/* ABA CRÉDITO DO APP WHATSAPP (Fase 4 do crédito; aba completa em 25/11/2026). Carregada pelo index.html, que entrega login, ordens e
   folhas (window.AppCredito(api)). Lê a tabela credito_fichas (só admin e familia, regra 0010) e manda as ordens credito_decidir e
   credito_pedir (regra 0011), que o servidor repassa ao motor do PC. Quem decide: o Leonardo e o pai.
   O que a aba tem: busca parada no topo (nome, telefone, CPF ou ficha, sem consulta ao banco), "Já é cliente" numa fila à parte (fora dos
   contadores), etapas em cada cartão, ficha inteira em tela cheia (as 50 colunas do site e a entrevista), gaveta de decisão em 2 passos
   (escolher → conferir) com o recibo de cada passo, e ida e volta com as Conversas.
   Aviso da decisão nesta etapa: só o cliente (Central). "Ninguém" e o vendedor entram quando o servidor souber (AVISO_LIGADO).
   O motivo da recusa fica só na ficha. Nenhum dado de cliente neste arquivo: tudo vem do banco depois do login.
   Leitura leve: lista com colunas escolhidas e sem as fichas do arquivo; depois, a cada 60 s e SÓ com esta aba aberta e o app na frente,
   só o que mudou (atualizada_em, com 5 min de folga) + a contagem; contagem diferente, erro ou 5.000+ linhas: carga completa.
   Ficha inteira só ao tocar; conversa da entrevista e fichas antigas só no botão. A lista fica guardada no aparelho SEM CPF e SEM
   telefone: os dois ficam só na memória (1 leitura curta por sessão) e somem ao sair.
   Testar com dado inventado: skills alianca-app-tela-celular e alianca-app-fluxo (repositório do ecossistema). */
(function(){
'use strict';
var COLS='id,estado,origem,nome,bairro,cidade,sla_desde,atualizada_em,criada_em,decidida_em,susp:sinais->suspeita->>suspeita,dup:sinais->duplicadas,rec:sinais->recorrente->>recorrente,bloco:entrevista->>bloco,faltam:entrevista->>faltam,ent:entrevista->>estado,res:decisao->>resultado,quem:decisao->>quem,rota:auto->>rota';
var SENS='cpf,tel8'; /* só na memória: nunca vão para a cópia do aparelho */
var DET='id,estado,origem,nome,cpf,telefone,bairro,cidade,cadastro,respostas,auto,sinais,decisao,anexos,sla_desde,criada_em,decidida_em,atualizada_em,ent:entrevista->>estado,entMotivo:entrevista->>motivo,bloco:entrevista->>bloco,faltam:entrevista->>faltam,entFim:entrevista->>fim';
var ESPERA={precisa_voce:1,pronta:1,suspeita:1,falta_documento:1};
var GRUPOS=[['pronta','Prontas para decidir'],['suspeita','Suspeitas'],['precisa_voce','Precisa de você'],['falta_documento','Falta o comprovante']];
var ENT_ROT={sem_resposta:'Cliente parou de responder',precisa_voce:'Entrevista travou',parada:'Entrevista parada',sem_whatsapp:'Número sem WhatsApp',concluida:'Precisa de você'};
var APROVAR=[['aprovado','1 cesta, sem entrada'],['aprovado_entrada','1 cesta, com entrada'],['aprovado_2','Até 2 cestas','só com histórico muito bom']];
var MOTIVOS=[['debito_anterior','Débito anterior'],['renda_nao_comprovada','Renda não comprovada'],['dados_nao_conferem','Dados não conferem'],['fora_da_area','Fora da área de entrega'],['falar_com_escritorio','Falar com o escritório']];
/* quem recebe o aviso da decisão. Ligado = o servidor já sabe fazer. Padrão por tipo: decisão do Gestor de 25/11 (Reprovar nasce em "Só cliente") */
var AVISAR=[['cliente','Só cliente'],['ambos','Cliente e vendedor'],['vendedor','Só vendedor'],['ninguem','Ninguém']];
var AVISO_LIGADO={cliente:1}, AVISO_PADRAO={aprovar:'cliente',reprovar:'cliente'};
var JAYME={14:1,15:1,16:1,17:1,24:1}; /* rotas do Jayme: o vendedor nunca é avisado pelo app; o caso fica com o Gestor */
var SITE=[
  ['Pessoa',[['Nome','Nome'],['CPF','CPF'],['RG','RG'],['Nascimento','Nascimento'],['Estado Civil','Estado civil'],['Mãe','Mãe'],['Pai','Pai']]],
  ['Contato',[['Celular 1','Celular 1'],['Celular 2','Celular 2'],['Telefone 1','Telefone 1'],['Telefone 2','Telefone 2'],['Melhor Horário','Melhor horário']]],
  ['Endereço e moradia',[['Endereço','Rua'],['Número','Número'],['Complemento','Complemento'],['Bairro','Bairro'],['Cidade','Cidade'],['Estado','Estado'],['CEP','CEP'],['SituacaoMoradia','Moradia'],['ValorAluguel','Aluguel'],['TempoMoradia','Tempo no endereço'],['Possui Imóvel','Tem imóvel'],['Possui Veículo','Tem veículo']]],
  ['Trabalho e renda',[['SituacaoTrabalho','Situação'],['Empresa','Empresa'],['Cargo','Cargo'],['CargoClt','Cargo na carteira'],['Data Admissão','Admissão'],['Endereço Empresa','Endereço da empresa'],['Telefone Empresa','Telefone da empresa'],['TipoBeneficio','Benefício'],['OcupacaoDiarista','Ocupação (diarista)'],['FrequenciaPagamento','Recebe a cada'],['Renda','Renda']]],
  ['Família',[['OcupacaoConjuge','Ocupação do cônjuge'],['PessoasCasa','Pessoas na casa'],['PessoasComRenda','Pessoas com renda']]],
  ['Pedido',[['Cesta','Cesta'],['ItensPersonalizados','Itens escolhidos'],['Pagamento','Pagamento'],['Como Conheceu','Como conheceu'],['Quem Indicou','Quem indicou'],['Observações','Observações']]],
  ['Registro do site',[['Data','Enviado em'],['_linha','Linha da planilha'],['Status','Status no site'],['PossivelClienteOpy','Marcado como cliente antigo'],['VendedorAtribuido','Vendedor atribuído'],['StatusVendedor','Status do vendedor']]]];
var DATAS={Nascimento:1,'Data Admissão':1,Data:1}, FONES={'Celular 1':1,'Celular 2':1,'Telefone 1':1,'Telefone 2':1,'Telefone Empresa':1}, DINHEIRO={Renda:1,ValorAluguel:1};
/* entrevista: [chave, rótulo, 1 = complemento (não conta como pergunta sem resposta)] */
var RESP=[['Renda',[['rendas','Quem trabalha e quanto ganha'],['tempoTrab','Tempo no trabalho'],['beneficio','Auxílio ou aposentadoria'],['beneficioValor','Valor do benefício',1],['diaPag','Dia do pagamento']]],
  ['Casa',[['moradia','Moradia'],['aluguel','Aluguel',1],['estadoCivil','Estado civil'],['pessoas','Pessoas na casa'],['filhos','Filhos'],['idadesFilhos','Idade dos filhos',1],['temParcelas','Outras prestações'],['parcelas','Valor das prestações',1],['outraCesta','Cesta de outra empresa'],['tempoEnd','Tempo no endereço']]],
  ['Segurança',[['refNome','Referência'],['nasc','Nascimento'],['idade','Idade',1],['comprovante','Comprovante de renda'],['comprovanteAnterior','Comprovante anterior',1]]]];
var RESP_FORA={rendasParcial:'Renda só do titular, a confirmar',obsRobo:'Observação do robô'};
var ANCORAS=[['resumo','Resumo'],['cadastro','Cadastro'],['entrevista','Entrevista'],['sistema','Sistema']];
var GUARDA='app-credito-v2', CHEIA_MAX=5000, FOLGA_MS=5*60000, CADA_MS=60000;
var DOTS='<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

window.AppCredito=function(api){
  var esc=api.esc, S=api.S, IC=api.IC, norm=api.normaliza, fmtTel=api.fmtTel, telBR=api.telBR;
  var st={lista:null,ult:'',lendo:false,leuEm:0,leuOk:'',erro:'',sens:false,entrou:false,pilha:'novos',filtro:'espera',busca:'',arq:null,
    aberta:null,det:{},log:{},sec:'resumo',folha:null,gav:null,ordens:{},voltaConv:null,rolLista:0,rolFicha:0};
  try{localStorage.removeItem('app-credito-v1');}catch(e){} /* cópia do formato antigo */
  try{var g=JSON.parse(localStorage.getItem(GUARDA)||'null');if(g&&g.em&&Array.isArray(g.lista)){st.guardadaDe=g.em;st.lista=g.lista;st.ult=g.ult||'';st.leuOk=g.quando||'';}}catch(e){}

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
  function horasDe(f){return horasUteis(f.sla_desde||f.criada_em);}
  function nivel(f){if(!ESPERA[f.estado]) return '';var h=horasDe(f);return h>24?'vermelho':h>4?'alerta':'ok';}
  function idade(f){var h=horasDe(f),dd=Math.floor(h/11.5);return h<1?'há pouco':h<24?Math.floor(h)+' h úteis':dd+(dd===1?' dia útil':' dias úteis');} /* 1 dia útil = 11 h 30 */
  function dois(n){return String(n).padStart(2,'0');}
  function ehHoje(iso){var d=new Date(iso),h=new Date();return !isNaN(d)&&d.toDateString()===h.toDateString();}
  function hora(iso){var d=new Date(iso);return isNaN(d)?'':dois(d.getHours())+':'+dois(d.getMinutes());}
  function dia(iso){var d=new Date(iso);return isNaN(d)?'':dois(d.getDate())+'/'+dois(d.getMonth()+1);}
  function quando(iso){var d=dia(iso);return d?d+' às '+hora(iso):'';}
  function curta(iso){return ehHoje(iso)?hora(iso):dia(iso);}
  function dataTxt(s){var m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/);return m?m[3]+'/'+m[2]+'/'+m[1]+(m[4]?' às '+m[4]:''):String(s||'');}
  function primeiro(n){var p=String(n||'').trim().split(/\s+/)[0]||'';return p?p[0].toUpperCase()+p.slice(1).toLowerCase():'cliente';}
  function dups(f){return Array.isArray(f.dup)?f.dup:[];}
  function dig(s){return String(s==null?'':s).replace(/\D/g,'');}
  function num(s){s=String(s==null?'':s).replace(/[^\d,.]/g,'');if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/[.,]/g,'');return +s||0;}
  function reais(n){return 'R$ '+n.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');}
  function fora(){return typeof navigator!=='undefined'&&navigator.onLine===false;}
  function calmo(){try{return window.matchMedia('(prefers-reduced-motion:reduce)').matches;}catch(e){return false;}}
  function leve(id){return (st.lista||[]).concat((st.arq&&st.arq.lista)||[]).filter(function(x){return x.id===id;})[0]||null;}
  function copiar(txt,aviso){
    var ok=function(){api.toast(aviso);};
    var plano=function(){var ta=document.createElement('textarea'),r=false;ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);ta.select();try{ta.setSelectionRange(0,txt.length);r=document.execCommand('copy');}catch(e){}document.body.removeChild(ta);
      if(r)ok();else api.toast('Não deu para copiar');};
    if(!txt) return;
    try{if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(txt).then(ok,plano);return;}}catch(e){}
    plano();
  }

  /* ---------- leitura ---------- */
  function guarda(){ /* cópia do aparelho: sem CPF e sem telefone */
    try{localStorage.setItem(GUARDA,JSON.stringify({em:api.em(),ult:st.ult,quando:st.leuOk,lista:st.lista.map(function(f){var o={};Object.keys(f).forEach(function(k){if(k!=='cpf'&&k!=='tel8')o[k]=f[k];});return o;})}));}catch(e){}
  }
  function maisNova(L){return L.reduce(function(m,f){return f.atualizada_em>m?f.atualizada_em:m;},'');}
  function fichas(cols,o){return api.SB().from('credito_fichas').select(cols,o).neq('estado','arquivo');}
  async function cheia(){
    var r=await fichas(COLS+','+SENS,{count:'exact'}).order('atualizada_em',{ascending:false}).limit(CHEIA_MAX);
    if(r.error) throw new Error(r.error.message);
    st.lista=r.data||[]; st.ult=maisNova(st.lista); st.sens=true;
  }
  async function indice(){ /* lista vinda da cópia do aparelho: CPF e final do telefone entram só na memória, 1 vez por sessão */
    var r=await fichas('id,'+SENS).limit(CHEIA_MAX);
    if(r.error) throw new Error(r.error.message);
    var por={}; (r.data||[]).forEach(function(x){por[x.id]=x;});
    st.lista.forEach(function(f){var x=por[f.id];if(x){f.cpf=x.cpf;f.tel8=x.tel8;}});
    st.sens=true;
  }
  async function atualizar(forcar){
    if(st.lendo||!api.em()||!api.SB()) return; st.lendo=true;
    try{
      if(st.guardadaDe&&st.guardadaDe!==api.em()){st.lista=null;st.ult='';st.sens=false;}
      st.guardadaDe=api.em();
      if(forcar||!st.lista||!st.ult) await cheia();
      else {
        var desde=new Date(Date.parse(st.ult)-FOLGA_MS).toISOString();
        var q=await Promise.all([fichas(COLS+','+SENS).gt('atualizada_em',desde).limit(CHEIA_MAX),fichas('id',{count:'exact',head:true})]);
        if(q[0].error||q[1].error||(q[0].data||[]).length>=CHEIA_MAX) await cheia();
        else {
          var por={}, mudou=null; st.lista.forEach(function(f){por[f.id]=f;});
          (q[0].data||[]).forEach(function(f){
            var antes=por[f.id]; por[f.id]=f;
            if(st.det[f.id]&&st.det[f.id].atualizada_em!==f.atualizada_em){if(st.aberta===f.id)mudou=f.id;else delete st.det[f.id];}
            if(antes&&antes.atualizada_em!==f.atualizada_em) delete st.log[f.id];
          });
          st.lista=Object.keys(por).map(function(k){return por[k];});
          if(q[1].count!=null&&q[1].count!==st.lista.length) await cheia();
          else {st.ult=maisNova(st.lista)||st.ult; if(!st.sens) await indice();}
          if(mudou) lerFicha(mudou); /* a ficha aberta mudou no PC: lê de novo sem fechar nada */
        }
      }
      st.erro=''; st.leuOk=new Date().toISOString(); guarda();
    }catch(e){st.erro=api.motivoCurto(e);api.anotaFalha('credito-lista',e);}
    finally{st.lendo=false;st.leuEm=Date.now();api.render();}
  }
  async function lerFicha(id){
    try{var r=await api.SB().from('credito_fichas').select(DET).eq('id',id).maybeSingle();if(r.error)throw new Error(r.error.message);st.det[id]=r.data||{erro:'Ficha não encontrada'};}
    catch(e){if(!st.det[id]||st.det[id].erro)st.det[id]={erro:'Não consegui abrir a ficha ('+api.motivoCurto(e)+')'};}
    api.render();
  }
  function abrirFicha(id){
    st.aberta=id; st.folha=null; st.gav=null; st.sec='resumo'; api.render();
    var f=leve(id), d=st.det[id];
    if(d&&!d.erro&&f&&d.atualizada_em===f.atualizada_em) return;
    lerFicha(id);
  }
  async function lerLog(id){ /* a conversa da entrevista pesa: vem só quando a pessoa pede */
    if(st.log[id]&&(st.log[id].lendo||st.log[id].rows)) return;
    st.log[id]={lendo:true}; api.render();
    try{var r=await api.SB().from('credito_fichas').select('log:entrevista->log').eq('id',id).maybeSingle();if(r.error)throw new Error(r.error.message);
      st.log[id]={rows:Array.isArray(r.data&&r.data.log)?r.data.log:[]};}
    catch(e){st.log[id]={erro:api.motivoCurto(e)};}
    api.render();
  }
  /* fichas antigas (antes de 16/11): 1 consulta, só no toque do botão. Vogais e "c" viram curinga para achar nome com acento */
  function termoArquivo(q){
    var n=norm(q).trim(), d=dig(n), letras=n.replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ').trim(), t=[];
    if(letras.length>=3) t.push('nome.ilike.*'+letras.replace(/[aeiouc]/g,'_').replace(/\s/g,'*')+'*');
    if(d.length>=6) t.push('cpf.ilike.*'+d.split('').join('*')+'*');
    if(d.length>=4){t.push('tel8.like.*'+d.slice(-8)+'*');}
    if(d.length>=2&&/^[a-z]*-?\d+$/.test(n.replace(/\s/g,''))) t.push('id.ilike.*'+n.replace(/[^a-z0-9-]/g,'')+'*');
    return t.join(',');
  }
  async function buscaArquivo(){
    var q=st.busca.trim(), t=termoArquivo(q); if(!t||(st.arq&&st.arq.lendo)) return;
    st.arq={q:q,lendo:true}; pintaCorpo();
    try{var r=await api.SB().from('credito_fichas').select(COLS+','+SENS).eq('estado','arquivo').or(t).limit(20);if(r.error)throw new Error(r.error.message);
      if(st.busca.trim()===q) st.arq={q:q,lista:r.data||[]};}
    catch(e){if(st.busca.trim()===q) st.arq={q:q,erro:api.motivoCurto(e)};api.anotaFalha('credito-arquivo',e);}
    pintaCorpo();
  }
  setInterval(function(){if(api.em()&&S.tab==='credito'&&!document.hidden)atualizar();},CADA_MS);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&api.em()&&S.tab==='credito'&&Date.now()-st.leuEm>15000)atualizar();});
  window.addEventListener('online',function(){if(api.em()&&S.tab==='credito')atualizar();else api.render();});
  window.addEventListener('offline',function(){if(api.em())api.render();});

  /* ---------- ordens ---------- */
  function ocupada(id){var o=st.ordens[id];return !!o&&(o.st==='enviando'||o.st==='pendente');}
  async function mandar(fichaId,tipo,dados){
    if(ocupada(fichaId)) return; /* toque duplo: 1 ordem só */
    var o={tipo:tipo,dados:dados,st:'enviando',resultado:''}; st.ordens[fichaId]=o; st.gav=null; st.folha='recibo';
    st.trava=true; setTimeout(function(){st.trava=false;},700); /* o 2º toque de um toque duplo cai no recibo, no mesmo lugar: não vale */
    api.render();
    try{
      o.id=await api.ordem(tipo,dados); o.st='pendente'; api.render();
      api.acompanha(o.id,function(d){
        o.st=d.status; o.resultado=d.resultado||''; o.erroFila=!!d.erroFila;
        /* feito ou não, a ficha pode ter mudado no PC (decisão gravada e mensagem presa na fila): lê de novo a lista e a ficha aberta */
        atualizar().then(function(){if(st.aberta===fichaId)lerFicha(fichaId);});
      },120);
    }catch(e){api.anotaFalha('credito-ordem',e);o.st='erro';o.resultado=api.motivoCurto(e);api.render();}
  }
  function repetir(fichaId){ /* mesma ordemId: o motor nunca decide duas vezes e a mensagem só sai se ainda não saiu */
    var o=st.ordens[fichaId]; if(!o||ocupada(fichaId)) return;
    var d={}; Object.keys(o.dados||{}).forEach(function(k){d[k]=o.dados[k];});
    if(o.id) d.ordemId=o.dados.ordemId||o.id; /* sem id, a ordem nem saiu do celular: vai uma nova */
    mandar(fichaId,o.tipo,d);
  }

  /* ---------- etapas ---------- */
  function etapaDe(f){ /* cartão: em qual das 4 etapas a ficha está (n) e o que dizer */
    var e=f.ent||'', rec=/recus/i.test(f.res||'');
    if(f.estado==='decidida') return {n:5,tom:rec?'nao':'fim',rot:(rec?'Recusado':'Aprovado')+(f.quem?' · por '+f.quem:'')};
    if(f.estado==='arquivo') return {n:0,tom:'',rot:'Ficha antiga'+(f.res?' · '+(rec?'recusada':'aprovada'):'')};
    if(f.estado==='pronta') return {n:4,tom:'',rot:'Pronta para decidir'};
    if(f.estado==='falta_documento') return {n:3,tom:'warn',rot:'Falta o comprovante'};
    if(f.estado==='entrevista') return {n:2,tom:'',rot:e==='conversando'?'Em entrevista'+(f.bloco?' · bloco '+f.bloco:'')+(+f.faltam?' · faltam '+f.faltam:''):'Aguardando entrevista'};
    if(f.estado==='suspeita') return {n:e==='concluida'?4:2,tom:'bad',rot:'Suspeita: conferir'};
    return {n:2,tom:'warn',rot:ENT_ROT[e]||((f.origem==='site'?'Enviou no site':'Cadastro por ligação')+' · sem entrevista')};
  }
  function barra(e){
    var h='<span class="cr-pg'+(e.n===5?' '+e.tom:'')+'" role="img" aria-label="'+(e.n===5?'Decidida':e.n?'Etapa '+e.n+' de 4':'Fora da fila')+'">';
    for(var i=1;i<=4;i++) h+='<i class="'+(e.n===5||i<e.n?'ok':i===e.n?'at '+e.tom:'')+'"></i>';
    return h+'</span>';
  }
  function passos(d){ /* ficha: as 4 etapas com o que aconteceu em cada uma */
    var e=d.ent||'', r=d.respostas||{}, dec=d.estado==='decidida', c=d.cadastro||{}, rec=/recus/i.test((d.decisao||{}).resultado||'');
    var ent=e==='concluida'?['ok',d.entFim?dia(d.entFim):'concluída']:e==='conversando'?['at','bloco '+(d.bloco||1)+' de 3']:e==='enviar'?['at','aguardando']:
      e?['at warn',({sem_resposta:'sem resposta',precisa_voce:'travou',parada:'parada',sem_whatsapp:'sem WhatsApp'})[e]||e]:[dec?'':'at warn','não houve'];
    var doc=r.comprovante?['ok','recebido']:d.estado==='falta_documento'?['at warn','falta']:['',dec||e==='concluida'?'não veio':'depois'];
    var fim=dec?['ok',rec?'recusado':'aprovado']:d.estado==='pronta'||(d.estado==='suspeita'&&e==='concluida')?['at','com você']:['','depois'];
    return [[d.origem==='site'?'Site':'Cadastro','ok',c.Data?dataTxt(c.Data).slice(0,5):dia(d.criada_em)],['Entrevista',ent[0],ent[1]],['Documento',doc[0],doc[1]],['Decisão',fim[0],fim[1]]];
  }

  /* ---------- lista ---------- */
  function pilhas(){
    var P={novos:{L:[],espera:0,atrasadas:0,andamento:0,dec:0,decHoje:0},clientes:{L:[],espera:0,atrasadas:0,andamento:0,dec:0,decHoje:0}};
    (st.lista||[]).forEach(function(f){var p=P[f.rec==='true'?'clientes':'novos'];p.L.push(f);
      if(ESPERA[f.estado]){p.espera++;if(nivel(f)==='vermelho')p.atrasadas++;}
      else if(f.estado==='entrevista')p.andamento++;
      else if(f.estado==='decidida'){p.dec++;if(ehHoje(f.decidida_em))p.decHoje++;}});
    return P;
  }
  function maisVelha(L){return L.slice().sort(function(a,b){return horasDe(b)-horasDe(a);});}
  function fila(){ /* quem espera, na ordem em que a tela mostra */
    var L=pilhas()[st.pilha].L, out=[];
    GRUPOS.forEach(function(g){out=out.concat(maisVelha(L.filter(function(f){return f.estado===g[0];})));});
    return out;
  }
  function proxima(id){return fila().filter(function(f){var o=st.ordens[f.id];return f.id!==id&&!(o&&(o.st==='feito'||ocupada(f.id)));})[0]||null;}
  function cartao(f,cliente){
    var e=etapaDe(f), n=nivel(f), lado, flag='';
    if(ESPERA[f.estado]) lado='<span class="pill '+(n==='vermelho'?'bad':n==='alerta'?'warn':'mute')+'">'+esc(idade(f))+'</span>';
    else lado='<span class="time">'+esc(curta(f.estado==='decidida'?f.decidida_em:f.atualizada_em))+'</span>';
    if(f.susp==='true'&&f.estado!=='suspeita') flag='<span class="cr-flag bad">Suspeita</span>';
    else if(dups(f).length) flag='<span class="cr-flag warn">Duplicada</span>';
    else if(cliente&&f.rec==='true') flag='<span class="cr-flag mute">Já é cliente</span>';
    var onde=[f.rota?'Rota '+f.rota:'',f.bairro,f.cidade].filter(Boolean).join(' · ');
    /* 3 linhas: nome + tempo parado · etapa (nunca cortada) · rota e lugar + 1 marca. A etiqueta de tempo só divide a 1ª linha */
    return '<button class="row cr-card" data-act="cr-abrir" data-id="'+esc(f.id)+'"><span class="cr-l1"><span class="nm">'+esc(f.nome)+'</span>'+lado+'</span>'+
      '<span class="cr-st">'+barra(e)+'<span>'+esc(e.rot)+'</span></span>'+(onde||flag?'<span class="cr-l3"><span class="cr-on">'+esc(onde)+'</span>'+flag+'</span>':'')+'</button>';
  }
  function esqueleto(n){var h='';for(var i=0;i<n;i++)h+='<div class="cr-sk" aria-hidden="true"><i style="width:55%"></i><i style="width:75%"></i><i style="width:40%"></i></div>';return h;}
  function vazio(t,s,ok){return '<div class="card"><div class="empty">'+(ok?'<div class="ck">'+IC.check+'</div>':'')+'<b>'+esc(t)+'</b>'+(s?'<span>'+esc(s)+'</span>':'')+'</div></div>';}
  function acha(q){ /* busca na memória: nome, bairro, cidade, rota e ficha por palavra; CPF, telefone e número da ficha por dígitos */
    var n=norm(q).trim(), pal=n.split(/\s+/).filter(Boolean), d=dig(n), d8=d.length>8?d.slice(-8):d;
    return (st.lista||[]).filter(function(f){
      var txt=norm([f.nome,f.bairro,f.cidade,f.rota?'rota '+f.rota:'',f.id].join(' '));
      if(pal.every(function(w){return txt.indexOf(w)>=0;})) return true;
      return d.length>=3&&(dig(f.cpf).indexOf(d)>=0||String(f.tel8||'').indexOf(d8)>=0||dig(f.id).indexOf(d)>=0);
    });
  }
  function buscaHTML(){
    var L=acha(st.busca), a=st.arq&&st.arq.q===st.busca.trim()?st.arq:null, t=termoArquivo(st.busca), h;
    var ord=maisVelha(L.filter(function(f){return ESPERA[f.estado];})).concat(L.filter(function(f){return f.estado==='entrevista';}),
      L.filter(function(f){return f.estado==='decidida';}).sort(function(x,y){return String(y.decidida_em).localeCompare(String(x.decidida_em));}));
    h='<p class="cr-nota" role="status">'+(L.length?L.length+(L.length>1?' fichas encontradas':' ficha encontrada'):'Nenhuma ficha na fila com esse dado')+(st.sens?'':' · telefone e CPF ainda carregando')+'</p>';
    if(ord.length) h+='<div class="card">'+ord.map(function(f){return cartao(f,true);}).join('')+'</div>';
    if(!a) h+='<button class="btn" data-act="cr-arquivo"'+(t?'':' disabled')+'>Procurar nas fichas antigas</button><p class="cr-nota">'+(t?'As fichas de antes de 16/11 ficam fora da fila.':'Para procurar nas antigas, digite 3 letras do nome ou 4 números.')+'</p>';
    else if(a.lendo) h+='<div class="sub-h">Fichas antigas</div><div class="card">'+esqueleto(2)+'</div>';
    else if(a.erro) h+='<div class="note cr-nt">'+IC.wifi+'<span>Não consegui procurar nas antigas ('+esc(a.erro)+')</span><button class="cr-nb" data-act="cr-arquivo">Tentar</button></div>';
    else h+='<div class="sub-h">Fichas antigas · '+a.lista.length+'</div>'+(a.lista.length?'<div class="card">'+a.lista.map(function(f){return cartao(f,true);}).join('')+'</div>':'<p class="cr-nota">Nada nas fichas antigas com esse dado.</p>');
    return h;
  }
  function pilhasHTML(){
    if(st.busca.trim()||!st.lista) return '';
    var P=pilhas();
    return '<div class="seg cr-vis" role="group" aria-label="Qual fila">'+[['novos','Cadastros novos',P.novos.espera],['clientes','Já é cliente',P.clientes.espera]].map(function(x){
      return '<button aria-pressed="'+(st.pilha===x[0])+'" data-act="cr-pilha" data-id="'+x[0]+'">'+x[1]+(x[2]?' <span class="n">'+x[2]+'</span>':'')+'</button>';}).join('')+'</div>';
  }
  function corpoHTML(){
    var h='', cli=st.pilha==='clientes';
    if(!st.lista) return st.erro?'<div class="cr-falha"><div class="empty"><b>Não consegui ler as fichas</b><span>'+esc(st.erro)+'</span></div><button class="btn pri" data-act="cr-ler">Tentar de novo</button></div>' /* aviso no meio, botão embaixo (polegar) */
      :'<div class="card" role="status" aria-label="Carregando as fichas">'+esqueleto(4)+'</div>';
    if(fora()||st.erro) h+='<div class="note cr-nt">'+IC.wifi+'<span>'+(fora()?'Sem internet':'Não atualizou ('+esc(st.erro)+')')+(st.leuOk?' · lista das '+esc(hora(st.leuOk)):'')+'</span><button class="cr-nb" data-act="cr-ler">Tentar</button></div>';
    if(st.busca.trim()) return h+buscaHTML();
    var P=pilhas()[st.pilha], L=P.L, cor=false;
    h+='<div class="filt cr-kpis" role="group" aria-label="Filtrar a fila">'+[['espera','Esperando',P.espera,''],['atrasadas','Mais de 24 h',P.atrasadas,P.atrasadas?'bad':''],['andamento','Em andamento',P.andamento,'']].map(function(x){
      return '<button class="'+x[3]+'" aria-pressed="'+(st.filtro===x[0])+'" data-act="cr-filtro" data-id="'+x[0]+'"><span class="n">'+x[2]+'</span><span class="l">'+x[1]+'</span></button>';}).join('')+'</div>';
    if(st.filtro==='espera'||st.filtro==='atrasadas'){
      var tarde=st.filtro==='atrasadas', n=0;
      GRUPOS.forEach(function(g){
        var G=maisVelha(L.filter(function(f){return f.estado===g[0]&&(!tarde||nivel(f)==='vermelho');})); if(!G.length) return;
        n+=G.length; cor=cor||G.some(function(f){return nivel(f)!=='ok';});
        h+='<div class="sub-h">'+g[1]+' · '+G.length+'</div><div class="card">'+G.map(function(f){return cartao(f);}).join('')+'</div>';
      });
      if(!n) h+=tarde?vazio('Nada atrasado','Nenhuma ficha parada há mais de 24 h úteis',1)
        :vazio(cli?'Nenhum cliente antigo esperando':'Nada esperando você',P.andamento?P.andamento+(P.andamento>1?' cadastros em entrevista':' cadastro em entrevista'):cli?'Quem já comprou e se cadastrou de novo aparece aqui':'Nenhum cadastro novo na fila',1);
    } else if(st.filtro==='andamento'){
      var A=L.filter(function(f){return f.estado==='entrevista';}).sort(function(a,b){return String(b.atualizada_em).localeCompare(String(a.atualizada_em));});
      h+=A.length?'<div class="sub-h">Em entrevista · '+A.length+'</div><div class="card">'+A.map(function(f){return cartao(f);}).join('')+'</div>':vazio('Nenhuma entrevista em andamento','O robô da Central começa sozinho quando o cadastro chega');
    } else {
      var Dc=L.filter(function(f){return f.estado==='decidida';}).sort(function(a,b){return String(b.decidida_em).localeCompare(String(a.decidida_em));}), ult='';
      if(!Dc.length) h+=vazio('Nenhuma decisão ainda','As fichas decididas ficam guardadas aqui');
      Dc.forEach(function(f,i){
        var dd=ehHoje(f.decidida_em)?'hoje':dia(f.decidida_em)?'em '+dia(f.decidida_em):'sem data';
        if(dd!==ult){h+=(i?'</div>':'')+'<div class="sub-h">Decididas '+dd+'</div><div class="card">';ult=dd;}
        h+=cartao(f);
      });
      if(Dc.length) h+='</div>';
    }
    if(st.filtro!=='decididas'&&P.dec) h+='<div class="card"><button class="row" data-act="cr-filtro" data-id="decididas"><div class="mid"><div class="t1"><span class="nm">Decididas</span></div><div class="t2">'+(P.decHoje?P.decHoje+' hoje · ':'')+P.dec+' no total</div></div><span class="chev">'+IC.chev+'</span></button></div>';
    if(cor) h+='<p class="cr-nota">Amarelo: parada há mais de 4 h úteis. Vermelho: mais de 24 h úteis (07h30 às 19h, seg a sáb).</p>';
    return h+'<p class="cr-nota cr-pe2" role="status">'+(st.lendo?'Atualizando…':st.leuOk?'Atualizado às '+esc(hora(st.leuOk))+' · atualiza sozinho a cada minuto':'')+'</p>';
  }
  function pintaCorpo(){var c=document.getElementById('crCorpo');if(c)c.innerHTML=corpoHTML();else api.render();}
  function view(){
    if(!st.lista&&!st.lendo&&!st.erro) atualizar();
    else if(Date.now()-st.leuEm>CADA_MS&&!st.lendo&&!document.hidden) atualizar();
    return '<div class="lfixo"><div class="find cr-find"><label>'+IC.search+'<input id="crBusca" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nome, telefone, CPF ou ficha" aria-label="Buscar por nome, telefone, CPF ou número da ficha" value="'+esc(st.busca)+'"></label>'+
      '<button class="cr-x" id="crLimpa" data-act="cr-limpa" aria-label="Limpar a busca"'+(st.busca?'':' hidden')+'>'+IC.x+'</button></div><div id="crPilhas">'+pilhasHTML()+'</div></div>'+
      '<div class="lrola" id="crLista"><div id="crCorpo">'+corpoHTML()+'</div></div>';
  }
  function badge(){ /* número da aba: só cadastro NOVO parado há mais de 4 h úteis ("Já é cliente" não entra na conta) */
    if(!st.entrou&&api.em()){st.entrou=true;setTimeout(atualizar,0);} /* 1 leitura ao entrar no app: o número da aba e o atalho das conversas */
    return (st.lista||[]).filter(function(f){var n=nivel(f);return f.rec!=='true'&&(n==='alerta'||n==='vermelho');}).length;
  }

  /* ---------- ficha em tela cheia ---------- */
  function valor(v){
    if(Array.isArray(v)) return v.map(function(x){return x&&typeof x==='object'?[x.quem,x.valor].filter(Boolean).join(': '):String(x);}).join(' · ');
    if(v&&typeof v==='object') return Object.keys(v).map(function(k){return v[k];}).join(' · ');
    return String(v);
  }
  function tem(v){return v!=null&&v!==''&&v!==false&&!(Array.isArray(v)&&!v.length);}
  function valorSite(k,v){
    var t=String(v).trim();
    if(DATAS[k]) return dataTxt(t);
    if(FONES[k]&&dig(t).length>=10) return fmtTel(telBR(t));
    if(DINHEIRO[k]&&/^[\d.,\s]+$/.test(t)&&num(t)>0) return reais(num(t));
    return api.semOpy(t);
  }
  function celula(k,v){return '<div class="cr-c'+(String(v).length>18?' larga':'')+'"><span class="k">'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>';}
  function bloco(titulo,celulas,faltam,rotFalta){
    return '<div class="cr-blk"><h4>'+esc(titulo)+'</h4>'+(celulas?'<div class="cr-g">'+celulas+'</div>':'')+(faltam.length?'<p class="cr-ni'+(celulas?'':' so')+'">'+rotFalta+': '+esc(faltam.join(', '))+'</p>':'')+'</div>';
  }
  function fatos(d){
    var c=d.cadastro||{}, r=d.respostas||{}, R=Array.isArray(r.rendas)?r.rendas:[], soma=R.reduce(function(s,x){return s+num(x&&x.valor);},0), F=[];
    F.push(soma?['Renda da casa',reais(soma),R.length+(R.length>1?' pessoas com renda':' pessoa com renda')]:num(c.Renda)?['Renda',reais(num(c.Renda)),'informada no site']:['Renda','Não informou','']);
    F.push(['Trabalho',c.SituacaoTrabalho||r.beneficio&&'Benefício'||'Não informou',r.tempoTrab||(c['Data Admissão']?'desde '+dataTxt(c['Data Admissão']):'')||c.Empresa||'']);
    var m=String(r.nasc||c.Nascimento||'').match(/^(\d{4})-(\d{2})-(\d{2})|^(\d{1,2})\/(\d{1,2})\/(\d{4})/), anos=r.idade?+r.idade:0;
    if(m){var a=+(m[1]||m[6]),me=+(m[2]||m[5]),di=+(m[3]||m[4]),h=new Date();anos=h.getFullYear()-a-((h.getMonth()+1<me||(h.getMonth()+1===me&&h.getDate()<di))?1:0);}
    F.push(['Idade',anos>0&&anos<120?anos+' anos':'Não informou',r.estadoCivil||c['Estado Civil']||'']);
    F.push(['Moradia',r.moradia||c.SituacaoMoradia||'Não informou',[r.aluguel||(num(c.ValorAluguel)?'aluguel de '+reais(num(c.ValorAluguel)):''),r.tempoEnd||c.TempoMoradia].filter(Boolean).join(' · ')]);
    return '<div class="cr-fatos">'+F.map(function(x){return '<div class="cr-fato"><span class="k">'+esc(x[0])+'</span><span class="v">'+esc(x[1])+'</span>'+(x[2]?'<span class="s">'+esc(x[2])+'</span>':'')+'</div>';}).join('')+'</div>';
  }
  function avisos(d){
    var s=d.sinais||{}, a=d.auto||{}, susp=s.suspeita||{}, rec=s.recorrente||{}, A=[];
    if(susp.suspeita) A.push(['bad','Suspeita: '+(susp.motivo||'ligada a outra ficha')]);
    if(rec.recorrente) A.push([rec.deve?'warn':'info',String(rec.motivo||'já é cliente').replace(/^./,function(x){return x.toUpperCase();})]);
    if((s.duplicadas||[]).length) A.push(['warn','A mesma pessoa tem outra ficha na fila']);
    if(d.estado==='precisa_voce'&&d.entMotivo) A.push(['warn',d.entMotivo]);
    if(a.foraArea) A.push(['warn','Sem rota: pode estar fora da área de entrega']);
    (a.alertas||[]).forEach(function(x){A.push(['warn',api.semOpy(x)]);});
    return A.map(function(x){return '<div class="cr-av '+x[0]+'">'+esc(x[1])+'</div>';}).join('');
  }
  function rotaTxt(d){
    var a=d.auto||{}, v=a.vendedor&&!/sem vendedor/i.test(a.vendedor)?a.vendedor:'';
    return a.rota?'Rota '+a.rota+(v?' · '+v:''):'Sem rota definida';
  }
  function conversa(d){var t=dig(d.telefone).slice(-8);return t.length===8&&api.convDoTel?api.convDoTel(t):null;}
  function podePedir(d){return !!ESPERA[d.estado]&&!ocupada(d.id);}
  function secResumo(d){
    var c=d.cadastro||{}, r=d.respostas||{}, cv=conversa(d), A=Array.isArray(d.anexos)?d.anexos:[];
    var h='<section class="cr-sec" id="cr-s-resumo">'+avisos(d)+fatos(d);
    h+='<div class="cr-blk"><h4>Documentos</h4><div class="cr-doc"><span class="ic">'+IC.img+'</span><span class="tx"><b>Comprovante de renda</b><span>'+(r.comprovante?'<i class="ok">Recebido</i> · '+esc(api.semOpy(r.comprovante)):'<i class="warn">Falta</i> · ainda não mandou')+'</span></span></div>';
    A.forEach(function(x){h+='<div class="cr-doc"><span class="ic">'+IC.file+'</span><span class="tx"><b>'+esc(x.original||x.local||'Anexo')+'</b><span>Guardado no PC da Análise'+(x.em?' · '+esc(dia(x.em)):'')+'</span></span></div>';});
    if(r.comprovante) h+='<p class="cr-nota">A foto fica na conversa do WhatsApp.</p>'+(cv?'<button class="cr-b" data-act="cr-conversa">'+IC.chat+'Ver na conversa</button>':'');
    else if(podePedir(d)&&d.ent) h+='<button class="cr-b" data-act="cr-pedir">Pedir o comprovante</button>';
    h+='</div>';
    h+='<div class="cr-blk"><h4>Pedido e entrega</h4><div class="cr-g">'+celula('Cesta',c.Cesta||'Não informou')+celula('Pagamento',c.Pagamento||'Não informou')+celula('Onde',[d.bairro,d.cidade].filter(Boolean).join(' · ')||'Não informou')+celula('Rota (pelo bairro)',rotaTxt(d))+'</div></div>';
    return h+'</section>';
  }
  function secCadastro(d){
    var c=d.cadastro||{}, usadas={}, h='<section class="cr-sec" id="cr-s-cadastro"><div class="sub-h">'+(d.origem==='site'?'Cadastro do site':'Cadastro')+'</div>';
    if(!Object.keys(c).length) return h+'<p class="cr-nota">Esta ficha não veio do site: os dados estão na entrevista.</p></section>';
    SITE.forEach(function(b){
      var cel='', falta=[];
      b[1].forEach(function(x){usadas[x[0]]=1;var v=c[x[0]];if(tem(v)&&String(v).trim())cel+=celula(x[1],valorSite(x[0],v));else falta.push(x[1]);});
      h+=bloco(b[0],cel,falta,'Não informou');
    });
    var extra=Object.keys(c).filter(function(k){return !usadas[k]&&tem(c[k])&&String(c[k]).trim();});
    if(extra.length) h+=bloco('Outros campos',extra.map(function(k){return celula(k,valorSite(k,c[k]));}).join(''),[],'');
    return h+'</section>';
  }
  function secEntrevista(d){
    var r=d.respostas||{}, e=d.ent||'', usadas={}, L=st.log[d.id];
    var sit=e==='concluida'?'Concluída'+(d.entFim?' em '+quando(d.entFim):''):e==='conversando'?'Em andamento: bloco '+(d.bloco||1)+' de 3'+(d.faltam?', faltam '+d.faltam+(+d.faltam===1?' resposta':' respostas'):''):e==='enviar'?'O robô da Central ainda vai mandar a primeira mensagem':e?(ENT_ROT[e]||e)+(d.entMotivo?': '+d.entMotivo:''):'Não houve entrevista';
    var h='<section class="cr-sec" id="cr-s-entrevista"><div class="sub-h">Entrevista</div><p class="cr-nota">'+esc(sit)+'</p>';
    RESP.forEach(function(b,i){
      var cel='', falta=[];
      b[1].forEach(function(x){usadas[x[0]]=1;var v=r[x[0]];if(tem(v))cel+=celula(x[1],api.semOpy(valor(v)));else if(!x[2]&&!(x[0]==='nasc'&&tem(r.idade)))falta.push(x[1]);});
      h+=bloco('Bloco '+(i+1)+' · '+b[0],cel,falta,'Sem resposta');
    });
    var extra=Object.keys(r).filter(function(k){return !usadas[k]&&tem(r[k]);});
    if(extra.length) h+=bloco('Outras anotações',extra.map(function(k){return celula(RESP_FORA[k]||k,r[k]===true?'Sim':api.semOpy(valor(r[k])));}).join(''),[],'');
    if(e){
      if(!L) h+='<button class="cr-b" data-act="cr-log">'+IC.chat+'Ver a conversa da entrevista</button>';
      else if(L.lendo) h+='<div class="card" role="status" aria-label="Carregando a conversa">'+esqueleto(2)+'</div>';
      else if(L.erro) h+='<div class="note cr-nt">'+IC.wifi+'<span>Não consegui abrir a conversa ('+esc(L.erro)+')</span><button class="cr-nb" data-act="cr-log">Tentar</button></div>';
      else if(!L.rows.length) h+='<p class="cr-nota">Nenhuma fala guardada desta entrevista.</p>';
      else h+='<div class="card"><div class="thread">'+L.rows.map(function(m){var cli=m.de==='cliente';
        return '<div class="msg '+(cli?'in':'out')+'"><span class="cr-mt">'+(cli?esc(primeiro(d.nome)):'Robô')+(m.quando?' · '+esc(quando(m.quando)):'')+'</span><div class="bub">'+esc(api.semOpy(m.texto||''))+'</div></div>';}).join('')+'</div></div>';
    }
    return h+'</section>';
  }
  function ligadas(d){
    var s=d.sinais||{}, L=[], porId={};
    (st.lista||[]).forEach(function(f){porId[f.id]=f;});
    ((s.suspeita||{}).ligadas||[]).forEach(function(l){L.push({id:l.id,porque:(l.motivos||[]).join(' e ')+' de ficha '+(l.situacao||''),iguais:l.camposIguais||[]});});
    (s.duplicadas||[]).forEach(function(l){L.push({id:l.id,porque:'mesmo '+(l.por||[]).join(' e '),iguais:[]});});
    if(!L.length) return '';
    return '<div class="cr-blk"><h4>Fichas ligadas</h4>'+L.map(function(l){var o=porId[l.id];
      return '<div class="cr-lig"><b>'+esc(o?o.nome:'Ficha '+l.id)+'</b><span>'+esc(l.porque)+(o?' · '+esc(etapaDe(o).rot):'')+'</span>'+(l.iguais.length?'<span>Campos iguais: '+esc(l.iguais.join(', '))+'</span>':'')+
        (o?'<button class="cr-b" data-act="cr-abrir" data-id="'+esc(o.id)+'">Abrir esta ficha</button>':'')+'</div>';}).join('')+'</div>';
  }
  function secSistema(d){
    var a=d.auto||{}, A=Array.isArray(a.achados)?a.achados:[], M=Array.isArray(a.mesmoEnd)?a.mesmoEnd:[], B=Array.isArray(a.bons)?a.bons:[];
    var h='<section class="cr-sec" id="cr-s-sistema"><div class="sub-h">Situação no sistema</div><div class="cr-blk"><h4>'+(A.length?'Já tem cadastro':'Cliente novo')+'</h4>';
    if(!A.length) h+='<p class="cr-nota">Não achei cadastro com este CPF, telefone ou nome.</p>';
    A.forEach(function(x){var deve=+x.dev>0;
      h+='<div class="cr-doc"><span class="tx"><b>'+esc(x.nome||'Cliente')+'</b><span>Código '+esc(x.cod)+' · '+(+x.compras||0)+(+x.compras===1?' compra':' compras')+(a.como?' · achado por '+esc(a.como):'')+'</span></span>'+api.pill(deve?'Deve '+reais(+x.dev):'Não deve',deve?'bad':'ok')+'</div>';});
    if(M.length){h+='<h4>No mesmo endereço</h4>';M.forEach(function(x){var deve=+x.dev>0;
      h+='<div class="cr-doc"><span class="tx"><b>'+esc(x.nome||'Cliente')+'</b><span>Código '+esc(x.cod)+'</span></span>'+api.pill(deve?'Deve '+reais(+x.dev):'Não deve',deve?'bad':'ok')+'</div>';});}
    if(B.length) h+='<p class="cr-nota">A favor: '+esc(B.map(api.semOpy).join(' · '))+'</p>';
    if(a.recomendacaoRobo) h+='<p class="cr-nota">Sugestão do sistema: '+esc(api.semOpy(a.recomendacaoRobo))+'</p>';
    h+='<p class="cr-nota">'+(a.quando?'Consulta de '+esc(quando(a.quando))+'. ':'')+'A base é atualizada uma vez por dia.</p>';
    h+='<div class="cr-2"><button class="cr-b" data-act="cr-copia" data-id="cpf"'+(dig(d.cpf)?'':' disabled')+'>Copiar CPF</button><button class="cr-b" data-act="cr-copia" data-id="tel"'+(dig(d.telefone)?'':' disabled')+'>Copiar telefone</button></div></div>';
    h+=ligadas(d);
    h+='<div class="cr-blk"><h4>Registro</h4><div class="cr-g">'+celula('Ficha',d.id)+celula('Origem',d.origem==='site'?'Site':d.origem==='ligacao'?'Ligação':d.origem||'—')+celula('Criada',quando(d.criada_em))+celula('Última mudança',quando(d.atualizada_em))+'</div></div>';
    return h+'</section>';
  }
  function resultadoCurto(dec){var r=String((dec||{}).resultado||'Decidida');return /recus/i.test(r)?'Recusado':r.replace(/^Aprovado\s*[–-]\s*/,'Aprovado · ');}
  function barraAcoes(d){
    var o=st.ordens[d.id], cv=conversa(d), mais='<button class="btn cr-mais" data-act="cr-mais" aria-label="Mais ações" aria-haspopup="dialog">'+DOTS+'</button>';
    var conv=cv?'<button class="btn cr-bx" data-act="cr-conversa">Conversa</button>':'';
    if(ocupada(d.id)) return '<div class="cr-bar"><span class="cr-gira" aria-hidden="true"></span><div class="cr-info" role="status"><b>'+(o.tipo==='credito_pedir'?'Pedindo o comprovante…':'Mandando a decisão…')+'</b></div><button class="btn cr-bx" data-act="cr-recibo">Acompanhar</button></div>';
    if(d.estado==='decidida'){var dec=d.decisao||{};
      return '<div class="cr-bar"><div class="cr-info"><b>'+esc(resultadoCurto(dec))+'</b>'+esc([dec.quem?'por '+dec.quem:'',quando(dec.em||dec.quando)].filter(Boolean).join(' · '))+'</div>'+
        (o&&o.erroFila&&o.st==='erro'?'<button class="btn pri cr-bx" data-act="cr-repetir" data-id="'+esc(d.id)+'">Reenviar</button>':conv)+mais+'</div>';}
    if(d.estado==='arquivo') return '<div class="cr-bar"><div class="cr-info"><b>Ficha antiga</b>Decida pela tela do PC</div>'+mais+'</div>';
    if(d.estado==='entrevista') return '<div class="cr-bar"><div class="cr-info"><b>Entrevista em andamento</b>A decisão libera quando ela terminar</div>'+conv+mais+'</div>';
    var dis=fora()?' disabled':'';
    return (fora()?'<div class="cr-sem" role="status">Sem internet: dá para ver, não para decidir</div>':'')+
      '<div class="cr-bar"><button class="btn cr-out" data-act="cr-gav" data-id="reprovar"'+dis+'>Reprovar</button><button class="btn pri" data-act="cr-gav" data-id="aprovar"'+dis+'>Aprovar</button>'+mais+'</div>';
  }
  function cheiaHTML(){
    if(!st.aberta) return '';
    var id=st.aberta, f=leve(id)||{}, d=st.det[id], c=d&&!d.erro?d.cadastro||{}:{};
    var sub='Ficha '+id+(d&&!d.erro?' · '+(c.Data?dataTxt(c.Data).replace(/\/\d{4}/,''):quando(d.criada_em)):'');
    var cvb=d&&!d.erro&&conversa(d)?'<button class="back cr-cvb" data-act="cr-conversa" aria-label="Abrir a conversa deste cliente">'+IC.chat+'</button>':''; /* só quando o app tem a conversa */
    var cab='<div class="cr-cab"><button class="back" data-act="cr-fechar" aria-label="Voltar">'+IC.back+'</button><div class="mid"><div class="nm">'+esc((d&&d.nome)||f.nome||'Ficha')+'</div><div class="sub">'+esc(sub)+'</div></div>'+cvb+'</div>';
    if(!d) return '<div class="cv cr-fi">'+cab+'<div class="cr-rola" id="crFicha" role="status" aria-label="Abrindo a ficha"><div class="cr-sec"><div class="card">'+esqueleto(3)+'</div><div class="card">'+esqueleto(3)+'</div></div></div></div>';
    if(d.erro) return '<div class="cv cr-fi">'+cab+'<div class="cr-rola cr-falha" id="crFicha"><div class="empty"><b>'+esc(d.erro)+'</b></div></div><div class="cr-bar"><button class="btn pri" data-act="cr-reler">Tentar de novo</button></div></div>';
    var et='<div class="cr-etp" role="list" aria-label="Etapas da ficha">'+passos(d).map(function(p){return '<div class="cr-e '+p[1]+'" role="listitem"><i>'+(p[1]==='ok'?IC.ok14:'')+'</i><b>'+p[0]+'</b><span>'+esc(p[2])+'</span></div>';}).join('')+'</div>';
    var anc='<nav class="cr-anc" aria-label="Partes da ficha">'+ANCORAS.map(function(a){return '<button data-act="cr-anc" data-id="'+a[0]+'" aria-current="'+(st.sec===a[0])+'">'+a[1]+'</button>';}).join('')+'</nav>';
    return '<div class="cv cr-fi">'+cab+'<div class="cr-rola" id="crFicha">'+et+anc+secResumo(d)+secCadastro(d)+secEntrevista(d)+secSistema(d)+'</div>'+barraAcoes(d)+'</div>';
  }

  /* ---------- gaveta de decisão: escolher → conferir → recibo ---------- */
  function entradaOk(G){var v=num(G.entrada);return v>0&&v<=1000;}
  function prontoGav(G){return !!G.opc&&(G.opc!=='aprovado_entrada'||entradaOk(G));}
  function opcao(act,id,rot,sub,marcada,travada){
    return '<button class="cr-op" role="radio" aria-checked="'+marcada+'"'+(travada?' aria-disabled="true"':'')+' data-act="'+act+'" data-id="'+id+'"><span class="rd">'+(travada?IC.lock:'')+'</span><span>'+esc(rot)+(sub?'<small>'+esc(sub)+'</small>':'')+'</span></button>';
  }
  function fEscolher(d){
    var G=st.gav, ehA=G.tipo==='aprovar', ops=ehA?APROVAR:MOTIVOS;
    var h='<div class="sh-h"><h3>'+(ehA?'Aprovar ':'Reprovar ')+esc(primeiro(d.nome))+'</h3><button class="x" data-act="cr-fecha-folha" aria-label="Fechar">'+IC.x+'</button></div>';
    h+='<p class="cr-lbl" id="crL1">'+(ehA?'Como fica a compra':'Motivo, que fica só na ficha')+'</p><div class="cr-ops" role="radiogroup" aria-labelledby="crL1">'+ops.map(function(x){return opcao('cr-opc',x[0],x[1],x[2],G.opc===x[0]);}).join('')+'</div>';
    if(ehA&&G.opc==='aprovado_entrada') h+='<label class="campo"><span>Valor da entrada, em reais</span><input id="crEnt" inputmode="decimal" autocomplete="off" placeholder="ex.: 50" value="'+esc(G.entrada||'')+'"></label>'+(G.entrada&&!entradaOk(G)?'<span class="erro" role="alert">De 1 a 1.000 reais</span>':'');
    h+='<p class="cr-lbl" id="crL2">Avisar quem</p><div class="cr-av2" role="radiogroup" aria-labelledby="crL2">'+AVISAR.map(function(x){return opcao('cr-avisar',x[0],x[1],'',G.avisar===x[0],!AVISO_LIGADO[x[0]]);}).join('')+'</div>';
    h+='<p class="cr-nota">'+(ehA?'O cliente recebe a mensagem de aprovação pela Central.':'O cliente recebe a recusa com a oferta à vista, sem o motivo.')+' As opções com cadeado chegam nas próximas etapas.</p>';
    return h+'<div class="cr-pe"><button class="btn '+(ehA?'pri':'danger')+'" data-act="cr-conferir"'+(prontoGav(G)?'':' disabled')+'>Conferir</button></div>';
  }
  function vendedorTxt(d){
    var a=d.auto||{};
    if(a.rota&&JAYME[+a.rota]) return 'Rota '+a.rota+' é do Jayme: o caso fica com você';
    return a.rota?rotaTxt(d)+': avise você pelo WhatsApp':'Sem rota definida: avise quem for entregar';
  }
  function fConferir(d){
    var G=st.gav, ehA=G.tipo==='aprovar', op=(ehA?APROVAR:MOTIVOS).filter(function(x){return x[0]===G.opc;})[0]||['',''], L=[];
    L.push(['Decisão',ehA?'Aprovar · '+op[1]+(G.opc==='aprovado_entrada'?' de '+String(G.entrada).trim()+' reais':''):'Reprovar']);
    if(!ehA) L.push(['Motivo',op[1]+' (só na ficha, o cliente não vê)']);
    L.push(['Cliente',d.nome+(dig(d.telefone)?' · '+fmtTel(telBR(d.telefone)):' · sem celular na ficha')]);
    L.push(['Aviso','Só o cliente, pela Central']);
    L.push(['Vendedor',ehA?vendedorTxt(d):'Não é avisado']);
    var h='<div class="sh-h"><h3>Conferir</h3><button class="x" data-act="cr-fecha-folha" aria-label="Fechar">'+IC.x+'</button></div>';
    h+='<div class="cr-res">'+L.map(function(x){return '<div><span class="k">'+x[0]+'</span><span class="v">'+esc(x[1])+'</span></div>';}).join('')+'</div>';
    if(fora()) h+='<span class="erro" role="alert">Sem internet: a decisão não sai agora.</span>';
    return h+'<div class="cr-pe btns"><button class="btn" data-act="cr-voltar">Voltar</button><button class="btn '+(ehA?'pri':'danger')+'" data-act="cr-confirmar"'+(fora()?' disabled':'')+'>'+(ehA?'Aprovar agora':'Reprovar agora')+'</button></div>';
  }
  function passo(est,t,s){return '<div class="cr-p '+est+'"><span class="ci">'+(est==='ok'?IC.ok14:est==='bad'?IC.x14:est==='at'?'<span class="cr-gira"></span>':'')+'</span><div><b>'+esc(t)+'</b>'+(s?'<span>'+esc(s)+'</span>':'')+'</div></div>';}
  function fRecibo(d){
    var o=st.ordens[d.id]; if(!o) return '';
    var ped=o.tipo==='credito_pedir', rec=!ped&&o.dados.resultado==='recusado', nm=primeiro(d.nome), indo=ocupada(d.id), feito=o.st==='feito';
    var jaDec=/já foi decidida/.test(o.resultado), semPc=/não respondeu/.test(o.resultado), semConf=o.st==='sem_confirmacao'||o.st==='expirada';
    var tit=indo?(ped?'Pedindo o comprovante…':rec?'Reprovando '+nm+'…':'Aprovando '+nm+'…'):feito?(ped?'Comprovante pedido':rec?'Cadastro reprovado':'Cadastro aprovado'):o.erroFila?'Decisão gravada, aviso não saiu':jaDec?'Esta ficha já foi decidida':'Não deu certo';
    var h='<div class="sh-h"><h3>'+esc(tit)+'</h3><button class="x" data-act="cr-fecha-folha" aria-label="Fechar">'+IC.x+'</button></div><div class="cr-ps" role="status">';
    /* 1: saiu do celular · 2: gravou no PC · 3: aviso ao cliente */
    h+=o.id?passo('ok','Ordem enviada'):o.st==='enviando'?passo('at','Mandando a ordem'):passo('bad','A ordem não saiu do celular',o.resultado);
    if(o.id){
      if(feito||o.erroFila) h+=passo('ok',ped?'Pedido gravado no PC da Análise':'Decisão gravada no PC da Análise');
      else if(indo) h+=passo('at',ped?'Gravando o pedido no PC da Análise':'Gravando a decisão no PC da Análise');
      else h+=passo('bad',semPc?'O PC da Análise não respondeu':semConf?'O servidor não confirmou':'O PC não gravou',semPc||semConf?'A mesma ordem nunca decide duas vezes: pode tentar de novo.':o.resultado);
      if(ped) h+=feito?passo('ok','O robô da Central pergunta ao cliente'):passo('de','O robô da Central pergunta ao cliente');
      else h+=feito?passo('ok','Aviso ao cliente na fila da Central'):o.erroFila?passo('bad','O aviso ao cliente não saiu',String(o.resultado).replace(/^[^(]*\(([^)]*)\).*$/,'$1')):passo('de','Aviso ao cliente pela Central');
    }
    if(!ped&&!rec&&(feito||o.erroFila)) h+=passo('de','Vendedor',vendedorTxt(d));
    h+='</div>';
    var prox=feito&&!ped?proxima(d.id):null;
    if(prox) h+='<p class="cr-nota">Próxima da fila: '+esc(prox.nome)+' · '+esc(idade(prox))+'</p>';
    else if(feito&&!ped) h+='<p class="cr-nota">Era a última da fila.</p>';
    h+='<div class="cr-pe btns">';
    if(indo) h+='<button class="btn cr-so" data-act="cr-fecha-folha">Fechar e seguir</button>';
    else if(feito) h+=prox?'<button class="btn" data-act="cr-lista">Voltar à lista</button><button class="btn pri" data-act="cr-abrir" data-id="'+esc(prox.id)+'">Próxima ficha</button>':'<button class="btn pri cr-so" data-act="'+(ped?'cr-fecha-folha':'cr-lista')+'">'+(ped?'Fechar':'Voltar à lista')+'</button>';
    else if(jaDec) h+='<button class="btn pri cr-so" data-act="cr-fecha-folha">Ver a ficha</button>';
    else h+='<button class="btn" data-act="cr-fecha-folha">Fechar</button><button class="btn pri" data-act="cr-repetir" data-id="'+esc(d.id)+'"'+(fora()?' disabled':'')+'>'+(o.erroFila?'Reenviar aviso':'Tentar de novo')+'</button>';
    return h+'</div>';
  }
  function fMais(d){
    var cv=conversa(d), t=telBR(d.telefone), br=t.length===10||t.length===11, L='';
    if(cv) L+='<button class="cr-li" data-act="cr-conversa">'+IC.chat+'Abrir a conversa no app</button>';
    if(br) L+='<a class="cr-li" href="https://wa.me/55'+esc(t)+'" target="_blank" rel="noopener noreferrer">'+IC.wa+'Abrir no WhatsApp<span class="sr"> (abre em outra aba)</span></a>';
    if(podePedir(d)&&d.ent) L+='<button class="cr-li" data-act="cr-pedir">'+IC.img+'Pedir o comprovante de novo</button>';
    if(dig(d.telefone)) L+='<button class="cr-li" data-act="cr-copia" data-id="tel">'+IC.copy+'Copiar telefone</button>';
    if(dig(d.cpf)) L+='<button class="cr-li" data-act="cr-copia" data-id="cpf">'+IC.copy+'Copiar CPF</button>';
    return '<div class="sh-h"><h3>'+esc(primeiro(d.nome))+'</h3><button class="x" data-act="cr-fecha-folha" aria-label="Fechar">'+IC.x+'</button></div><div class="cr-lis">'+(L||'<p class="cr-nota">Nada para fazer com esta ficha.</p>')+'</div>';
  }
  function folha(){
    if(!st.folha||!st.aberta) return '';
    var d=st.det[st.aberta]; if(!d||d.erro) return '';
    var rot=st.folha==='mais'?'Mais ações':st.folha==='recibo'?'Andamento da ordem':st.gav&&st.gav.passo===2?'Conferir a decisão':st.gav&&st.gav.tipo==='aprovar'?'Aprovar':'Reprovar';
    var h=st.folha==='mais'?fMais(d):st.folha==='recibo'?fRecibo(d):st.gav?(st.gav.passo===2?fConferir(d):fEscolher(d)):'';
    return h?'<div class="scrim" data-act="cr-fecha-folha"><div class="sheet cr-sheet" role="dialog" aria-modal="true" aria-label="'+rot+'"><span class="grab"></span>'+h+'</div></div>':'';
  }

  /* ---------- ida e volta com as Conversas ---------- */
  function daConversa(fc){ /* a conversa aberta tem cadastro de crédito? (pelos 8 dígitos finais do telefone; prefere o que ainda não foi decidido) */
    var a=dig((fc||{}).telChat).slice(-8), b=dig((fc||{}).telCad).slice(-8);
    if(!st.lista||(a.length<8&&b.length<8)) return null;
    var L=st.lista.filter(function(f){return f.tel8&&(f.tel8===a||f.tel8===b);});
    if(!L.length) return null;
    L.sort(function(x,y){return (x.estado==='decidida')-(y.estado==='decidida')||String(y.criada_em).localeCompare(String(x.criada_em));});
    return {id:L[0].id,etapa:etapaDe(L[0]).rot,aberta:L[0].estado!=='decidida'};
  }
  function rolaPara(id,y){requestAnimationFrame(function(){var el=document.getElementById(id);if(el)el.scrollTop=y;});var e=document.getElementById(id);if(e)e.scrollTop=y;}
  function fecharFicha(){
    var cv=st.voltaConv; st.aberta=null; st.folha=null; st.gav=null; st.voltaConv=null;
    if(cv&&api.abrirConv){api.abrirConv(cv,false);return;} /* veio de uma conversa: volta para ela */
    api.render(); rolaPara('crLista',st.rolLista||0);
  }
  function marca(sec){st.sec=sec;var B=document.querySelectorAll('.cr-anc button');for(var i=0;i<B.length;i++)B[i].setAttribute('aria-current',String(B[i].getAttribute('data-id')===sec));}

  /* ---------- toques ---------- */
  function acao(a,id,el,ev){
    if(a==='cr-fecha-folha'&&el.classList.contains('scrim')&&ev.target!==el) return;
    if(st.trava&&st.folha==='recibo') return;
    if(el.getAttribute&&el.getAttribute('aria-disabled')==='true'){api.toast('Chega nas próximas etapas');return;}
    var d=st.aberta&&st.det[st.aberta]; if(d&&d.erro) d=null;
    switch(a){
      case 'cr-pilha': st.pilha=id; st.filtro='espera'; break;
      case 'cr-filtro': st.filtro=st.filtro===id&&id!=='espera'?'espera':id; break; /* tocar de novo volta para "Esperando você" */
      case 'cr-ler': st.erro=''; atualizar(true); break;
      case 'cr-limpa': st.busca=''; st.arq=null; api.render(); var b=document.getElementById('crBusca'); if(b) b.focus(); return;
      case 'cr-arquivo': buscaArquivo(); return;
      case 'cr-abrir': if(!st.aberta){var l=document.getElementById('crLista');st.rolLista=l?l.scrollTop:0;} abrirFicha(id); rolaPara('crFicha',0); return;
      case 'cr-reler': if(st.aberta){delete st.det[st.aberta];abrirFicha(st.aberta);} return;
      case 'cr-fechar': fecharFicha(); return;
      case 'cr-lista': st.voltaConv=null; fecharFicha(); return;
      case 'cr-anc': var s=document.getElementById('cr-s-'+id); marca(id); if(s) s.scrollIntoView({block:'start',behavior:calmo()?'auto':'smooth'}); return;
      case 'cr-log': if(st.aberta){delete st.log[st.aberta];lerLog(st.aberta);} return;
      case 'cr-copia': if(!d) return; copiar(id==='cpf'?dig(d.cpf):telBR(d.telefone),id==='cpf'?'CPF copiado':'Telefone copiado'); if(st.folha==='mais'){st.folha=null;break;} return;
      case 'cr-conversa': if(!d) return; var cv=conversa(d); if(!cv){api.toast('Sem conversa deste número no app');return;}
        var fr=document.getElementById('crFicha'); st.rolFicha=fr?fr.scrollTop:0; st.folha=null; api.abrirConv(cv.id,true); return;
      case 'cr-da-conversa': st.voltaConv=S.conv; S.fichaAberta=false; S.conv=null; S.tab='credito'; st.busca=''; abrirFicha(id); return;
      case 'cr-mais': if(d) st.folha='mais'; break;
      case 'cr-recibo': if(d&&st.ordens[d.id]) st.folha='recibo'; break;
      case 'cr-fecha-folha': st.folha=null; st.gav=null; break;
      case 'cr-gav': if(d&&!ocupada(d.id)){st.gav={tipo:id,passo:1,opc:'',entrada:'',avisar:AVISO_PADRAO[id]};st.folha='gaveta';} break;
      case 'cr-opc': if(st.gav) st.gav.opc=id; break;
      case 'cr-avisar': if(st.gav&&AVISO_LIGADO[id]) st.gav.avisar=id; break;
      case 'cr-conferir': if(st.gav&&prontoGav(st.gav)) st.gav.passo=2; break;
      case 'cr-voltar': if(st.gav) st.gav.passo=1; break;
      case 'cr-confirmar': if(!d||!st.gav||!prontoGav(st.gav)||fora()) return;
        var G=st.gav, o={ficha:d.id,resultado:G.tipo==='aprovar'?G.opc:'recusado',avisar:G.avisar};
        if(G.opc==='aprovado_entrada') o.entrada=String(G.entrada).trim();
        if(G.tipo==='reprovar') o.motivo=G.opc;
        mandar(d.id,'credito_decidir',o); return;
      case 'cr-repetir': repetir(id); return;
      case 'cr-pedir': if(!d) return; st.folha=null;
        S.modal={t:'Pedir o comprovante de '+primeiro(d.nome)+'?',p:'O robô da Central pede de novo a foto do holerite ou o PDF da Carteira Digital. A ficha volta para a entrevista.',ok:'Pedir',fazer:function(){mandar(d.id,'credito_pedir',{ficha:d.id});}}; break;
      default: return;
    }
    api.render();
  }
  document.addEventListener('input',function(ev){
    var t=ev.target; if(!t) return;
    if(t.id==='crEnt'&&st.gav){var antes=entradaOk(st.gav);st.gav.entrada=t.value;if(entradaOk(st.gav)!==antes||!t.value)api.render();return;}
    if(t.id==='crBusca'){ /* a busca redesenha só a lista: o teclado do celular não fecha a cada letra, e nada vai ao banco */
      var tinha=!!st.busca.trim(); st.busca=t.value; st.arq=null;
      var x=document.getElementById('crLimpa'), p=document.getElementById('crPilhas'), l=document.getElementById('crLista');
      if(x) x.hidden=!st.busca;
      if(p&&!!st.busca.trim()!==tinha) p.innerHTML=pilhasHTML();
      pintaCorpo(); if(l) l.scrollTop=0;
    }
  });
  document.addEventListener('keydown',function(ev){
    if(ev.key!=='Escape'||ev.defaultPrevented||S.modal||S.tab!=='credito'||!st.aberta) return;
    if(st.folha==='gaveta'&&st.gav&&st.gav.passo===2) st.gav.passo=1; else if(st.folha){st.folha=null;st.gav=null;} else {ev.preventDefault();fecharFicha();return;}
    ev.preventDefault(); api.render();
  });
  var espia=0; /* a âncora acompanha a parte da ficha que está na tela, sem redesenhar */
  document.addEventListener('scroll',function(ev){
    var el=ev.target; if(!el||el.id!=='crFicha'||espia) return;
    espia=requestAnimationFrame(function(){espia=0;
      var topo=el.getBoundingClientRect().top+64, atual=ANCORAS[0][0];
      ANCORAS.forEach(function(a){var s=document.getElementById('cr-s-'+a[0]);if(s&&s.getBoundingClientRect().top<=topo)atual=a[0];});
      if(el.scrollTop+el.clientHeight>=el.scrollHeight-2) atual=ANCORAS[ANCORAS.length-1][0];
      if(atual!==st.sec) marca(atual);});
  },true);

  /* estilo só da aba (o resto vem do index.html). Cores sempre pelas variáveis da página */
  var css=document.createElement('style');
  css.textContent=
    /* lista */
    '.cr-find{position:relative}.find.cr-find input{padding-right:46px}#crBusca::-webkit-search-cancel-button{display:none}.cr-x{position:absolute;right:0;top:0;width:44px;height:44px;border:0;background:transparent;color:var(--ink-2);display:flex;align-items:center;justify-content:center;border-radius:22px}.cr-x[hidden]{display:none}'+
    '#crPilhas:empty{display:none}.seg.cr-vis{grid-template-columns:repeat(2,minmax(0,1fr))}.cr-vis button{height:44px;white-space:nowrap}'+
    '#crCorpo{display:flex;flex-direction:column;gap:12px;flex:1 0 auto}.cr-falha{flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px}.cr-falha .empty{flex:1;justify-content:center}.cr-falha .empty span{color:var(--ink-2)}'+
    '.filt.cr-kpis{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.filt.cr-kpis button{align-items:flex-start;padding:10px 8px 9px 10px;gap:2px;border-radius:12px;text-align:left;background:var(--card);min-width:0}.filt.cr-kpis .l{font-size:12px}'+
    '.cr-card{flex-direction:column;align-items:stretch;gap:5px;padding:14px 16px}.cr-l1{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'+
    '.cr-l1 .nm{min-width:0;font-size:15px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}.cr-l1 .pill,.cr-l1 .time{flex:none}'+ /* o nome nunca é cortado: quebra em quantas linhas precisar */
    '.cr-st{display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.3;font-weight:500;color:var(--ink-2);min-width:0}.cr-st>span:last-child{min-width:0}'+
    '.cr-l3{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}'+
    '.cr-pg{display:inline-flex;gap:3px;flex:none}.cr-pg i{width:12px;height:4px;border-radius:2px;background:var(--line)}.cr-pg i.ok{background:var(--pri)}.cr-pg i.at{width:22px;background:var(--pri)}'+
    '.cr-pg i.at.warn{background:var(--warn)}.cr-pg i.at.bad{background:var(--bad)}.cr-pg.fim i{background:var(--ok)}.cr-pg.nao i{background:var(--ink-3)}'+
    '.cr-on{flex:1;min-width:0;font-size:12px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
    '.cr-flag{font-size:12px;font-weight:600;white-space:nowrap}.cr-flag.bad{color:var(--bad)}.cr-flag.warn{color:var(--warn)}.cr-flag.mute{color:var(--ink-2)}'+
    '.cr-nota{margin:0;font-size:13px;line-height:1.4;color:var(--ink-2)}.cr-pe2{text-align:center;padding:4px 0 8px}'+
    '.cr-nt{justify-content:space-between}.cr-nt span{flex:1;min-width:0}.cr-nb{flex:none;height:44px;padding:0 14px;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;font-weight:700;font-size:13px}'+
    '.cr-sk{display:flex;flex-direction:column;gap:9px;padding:16px;border-bottom:1px solid var(--line-2)}.cr-sk:last-child{border-bottom:0}'+
    '.cr-sk i{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--line-2) 25%,var(--line) 37%,var(--line-2) 63%);background-size:400% 100%;animation:cr-sk 1.3s ease infinite}'+
    '@keyframes cr-sk{0%{background-position:100% 50%}100%{background-position:0 50%}}'+
    /* ficha */
    '.cr-fi{background:var(--bg)}.cr-cab{flex:none;display:flex;align-items:center;gap:10px;background:var(--card);border-bottom:1px solid var(--line);padding:calc(8px + env(safe-area-inset-top,0px)) 12px 8px}'+
    '.cr-cab .mid{flex:1;min-width:0}.cr-cvb{color:var(--pri)}.cr-cab .nm{font-size:16px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}.cr-cab .sub{font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}'+
    '.cr-rola{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;padding-bottom:16px}.cr-rola>*{flex-shrink:0}'+
    '.cr-etp{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:14px 8px 12px;background:var(--card)}'+
    '.cr-e{display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;text-align:center;min-width:0;padding:0 2px}'+
    '.cr-e::before{content:"";position:absolute;top:11px;right:50%;width:100%;height:2px;background:var(--line)}.cr-e:first-child::before{display:none}.cr-e.ok::before,.cr-e.at::before{background:var(--pri)}'+
    '.cr-e i{width:24px;height:24px;border-radius:50%;border:2px solid var(--line);background:var(--card);display:flex;align-items:center;justify-content:center;position:relative;z-index:1;color:#fff;font-style:normal}'+
    '.cr-e.ok i{background:var(--pri);border-color:var(--pri)}.cr-e.at i{border-color:var(--pri)}.cr-e.at i::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--pri)}'+
    '.cr-e.at.warn i{border-color:var(--warn)}.cr-e.at.warn i::after{background:var(--warn)}.cr-e b{font-size:12px;font-weight:600}.cr-e span{font-size:12px;line-height:1.25;color:var(--ink-2);overflow-wrap:anywhere}.cr-e.at.warn span{color:var(--warn);font-weight:600}'+
    '.cr-anc{position:sticky;top:0;z-index:2;display:flex;background:var(--card);border-top:1px solid var(--line-2);border-bottom:1px solid var(--line);padding:0 8px}'+
    '.cr-anc button{flex:1 1 auto;min-width:44px;height:44px;border:0;background:transparent;font-size:13px;font-weight:600;color:var(--ink-2);padding:0 6px;position:relative;white-space:nowrap}'+
    '.cr-anc button[aria-current="true"]{color:var(--pri)}.cr-anc button[aria-current="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px;background:var(--pri)}'+
    '.cr-sec{display:flex;flex-direction:column;gap:12px;padding:16px 16px 4px;scroll-margin-top:46px}'+
    '.cr-av{border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.35;font-weight:600}.cr-av.bad{background:var(--bad-soft);color:var(--bad)}.cr-av.warn{background:var(--warn-soft);color:var(--warn)}.cr-av.info{background:var(--pri-soft);color:var(--pri)}'+
    '.cr-fatos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cr-fato{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}'+
    '.cr-fato .k{font-size:12px;font-weight:600;color:var(--ink-2)}.cr-fato .v{font-size:17px;font-weight:700;line-height:1.2;letter-spacing:-.01em;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.cr-fato .s{font-size:12px;line-height:1.3;color:var(--ink-2);overflow-wrap:anywhere}'+
    '.cr-blk{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;display:flex;flex-direction:column;gap:12px}.cr-blk h4{margin:0;font-size:13px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.06em}'+
    '.cr-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}.cr-c{display:flex;flex-direction:column;gap:2px;min-width:0}.cr-c.larga{grid-column:1/-1}'+
    '.cr-c .k{font-size:12px;color:var(--ink-2)}.cr-c .v{font-size:15px;line-height:1.3;font-weight:500;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}'+
    '.cr-ni{margin:0;font-size:13px;line-height:1.4;color:var(--ink-2);border-top:1px solid var(--line-2);padding-top:10px}.cr-ni.so{border-top:0;padding-top:0}'+
    '.cr-doc{display:flex;align-items:center;gap:12px;min-height:44px}.cr-doc .ic{width:40px;height:40px;border-radius:10px;background:var(--mute-soft);color:var(--ink-2);display:flex;align-items:center;justify-content:center;flex:none}'+
    '.cr-doc .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.cr-doc .tx b{font-size:15px;font-weight:600;overflow-wrap:anywhere}.cr-doc .tx span{font-size:13px;color:var(--ink-2);overflow-wrap:anywhere}.cr-doc .tx i{font-style:normal;font-weight:600}.cr-doc .tx i.ok{color:var(--ok)}.cr-doc .tx i.warn{color:var(--warn)}'+
    '.cr-b{min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:14px;font-weight:600;color:var(--pri);display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}.cr-b:disabled{opacity:.5}'+
    '.cr-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cr-lig{display:flex;flex-direction:column;gap:4px;font-size:14px}.cr-lig span{color:var(--ink-2);font-size:13px}.cr-lig .cr-b{align-self:flex-start;margin-top:4px}'+
    '.cr-mt{font-size:12px;font-weight:600;color:var(--ink-2);padding:0 6px}'+
    '.cr-sem{flex:none;padding:8px 16px;background:var(--warn-soft);color:var(--warn);font-size:13px;font-weight:600;text-align:center}'+
    '.cr-bar{flex:none;display:flex;gap:10px;align-items:center;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));background:var(--card);border-top:1px solid var(--line)}'+
    '.cr-bar .btn{flex:1;min-width:0}.cr-bar .cr-mais{flex:none;width:52px;display:flex;align-items:center;justify-content:center}.cr-bar .cr-bx{flex:none;width:auto;padding:0 16px}'+
    '.cr-out{border-color:var(--bad);color:var(--bad)}.cr-info{flex:1;min-width:0;font-size:13px;line-height:1.3;color:var(--ink-2)}.cr-info b{display:block;font-size:15px;color:var(--ink);overflow-wrap:anywhere}'+
    /* gaveta */
    '.cr-lbl{margin:0;font-size:13px;font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.06em}.sheet .cr-lbl{font-size:13px}.sheet .cr-nota{font-size:13px}'+
    '.cr-ops{display:flex;flex-direction:column;gap:8px}.cr-op{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;border:1px solid var(--line);border-radius:12px;background:var(--card);text-align:left;padding:6px 14px;font-size:15px;font-weight:600;color:var(--ink)}'+
    '.cr-op small{display:block;font-size:13px;font-weight:500;color:var(--ink-2)}.cr-op .rd{width:20px;height:20px;border-radius:50%;border:2px solid var(--ink-3);flex:none;display:flex;align-items:center;justify-content:center;color:var(--ink-2)}'+
    '.cr-op[aria-checked="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}.cr-op[aria-checked="true"] .rd{border-color:var(--pri)}.cr-op[aria-checked="true"] .rd::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--pri)}'+
    '.cr-av2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cr-av2 .cr-op{font-size:14px;padding:6px 10px;gap:8px}'+
    '.cr-op[aria-disabled="true"]{background:var(--bg);border-style:dashed;color:var(--ink-2);font-weight:500}.cr-op[aria-disabled="true"] .rd{border:0}'+
    '.cr-sheet .campo span{font-size:14px;font-weight:600;color:var(--ink-2)}.cr-sheet .campo input{height:48px;border:1px solid var(--line);border-radius:12px;padding:0 14px;font-size:16px;width:100%;background:var(--card)}'+
    '.cr-sheet .campo input:focus{outline:2px solid var(--pri);outline-offset:1px;border-color:transparent}'+
    '.cr-pe{position:sticky;bottom:calc(-24px - env(safe-area-inset-bottom,0px));margin:0 -16px calc(-24px - env(safe-area-inset-bottom,0px));padding:12px 16px calc(24px + env(safe-area-inset-bottom,0px));background:var(--card);border-top:1px solid var(--line-2)}.cr-pe .cr-so{grid-column:1/-1}'+
    '.cr-res{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden}.cr-res div{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;padding:11px 12px;border-bottom:1px solid var(--line-2);font-size:14px;line-height:1.35}'+
    '.cr-res div:last-child{border-bottom:0}.cr-res .k{color:var(--ink-2);font-size:13px}.cr-res .v{font-weight:600;overflow-wrap:anywhere}'+
    '.cr-ps{display:flex;flex-direction:column;gap:14px}.cr-p{display:flex;gap:12px;align-items:flex-start;font-size:15px;line-height:1.35}.cr-p .ci{width:24px;height:24px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:var(--mute-soft);color:var(--ink-2)}'+
    '.cr-p.ok .ci{background:var(--ok-soft);color:var(--ok)}.cr-p.bad .ci{background:var(--bad-soft);color:var(--bad)}.cr-p.at .ci{background:transparent}.cr-p b{display:block;font-weight:600}.cr-p.de b{font-weight:500;color:var(--ink-2)}'+
    '.cr-p span{display:block;font-size:13px;color:var(--ink-2)}'+
    '.cr-gira{display:block;width:18px;height:18px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--pri);animation:cr-gira .8s linear infinite;flex:none}@keyframes cr-gira{to{transform:rotate(360deg)}}'+
    '.cr-lis{display:flex;flex-direction:column}.cr-li{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;border:0;border-bottom:1px solid var(--line-2);background:var(--card);padding:0 4px;font-size:15px;font-weight:600;text-align:left;color:var(--ink);text-decoration:none}.cr-li:last-child{border-bottom:0}.cr-li svg{width:20px;height:20px;flex:none;color:var(--ink-2)}'+
    /* faixa da conversa com cadastro de crédito */
    '.faixa.cr-fxc{border-left-color:var(--pri)}.cr-fxc .cr-fxt{flex:1;min-width:0;font-size:14px;line-height:1.35}.cr-fxc .cr-fxt span{color:var(--ink-2)}'+
    '.cr-ver{flex:none;height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--pri);font-size:13px;font-weight:700}'+
    '@media (prefers-reduced-motion:reduce){.cr-sk i,.cr-gira{animation:none}}';
  document.head.appendChild(css);

  return {view:view,badge:badge,folha:folha,acao:acao,cheia:cheiaHTML,daConversa:daConversa,
    vista:function(){return (st.aberta||'')+'|'+st.pilha+'|'+st.filtro;},
    voltou:function(){rolaPara('crFicha',st.rolFicha||0);}, /* voltou da conversa para a ficha: no mesmo ponto */
    sair:function(){st.lista=null;st.ult='';st.sens=false;st.entrou=false;st.det={};st.log={};st.ordens={};st.aberta=null;st.folha=null;st.gav=null;st.arq=null;st.busca='';st.erro='';st.leuEm=0;st.leuOk='';st.voltaConv=null;st.pilha='novos';st.filtro='espera';
      try{localStorage.removeItem(GUARDA);}catch(e){}},
    _teste:{horasUteis:horasUteis,st:st,atualizar:atualizar,acha:acha,termoArquivo:termoArquivo,etapaDe:etapaDe}};
};
})();
