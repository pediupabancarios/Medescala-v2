/* Testes do MedEscala. Cada teste abre o app (index.html) num iframe novo, com banco FALSO.
   Os testes marcados "[incidente]" travam erros que já aconteceram em produção. */
function SUITE(h){
  var test=h.test,eq=h.eq,ok=h.ok,skip=h.skip,newApp=h.newApp,makeServer=h.makeServer,sleep=h.sleep,DOCS3=h.DOCS3,shift=h.shift,many=h.many,doc=h.doc;
  var FUSO=Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function appComo(user,seed){
    var A=await newApp(),S=makeServer(seed||{data:{docs:DOCS3}});
    A.fetch=S.fetch;A.CU=user||DOCS3[0];
    return {A:A,S:S};
  }

  /* ───────── Datas (incidente 2026-10: "hoje" em UTC) ───────── */
  test('[incidente] tdStr usa a data de Brasília às 21:30 (não vira o dia)',async function(){
    if(FUSO!=='America/Fortaleza')skip('fuso do navegador é '+FUSO);
    var A=await newApp();h.mockDate(A,'2026-10-21T00:30:00Z');
    eq(A.tdStr(),'2026-10-20');
    h.mockDate(A,'2026-10-21T02:59:00Z');eq(A.tdStr(),'2026-10-20','23:59');
    h.mockDate(A,'2026-10-21T06:00:00Z');eq(A.tdStr(),'2026-10-21','03:00');
  });
  test('dayStr e ymStr',async function(){
    var A=await newApp();
    eq(A.dayStr(new A.Date(2026,0,5)),'2026-01-05');eq(A.ymStr(new A.Date(2026,11,31)),'2026-12');
  });
  test('código-fonte não usa toISOString() para "hoje" e initApp não semeia a escala de fábrica',async function(){
    var src=await h.fonte();
    ok(!/toISOString\(\)\.slice\(0,\s*10\)/.test(src),'achei toISOString().slice(0,10) — usa UTC');
    var i=src.indexOf('function initApp()'),j=src.indexOf('\nfunction ',i+20),corpo=src.slice(i,j);
    ok(corpo.indexOf('SJUNE')<0&&corpo.indexOf('SMAIO')<0,'initApp voltou a semear SJUNE/SMAIO (incidente 17/10)');
    ok(corpo.indexOf('saveAll')<0,'initApp chama saveAll');
  });

  /* ───────── Regra: 2 por turno, 4 por dia ───────── */
  test('shiftPeriod agrupa D/d e N/n',async function(){
    var A=await newApp();eq([A.shiftPeriod('D'),A.shiftPeriod('d'),A.shiftPeriod('N'),A.shiftPeriod('n')],['D','D','N','N']);
  });
  test('checkDayLimit: 3º diurno é bloqueado, noturno livre, extra conta no mesmo turno',async function(){
    var A=await newApp();A.ST.shifts=many(2,'2026-10-10','D');
    eq(A.checkDayLimit('2026-10-10','D',null).ok,false);
    eq(A.checkDayLimit('2026-10-10','d',null).ok,false,'extra diurno conta como diurno');
    eq(A.checkDayLimit('2026-10-10','N',null).ok,true);
    eq(A.checkDayLimit('2026-10-10','D','x2026-10-10D0').ok,true,'editar o próprio plantão não conta');
    ok(/Limite de 2 plantonistas diurnos/.test(A.checkDayLimit('2026-10-10','D',null).msg));
  });
  test('checkDayLimit: 4 por dia (2 diurnos + 2 noturnos)',async function(){
    var A=await newApp();A.ST.shifts=many(2,'2026-10-11','D').concat(many(2,'2026-10-11','N'));
    eq(A.checkDayLimit('2026-10-11','N',null).ok,false);eq(A.checkDayLimit('2026-10-11','D',null).ok,false);
    eq(A.checkDayLimit('2026-10-12','D',null).ok,true,'outro dia livre');
  });
  test('vagasProx só considera meses que já têm escala',async function(){
    var A=await newApp();h.mockDate(A,'2026-10-30T15:00:00Z');
    A.ST.shifts=many(2,'2026-10-30','D').concat(many(1,'2026-10-30','N'),many(2,'2026-10-31','D'),many(2,'2026-10-31','N'));
    var v=A.vagasProx(5);
    eq(v.map(function(x){return x.date+x.p;}),['2026-10-30N'],'só falta 1 noturno em 30/10; novembro sem escala não gera vaga');
  });

  /* ───────── Segurança dos dados (incidente 2026-10-17) ───────── */
  test('[incidente] save() não grava chave que nunca foi lida',async function(){
    var c=await appComo();c.A.ST.shifts=[shift('a','2026-10-01','D','m1')];c.A.ST.docs=[];
    await c.A.save('shifts');await c.A.save('docs');
    eq(c.S.writes().length,0,'houve gravação sem ter lido o banco');
  });
  test('[incidente] leitura de plantões falha → nada é gravado e a escala não é "zerada" no banco',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(5,'2026-10-01','D')});
    c.S.failShifts=true;await c.A.doSync(true);
    ok(!c.A.LOADED.shifts,'LOADED.shifts deveria ser falso');
    c.A.ST.shifts=[shift('seed','2026-06-01','D','m1')];            // o "seed de fábrica" do incidente
    await c.A.save('shifts');
    eq(c.S.writes().length,0);eq(c.S.shifts.length,5,'o banco falso foi alterado');
  });
  test('doSync carrega plantões, médicos e marca tudo como lido',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(3,'2026-10-01','D')});
    await c.A.doSync(true);
    eq(c.A.ST.shifts.length,3);ok(c.A.LOADED.shifts&&c.A.LOADED.docs);ok(c.A.ST.docs.length>=3);
  });
  test('saveShifts envia só o que mudou (criar / alterar / apagar)',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:[shift('s1','2026-10-01','D','m1'),shift('s2','2026-10-02','N','m2')]});
    await c.A.doSync(true);
    await c.A.save('shifts');eq(c.S.rpcSaves().length,0,'sem mudança não envia nada');
    c.A.ST.shifts.find(function(x){return x.id==='s1';}).docId='m2';
    c.A.ST.shifts.push(shift('s3','2026-10-03','D','m1'));
    c.A.ST.shifts=c.A.ST.shifts.filter(function(x){return x.id!=='s2';});
    await c.A.save('shifts');
    var b=c.S.rpcSaves()[0];
    eq(b.p_upserts.map(function(x){return x.id;}).sort(),['s1','s3']);eq(b.p_deletes,['s2']);eq(b.p_force,false);
    ok(/Rodrigo/.test(b.p_actor),'quem fez entra no histórico');
    eq(c.S.shifts.map(function(x){return x.id;}).sort(),['s1','s3']);
  });
  test('remoção em massa pede confirmação; ao cancelar nada é enviado; ao confirmar vai com force',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(100,'2026-10-01','D')});
    await c.A.doSync(true);
    c.A.confirm=function(){return false;};c.A.ST.shifts=c.A.ST.shifts.slice(0,10);
    await c.A.save('shifts');eq(c.S.rpcSaves().length,0,'cancelou mas enviou');
    await h.sleep(300);c.A.confirm=function(){return true;};c.A.ST.shifts=c.A.ST.shifts.slice(0,10);
    await c.A.save('shifts');var b=c.S.rpcSaves()[0];
    eq(b.p_deletes.length,90);eq(b.p_force,true);
  });
  test('chaves não-plantão: encolher >50% pede confirmação',async function(){
    var big=[];for(var i=0;i<40;i++)big.push({id:'e'+i,type:'exchange',status:'approved'});
    var c=await appComo(null,{data:{docs:DOCS3,exchanges:big}});await c.A.doSync(true);
    c.A.confirm=function(){return false;};c.A.ST.exchanges=big.slice(0,5);
    await c.A.save('exchanges');eq(c.S.writes().length,0);
  });

  /* ───────── Consumo de dados (sincronização leve) ───────── */
  test('sincronização parada gasta só a consulta de versões',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(3,'2026-10-01','D')});
    await c.A.doSync(true);c.S.log.length=0;
    for(var i=0;i<3;i++){c.A.syncing=false;await c.A.doSync();}
    eq(c.S.log.length,3);ok(c.S.log.every(function(x){return x.p.indexOf('select=key,updated_at')>0;}),'baixou algo além das versões');
  });
  test('só a chave que mudou é baixada; plantões não são relidos',async function(){
    var c=await appComo(null,{data:{docs:DOCS3,exchanges:[]},shifts:many(3,'2026-10-01','D')});
    await c.A.doSync(true);c.S.ver.exchanges='v9';c.S.log.length=0;c.A.syncing=false;await c.A.doSync();
    var baixou=c.S.log.map(function(x){return x.p;}).filter(function(p){return p.indexOf('key=eq.')>=0||p.indexOf('medescala_shifts')===0;});
    eq(baixou.length,1);ok(baixou[0].indexOf('key=eq.exchanges')>=0);
  });
  test('se a consulta de versão falhar, volta a baixar tudo (comportamento antigo)',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(2,'2026-10-01','D')});
    await c.A.doSync(true);c.S.failVersions=true;c.S.log.length=0;c.A.syncing=false;await c.A.doSync();
    ok(c.S.log.some(function(x){return x.p.indexOf('medescala_shifts')===0;}),'não releu os plantões');
    ok(c.S.log.filter(function(x){return x.p.indexOf('key=eq.')>=0;}).length>=6,'não releu as chaves');
  });
  test('foto vai para o Storage e o cadastro guarda só o endereço',async function(){
    var c=await appComo();
    var png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    var url=await c.A.uploadFotoStorage('m1',png);
    var req=c.S.log.find(function(x){return x.p.indexOf('object/medescala-fotos/m1.png')===0;});
    ok(req,'não enviou ao bucket');eq(req.h['x-upsert'],'true');
    ok(/\/storage\/v1\/object\/public\/medescala-fotos\/m1\.png\?v=\d+$/.test(url),url);
  });

  /* ───────── Trocas ligadas à data ───────── */
  test('exInfo usa a data guardada e cai no plantão só se faltar',async function(){
    var A=await newApp();A.ST.shifts=[shift('s1','2026-10-05','N','m1')];
    eq(A.exInfo({fromDate:'2026-09-01',fromType:'D',fromShiftId:'s1'},'from'),{date:'2026-09-01',type:'D'});
    eq(A.exInfo({fromShiftId:'s1'},'from'),{date:'2026-10-05',type:'N'});
    eq(A.exInfo({fromShiftId:'sumiu'},'from'),null);
  });
  test('backfillExchDates completa registros antigos quando o plantão existe',async function(){
    var c=await appComo(null,{data:{docs:DOCS3,exchanges:[{id:'e1',type:'exchange',status:'approved',fromShiftId:'s1',toShiftId:'s2'},{id:'e2',type:'passover',status:'approved',fromShiftId:'sumiu'}]},shifts:[shift('s1','2026-10-05','N','m1'),shift('s2','2026-10-06','D','m2')]});
    await c.A.doSync(true);c.A.backfillExchDates();await h.sleep(200);
    var e1=c.S.data.exchanges[0];eq([e1.fromDate,e1.fromType,e1.toDate,e1.toType],['2026-10-05','N','2026-10-06','D']);
    ok(!c.S.data.exchanges[1].fromDate,'inventou data para plantão inexistente');
  });

  /* ───────── Navegação e busca ───────── */
  test('barra inferior por perfil',async function(){
    var A=await newApp();
    A.CU=DOCS3[0];eq(A.bnItems().map(function(i){return i.id;}),['dashboard','calendar','exchanges','ms']);
    A.CU=DOCS3[1];eq(A.bnItems().map(function(i){return i.id;}),['dashboard','myshifts','calendar','exchanges']);
  });
  test('link direto: médico não abre tela do gestor; gestor abre',async function(){
    var A=await newApp();A.history.replaceState(null,'','#/rep');
    A.CU=DOCS3[1];eq(A.pageFromHash(),null);
    A.CU=DOCS3[0];eq(A.pageFromHash(),'rep');
    A.history.replaceState(null,'','#/calendar');A.CU=DOCS3[1];eq(A.pageFromHash(),'calendar');
  });
  test('painel Mais lista as telas certas por perfil',async function(){
    var A=await newApp();
    A.CU=DOCS3[0];A.openMoreSheet();var t1=A.document.querySelector('#MODS .mo').innerText;
    ok(/Relatórios/.test(t1)&&/Log do Sistema/.test(t1)&&/Sair/.test(t1));
    A.CU=DOCS3[1];A.openMoreSheet();var t2=A.document.querySelector('#MODS .mo').innerText;
    ok(/Mural/.test(t2)&&!/Relatórios/.test(t2)&&!/Log do Sistema/.test(t2));
  });
  test('busca de telas e ações respeita o perfil e ignora acentos',async function(){
    var A=await newApp();
    A.CU=DOCS3[0];ok(A.searchTargets('relatorio').some(function(t){return /Relatórios/.test(t.lb);}),'sem acento');
    ok(A.searchTargets('backup').length>0);
    A.CU=DOCS3[1];eq(A.searchTargets('backup').length,0);eq(A.searchTargets('relatorio').length,0);
    ok(A.searchTargets('troca').length>0);
  });

  /* ───────── Planilha oficial (.xlsx) ───────── */
  function planilhaSetembro(){
    var dow=['ter','qua','qui','sex','sáb','dom','seg','ter','qua','qui','sex','sáb','dom','seg','ter','qua','qui','sex','sáb','dom','seg','ter','qua','qui','sex','sáb','dom','seg','ter','qua'];
    var dias=[];for(var i=1;i<=30;i++)dias.push(i);
    function linha(n,nome,crm,cel){var l=[n,'1',nome,crm,'7 AS 19H','20H','PLANTÃO'];for(var i=0;i<30;i++)l.push(cel[i+1]||null);l.push(0);return l;}
    return [
      ['','','MÊS/ AGOSTO             ANO:  /2026'],                       // cabeçalho errado de propósito (acontece de verdade)
      ['','','','','','',''].concat(dow),
      ['Nº','MATRÍCULA','NOME','CONSELHO','HORÁRIO','C.H.','REGIME'].concat(dias).concat(['TOTAL']),
      linha(1,'ANA PAULA GOMES SALES','19099/PB',{1:'D',2:'D/N'}),
      linha(2,'RAISSA DELANE TEBERG SOARES','13969/PB',{1:'N',2:'dn'}),   // grafia diferente do cadastro: casa pelo CRM
      linha(3,'RODRIGO CAHUANA CHIPAYO','11707/PB',{1:'COORDENADOR DO SETOR'})
    ];
  }
  test('[incidente] planilha de 30 dias: mês é setembro (não confunde com dezembro) mesmo com cabeçalho "agosto"',async function(){
    var A=await newApp();var rows=planilhaSetembro();
    var hi=A.ofAcharCabecalho(rows);eq(hi,2);eq(A.ofAcharAno(rows),2026);
    eq(A.ofDetectarMes(rows,hi,2026),[9]);
  });
  test('planilha: extrai D, N, D/N, dn, ignora anotações e casa nome divergente pelo CRM',async function(){
    var A=await newApp();A.ST.docs=DOCS3;var rows=planilhaSetembro();
    var r=A.ofExtrairEntradas(rows,A.ofAcharCabecalho(rows));
    eq(r.entries.map(function(e){return e.nome.split(' ')[0]+e.day+e.type;}).sort(),['ANA1D','ANA2D','ANA2N','RAISSA1N','RAISSA2d','RAISSA2n']);
    eq(r.ignorados.length,1);eq(r.semMatch,[]);eq(r.nomeDiverge.length,1);
  });
  test('planilha: importação que estoura o limite é bloqueada inteira',async function(){
    var A=await newApp();A.ST.docs=DOCS3;A.ST.shifts=many(2,'2026-09-01','D','g1');
    var rows=planilhaSetembro(),r=A.ofExtrairEntradas(rows,A.ofAcharCabecalho(rows));
    var comData=r.entries.map(function(e){return{day:e.day,type:e.type,nome:e.nome,match:e.match,date:'2026-09-'+('0'+e.day).slice(-2)};});
    var sim=A.ofSimularLote(comData);
    ok(Object.keys(sim.violacoes).indexOf('2026-09-01')>=0,'dia 1 já tem 2 diurnos e a planilha traz outro');
  });

  /* ───────── App instalável, offline e lembretes ───────── */
  test('PWA: manifesto, ícones e service worker existem e o app os usa',async function(){
    var m=await fetch('../manifest.json').then(function(r){return r.json();});
    eq(m.display,'standalone');ok(m.icons.length>=2,'ícones no manifesto');
    for(var i=0;i<m.icons.length;i++){var r=await fetch('../'+m.icons[i].src);ok(r.ok,'ícone '+m.icons[i].src+' não existe');}
    var sw=await fetch('../sw.js').then(function(r){return r.text();});
    ok(/addEventListener\('push'/.test(sw)&&/addEventListener\('notificationclick'/.test(sw),'sw sem push/notificationclick');
    var src=await h.fonte();
    ok(/rel="manifest" href="manifest\.json"/.test(src),'index não aponta para o manifesto');
    ok(/serviceWorker\.register\('sw\.js'\)/.test(src),'index não registra o sw.js');
    ok(!/registerServiceWorker\(\)\{return;/.test(src),'service worker voltou a ficar desligado');
  });
  test('offline: a última escala sincronizada fica guardada e volta sem internet, sem permitir gravar',async function(){
    var c=await appComo(null,{data:{docs:DOCS3},shifts:many(3,'2026-10-01','D')});
    await c.A.doSync(true);
    var guardado=c.A.localStorage.getItem('mes_cache_v1');ok(guardado,'cache não foi gravado');
    var A=await newApp();A.localStorage.setItem('mes_cache_v1',guardado);
    var log=[];
    A.fetch=function(u,o){log.push({m:(o&&o.method)||'GET',p:String(u)});return Promise.reject(new Error('sem rede'));};
    ok(A.loadCache(),'loadCache devolveu falso');
    eq(A.ST.shifts.length,3);ok(A.ST.docs.length>=3);
    A.CU=DOCS3[0];await A.doSync(true).catch(function(){});
    ok(!A.LOADED.shifts,'não pode marcar como lido sem ter lido');
    A.ST.shifts=A.ST.shifts.slice(0,1);await A.save('shifts');
    eq(log.filter(function(x){return x.m!=='GET';}),[],'offline não pode gravar nada');
  });
  test('lembretes: cartão só para médicos e inscrição vai para o banco',async function(){
    var c=await appComo(DOCS3[1],{data:{docs:DOCS3}});await c.A.doSync(true);
    c.A.eval('PG_MAP.perfil()');ok(c.A.G('PUSHCARD'),'médico deveria ver o cartão de lembretes');
    var g=await appComo(DOCS3[0],{data:{docs:DOCS3}});await g.A.doSync(true);
    g.A.eval('PG_MAP.perfil()');ok(!g.A.G('PUSHCARD'),'gestor não recebe lembretes de plantão');
    await c.A.rpc('medescala_push_subscribe',c.A.pushSubArgs({toJSON:function(){return{endpoint:'https://push.example/x',keys:{p256dh:'a',auth:'b'}};}}));
    var w=c.S.writes().filter(function(x){return x.p==='rpc/medescala_push_subscribe';});
    eq(w.length,1);eq(JSON.parse(w[0].b).p_doc_id,'m1');
  });

  /* ───────── Todas as telas abrem sem erro ───────── */
  async function varrer(user){
    var c=await appComo(user,{data:{docs:DOCS3},shifts:many(2,'2026-10-10','D').concat(many(2,'2026-10-10','N'),many(1,'2026-10-11','D','m2'))});
    await c.A.doSync(true);var erros=[];
    var mapa=c.A.eval('Object.keys(PG_MAP)');
    ok(mapa.length>=23,'PG_MAP tem '+mapa.length+' telas');
    mapa.forEach(function(pg){try{c.A.curPg=pg;c.A.eval('PG_MAP["'+pg+'"]()');}catch(e){erros.push(pg+': '+e.message);}});
    eq(erros,[]);
  }
  test('todas as telas abrem sem erro (gestor)',function(){return varrer(DOCS3[0]);});
  test('todas as telas abrem sem erro (médico)',function(){return varrer(DOCS3[1]);});
}
