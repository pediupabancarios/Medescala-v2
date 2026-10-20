-- MedEscala — "virada" para plantões em tabela própria.
-- Rodar SÓ DEPOIS que o index.html novo (commit bea636a ou posterior) estiver publicado no GitHub Pages.
-- (A fase 1 — tabelas, funções, cron — já foi aplicada pelas migrations
--  medescala_fase1_plantoes_historico_backups / medescala_backup_diario_pg_cron.)

-- 1) Sincronização final: traz do formato antigo o que versões antigas do app ainda gravaram depois da cópia inicial
create or replace function public.medescala_cutover_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_since timestamptz; n_ins int; n_upd int; n_del int; v_leg jsonb;
begin
  select max(updated_at) into v_since from medescala_shifts where updated_by = 'migracao';
  select medescala_safe_jsonb(value) into v_leg from medescala_data where key = 'shifts';
  if jsonb_typeof(v_leg) <> 'array' or jsonb_array_length(v_leg) = 0 then
    raise exception 'formato antigo vazio ou inválido — nada foi sincronizado';
  end if;
  perform set_config('medescala.actor', 'sincronização do formato antigo', true);
  -- novos (e não apagados na tabela nova depois da cópia)
  insert into medescala_shifts (id, date, type, doc_id, data, updated_by)
    select e->>'id', e->>'date', e->>'type', e->>'docId', e, 'formato-antigo'
    from jsonb_array_elements(v_leg) e
    where not exists (select 1 from medescala_audit a where a.entity = 'shift' and a.entity_id = e->>'id' and a.action = 'delete' and a.ts > v_since)
  on conflict (id) do nothing;
  get diagnostics n_ins = row_count;
  -- alterados no formato antigo, em linhas que a tabela nova não tocou desde a cópia
  update medescala_shifts s
     set date = l.e->>'date', type = l.e->>'type', doc_id = l.e->>'docId', data = l.e, updated_at = now(), updated_by = 'formato-antigo'
    from jsonb_array_elements(v_leg) l(e)
   where s.id = l.e->>'id' and s.data is distinct from l.e and s.updated_at <= v_since;
  get diagnostics n_upd = row_count;
  -- apagados no formato antigo (linha intocada desde a cópia e ausente lá); limite de segurança
  with gone as (select id from medescala_shifts s
                 where s.updated_by = 'migracao' and not exists (select 1 from jsonb_array_elements(v_leg) l(e) where l.e->>'id' = s.id))
  delete from medescala_shifts where id in (select id from gone) and (select count(*) from gone) <= 40;
  get diagnostics n_del = row_count;
  return jsonb_build_object('inseridos', n_ins, 'atualizados', n_upd, 'apagados', n_del);
end $$;
revoke all on function public.medescala_cutover_sync() from public, anon, authenticated;
select public.medescala_cutover_sync();

-- 2) Espelho: a cada mudança na tabela nova, a chave antiga 'shifts' é reescrita (versões antigas do app continuam LENDO dados corretos)
create or replace function public.medescala_shifts_mirror() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update medescala_data
     set value = (select coalesce(jsonb_agg(data order by date, id), '[]'::jsonb)::text from medescala_shifts)
   where key = 'shifts';
  return null;
end $$;
drop trigger if exists medescala_shifts_mirror_trg on public.medescala_shifts;
create trigger medescala_shifts_mirror_trg after insert or update or delete on public.medescala_shifts
  for each statement execute function public.medescala_shifts_mirror();

-- 3) Proteção: versões antigas do app não conseguem mais GRAVAR na chave antiga (receberiam erro e a mensagem pedindo para recarregar)
create or replace function public.medescala_protect_legacy() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() <= 1 and ((tg_op = 'DELETE' and old.key = 'shifts') or (tg_op <> 'DELETE' and new.key = 'shifts')) then
    raise exception 'Versão antiga do MedEscala: recarregue a página (Cmd+Shift+R) para continuar.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists medescala_protect_legacy_trg on public.medescala_data;
create trigger medescala_protect_legacy_trg before insert or update or delete on public.medescala_data
  for each row execute function public.medescala_protect_legacy();

-- Reverter (se necessário): drop trigger medescala_protect_legacy_trg on public.medescala_data;
--                           drop trigger medescala_shifts_mirror_trg on public.medescala_shifts;
