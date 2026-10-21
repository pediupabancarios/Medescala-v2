-- Lembretes de plantão com o app fechado (Web Push). Rodar UMA vez no Supabase (SQL Editor) ou via migração.
-- Chaves VAPID e segredo do agendador ficam em medescala_secrets (sem acesso para anon/authenticated).
create extension if not exists pg_net with schema extensions;

create table if not exists public.medescala_secrets (name text primary key, value text not null, created_at timestamptz default now());
create table if not exists public.medescala_push_subs (
  endpoint text primary key,
  doc_id text not null,
  sub jsonb not null,
  ua text,
  created_at timestamptz default now()
);
create index if not exists medescala_push_subs_doc on public.medescala_push_subs(doc_id);
create table if not exists public.medescala_push_log (
  shift_id text not null,
  kind text not null,
  doc_id text not null,
  sent_at timestamptz default now(),
  primary key (shift_id, kind, doc_id)
);
alter table public.medescala_secrets enable row level security;
alter table public.medescala_push_subs enable row level security;
alter table public.medescala_push_log enable row level security;
revoke all on public.medescala_secrets, public.medescala_push_subs, public.medescala_push_log from anon, authenticated;

-- segredo que o agendador (pg_cron) usa para chamar a função; gerado aqui, nunca sai do banco
insert into public.medescala_secrets(name,value) values ('cron_secret', encode(extensions.gen_random_bytes(24),'hex')) on conflict do nothing;

create or replace function public.medescala_push_subscribe(p_doc_id text, p_sub jsonb, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
declare ep text := p_sub->>'endpoint';
begin
  if ep is null or ep !~ '^https://' or length(ep) > 1000 or coalesce(p_doc_id,'') = '' or length(p_doc_id) > 80 then
    raise exception 'inscricao invalida';
  end if;
  if p_sub->'keys'->>'p256dh' is null or p_sub->'keys'->>'auth' is null then raise exception 'inscricao sem chaves'; end if;
  insert into medescala_push_subs(endpoint, doc_id, sub, ua) values (ep, p_doc_id, p_sub, left(p_ua,120))
  on conflict (endpoint) do update set doc_id = excluded.doc_id, sub = excluded.sub, ua = excluded.ua, created_at = now();
  -- no máximo 5 aparelhos por médico (mantém os mais recentes)
  delete from medescala_push_subs where doc_id = p_doc_id and endpoint not in
    (select endpoint from medescala_push_subs where doc_id = p_doc_id order by created_at desc limit 5);
end $$;

create or replace function public.medescala_push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from medescala_push_subs where endpoint = p_endpoint;
$$;

create or replace function public.medescala_push_test(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
declare sec text;
begin
  if not exists (select 1 from medescala_push_subs where endpoint = p_endpoint) then raise exception 'aparelho nao inscrito'; end if;
  select value into sec from medescala_secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://ovkfrtozsyorosjymwoi.supabase.co/functions/v1/send-shift-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',sec),
    body := jsonb_build_object('mode','test','endpoint',p_endpoint));
end $$;

grant execute on function public.medescala_push_subscribe(text,jsonb,text), public.medescala_push_unsubscribe(text), public.medescala_push_test(text) to anon, authenticated;

-- verifica a cada 5 min só nas horas que importam (UTC 09h e 21h = 1h antes dos plantões das 07h e 19h de Brasília)
select cron.schedule('medescala-lembretes', '*/5 9,21 * * *', $job$
  select net.http_post(
    url := 'https://ovkfrtozsyorosjymwoi.supabase.co/functions/v1/send-shift-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.medescala_secrets where name='cron_secret')),
    body := '{"mode":"cron"}'::jsonb)
$job$);
