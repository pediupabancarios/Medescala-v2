-- Aviso por e-mail das trocas e repasses. Rodar UMA vez. A senha/chave do e-mail NÃO fica aqui: vai nos Secrets da Edge Function.
create table if not exists public.medescala_email_log (
  exch_id text not null,
  event text not null,
  sent_at timestamptz default now(),
  primary key (exch_id, event)
);
alter table public.medescala_email_log enable row level security;
revoke all on public.medescala_email_log from anon, authenticated;
