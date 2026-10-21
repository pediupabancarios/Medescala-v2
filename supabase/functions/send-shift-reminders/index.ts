// Envia os lembretes de plantão (Web Push). Chamada pelo pg_cron a cada 5 min e pelo botão "Enviar teste".
// verify_jwt = false: a autenticação é o cabeçalho x-cron-secret (guardado em medescala_secrets).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "Content-Type": "application/json" } });
const APP = "https://pediupabancarios.github.io/Medescala-v2/";

async function secret(name: string) {
  const { data } = await sb.from("medescala_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value as string | undefined;
}
// as chaves VAPID são criadas aqui na primeira chamada e nunca saem do banco (só a pública é devolvida)
async function vapid() {
  let pub = await secret("vapid_public"), priv = await secret("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await sb.from("medescala_secrets").upsert([{ name: "vapid_public", value: k.publicKey }, { name: "vapid_private", value: k.privateKey }], { onConflict: "name", ignoreDuplicates: true });
    pub = await secret("vapid_public"); priv = await secret("vapid_private");
  }
  webpush.setVapidDetails(APP, pub!, priv!);
  return pub!;
}
const p2 = (n: number) => String(n).padStart(2, "0");
const brt = (d: Date) => { const x = new Date(d.getTime() - 3 * 3600e3); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`; };

async function push(sub: any, payload: object) {
  try { await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 }); return true; }
  catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("medescala_push_subs").delete().eq("endpoint", sub.endpoint);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* sem corpo */ }
  const mode = body.mode || "cron";

  if (mode === "info") return json({ publicKey: await vapid() });

  if (req.headers.get("x-cron-secret") !== (await secret("cron_secret"))) return json({ error: "nao autorizado" }, 401);
  await vapid();

  if (mode === "test") {
    const { data: s } = await sb.from("medescala_push_subs").select("sub").eq("endpoint", body.endpoint).maybeSingle();
    if (!s) return json({ error: "aparelho nao inscrito" }, 404);
    const ok = await push(s.sub, { title: "✅ Lembretes funcionando", body: "Você vai receber avisos antes dos seus plantões.", url: "./#/myshifts", tag: "teste" });
    return json({ sent: ok ? 1 : 0 });
  }

  // cron: plantões de hoje/amanhã (horário de Brasília) que começam nos próximos 60 min
  const now = new Date();
  const dias = [brt(now), brt(new Date(now.getTime() + 24 * 3600e3))];
  const { data: rows, error } = await sb.from("medescala_shifts").select("data").in("data->>date", dias);
  if (error) return json({ error: error.message }, 500);
  let sent = 0;
  for (const r of rows || []) {
    const s = r.data; if (!s?.docId || !s.date) continue;
    const noturno = s.type === "N" || s.type === "n";
    const [y, m, d] = s.date.split("-").map(Number);
    const mins = Math.round((Date.UTC(y, m - 1, d, (noturno ? 19 : 7) + 3) - now.getTime()) / 60000);
    const kind = mins > 15 && mins <= 60 ? "1h" : mins > 0 && mins <= 15 ? "15m" : null;
    if (!kind) continue;
    const { data: subs } = await sb.from("medescala_push_subs").select("sub").eq("doc_id", s.docId);
    if (!subs?.length) continue;
    const { error: dup } = await sb.from("medescala_push_log").insert({ shift_id: String(s.id), kind, doc_id: s.docId });
    if (dup) continue; // já avisado
    for (const x of subs) if (await push(x.sub, {
      title: `⏰ Plantão ${noturno ? "noturno" : "diurno"} em ${mins} min`,
      body: `${noturno ? "19h às 07h" : "07h às 19h"} — ${s.sector || "UPA Pediátrica"}`, url: "./#/myshifts", tag: `${s.id}-${kind}` })) sent++;
  }
  await sb.from("medescala_push_log").delete().lt("sent_at", new Date(now.getTime() - 3 * 86400e3).toISOString());
  return json({ checked: rows?.length || 0, sent });
});
