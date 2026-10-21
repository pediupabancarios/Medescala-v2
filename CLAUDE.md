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

## Testes automáticos
- 28 testes em `tests/suite.js` rodam o **app de verdade** (`index.html` em iframes) contra um **banco Supabase falso** (`makeServer` em `tests/runner.html`) — nenhum teste toca o banco real. Cobrem os incidentes: escala apagada por falha de leitura, "hoje" em UTC, limite 2/turno, gravação só do que mudou, remoção em massa, sincronização leve, fotos no Storage, trocas com data, navegação/busca por perfil, planilha oficial (mês de 30 dias × dezembro) e abertura das 23 telas.
- **No GitHub:** `.github/workflows/ci.yml` roda a cada Push (sintaxe dos scripts + testes no Chromium, fuso de Brasília). Falhou = X vermelho no commit.
- **No navegador (sem Node):** servir a pasta (`.claude/launch.json`, porta 8852) e abrir `http://localhost:8852/tests/runner.html` — o título da aba mostra `OK 28/28`.
- **Com Node:** `npm install --no-save playwright && npx playwright install chromium && node tests/run-ci.js`.
- Todo bug novo: escreva o teste que o reproduz em `tests/suite.js` antes de corrigir.

## Navegação
- Barra inferior **por perfil** (`bnItems()`): gestor = Início, Escala, Trocas (ponto vermelho se há trocas pendentes), Gerenciar, Mais; médico = Início, Meu Plantão, Escala, Trocas, Mais (ponto no Mais se há repasse aberto no Mural). O gesto de deslizar usa a mesma ordem.
- **Mais** (`openMoreSheet()`) lista todas as telas fora da barra, agrupadas por `navItems()` (`sec`): Principal, Gestão, Administração, Conta, Ferramentas clínicas + Sair. Tela nova: adicione em `navItems()` (e em `GESTOR_ONLY` se for só do gestor).
- Cada tela tem endereço `#/<pagina>` (`navPush`, `pageFromHash`, `pageAllowed`): botão voltar do celular/navegador funciona; com painel/menu aberto o voltar só fecha o painel; link direto vale depois do login; médico não abre tela de `GESTOR_ONLY`.

- **Início** (`dashActions()`): cartão "Precisa de atenção" — gestor: trocas pendentes, vagas (<2 por turno) nos próximos 14 dias (`vagasProx`; só meses já lançados), plantão ativo >14h, repasses abertos; médico: repasses disponíveis, solicitação pendente, plantão amanhã. Cada linha leva à tela (`goCalDate(data)` destaca o dia no calendário).
- **Calendário**: botões Hoje / Meu próximo plantão (`calToday`, `calGoMine`), filtro por médico (`_calF`: all|mine|id), salto de mês (`calJump`) e deslizar troca o mês (em `initSwipe`, só nessa tela).
- **Relatórios**: setas ‹ › (`repStep`) e menu **Exportar** (`openExportMenu`) com PDF, Excel, Grade e Planilha Oficial.
- **Busca** (topo ou Cmd/Ctrl+K ou `/`): além de médicos e plantões acha telas e ações (`searchTargets`, sem acento; ações do gestor só aparecem para o gestor).
- **Legibilidade**: nada abaixo de 10px fora dos modelos de impressão; bloco `<style id="ux-extra">` define alvos de toque (botões ≥38/44px) e campos com 16px no celular.

- **Datas**: sempre horário **local** (Brasília). `tdStr()`/`dayStr()`/`ymStr()` usam getters locais — nunca `toISOString()` para 'hoje' (UTC vira o dia às 21h). Plantão noturno de madrugada pertence ao dia anterior (`pgAgora` usa o dia anterior antes das 07h).

## Dados: onde cada coisa mora (Supabase `ovkfrtozsyorosjymwoi`)
- `medescala_shifts` — **uma linha por plantão** (`id, date, type, doc_id, data jsonb, updated_at, updated_by`). Fonte da verdade dos plantões. O app só **lê** a tabela; toda escrita passa pela função `medescala_save_shifts(p_upserts, p_deletes, p_actor, p_force)` (atômica, bloqueia remoção em massa > max(40, 25%) sem `p_force`).
- `saveShifts()` no app grava **só o que mudou** (diff contra `SHIFTS_SNAP`). Por isso dois aparelhos editando plantões diferentes não se sobrescrevem mais.
- `medescala_audit` — histórico (quem/o quê/antes/depois). Plantões: gatilho no banco. docs/trocas/avisos/ocorrências/meses: o app envia via `medescala_log_audit` (`auditAfterSave`). Tela Log → "Histórico de alterações" (com ↩ Restaurar para plantão apagado).
- `medescala_backups` — snapshot completo diário às 03:00 (pg_cron `medescala-backup-diario`, guarda 60 dias) + manuais (guarda 20). Baixáveis na tela Log. Restauração: só via SQL (`medescala_restore_backup`), nunca pelo app.
- `medescala_data` (chave/valor) continua para: docs, months, exchanges, notifs, log, avisos, msgs, ocorrencias. A chave legada `shifts` é só espelho para versões antigas do app.
- Plano **free**: sem backup do Supabase — os backups acima são a rede de segurança. Faça também download local periódico (aviso automático após 14 dias).
- Trocas/repasses (`exchanges`) guardam `fromDate/fromType/toDate/toType` além dos IDs dos plantões; telas usam `exInfo(e,'from'|'to')` (cai no ID só se faltar a data). `backfillExchDates()` completa registros antigos quando o plantão ainda existe.
- Tempo real: `medescala_shifts` está na publicação `supabase_realtime`; o app trata INSERT/UPDATE/DELETE em `applyShiftChange`.

- **Consumo de dados** (plano free: 5 GB/mês de saída): `doSync()` só pergunta as versões (`medescala_data.updated_at`, ~460 bytes) e baixa **apenas as chaves que mudaram**; plantões vêm do tempo real e são relidos por inteiro só no login, no botão Sync, na reconexão ou a cada 10 min (a cada 60s se o tempo real estiver fora). Fotos dos médicos ficam no bucket público `medescala-fotos` (`<docId>.jpg`) e `doc.photo` guarda só o endereço (`uploadFotoStorage`). Nunca gravar foto em base64 no cadastro.

## ⚠️ Proteção contra perda de dados (incidente 2026-10-17)
O app já apagou ago/set/out ao gravar a escala de fábrica quando a leitura falhou. Regras:
- `save(key)` só grava chave lida com sucesso na sessão (`LOADED`); chaves em `medescala_data` pedem confirmação se encolherem >50%.
- **Nunca** reintroduzir seed/saveAll automático. Toda escrita de plantão passa por `save('shifts')`.

## Planilha oficial da Prefeitura (.xlsx)
- Importar Plantões → upload (descobre o mês pelo dia da semana; casa médico por nome ou CRM; preview e confirmação).
- Relatórios → "Planilha Oficial" (download no mesmo layout). Extrator externo: `~/Documents/UPA/Escala/extrair_escala.py` (.numbers/.xlsx → CSV).

## App instalável, offline e lembretes (push)
- `manifest.json` + ícones (`icon-192/512.png`, `apple-touch-icon.png`, `icon.svg`) e `sw.js` (rede primeiro, cache como reserva; trata `push` e `notificationclick`). Subir `const C` em `sw.js` limpa o cache antigo. `?nosw=1` na URL desliga o registro (os testes usam).
- Offline: `saveCache()`/`loadCache()` guardam a última escala em `localStorage.mes_cache_v1`; sem internet o app mostra esses dados em **só leitura** (`LOADED` continua falso, então nada é gravado).
- Lembretes (só médicos, cartão no Perfil): `enablePush()` pede permissão (precisa de toque do usuário; no iPhone só com o app instalado), busca a chave pública na Edge Function (`mode:'info'`) e grava a inscrição via RPC `medescala_push_subscribe`.
- Servidor: `supabase/push.sql` (tabelas `medescala_secrets`/`medescala_push_subs`/`medescala_push_log`, RPCs, job pg_cron `*/5 9,21 * * *` UTC) + `supabase/functions/send-shift-reminders/index.ts` (verify_jwt=false; autentica por `x-cron-secret`; gera as chaves VAPID na 1ª chamada; avisa 1 h e 15 min antes; 07h/19h de Brasília). **Em produção desde 2026-10-21** (SQL aplicado, função publicada e testada; o agendador também tem job de backup diário separado).

## E-mail de trocas e repasses
- Cada médico (e o gestor) cadastra o e-mail em Perfil → ✉️ Meu e-mail (`doc.email`); o gestor também edita em Médicos. O gestor (role `gestor`) recebe **uma única mensagem por troca/repasse**, quando ela se concretiza (`done`/`claimed`/`approved`, nunca repetida); anúncio, recusa e cancelamento vão só aos envolvidos.
- `mailExch(id, evento)` no app avisa a Edge Function `send-exchange-email` (eventos: `done`, `announced`, `claimed`, `approved`, `rejected`, `cancelled`). A função lê a troca e os e-mails **do banco** (o app não escolhe destinatário), confere se o estado bate com o evento, ignora eventos com mais de 6 h e evita duplicados em `medescala_email_log`.
- Provedor: Secrets da Edge Function no painel do Supabase — Gmail: `SMTP_USER` + `SMTP_PASS` (senha de app) | Brevo: `BREVO_API_KEY` + `MAIL_FROM`. Sem provedor a função só responde "provedor não configurado" e nada quebra. SQL em `supabase/email.sql`.
