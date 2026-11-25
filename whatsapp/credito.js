/* ABA CRÉDITO DO APP WHATSAPP (Fase 4 do crédito, 25/11/2026). Carregada pelo index.html, que entrega login, ordens e folhas (window.AppCredito(api)).
   Lê a tabela credito_fichas (só admin e familia, regra 0010) e manda as ordens credito_decidir e credito_pedir (regra 0011), que o servidor
   repassa ao motor do PC. Quem decide: o Leonardo e o pai. Aprovar avisa só o cliente (o vendedor, à mão, até a Fase A); Reprovar guarda o
   motivo só na ficha. Nenhum dado de cliente neste arquivo: tudo vem do banco depois do login.
   Leitura leve (mesmo padrão da Consulta): lista com colunas escolhidas e sem as fichas do arquivo; depois, a cada 60 s e SÓ com esta aba
   aberta e o app na frente, só o que mudou (atualizada_em, com 5 min de folga) + a contagem; contagem diferente, erro ou 5.000+ linhas:
   carga completa. Ficha inteira só ao tocar. Cópia da lista no aparelho (localStorage) para abrir rápido. */
(function(){
'use strict';
var COLS='id,estado,origem,nome,bairro,cidade,sla_desde,atualizada_em,criada_em,decidida_em,susp:sinais->suspeita->>suspeita,dup:sinais->duplicadas,rec:sinais->recorrente->>recorrente,bloco:entrevista->>bloco,faltam:entrevista->>faltam,ent:entrevista->>estado,res:decisao->>resultado,quem:decisao->>quem';
var DET='id,estado,origem,nome,telefone,bairro,cidade,cadastro,respostas,auto,sinais,decisao,sla_desde,criada_em,decidida_em,atualizada_em,ent:entrevista->>estado,entMotivo:entrevista->>motivo,bloco:entrevista->>bloco,faltam:entrevista->>faltam';
var ESPERA={precisa_voce:1,pronta:1,suspeita:1,falta_documento:1};
var ROT={precisa_voce:'Precisa de você',pronta:'Pronta',suspeita:'Suspeita',falta_documento:'Falta documento',entrevista:'Em entrevista',decidida:'Decidida'};
var FILTROS=[['espera','Esperando'],['precisa_voce','Precisa de você'],['pronta','Pronta'],['suspeita','Suspeita'],['falta_documento','Falta documento'],['entrevista','Em entrevista'],['hoje','Decididas hoje']];
var APROVAR=[['aprovado','1 cesta, sem entrada'],['aprovado_entrada','1 cesta, com entrada'],['aprovado_2','Até 2 cestas (histórico muito bom)']];
var MOTIVOS=[['debito_anterior','Débito anterior'],['renda_nao_comprovada','Renda não comprovada'],['dados_nao_conferem','Dados não conferem'],['fora_da_area','Fora da área de entrega'],['falar_com_escritorio','Falar com o escritório']];
var RESP=[['Renda',[['rendas','Quem trabalha'],['tempoTrab','Tempo no trabalho'],['beneficio','Auxílio ou aposentadoria'],['diaPag','Dia do pagamento']]],
  ['Casa',[['moradia','Moradia'],['aluguel','Aluguel'],['estadoCivil','Estado civil'],['pessoas','Pessoas na casa'],['filhos','Filhos'],['temParcelas','Prestações'],['outraCesta','Outra cesta'],['tempoEnd','Tempo no endereço']]],
  ['Segurança',[['refNome','Referência'],['nasc','Nascimento'],['comprovante','Comprovante de renda'],['comprovanteAnterior','Comprovante anterior']]]];
var SITE=[['Data','Cadastro em'],['Cesta','Cesta'],['Renda','Renda'],['SituacaoTrabalho','Trabalho'],['Empresa','Empresa'],['Cargo','Cargo'],['SituacaoMoradia','Moradia'],['TempoMoradia','Tempo no endereço']];
var GUARDA='app-credito-v1', CHEIA_MAX=5000, FOLGA_MS=5*60000, CADA_MS=60000;

window.AppCredito=function(api){
  var esc=api.esc, S=api.S;
  var st={lista:null,ult:'',lendo:false,leuEm:0,erro:'',filtro:'espera',aberta:null,det:{},form:null,ordens:{}};
  try{var g=JSON.parse(localStorage.getItem(GUARDA)||'null');if(g&&g.em&&Array.isArray(g.lista)){st.guardadaDe=g.em;st.lista=g.lista;st.ult=g.ult||'';}}catch(e){}

  /* ---------- horas úteis: 07h30–19h00, seg–sáb, horário de Brasília (cópia do ecossistema/credito/horas-uteis.js, sem feriado) ---------- */
  function horasUteis(desde,ate){
    var a=Date.parse(desde),b=ate||Date.now(); if(isNaN(a)||b<=a) return 0;
    var FUSO=-3*60,ini=7.5*60,fim=19*60,min=0,dia=new Date(a+FUSO*60000).toISOString().slice(0,10),ult=new Date(b+FUSO*60000).toISOString().slice(0,10);
    for(var i=0;i<400&&dia<=ult;i++){
      var meia=Date.parse(dia+'T00:00:00Z')-FUSO*60000,dow=new Date(dia+'T12:00:00Z').getUTCDay();
      if(dow!==0){var x=Math.max(a,meia+ini*60000),y=Math.min(b,meia+fim*60000);if(y>x)min+=(y-x)/60000;}
      dia=new Date(Date.parse(dia+'T12:00:00Z')+864e5).toISOString().slice(0,10);
    }
    return min/60;
  }
  function nivel(f){if(!ESPERA[f.estado]) return '';var h=horasUteis(f.sla_desde||f.criada_em);return h>24?'vermelho':h>4?'alerta':'ok';}
  function idade(f){var h=horasUteis(f.sla_desde||f.criada_em);var dd=Math.floor(h/11.5);return h<1?'menos de 1 h útil':h<24?Math.floor(h)+' h úteis':dd+(dd===1?' dia útil':' dias úteis');} /* 1 dia útil = 11 h 30 */
  function ehHoje(iso){var d=new Date(iso),h=new Date();return !isNaN(d)&&d.toDateString()===h.toDateString();}
  function quando(iso){var d=new Date(iso);return isNaN(d)?'':String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function primeiro(n){return String(n||'').trim().split(/\s+/)[0]||'cliente';}
  function dups(f){return Array.isArray(f.dup)?f.dup:[];}

  /* ---------- leitura ---------- */
  function guarda(){try{localStorage.setItem(GUARDA,JSON.stringify({em:api.em(),lista:st.lista,ult:st.ult}));}catch(e){}}
  function maisNova(L){return L.reduce(function(m,f){return f.atualizada_em>m?f.atualizada_em:m;},'');}
  async function cheia(){
    var r=await api.SB().from('credito_fichas').select(COLS,{count:'exact'}).neq('estado','arquivo').order('atualizada_em',{ascending:false}).limit(CHEIA_MAX);
    if(r.error) throw new Error(r.error.message);
    st.lista=r.data||[]; st.ult=maisNova(st.lista);
  }
  async function atualizar(forcar){
    if(st.lendo||!api.em()||!api.SB()) return; st.lendo=true;
    try{
      if(st.guardadaDe&&st.guardadaDe!==api.em()){st.lista=null;st.ult='';}
      st.guardadaDe=api.em();
      if(forcar||!st.lista||!st.ult) await cheia();
      else {
        var desde=new Date(Date.parse(st.ult)-FOLGA_MS).toISOString();
        var q=await Promise.all([api.SB().from('credito_fichas').select(COLS).neq('estado','arquivo').gt('atualizada_em',desde).limit(CHEIA_MAX),
          api.SB().from('credito_fichas').select('id',{count:'exact',head:true}).neq('estado','arquivo')]);
        if(q[0].error||q[1].error||(q[0].data||[]).length>=CHEIA_MAX) await cheia();
        else {
          var por={}; st.lista.forEach(function(f){por[f.id]=f;}); (q[0].data||[]).forEach(function(f){por[f.id]=f;if(st.det[f.id]&&st.det[f.id].atualizada_em!==f.atualizada_em)delete st.det[f.id];});
          st.lista=Object.keys(por).map(function(k){return por[k];});
          if(q[1].count!=null&&q[1].count!==st.lista.length) await cheia(); else st.ult=maisNova(st.lista)||st.ult;
        }
      }
      st.erro=''; guarda();
    }catch(e){st.erro='Não consegui ler as fichas ('+api.motivoCurto(e)+')';api.anotaFalha('credito-lista',e);}
    finally{st.lendo=false;st.leuEm=Date.now();api.render();}
  }
  async function abrirFicha(id){
    st.aberta=id; st.form=null; api.render();
    var f=(st.lista||[]).filter(function(x){return x.id===id;})[0];
    if(st.det[id]&&f&&st.det[id].atualizada_em===f.atualizada_em) return;
    try{var r=await api.SB().from('credito_fichas').select(DET).eq('id',id).maybeSingle();if(r.error)throw new Error(r.error.message);st.det[id]=r.data||{erro:'Ficha não encontrada'};}
    catch(e){st.det[id]={erro:'Não consegui abrir a ficha ('+api.motivoCurto(e)+')'};}
    api.render();
  }
  setInterval(function(){if(api.em()&&S.tab==='credito'&&!document.hidden)atualizar();},CADA_MS);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&api.em()&&S.tab==='credito'&&Date.now()-st.leuEm>15000)atualizar();});

  /* ---------- ordens ---------- */
  async function mandar(fichaId,tipo,dados){
    var o={tipo:tipo,dados:dados,st:'enviando',resultado:''}; st.ordens[fichaId]=o; st.form=null; api.render();
    try{
      o.id=await api.ordem(tipo,dados);
      api.acompanha(o.id,function(d){
        o.st=d.status; o.resultado=d.resultado||''; o.erroFila=!!d.erroFila;
        if(d.status==='feito') api.toast(tipo==='credito_pedir'?'Comprovante pedido':'Feito');
        /* feito ou não, a ficha pode ter mudado no PC (decisão gravada e mensagem presa na fila): lê de novo a lista e a ficha aberta */
        delete st.det[fichaId]; atualizar().then(function(){if(st.aberta===fichaId)abrirFicha(fichaId);});
      },120);
    }catch(e){api.anotaFalha('credito-ordem',e);o.st='erro';o.resultado='Não saiu: '+api.motivoCurto(e);api.render();}
  }
  function decidir(f,resultado,entrada,motivo){
    var d={ficha:f.id,resultado:resultado}; if(entrada) d.entrada=entrada; if(motivo) d.motivo=motivo;
    mandar(f.id,'credito_decidir',d);
  }
  function repetir(fichaId){ /* mesma ordemId: o motor nunca decide duas vezes e a mensagem só sai se ainda não saiu */
    var o=st.ordens[fichaId]; if(!o||!o.id) return;
    var d={}; Object.keys(o.dados||{}).forEach(function(k){d[k]=o.dados[k];}); d.ordemId=o.dados.ordemId||o.id;
    mandar(fichaId,o.tipo,d);
  }

  /* ---------- tela ---------- */
  function filtrar(L,k){
    if(k==='espera') return L.filter(function(f){return ESPERA[f.estado];});
    if(k==='hoje') return L.filter(function(f){return f.estado==='decidida'&&ehHoje(f.decidida_em);});
    return L.filter(function(f){return f.estado===k;});
  }
  function ordenar(L,k){
    var h=function(f){return horasUteis(f.sla_desde||f.criada_em);};
    if(k==='entrevista') return L.slice().sort(function(a,b){return String(b.atualizada_em).localeCompare(String(a.atualizada_em));});
    if(k==='hoje') return L.slice().sort(function(a,b){return String(b.decidida_em).localeCompare(String(a.decidida_em));});
    return L.slice().sort(function(a,b){return h(b)-h(a);});
  }
  function etiquetas(f){
    var t=[];
    if(f.susp==='true') t.push(api.pill('Suspeita','bad'));
    if(dups(f).length) t.push(api.pill('Duplicada','warn'));
    if(f.rec==='true') t.push(api.pill('Já é cliente','info'));
    if(f.estado==='entrevista'&&f.bloco) t.push(api.pill('Bloco '+f.bloco+' de 3'+(f.faltam?' · faltam '+f.faltam:''),'mute'));
    return t.join('');
  }
  function linha(f){
    var n=nivel(f), tom=n==='vermelho'?'bad':n==='alerta'?'warn':f.estado==='decidida'?(/recus/i.test(f.res)?'mute':'ok'):'info';
    var lado=ESPERA[f.estado]?'<span class="pill '+tom+'">'+esc(idade(f))+'</span>':f.estado==='decidida'?'<span class="time">'+esc(quando(f.decidida_em))+'</span>':'<span class="time">'+esc(quando(f.atualizada_em))+'</span>';
    var sub=f.estado==='decidida'?esc(String(f.res||'')+(f.quem?' · '+f.quem:'')):esc(ROT[f.estado]||f.estado)+(f.bairro||f.cidade?' · '+esc([f.bairro,f.cidade].filter(Boolean).join(', ')):'');
    return '<button class="row" data-act="cr-abrir" data-id="'+esc(f.id)+'"><div class="ico '+tom+'">'+esc(api.ini(f.nome))+'</div><div class="mid"><div class="t1"><span class="nm">'+esc(f.nome)+'</span></div>'+
      '<div class="t2">'+sub+'</div>'+(etiquetas(f)?'<div class="cr-et">'+etiquetas(f)+'</div>':'')+'</div><div class="end">'+lado+'</div></button>';
  }
  function view(){
    if(!st.lista&&!st.lendo&&!st.erro) atualizar();
    else if(Date.now()-st.leuEm>CADA_MS&&!st.lendo&&!document.hidden) atualizar();
    var h='<section class="sec"><div class="sec-h"><h2>Crédito</h2><span class="time">'+(st.lendo?'atualizando…':st.leuEm?'lido às '+esc(quando(new Date(st.leuEm).toISOString()).slice(6)):'')+'</span></div>';
    if(st.erro) h+='<div class="card"><div class="empty"><b>'+esc(st.erro)+'</b><button class="btn" data-act="cr-ler">Tentar de novo</button></div></div>';
    if(!st.lista) return h+(st.erro?'':'<div class="card"><div class="empty"><b>Carregando as fichas…</b></div></div>')+'</section>';
    var L=st.lista;
    h+='<div class="chips" role="group" aria-label="Filtrar fichas">'+FILTROS.map(function(x){return '<button aria-pressed="'+(st.filtro===x[0])+'" data-act="cr-filtro" data-id="'+x[0]+'">'+x[1]+' <span class="n">'+filtrar(L,x[0]).length+'</span></button>';}).join('')+'</div>';
    var F=ordenar(filtrar(L,st.filtro),st.filtro);
    h+='<div class="card">'+(F.length?F.map(linha).join(''):'<div class="empty"><div class="ck">'+api.IC.check+'</div><b>Nada aqui</b><span>0 fichas neste filtro</span></div>')+'</div>';
    if(st.filtro==='espera'||st.filtro==='precisa_voce'||st.filtro==='pronta') h+='<p class="cr-nota">Amarelo: parada há mais de 4 h úteis. Vermelho: mais de 24 h úteis (07h30 às 19h, seg a sáb).</p>';
    return h+'</section>';
  }
  function badge(){
    if(!st.lista&&!st.lendo&&!st.erro&&api.em()) setTimeout(atualizar,0); /* 1 leitura ao entrar no app, para o número da aba */
    return (st.lista||[]).filter(function(f){var n=nivel(f);return n==='alerta'||n==='vermelho';}).length;
  }
  function valor(v){
    if(Array.isArray(v)) return v.map(function(x){return x&&typeof x==='object'?[x.quem,x.valor].filter(Boolean).join(': '):String(x);}).join(' · ');
    if(v&&typeof v==='object') return Object.keys(v).map(function(k){return v[k];}).join(' · ');
    return String(v);
  }
  function campos(lista,obj){
    var h='';lista.forEach(function(x){var v=(obj||{})[x[0]];if(v!=null&&v!==''&&!(Array.isArray(v)&&!v.length))h+='<span class="k">'+esc(x[1])+'</span><span class="v">'+esc(valor(v))+'</span>';});
    return h;
  }
  function ligadas(d){
    var s=(d.sinais||{}), L=[], porId={};
    (st.lista||[]).forEach(function(f){porId[f.id]=f;});
    ((s.suspeita||{}).ligadas||[]).forEach(function(l){L.push({id:l.id,porque:(l.motivos||[]).join(' e ')+' de ficha '+(l.situacao||''),iguais:l.camposIguais||[]});});
    (s.duplicadas||[]).forEach(function(l){L.push({id:l.id,porque:'mesmo '+(l.por||[]).join(' e '),iguais:[]});});
    if(!L.length) return '';
    return '<div class="sub-h">Fichas ligadas</div><div class="cr-lig">'+L.map(function(l){var o=porId[l.id];
      return '<div class="cr-l"><b>'+esc(o?o.nome:l.id)+'</b><span>'+esc(l.porque)+(o?' · '+esc(ROT[o.estado]||o.estado):'')+'</span>'+(l.iguais.length?'<span class="cr-ig">Campos iguais: '+esc(l.iguais.join(', '))+'</span>':'')+(o?'<button class="tb" data-act="cr-abrir" data-id="'+esc(o.id)+'">Abrir</button>':'')+'</div>';}).join('')+'</div>';
  }
  function blocoOrdem(f){
    var o=st.ordens[f.id]; if(!o) return '';
    if(o.st==='enviando'||o.st==='pendente') return '<div class="cr-ord">Mandando ao PC da Análise…</div>';
    if(o.st==='feito') return '<div class="cr-ord ok">'+esc(o.resultado)+'</div>';
    return '<div class="cr-ord bad">'+esc(o.resultado||'Não deu')+'</div>'+(o.id?'<button class="btn" data-act="cr-repetir" data-id="'+esc(f.id)+'">'+(o.erroFila?'Reenviar mensagem':'Tentar de novo')+'</button>':'');
  }
  function acoes(d){
    var o=st.ordens[d.id];
    if(d.estado==='decidida'){
      var dec=d.decisao||{}, aprov=!/recus/i.test(dec.resultado||''), jaDisse=o&&o.st==='feito'&&/vendedor/.test(o.resultado);
      return '<div class="cr-dec">'+esc(dec.resultado||'Decidida')+(dec.quem?' · por '+esc(dec.quem):'')+(dec.quando||dec.em?' · '+esc(quando(dec.em||dec.quando)):'')+'</div>'+
        (aprov&&!jaDisse&&ehHoje(dec.em||dec.quando)?'<p class="cr-nota">Avise o vendedor da rota pelo WhatsApp (o recado automático chega na Fase A).</p>':'');
    }
    if(d.estado==='arquivo') return '<p class="cr-nota">Ficha antiga: decida pela tela do PC.</p>';
    if(o&&o.erroFila) return ''; /* decisão já gravada no PC: só o Reenviar (no bloco da ordem) */
    var emEnt=d.estado==='entrevista', ocupado=o&&(o.st==='enviando'||o.st==='pendente');
    var dis=emEnt||ocupado?' disabled':'';
    return (emEnt?'<p class="cr-nota">A entrevista ainda está em andamento: espere terminar para decidir.</p>':'')+
      '<div class="cr-bt"><button class="btn pri" data-act="cr-form" data-id="aprovar"'+dis+'>Aprovar</button><button class="btn danger" data-act="cr-form" data-id="reprovar"'+dis+'>Reprovar</button></div>'+
      '<button class="btn" data-act="cr-pedir"'+dis+'>Pedir comprovante de novo</button>';
  }
  function form(d){
    var F=st.form, ehA=F.tipo==='aprovar', ops=ehA?APROVAR:MOTIVOS;
    var h='<div class="sh-h"><h3>'+(ehA?'Aprovar ':'Reprovar ')+esc(primeiro(d.nome))+'</h3><button class="x" data-act="cr-voltar" aria-label="Voltar">'+api.IC.x+'</button></div>';
    h+='<p>'+(ehA?'Como fica a compra?':'Por quê? O motivo fica só na ficha: o cliente nunca vê.')+'</p><div class="cr-ops" role="radiogroup">';
    ops.forEach(function(x){h+='<button class="cr-op" role="radio" aria-checked="'+(F.opc===x[0])+'" data-act="cr-opc" data-id="'+x[0]+'">'+esc(x[1])+'</button>';});
    h+='</div>';
    if(ehA&&F.opc==='aprovado_entrada') h+='<label class="campo"><span>Valor da entrada (em reais)</span><input id="crEnt" inputmode="decimal" autocomplete="off" placeholder="ex.: 50" value="'+esc(F.entrada||'')+'"></label>';
    var pronto=F.opc&&(F.opc!=='aprovado_entrada'||+String(F.entrada||'').replace(',','.')>0);
    return h+'<button class="btn '+(ehA?'pri':'danger')+'" data-act="cr-confirmar"'+(pronto?'':' disabled')+'>Continuar</button>';
  }
  function folha(){
    if(!st.aberta) return '';
    var d=st.det[st.aberta], f=(st.lista||[]).filter(function(x){return x.id===st.aberta;})[0]||{}, h;
    if(!d) h='<div class="sh-h"><h3>'+esc(f.nome||'Ficha')+'</h3><button class="x" data-act="cr-fechar" aria-label="Fechar">'+api.IC.x+'</button></div><div class="empty"><b>Abrindo a ficha…</b></div>';
    else if(d.erro) h='<div class="sh-h"><h3>Ficha</h3><button class="x" data-act="cr-fechar" aria-label="Fechar">'+api.IC.x+'</button></div><div class="empty"><b>'+esc(d.erro)+'</b></div>';
    else if(st.form) h=form(d);
    else {
      var s=d.sinais||{}, susp=s.suspeita||{}, rec=s.recorrente||{}, avisos=[];
      if(susp.suspeita) avisos.push(['bad','Suspeita: '+(susp.motivo||'ligada a outra ficha')]);
      if(rec.recorrente) avisos.push(['info',rec.motivo||'Já é cliente']);
      if((s.duplicadas||[]).length) avisos.push(['warn','A mesma pessoa tem outra ficha na fila']);
      if(d.estado==='precisa_voce'&&d.entMotivo) avisos.push(['warn',d.entMotivo]);
      h='<div class="sh-h"><h3>'+esc(d.nome)+'</h3><button class="x" data-act="cr-fechar" aria-label="Fechar">'+api.IC.x+'</button></div>';
      h+='<div class="cr-topo">'+api.pill(ROT[d.estado]||d.estado,ESPERA[d.estado]?(nivel(d)==='vermelho'?'bad':nivel(d)==='alerta'?'warn':'info'):'mute')+(ESPERA[d.estado]?'<span class="time">parada há '+esc(idade(d))+'</span>':'')+'<span class="time">'+esc([d.bairro,d.cidade].filter(Boolean).join(', '))+'</span></div>';
      avisos.forEach(function(a){h+='<div class="cr-av '+a[0]+'">'+esc(a[1])+'</div>';});
      h+=blocoOrdem(d)+acoes(d);
      var site=campos(SITE,d.cadastro); if(site) h+='<div class="sub-h">Do cadastro do site</div><div class="fl cr-fl">'+site+'</div>';
      RESP.forEach(function(b,i){var c=campos(b[1],d.respostas);h+='<div class="sub-h">Bloco '+(i+1)+' · '+b[0]+'</div>'+(c?'<div class="fl cr-fl">'+c+'</div>':'<p class="cr-nota">Nada respondido ainda.</p>');});
      h+=ligadas(d);
      if(d.telefone) h+='<a class="tb wa" href="https://wa.me/55'+esc(String(d.telefone).replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,''))+'" target="_blank" rel="noopener">'+api.IC.wa+' Abrir no WhatsApp</a>';
    }
    return '<div class="scrim" data-act="cr-fechar"><div class="sheet cr-sheet" role="dialog" aria-modal="true" aria-label="Ficha de crédito"><span class="grab"></span>'+h+'</div></div>';
  }

  /* ---------- toques ---------- */
  function acao(a,id,el,ev){
    if(a==='cr-fechar'&&el.classList.contains('scrim')&&ev.target!==el) return;
    var d=st.aberta&&st.det[st.aberta];
    switch(a){
      case 'cr-filtro': st.filtro=id; break;
      case 'cr-ler': st.erro=''; atualizar(true); return;
      case 'cr-abrir': abrirFicha(id); return;
      case 'cr-fechar': st.aberta=null; st.form=null; break;
      case 'cr-form': if(d) st.form={tipo:id,opc:'',entrada:''}; break;
      case 'cr-voltar': st.form=null; break;
      case 'cr-opc': if(st.form) st.form.opc=id; break;
      case 'cr-repetir': repetir(id); return;
      case 'cr-pedir': if(!d) return;
        S.modal={t:'Pedir o comprovante de '+primeiro(d.nome)+'?',p:'O robô da Central pede de novo a foto do holerite ou o PDF da Carteira Digital. A ficha volta para a entrevista.',ok:'Pedir',fazer:function(){mandar(d.id,'credito_pedir',{ficha:d.id});}}; break;
      case 'cr-confirmar': if(!d||!st.form||!st.form.opc) return;
        var F=st.form, nm=primeiro(d.nome);
        if(F.tipo==='aprovar'){
          var rot=APROVAR.filter(function(x){return x[0]===F.opc;})[0][1], ent=F.opc==='aprovado_entrada'?String(F.entrada||'').trim():'';
          S.modal={t:'Aprovar '+nm+'?',p:rot+(ent?' (entrada de '+ent+' reais)':'')+'. A Central manda agora a mensagem de aprovação ao cliente. O vendedor você avisa pelo WhatsApp.',ok:'Aprovar',fazer:function(){decidir(d,F.opc,ent,'');}};
        } else {
          var mot=MOTIVOS.filter(function(x){return x[0]===F.opc;})[0][1];
          S.modal={t:'Reprovar '+nm+'?',p:'Motivo: '+mot+' (fica só na ficha). A Central manda a recusa com a oferta à vista, sem o motivo.',ok:'Reprovar',fazer:function(){decidir(d,'recusado','',F.opc);}};
        }
        break;
      default: return;
    }
    api.render();
  }
  document.addEventListener('input',function(ev){if(ev.target&&ev.target.id==='crEnt'&&st.form){var antes=+String(st.form.entrada||'').replace(',','.')>0;st.form.entrada=ev.target.value;if((+String(ev.target.value).replace(',','.')>0)!==antes)api.render();}});
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&!ev.defaultPrevented&&st.aberta&&!S.modal){if(st.form)st.form=null;else st.aberta=null;ev.preventDefault();api.render();}});

  /* estilo só da aba (o resto vem do index.html) */
  var css=document.createElement('style');
  css.textContent='.cr-et{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}.cr-nota{margin:0;font-size:13px;color:var(--ink-3)}'+
    '.cr-topo{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.cr-av{border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600}'+
    '.cr-av.bad{background:var(--bad-soft);color:var(--bad)}.cr-av.warn{background:var(--warn-soft);color:var(--warn)}.cr-av.info{background:var(--pri-soft);color:var(--pri)}'+
    '.cr-bt{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cr-dec{background:var(--mute-soft);border-radius:10px;padding:10px 12px;font-weight:600}'+
    '.cr-ord{border-radius:10px;padding:10px 12px;font-size:14px;background:var(--pri-soft);color:var(--pri)}.cr-ord.ok{background:var(--ok-soft);color:var(--ok)}.cr-ord.bad{background:var(--bad-soft);color:var(--bad)}'+
    '.cr-fl{padding:0;grid-template-columns:120px minmax(0,1fr);align-items:start}.cr-fl .v{overflow-wrap:anywhere}'+
    '.cr-ops{display:flex;flex-direction:column;gap:8px}.cr-op{min-height:48px;border:1px solid var(--line);border-radius:12px;background:var(--card);text-align:left;padding:0 14px;font-size:15px;font-weight:600;color:var(--ink)}'+
    '.cr-op[aria-checked="true"]{border-color:var(--pri);background:var(--pri-soft);color:var(--pri)}'+
    '.cr-sheet .campo input{height:48px;border:1px solid var(--line);border-radius:12px;padding:0 14px;font-size:16px}'+
    '.cr-lig{display:flex;flex-direction:column;gap:8px}.cr-l{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:14px}'+
    '.cr-l span{color:var(--ink-2)}.cr-l .cr-ig{font-size:13px}.cr-l .tb{align-self:flex-start;height:36px}';
  document.head.appendChild(css);

  return {view:view,badge:badge,folha:folha,acao:acao,
    sair:function(){st.lista=null;st.ult='';st.det={};st.ordens={};st.aberta=null;st.form=null;st.erro='';st.leuEm=0;try{localStorage.removeItem(GUARDA);}catch(e){}},
    _teste:{horasUteis:horasUteis,st:st,atualizar:atualizar}};
};
})();
