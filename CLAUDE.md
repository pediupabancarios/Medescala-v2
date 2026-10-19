# MedEscala — UPA Pediátrica Bancários JP

## O que é
PWA de gestão de escalas médicas da UPA Pediátrica Bancários (UPA 24H Bancários), João Pessoa/PB.
Coordenador: Dr. Rodrigo Cahuana Chipayo — CRM 11707/PB.
App **separado** do Hemocentro (Triagem em `../hemocentro-app-projeto`, Escala Hemocentro em `../escala hemocentro`).

## Stack / deploy
- **Single file:** `index.html` (HTML + CSS + JS inline; SheetJS via CDN para .xlsx).
- **Backend:** Supabase, projeto `ovkfrtozsyorosjymwoi`, tabela `medescala_data` (chave/valor: `docs, shifts, months, exchanges, notifs, log, avisos, msgs, ocorrencias`). Plano **free: sem backup** — use "Backup do sistema" (Log) com frequência.
- **Repositório:** `pediupabancarios/Medescala-v2` → GitHub Pages `https://pediupabancarios.github.io/Medescala-v2/`.
- **Publicar:** commit aqui e **Push origin pelo GitHub Desktop** (o git de linha de comando não tem credencial).
- **Local:** servidor `.claude/launch.json` (porta 8852). Login gestor: `rodrigo.cahuana` / CRM.

## Arquitetura JS
`ST` estado global · `CU` usuário · `PG_MAP{}` páginas · `goTo(pg)` · `G(id)` · `save(key)` grava no Supabase · `doSync()` lê tudo · `isG()` gestor.
Páginas: dashboard, calendar, myshifts, board, exchanges, ms, mm, md, rep, lg, geo, avisos, chat, horas, perfil, agora, ocorrencias, passagem, importar, passagens, instalar, sri, gaso.

## Regras de negócio
- **Máx. 2 plantonistas por turno e 4 por dia** (D/d = diurno, N/n = noturno), bloqueante: `checkDayLimit()` / `shiftPeriod()`. Todo fluxo que cria plantão deve chamá-la.
- Tipos: D (07-19h), N (19-07h), d (Extra D), n (Extra N). Gestor CRM 11707 tem acesso total.

## ⚠️ Proteção contra perda de dados (incidente 2026-10-17)
O app já apagou ago/set/out ao gravar a escala de fábrica quando a leitura falhou. Hoje:
- `save(key)` só grava chaves lidas com sucesso na sessão (`LOADED`) e pede confirmação se a gravação reduzir a chave em >50% (`LOADEDLEN`).
- **Nunca** reintroduzir seed/saveAll automático. Toda escrita nova passa por `save()`.

## Planilha oficial da Prefeitura (.xlsx)
- Importar Plantões → upload (descobre o mês pelo dia da semana; casa médico por nome ou CRM; preview e confirmação).
- Relatórios → "Planilha Oficial" (download no mesmo layout). Extrator externo: `~/Documents/UPA/Escala/extrair_escala.py` (.numbers/.xlsx → CSV).
