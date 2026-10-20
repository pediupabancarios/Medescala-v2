# MedEscala — UPA Pediátrica Bancários JP

## O que é
PWA de gestão de escalas médicas da UPA Pediátrica Bancários (UPA 24H Bancários), João Pessoa/PB.
Coordenador: Dr. Rodrigo Cahuana Chipayo — CRM 11707/PB.
App **separado** do Hemocentro (Triagem em `../hemocentro-app-projeto`, Escala Hemocentro em `../escala hemocentro`).

## Stack / deploy
- **Single file:** `index.html` (HTML + CSS + JS inline; SheetJS via CDN para .xlsx).
- **Backend:** Supabase `ovkfrtozsyorosjymwoi` (ver "Dados" abaixo).
- **Repositório:** `pediupabancarios/Medescala-v2` → GitHub Pages `https://pediupabancarios.github.io/Medescala-v2/`.
- **Publicar:** commit aqui e **Push origin pelo GitHub Desktop** (o git de linha de comando não tem credencial).
- **Local:** servidor `.claude/launch.json` (porta 8852). Login gestor: `rodrigo.cahuana` / CRM.

## Arquitetura JS
`ST` estado global · `CU` usuário · `PG_MAP{}` páginas · `goTo(pg)` · `G(id)` · `save(key)` grava no Supabase · `doSync()` lê tudo · `isG()` gestor.
Páginas: dashboard, calendar, myshifts, board, exchanges, ms, mm, md, rep, lg, geo, avisos, chat, horas, perfil, agora, ocorrencias, passagem, importar, passagens, instalar, sri, gaso.

## Regras de negócio
- **Máx. 2 plantonistas por turno e 4 por dia** (D/d = diurno, N/n = noturno), bloqueante: `checkDayLimit()` / `shiftPeriod()`. Todo fluxo que cria plantão deve chamá-la.
- Tipos: D (07-19h), N (19-07h), d (Extra D), n (Extra N). Gestor CRM 11707 tem acesso total.

## Dados: onde cada coisa mora (Supabase `ovkfrtozsyorosjymwoi`)
- `medescala_shifts` — **uma linha por plantão** (`id, date, type, doc_id, data jsonb, updated_at, updated_by`). Fonte da verdade dos plantões. O app só **lê** a tabela; toda escrita passa pela função `medescala_save_shifts(p_upserts, p_deletes, p_actor, p_force)` (atômica, bloqueia remoção em massa > max(40, 25%) sem `p_force`).
- `saveShifts()` no app grava **só o que mudou** (diff contra `SHIFTS_SNAP`). Por isso dois aparelhos editando plantões diferentes não se sobrescrevem mais.
- `medescala_audit` — histórico (quem/o quê/antes/depois). Plantões: gatilho no banco. docs/trocas/avisos/ocorrências/meses: o app envia via `medescala_log_audit` (`auditAfterSave`). Tela Log → "Histórico de alterações" (com ↩ Restaurar para plantão apagado).
- `medescala_backups` — snapshot completo diário às 03:00 (pg_cron `medescala-backup-diario`, guarda 60 dias) + manuais (guarda 20). Baixáveis na tela Log. Restauração: só via SQL (`medescala_restore_backup`), nunca pelo app.
- `medescala_data` (chave/valor) continua para: docs, months, exchanges, notifs, log, avisos, msgs, ocorrencias. A chave legada `shifts` é só espelho para versões antigas do app.
- Plano **free**: sem backup do Supabase — os backups acima são a rede de segurança. Faça também download local periódico (aviso automático após 14 dias).
- Tempo real: `medescala_shifts` está na publicação `supabase_realtime`; o app trata INSERT/UPDATE/DELETE em `applyShiftChange`.

## ⚠️ Proteção contra perda de dados (incidente 2026-10-17)
O app já apagou ago/set/out ao gravar a escala de fábrica quando a leitura falhou. Regras:
- `save(key)` só grava chave lida com sucesso na sessão (`LOADED`); chaves em `medescala_data` pedem confirmação se encolherem >50%.
- **Nunca** reintroduzir seed/saveAll automático. Toda escrita de plantão passa por `save('shifts')`.

## Planilha oficial da Prefeitura (.xlsx)
- Importar Plantões → upload (descobre o mês pelo dia da semana; casa médico por nome ou CRM; preview e confirmação).
- Relatórios → "Planilha Oficial" (download no mesmo layout). Extrator externo: `~/Documents/UPA/Escala/extrair_escala.py` (.numbers/.xlsx → CSV).
