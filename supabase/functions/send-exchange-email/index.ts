// Envia por e-mail o aviso de troca/repasse: para quem participou + cópia ao gestor.
// O app só diz QUAL troca e QUAL evento; destinatários e texto saem do banco (ninguém consegue mandar e-mail para endereço arbitrário).
// Provedor (Secrets da Edge Function): Gmail -> SMTP_USER + SMTP_PASS (senha de app)  |  Brevo -> BREVO_API_KEY + MAIL_FROM
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const STATUS_DO_EVENTO: Record<string, string> = { done: "approved", claimed: "approved", approved: "approved", announced: "open", rejected: "rejected", cancelled: "cancelled" };
const TIPO: Record<string, string> = { D: "Diurno 07–19h", d: "Extra diurno 07–19h", N: "Noturno 19–07h", n: "Extra noturno 19–07h" };
const fd = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");

async function ler(key: string) {
  const { data } = await sb.from("medescala_data").select("value").eq("key", key).maybeSingle();
  const v = data?.value; try { return typeof v === "string" ? JSON.parse(v) : (v ?? []); } catch { return []; }
}

function montar(ev: string, e: any, nome: (id?: string) => string) {
  const tipo = e.type === "passover" ? "Repasse" : "Troca";
  const de = nome(e.fromDocId), para = e.toDocId ? nome(e.toDocId) : null;
  const t = ({
    done: [`🔄 Troca realizada: ${de} ↔ ${para}`, "Troca realizada"],
    announced: [`📤 Repasse anunciado: ${de}`, "Repasse anunciado (aguardando alguém assumir)"],
    claimed: [`✋ Repasse assumido: ${para} assumiu de ${de}`, "Repasse assumido"],
    approved: [`✅ ${tipo} aprovado: ${de}${para ? " ↔ " + para : ""}`, `${tipo} aprovado`],
    rejected: [`⛔ ${tipo} recusado: ${de}`, `${tipo} recusado`],
    cancelled: [`${tipo} cancelado: ${de}`, `${tipo} cancelado`],
  } as Record<string, string[]>)[ev];
  const linha = (rot: string, v: string) => `<tr><td style="padding:6px 12px;color:#555">${rot}</td><td style="padding:6px 12px"><b>${esc(v)}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="color:#047857;margin:0 0 12px">${esc(t[1])}</h2>
<table style="border-collapse:collapse;background:#f4fbf8;border-radius:8px">
${linha("De", de)}${para ? linha("Para", para) : ""}
${linha(e.type === "passover" ? "Plantão" : "Plantão de " + de, `${fd(e.fromDate)} · ${TIPO[e.fromType] || "—"}`)}
${e.type === "exchange" ? linha("Plantão de " + para, `${fd(e.toDate)} · ${TIPO[e.toType] || "—"}`) : ""}
${e.reason ? linha("Motivo", e.reason) : ""}</table>
<p style="color:#777;font-size:12px;margin-top:16px">MedEscala — UPA Pediátrica Bancários. Aviso automático, não responda este e-mail.</p></div>`;
  return { subject: t[0], html };
}

async function enviar(to: string[], subject: string, html: string) {
  const user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS"), brevo = Deno.env.get("BREVO_API_KEY");
  if (user && pass) {
    const tr = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await tr.sendMail({ from: `"MedEscala UPA" <${user}>`, to: to[0], cc: to.slice(1), subject, html });
    return true;
  }
  if (brevo) {
    const from = Deno.env.get("MAIL_FROM") || "";
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": brevo, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: "MedEscala UPA", email: from }, to: to.map((email) => ({ email })), subject, htmlContent: html }) });
    if (!r.ok) throw new Error("Brevo " + r.status);
    return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let b: any = {}; try { b = await req.json(); } catch (_) { /* vazio */ }
  const ev = String(b.event || ""), id = String(b.exch_id || "");
  if (!(ev in STATUS_DO_EVENTO) || !id) return json({ error: "pedido inválido" }, 400);

  const [exchs, docs] = await Promise.all([ler("exchanges"), ler("docs")]);
  const e = (exchs as any[]).find((x) => x.id === id);
  if (!e) return json({ skipped: "troca não encontrada" });
  if (e.status !== STATUS_DO_EVENTO[ev]) return json({ skipped: "estado da troca não confere com o evento" });
  if (Date.now() - (e.resolvedAt || e.createdAt || 0) > 6 * 3600e3) return json({ skipped: "evento antigo" });

  const porId = new Map((docs as any[]).map((d) => [d.id, d]));
  const nome = (i?: string) => String(porId.get(i || "")?.name || "—");
  const ids = [e.fromDocId, e.toDocId].filter(Boolean);
  const gestores = (docs as any[]).filter((d) => d.role === "gestor");
  const to = [...new Set([...ids.map((i) => porId.get(i)?.email), ...gestores.map((g) => g.email)].filter((m) => typeof m === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)).map((m) => m.toLowerCase()))];
  const { subject, html } = montar(ev, e, nome);
  if (b.dry && req.headers.get("x-cron-secret")) {
    const { data: s } = await sb.from("medescala_secrets").select("value").eq("name", "cron_secret").maybeSingle();
    if (s?.value === req.headers.get("x-cron-secret")) return json({ dry: true, to, subject });
  }
  if (!to.length) return json({ skipped: "ninguém tem e-mail cadastrado" });

  const { error: dup } = await sb.from("medescala_email_log").insert({ exch_id: id, event: ev });
  if (dup) return json({ skipped: "já enviado" });
  try {
    const ok = await enviar(to, subject, html);
    if (!ok) { await sb.from("medescala_email_log").delete().eq("exch_id", id).eq("event", ev); return json({ skipped: "provedor de e-mail não configurado" }); }
    return json({ sent: to.length });
  } catch (err) {
    await sb.from("medescala_email_log").delete().eq("exch_id", id).eq("event", ev);
    return json({ error: String((err as Error).message || err).slice(0, 200) }, 500);
  }
});
