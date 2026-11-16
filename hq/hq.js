/* ALIANÇA HQ — painel de comando no padrão Tabler, tema claro (16/11/2026, branch feat/novo-layout-hq).
   SEM LOGIN: lê só as linhas de contagem (hq-pc e hq-servidor) e mostra o estado de cada funcionário digital. Nada de valor, fila ou nome.
   COM LOGIN DO GESTOR (Supabase Auth + papel admin): lê a linha privada hq-financeiro e libera pendências, números, filas e chaves.
   Nenhum dado fica neste arquivo: tudo vem do banco, e quem decide o que cada um lê é a regra do banco (RLS), não esta página.
   As ordens usam o contrato de sempre: uma linha hq-cmd-... com status "pendente", que o worker do servidor executa numa lista fechada.
   Pendência (decisão de crédito, confirmação de entrega): 1 toque, com 5 segundos para desfazer antes de a ordem sair.
   Chave e demais ordens: sempre com pergunta de confirmação. A chave só muda de posição quando o servidor confirma. */
(() => {
'use strict';

/* ---------------- configuração ---------------- */
const URL_BANCO = window.SUPABASE_URL || '', CHAVE_PUBLICA = window.SUPABASE_ANON_KEY || '';   // vêm de ../config.js (chave pública por desenho)
const BIBLIOTECA_LOGIN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';   // só é baixada quando o Gestor entra
const CICLO_MS = 60000, CICLO_RAPIDO_MS = 10000, VELHO_MIN = 15, FUSO = 'America/Sao_Paulo';
const EXPEDIENTE_BANCO = ['08:00', '18:30'], LEITURA_ATRASADA_MIN = 120, PEDIDO_SEM_DONO_H = 20, DESFAZER_MS = 5000;
const LIMITE_PENDENCIAS = { credito: 4, pix: 2, entrega: 3 };   // o resto fica a um toque, na gaveta

/* Os seis funcionários digitais. "chave" é a chave principal da linha; "outras" aparecem na gaveta.
   As janelas de trabalho repetem as que estão configuradas nos motores do servidor (seg a sáb). */
const EQUIPE = [
  { id: 'atendente', cargo: 'Atendente da Central', plantao: true, precisaCentral: true, outras: ['SITE_CADASTRO_AO_VIVO', 'POS_QUITACAO_AO_VIVO', 'PERGUNTA_DATA_AO_VIVO', 'ARQUIVA_CONCLUIDOS_AO_VIVO'] },
  { id: 'credito', cargo: 'Analista de Crédito', plantao: true, outras: [] },
  { id: 'vip', cargo: 'Especialista VIP', chave: 'INDICACAO_VIP_AO_VIVO', janela: ['08:30', '17:30'], outras: ['CAMPANHAS_VENDAS_AO_VIVO'] },
  { id: 'recuperador', cargo: 'Recuperador de Base', chave: 'REATIVACAO_BASE_AO_VIVO', janela: ['08:30', '17:30'], outras: ['REATIVACAO_AO_VIVO'] },
  { id: 'cobrador', cargo: 'Cobrador Preventivo', chave: 'REGUA_COBRANCA_AO_VIVO', janela: ['08:30', '17:30'], outras: ['REGUA_ATRASADOS_AO_VIVO', 'LEMBRETE_VISITA_AO_VIVO'] },
  { id: 'secretario', cargo: 'Secretário dos Vendedores', chave: 'RECADO_VENDEDOR_AO_VIVO', janela: ['08:00', '18:00'], precisaCentral: true, outras: ['ROMANEIO_AO_VIVO', 'DONO_DO_PEDIDO_AO_VIVO', 'COPILOTO_BRUNO_AO_VIVO'] },
];
const CICLO_DE = { vip: 'credito.indicacaoVip.ultimoCiclo', recuperador: 'credito.recompra.ultimoCiclo', cobrador: 'credito.regua.ultimoCiclo', secretario: 'boletim.ultimoCiclo' };

/* O que cada chave faz: aparece só na pergunta de confirmação, antes de ligar ou pausar. alvo: quem recebe mensagem quando ela está ligada. */
const CHAVES = {
  SITE_CADASTRO_AO_VIVO: { alvo: 'cliente', txt: 'Manda as boas-vindas pedindo os comprovantes e o dossiê de crédito no grupo de aprovação. Desligada: o cadastro é recebido e analisado, mas nada é enviado.' },
  POS_QUITACAO_AO_VIVO: { alvo: 'cliente', txt: 'Oferece uma nova cesta ao cliente bom que acabou de quitar. Seg a sáb, das 8h às 18h.' },
  PERGUNTA_DATA_AO_VIVO: { alvo: 'cliente', txt: 'Pergunta a quem pagou só uma parte para qual dia fica o restante.' },
  ARQUIVA_CONCLUIDOS_AO_VIVO: { alvo: 'ninguem', txt: 'Arquiva conversas lidas, sem pendência e paradas há mais de 24 h. Não envia mensagem.' },
  INDICACAO_VIP_AO_VIVO: { alvo: 'cliente', txt: 'Envia o link exclusivo de indicação para quem paga em dia. Desligada: monta a fila de convites, mas não envia.' },
  CAMPANHAS_VENDAS_AO_VIVO: { alvo: 'cliente', txt: 'Oferta com brinde para quem quitou, convite de indicação e reativação comercial. Nunca desconto.' },
  REATIVACAO_BASE_AO_VIVO: { alvo: 'cliente', txt: 'Convida bons pagadores da base e manda a renovação 24 h depois de quem quitou em dia. Desligada: monta a fila, mas não envia.' },
  REATIVACAO_AO_VIVO: { alvo: 'cliente', txt: 'Versão anterior da reativação: convida bons pagadores que não compram há 45 a 180 dias.' },
  REGUA_COBRANCA_AO_VIVO: { alvo: 'cliente', txt: 'Lembrete de parcela 3 dias antes, no dia e 3 dias depois do vencimento. Desligada: monta a fila, mas não envia.' },
  REGUA_ATRASADOS_AO_VIVO: { alvo: 'cliente', txt: 'Cobra clientes com 3 a 30 dias de atraso. É cobrança, e a rotina do dia já manda avisos de atraso.' },
  LEMBRETE_VISITA_AO_VIVO: { alvo: 'cliente', txt: 'Avisa o cliente na véspera da visita do vendedor. Pode repetir mensagem da rotina.' },
  RECADO_VENDEDOR_AO_VIVO: { alvo: 'vendedor', txt: 'Solta os 3 boletins do dia no grupo de cada rota. Aviso de Pix e cancelamento urgente saem na hora.' },
  ROMANEIO_AO_VIVO: { alvo: 'vendedor', txt: 'Manda o roteiro do dia da rota para o grupo do vendedor.' },
  DONO_DO_PEDIDO_AO_VIVO: { alvo: 'vendedor', txt: 'Lembra o grupo do vendedor quando um pedido de compra fica sem atendimento, e avisa você antes de completar um dia.' },
  COPILOTO_BRUNO_AO_VIVO: { alvo: 'vendedor', txt: 'Apoio extra nas rotas 1, 6, 18, 21 e 25: quem cobrar primeiro, radar e oportunidades de venda.' },
  BOLETIM_DONO_AO_VIVO: { alvo: 'gestor', txt: 'No modo silencioso o resumo do dia fica aqui no HQ. O recomendado é deixar desligada.' },
  ORQUESTRADOR_CONCILIADOR_AO_VIVO: { alvo: 'ninguem', txt: 'Confere os Pix a cada 30 min. Não grava baixa sem a chave de gravação.' },
  CONCILIADOR_AUTO_GRAVAR: { alvo: 'ninguem', txt: 'Grava baixa no sistema financeiro sozinho. Só se liga pelo terminal, com o dono presente.', travada: true },
};
const QUEM_RECEBE = { cliente: 'Ao ligar, as mensagens saem de verdade para os clientes.', vendedor: 'Ao ligar, os recados saem de verdade para os grupos dos vendedores.', gestor: 'Ao ligar, o resumo volta a ir para o seu WhatsApp.', ninguem: 'Não envia mensagem a ninguém.' };

const PENDENCIA = { promessa: 'Promessa de pagamento', encaminhar: 'Encaminhar a uma pessoa', comprador: 'Quer comprar', contestacao: 'Contestação', pix_nao_baixado: 'Pix ainda não baixado', ja_pagou: 'Disse que já pagou', suspeita: 'Suspeita', sair: 'Pediu para sair', desacordo: 'Desacordo', comprovante: 'Comprovante para conferir', entrevista: 'Entrevista de crédito', vendedor_msg: 'Recado de vendedor', dinheiro_nao_confere: 'Dinheiro não confere' };
const ORIGEM = { indicacao_vip: 'indicação VIP', direto: 'direto no site' };
const ORDEM_TIPO = { chave: 'Chave', credito_decidir: 'Decisão de crédito', entrega_confirmar: 'Confirmar entrega', reiniciar_robo: 'Reinício de número', cobranca_1215: 'Rodada de cobrança', diretriz: 'Diretriz' };
const DIA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const TITULOS = { caixa: 'Caixa de hoje', previsao: 'A receber em 7 dias', atraso: 'Atraso', receita: 'Equipe digital no mês', captacao: 'Captação', entrega: 'Entrega na rota', quitacao: 'Quitação', avisos: 'Avisos de hoje' };

/* ---------------- estado ---------------- */
const E = {
  pub: { ok: false, erro: 'carregando', pc: null, srv: null, em: 0, primeira: true },
  fin: null, finEm: null, finErro: '',
  g: { sb: null, admin: false, email: '', conferindo: false },
  ordens: [], espera: {}, enviadas: {}, agendadas: {}, rapidoAte: 0, lendo: false, gaveta: null,
};

/* ---------------- utilidades ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pega = (o, caminho, pad) => { let x = o; for (const k of caminho.split('.')) { if (x == null) return pad; x = x[k]; } return x == null ? pad : x; };
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const plural = (n, um, varios) => (n === 1 ? um : varios);
const conta = (n, um, varios) => n + ' ' + plural(n, um, varios);
const ACENTOS = [[/\bendereco\b/g, 'endereço'], [/\bsituacao\b/g, 'situação'], [/\bexcluida\b/g, 'excluída'], [/\bindicacao\b/g, 'indicação'], [/\brenovacao\b/g, 'renovação'], [/\banticolisao\b/g, 'recebeu outra mensagem há pouco'], [/\bconversa ativa\b/g, 'está conversando agora'], [/\bhorario\b/g, 'horário'], [/\bcredito\b/g, 'crédito'], [/\bwhatsapp\b/g, 'WhatsApp'], [/\bpix\b/g, 'Pix'], [/\bcpf\b/g, 'CPF'], [/\bcep\b/g, 'CEP'], [/\bnao\b/g, 'não'], [/\bpossivel\b/g, 'possível'], [/\bdivida\b/g, 'dívida'], [/\bcancelamento rota\b/g, 'cancelamento de rota']];
const humano = s => ACENTOS.reduce((t, [de, para]) => t.replace(de, para), String(s || '').replace(/_/g, ' '));
const MOTIVO_CICLO = { chave_desligada: 'chave desligada, só prévia', fora_do_horario: 'fora do horário', fora_da_janela: 'fora do horário' };
const frase = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const origem = o => ORIGEM[o] || humano(o);
const inteiro = v => Math.round(+v || 0).toLocaleString('pt-BR');
const reais = v => (num(+v) == null ? '–' : 'R$ ' + inteiro(v));   // espaço que não quebra: o valor nunca se separa do R$
const pct = v => (num(v) == null ? '–' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const poe = (el, html) => { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } };

const partesFuso = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
function noFuso(d = new Date()) {   // dia, minuto do dia e dia da semana no horário de Londrina
  const p = {}; for (const x of partesFuso.formatToParts(d)) p[x.type] = x.value;
  return { dia: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), sem: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const minutos = hhmm => { const [h, m] = hhmm.split(':'); return h * 60 + (+m); };
const naJanela = (j, t = noFuso()) => !!j && t.sem !== 0 && t.min >= minutos(j[0]) && t.min < minutos(j[1]);
function proximoDiaUtil(t = noFuso()) {   // hoje, se ainda dá tempo de trabalhar; senão o próximo dia de seg a sáb
  let d = new Date(t.dia + 'T12:00:00-03:00');
  if (t.sem === 0 || t.min >= minutos('17:30')) do { d = new Date(d.getTime() + 864e5); } while (noFuso(d).sem === 0);
  const x = noFuso(d); return { dia: x.dia, sem: x.sem, hoje: x.dia === t.dia };
}
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : fHora.format(d); };
const dataBR = dia => String(dia || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const minDesde = iso => { const t = Date.parse(iso); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); };
const haQuanto = min => (min == null ? 'sem dado' : min < 1 ? 'agora' : min < 60 ? 'há ' + min + ' min' : min < 2880 ? 'há ' + Math.round(min / 60) + ' h' : 'há ' + Math.round(min / 1440) + ' dias');
function quando(iso) {   // "hoje às 14:32", "ontem às 18:10", "13/11 às 09:00"
  const d = new Date(iso); if (isNaN(d)) return '';
  const dia = noFuso(d).dia, hoje = noFuso().dia, ontem = noFuso(new Date(Date.now() - 864e5)).dia;
  return (dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : dataBR(dia)) + ' às ' + hora(iso);
}

/* ---------------- leitura ---------------- */
async function lerPublico() {
  const r = await fetch(URL_BANCO + '/rest/v1/painel_dados?select=id,atualizado_em,dados&id=in.(hq-pc,hq-servidor)', { headers: { apikey: CHAVE_PUBLICA, Authorization: 'Bearer ' + CHAVE_PUBLICA }, cache: 'no-store' });
  if (!r.ok) throw new Error('o banco respondeu ' + r.status);
  const por = {}; for (const x of await r.json()) por[x.id] = x;
  return { ok: true, erro: '', pc: por['hq-pc'] || null, srv: por['hq-servidor'] || null, em: Date.now(), primeira: false };
}
function temSessaoGuardada() { try { return !!localStorage.getItem('sb-' + new URL(URL_BANCO).hostname.split('.')[0] + '-auth-token'); } catch (e) { return false; } }
function carregaBiblioteca() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((ok, falha) => { const s = document.createElement('script'); s.src = BIBLIOTECA_LOGIN; s.onload = () => ok(); s.onerror = () => falha(new Error('não consegui carregar o login (sem internet?)')); document.head.appendChild(s); });
}
async function cliente() { if (!E.g.sb) { await carregaBiblioteca(); E.g.sb = window.supabase.createClient(URL_BANCO, CHAVE_PUBLICA); } return E.g.sb; }
async function confereGestor({ sairSeNaoFor = false } = {}) {   // só é Gestor quem tem sessão E papel admin no banco
  const sb = await cliente(), { data } = await sb.auth.getSession();
  if (!data || !data.session) { E.g.admin = false; E.g.email = ''; return false; }
  const r = await sb.from('al_papeis').select('papel').limit(1);
  E.g.admin = !r.error && !!r.data && !!r.data[0] && r.data[0].papel === 'admin';
  E.g.email = E.g.admin ? (data.session.user.email || '') : '';
  if (!E.g.admin && sairSeNaoFor) await sb.auth.signOut();   // só desfaz um login feito aqui; sessão de outra tela do Painel não é derrubada
  return E.g.admin;
}
async function lerPrivado() {
  const sb = E.g.sb;
  const [f, o] = await Promise.all([
    sb.from('painel_dados').select('dados,atualizado_em').eq('id', 'hq-financeiro').maybeSingle(),
    sb.from('painel_dados').select('id,dados,atualizado_em').like('id', 'hq-cmd-%').order('atualizado_em', { ascending: false }).limit(8)]);
  if (f.error) throw new Error(f.error.message);
  E.fin = (f.data && f.data.dados) || null; E.finEm = (f.data && f.data.atualizado_em) || null; E.ordens = (o && o.data) || [];
}
async function ciclo() {
  if (E.lendo) { E.denovo = true; return; }   // já tem uma leitura em andamento: repete logo depois dela (ex.: o Gestor acabou de entrar)
  E.lendo = true;
  try {
    try { E.pub = await lerPublico(); } catch (e) { E.pub = { ...E.pub, ok: false, erro: (e && e.message) || 'falhou', primeira: false }; }
    if (E.g.admin) { try { await lerPrivado(); E.finErro = ''; } catch (e) { E.finErro = (e && e.message) || 'falhou'; } }
  } finally { E.lendo = false; }
  pinta();
  if (E.denovo) { E.denovo = false; await ciclo(); }
}
let relogio = null;
function agenda() { clearTimeout(relogio); relogio = setTimeout(roda, Date.now() < E.rapidoAte ? CICLO_RAPIDO_MS : CICLO_MS); }
async function roda() { if (!document.hidden) await ciclo(); agenda(); }

/* ---------------- modelo: junta PC e servidor ---------------- */
function robosJuntos() {   // robô por robô vale a origem que o tem vivo e com dado fresco
  const mapa = new Map();
  for (const [onde, linha] of [['PC', E.pub.pc], ['Servidor', E.pub.srv]]) {
    const lista = pega(linha, 'dados.robos.lista', []); if (!lista.length) continue;
    const velha = minDesde(linha.atualizado_em) > VELHO_MIN;
    for (const r of lista) {
      const batida = r.ultimaBatida ? minDesde(r.ultimaBatida) : null, vivo = !velha && !!r.vivo && batida != null && batida < 6;
      const nivel = vivo ? 3 : (!velha && r.ligado) ? 2 : (velha && r.ligado) ? 1 : 0;   // 3 conectado · 2 ligado sem sinal · 1 origem parou de atualizar · 0 desligado
      const atual = mapa.get(r.nome);
      if (!atual || nivel > atual.nivel) mapa.set(r.nome, { nome: r.nome, id: r.id || '', nivel, onde, motivo: r.motivo || r.estado || '', atendidos: num(r.atendidosHoje), naoLidas: num(r.naoLidas) });
    }
  }
  return [...mapa.values()];
}
function chavesJuntas() {   // a chave conta como ligada se estiver ligada no PC ou no servidor; nos dois ao mesmo tempo é risco de mensagem repetida
  const mapa = new Map(), duplas = [];
  for (const [onde, linha] of [['PC', E.pub.pc], ['servidor', E.pub.srv]]) for (const c of pega(linha, 'dados.chaves.lista', [])) {
    const x = mapa.get(c.nome) || { nome: c.nome, titulo: c.titulo || humano(c.nome), ligada: false, onde: '' };
    if (c.ligada) { if (x.ligada) duplas.push(x.titulo); x.ligada = true; x.onde = onde; }
    mapa.set(c.nome, x);
  }
  return { mapa, duplas };
}
function contexto() {
  const pub = E.pub, srvMin = pub.srv ? minDesde(pub.srv.atualizado_em) : null, srvFresco = srvMin != null && srvMin <= VELHO_MIN;
  const robos = pub.ok ? robosJuntos() : [], ch = pub.ok ? chavesJuntas() : { mapa: new Map(), duplas: [] };
  const srvD = pega(pub.srv, 'dados', null), pcD = pega(pub.pc, 'dados', null), fonte = (srvFresco && srvD) || pcD || srvD || {};   // o servidor é o motor; cai para o PC se ele não trouxer
  const central = robos.find(r => /^central$/i.test(r.nome)), cr0 = pega(E.fin, 'credito', null);
  return { conectado: pub.ok, carregando: pub.primeira, erro: pub.erro, srvMin, srvFresco, temSrv: !!pub.srv, robos, central: !!central && central.nivel === 3, chaves: ch.mapa, duplas: ch.duplas,
    ind: fonte.indicadores || null, triagem: fonte.triagem && !fonte.triagem.erro ? fonte.triagem : null, motor: fonte.motor || null,
    admin: E.g.admin, fin: E.g.admin ? E.fin : null, cr: E.g.admin ? (Array.isArray(cr0) ? { recentes: cr0 } : (cr0 || {})) : {}, agora: noFuso() };
}
function erroCiclo(f, c) { const u = pega(c.fin, CICLO_DE[f.id] || '?', null); return !u ? '' : u.erro ? String(u.erro) : u.ok === false ? 'o ciclo falhou' : ''; }
function situacao(f, c) {
  if (!c.conectado) return { cod: 'semdado', txt: c.carregando ? 'Lendo' : 'Sem sinal' };
  if (!c.srvFresco) return { cod: 'falha', txt: 'Sem sinal' };
  if (f.precisaCentral && !c.central) return { cod: 'falha', txt: 'Central fora' };
  if (erroCiclo(f, c)) return { cod: 'falha', txt: 'Erro no ciclo' };
  if (f.plantao) return { cod: 'trabalhando', txt: 'Trabalhando' };
  const ch = c.chaves.get(f.chave);
  if (!ch) return { cod: 'semdado', txt: 'Sem dado' };
  if (!ch.ligada) return { cod: 'pausa', txt: 'Em pausa' };
  return naJanela(f.janela, c.agora) ? { cod: 'trabalhando', txt: 'Trabalhando' } : { cod: 'janela', txt: 'Aguardando janela' };
}
function numeros(f, c) {   // volume e fila de cada um (só com login). total: o servidor publica o acumulado, não o número do dia
  const cr = c.cr, t = pega(cr, 'funil.total', {});
  switch (f.id) {
    case 'atendente': return c.ind ? { n: c.ind.atendidosHoje, un: 'atendimentos hoje', fila: c.ind.pendenciasAbertas } : null;
    case 'credito': return cr.funil ? { n: t.leads || 0, un: 'cadastros no total', total: true, fila: (cr.excecoes || []).length, alerta: (cr.excecoes || []).length > 0 } : null;
    case 'vip': return cr.indicacaoVip ? { n: pega(cr, 'indicacaoVip.convites.enviados', 0), un: 'convites no total', total: true, fila: pega(cr, 'indicacaoVip.convites.agendados', 0) } : null;
    case 'recuperador': return cr.recompra ? { n: pega(cr, 'recompra.hoje.enviados', 0), de: pega(cr, 'recompra.hoje.limite', null), un: 'reativações hoje', fila: pega(cr, 'recompra.hoje.programados', 0) } : null;
    case 'cobrador': return cr.regua ? { n: cr.regua.enviadosHoje || 0, de: cr.regua.limiteDiario, un: 'lembretes hoje', fila: pega(cr, 'regua.agendados.total', 0) } : null;
    case 'secretario': return pega(c.fin, 'boletim.hoje', null) ? { n: c.fin.boletim.hoje.boletins || 0, un: 'boletins hoje', fila: c.fin.boletim.aguardando || 0 } : null;
  }
  return null;
}
function caixaPix(c) {   // nunca mostra zero por engano: sem leitura do banco, o valor fica vazio e o motivo aparece
  const px = pega(c.cr, 'caixa.pixHoje', null); if (!px) return null;
  if (!px.leitura) return { estado: 'sem', motivo: px.motivo || 'Sem leitura do banco hoje.', px };
  const min = minDesde(px.leituraEm), atrasada = naJanela(EXPEDIENTE_BANCO, c.agora) && min != null && min > LEITURA_ATRASADA_MIN;
  return { estado: atrasada ? 'atrasada' : 'ok', total: px.total, n: px.n || 0, hora: hora(px.leituraEm), min, px };
}
function receita(c) {   // vendas do mês atribuídas ao que a equipe digital foi buscar: indicação, reativação e renovação
  const roi = pega(c.fin, 'roi', null); if (!roi || !roi.mes) return null;
  const por = {}; for (const o of roi.mes.porOrigem || []) por[o.id] = o;
  const v = id => pega(por[id], 'vendido', 0), n = id => pega(por[id], 'cestas', 0);
  const indicacao = v('indique'), reativacao = v('reativacao'), renovacao = v('vip') + v('pos-quitacao');
  return { total: indicacao + reativacao + renovacao, cestas: n('indique') + n('reativacao') + n('vip') + n('pos-quitacao'), indicacao, reativacao, renovacao,
    outras: v('receptivo') + v('cobranca'), roi, mes: MES[(+String(roi.hoje || '').slice(5, 7) || 1) - 1] };
}
function pendencias(c) {   // falhas (alguém precisa olhar), itens (resolvem com 1 toque do Gestor) e pontos de atenção
  const falhas = [], itens = [], atencoes = [];
  if (!c.conectado) return { falhas, itens, atencoes };
  if (!c.temSrv) falhas.push({ txt: 'O servidor ainda não publicou o estado' });
  else if (!c.srvFresco) falhas.push({ txt: 'Servidor sem sinal ' + haQuanto(c.srvMin) });
  for (const r of c.robos) if (r.nivel === 1 || r.nivel === 2) falhas.push({ txt: 'WhatsApp ' + r.nome + ' sem conexão', det: r.nivel === 2 ? 'Ligado, sem sinal recente' : 'Origem (' + r.onde + ') parou de atualizar', abre: 'atendente' });
  if (c.duplas.length) falhas.push({ txt: 'Chave ligada no PC e no servidor', det: c.duplas.join(', ') });
  if (!c.admin) return { falhas, itens, atencoes };   // linha pública: nenhum detalhe além de haver ou não instabilidade

  if (E.finErro || !c.fin) falhas.push({ txt: 'Números privados não lidos', det: E.finErro || 'O servidor ainda não publicou a linha privada' });
  else {
    const finMin = minDesde(E.finEm);
    if (finMin != null && finMin > VELHO_MIN) atencoes.push({ txt: 'Números desatualizados', det: 'Última publicação ' + quando(E.finEm) });
    for (const f of EQUIPE) { const e = erroCiclo(f, c); if (e) falhas.push({ txt: f.cargo + ': erro no último ciclo', det: e, abre: f.id }); }
    const bx = c.cr.baixaPix, cx = c.cr.caixa;
    if (pega(bx, 'ultimoCiclo.erro', '')) falhas.push({ txt: 'Baixa por Pix: erro no último ciclo', det: String(bx.ultimoCiclo.erro), abre: 'quitacao' });
    if (pega(bx, 'ultimoCiclo.fonte', '') === 'sem_arquivo_de_excecoes') falhas.push({ txt: 'Baixa por Pix sem a lista do conciliador', abre: 'quitacao' });
    if (cx && pega(cx, 'inadimplencia.baseLida', true) === false) falhas.push({ txt: 'A base não foi lida', det: 'Previsão e atraso incompletos', abre: 'atraso' });
    const px = caixaPix(c);
    if (px && px.estado === 'atrasada') atencoes.push({ txt: 'Leitura do banco atrasada', det: 'Última às ' + px.hora, abre: 'caixa' });
    for (const x of c.cr.excecoes || []) itens.push({ tipo: 'credito', k: 'credito:' + x.leadId, lead: x.leadId, txt: x.nome, det: [x.cidade, (x.motivos || [])[0]].filter(Boolean).join(', '), abre: 'credito' });
    for (const x of pega(bx, 'revisao', [])) itens.push({ tipo: 'pix', txt: (x.pagador || 'Pix') + ', ' + reais(x.valor), det: frase(humano(x.motivo)), abre: 'quitacao' });
    for (const g of Array.isArray(c.cr.pedidos) ? c.cr.pedidos : []) for (const p of g.pedidos || []) itens.push({ tipo: 'entrega', k: 'entrega:' + p.pedidoId, pedido: p.pedidoId, txt: p.nome, det: 'Rota ' + (g.rota || 'sem rota') + (p.bairro ? ', ' + p.bairro : ''), abre: 'entrega' });
  }
  const dp = pega(c.ind, 'donoPedido', null);
  if (dp && dp.semAtender3h > 0 && dp.maisAntigoNovoH >= PEDIDO_SEM_DONO_H) atencoes.push({ txt: conta(dp.semAtender3h, 'pedido de compra', 'pedidos de compra') + ' sem atendimento', det: 'O mais antigo espera há ' + dp.maisAntigoNovoH + ' h', abre: 'atendente' });
  return { falhas, itens, atencoes };
}

/* ---------------- peças de marcação (classes do Tabler) ---------------- */
const SELO = { trabalhando: 'bg-green-lt', janela: 'bg-azure-lt', pausa: 'bg-secondary-lt', falha: 'bg-red-lt', semdado: 'bg-secondary-lt' };
const selo = (cod, txt) => `<span class="badge ${SELO[cod] || SELO.semdado}">${esc(txt)}</span>`;
const TIPO = { falha: ['bg-red-lt', 'Falha'], credito: ['bg-yellow-lt', 'Crédito'], pix: ['bg-purple-lt', 'Pix'], entrega: ['bg-azure-lt', 'Entrega'], atencao: ['bg-orange-lt', 'Atenção'] };
const sec = (titulo, corpo, lado = '') => (corpo ? `<div class="secao"><div class="subheader"><span>${esc(titulo)}</span>${lado ? `<span class="badge bg-secondary-lt">${esc(lado)}</span>` : ''}</div>${corpo}</div>` : '');
const lin = (rot, val, obs = '') => `<div class="lin"><span>${esc(rot)}${obs ? `<small class="d-block">${esc(obs)}</small>` : ''}</span><span>${val}</span></div>`;   // val já chega pronto de quem chama
const vazio = t => `<div class="text-secondary py-2">${esc(t)}</div>`;
const erroHtml = t => `<div class="alert alert-danger py-2" role="alert">${esc(t)}</div>`;

function acoesHtml(i) {   // os botões de 1 toque de uma pendência: depois do toque, 5 segundos para desfazer
  if (!i.k) return i.abre ? `<button type="button" class="btn btn-sm" data-abre="${esc(i.abre)}">Ver</button>` : '';
  const ag = E.agendadas[i.k], ja = E.enviadas[i.k];
  if (ag) return `<span class="desfaz"><span class="text-secondary">${esc(ag.fazendo)}</span><button type="button" class="btn btn-sm" data-desfaz="${esc(i.k)}">Desfazer</button><i class="desfaz-barra" aria-hidden="true"></i></span>`;
  if (ja) return `<span class="text-green">${esc(ja.txt)}</span>`;
  return i.tipo === 'credito'
    ? `<button type="button" class="btn btn-sm btn-success" data-credito="aprovar" data-lead="${esc(i.lead)}">Aprovar</button><button type="button" class="btn btn-sm btn-outline-danger" data-credito="recusar" data-lead="${esc(i.lead)}">Recusar</button>`
    : `<button type="button" class="btn btn-sm btn-primary" data-entrega="${esc(i.pedido)}">Confirmar entrega</button>`;
}
function linhaPend(i) {
  const t = TIPO[i.tipo];
  return `<div class="list-group-item"><div class="row align-items-center g-2"><div class="col-auto"><span class="badge ${t[0]}">${t[1]}</span></div>` +
    `<div class="col" style="min-width:0"${i.abre ? ` data-abre="${esc(i.abre)}" role="button"` : ''}><div class="text-truncate fw-medium">${esc(i.txt)}</div>${i.det ? `<div class="text-secondary text-truncate small">${esc(i.det)}</div>` : ''}</div>` +
    `<div class="${i.tipo === 'credito' ? 'col-12 col-sm-auto' : 'col-auto'}"><div class="btn-list justify-content-end flex-nowrap">${acoesHtml(i)}</div></div></div></div>`;
}
function chaveHtml(nome, c) {
  const ch = c.chaves.get(nome), info = CHAVES[nome] || {}, esp = E.espera[nome];
  if (!ch) return '<span class="text-secondary">sem dado</span>';
  if (info.travada) return `<span class="text-secondary" title="Só pelo terminal">${ch.ligada ? 'ligada' : 'desligada'}</span>`;
  const mostra = esp ? esp.valor : ch.ligada;
  return `<span class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" aria-label="${esc(ch.titulo)}" data-chave="${esc(nome)}" data-ligar="${ch.ligada ? 0 : 1}"${mostra ? ' checked' : ''}${esp ? ' disabled title="Aguardando o servidor"' : ''}></span>`;
}
function linhaChave(nome, c) {
  const ch = c.chaves.get(nome);
  return `<div class="lin ctl"><span>${esc(pega(ch, 'titulo', humano(nome)))}${ch && ch.ligada && ch.onde === 'PC' ? '<small class="d-block text-secondary">ligada no PC</small>' : ''}</span><span>${chaveHtml(nome, c)}</span></div>`;
}

/* ---------------- pintura ---------------- */
function pinta() {
  const c = contexto(), p = pendencias(c);
  resolveEsperas(c);
  const b = $('botao-entrar'); b.textContent = E.g.admin ? 'Sair' : E.g.conferindo ? 'Conferindo' : 'Entrar'; b.disabled = E.g.conferindo; b.className = E.g.admin ? 'btn' : 'btn btn-primary';
  pintaSinal(c, p); pintaPendencias(c, p); pintaIndicadores(c); pintaEquipe(c); pintaEsteira(c); pintaControles(c); pintaRodape(c);
  if (E.gaveta && $('gaveta').open) pintaGaveta(c);
}
function pintaSinal(c, p) {
  let cor = 'green', txt = 'Online', pisca = true;
  if (!c.conectado) { cor = c.carregando ? 'secondary' : 'red'; txt = c.carregando ? 'Lendo' : 'Sem conexão'; pisca = false; }
  else if (p.falhas.length) { cor = c.admin ? 'red' : 'yellow'; txt = c.admin ? conta(p.falhas.length, 'falha', 'falhas') : 'Instável'; pisca = false; }
  else if (p.itens.length) { cor = 'yellow'; txt = conta(p.itens.length, 'pendência', 'pendências'); pisca = false; }
  poe($('sinal'), `<span class="status status-${cor}"${c.srvMin != null ? ` title="Atualizado ${esc(haQuanto(c.srvMin))}"` : ''}><span class="status-dot${pisca ? ' status-dot-animated' : ''}"></span>${esc(txt)}</span>`);
}
function pintaPendencias(c, p) {
  const el = $('radar'); el.hidden = !c.admin; if (!c.admin) { poe(el, ''); return; }
  const linhas = p.falhas.map(f => linhaPend({ tipo: 'falha', ...f })), destino = { credito: 'credito', pix: 'quitacao', entrega: 'entrega' };
  for (const tipo of ['credito', 'pix', 'entrega']) {
    const l = p.itens.filter(i => i.tipo === tipo), lim = LIMITE_PENDENCIAS[tipo];
    linhas.push(...l.slice(0, lim).map(linhaPend));
    if (l.length > lim) linhas.push(`<button type="button" class="list-group-item list-group-item-action text-secondary" data-abre="${destino[tipo]}">Mais ${l.length - lim} de ${TIPO[tipo][1].toLowerCase()}</button>`);
  }
  linhas.push(...p.atencoes.map(a => linhaPend({ tipo: 'atencao', ...a })));
  const total = p.falhas.length + p.itens.length, hoje = pega(c.fin, 'gestor.hoje', null), avisos = hoje ? (hoje.silenciosos || 0) + (hoje.whatsapp || 0) : 0;
  poe(el, `<div class="card"><div class="card-header"><h3 class="card-title">Pendências</h3><div class="card-actions">${total ? `<span class="badge bg-red-lt">${total}</span>` : ''}</div></div>` +
    `<div class="list-group list-group-flush">${linhas.join('') || '<div class="list-group-item"><span class="status status-green"><span class="status-dot"></span>Nenhuma pendência</span></div>'}</div>` +
    (avisos ? `<div class="card-footer py-2"><button type="button" class="btn btn-link p-0" data-abre="avisos">${conta(avisos, 'aviso', 'avisos')} hoje</button></div>` : '') + '</div>');
}
function kpi(rotulo, valor, sub, abre, cor = '') {
  return `<div class="col-6 col-md-4 col-xl-2"><button type="button" class="card card-sm card-link kpi" data-abre="${abre}"><span class="card-body"><span class="subheader">${esc(rotulo)}</span><span class="kpi-valor">${valor}</span><span class="kpi-sub ${cor ? 'text-' + cor : 'text-secondary'}">${sub ? esc(sub) : '&nbsp;'}</span></span></button></div>`;
}
function pintaIndicadores(c) {   // o dia (Pix, vendido, recebido) e a semana (a receber, atraso), mais o mês da equipe digital
  const el = $('pulso'); el.hidden = !c.admin; if (!c.admin) { poe(el, ''); return; }
  if (!c.fin) { poe(el, `<div class="alert alert-warning mb-0" role="alert">${esc(E.finErro ? 'Números não lidos: ' + E.finErro : 'O servidor ainda não publicou os números de hoje.')}</div>`); return; }
  const cx = c.cr.caixa, px = caixaPix(c), rc = receita(c), roi = pega(c.fin, 'roi', {}), d = pega(roi, 'dia.empresa', null);
  const io = pega(cx, 'inadimplencia.operacional', null), ih = pega(cx, 'inadimplencia.historico', null), baseLida = pega(cx, 'inadimplencia.baseLida', true) !== false;
  const vendasAtras = roi.dadosVendasAte && roi.hoje && roi.dadosVendasAte < roi.hoje, recebAtras = roi.dadosRecebAte && roi.hoje && roi.dadosRecebAte < roi.hoje;
  poe(el, '<div class="row row-cards">' +
    (!px ? kpi('Pix hoje', '–', 'sem dado', 'caixa') : px.estado === 'sem' ? kpi('Pix hoje', '–', 'sem leitura do banco', 'caixa', 'yellow')
      : kpi('Pix hoje', reais(px.total), px.estado === 'atrasada' ? 'leitura atrasada, ' + px.hora : 'lido às ' + px.hora + ', ' + px.n + ' Pix', 'caixa', px.estado === 'atrasada' ? 'yellow' : '')) +
    kpi('Vendido hoje', d ? reais(d.vendido) : '–', !d ? 'sem dado' : vendasAtras ? 'lançado até ' + dataBR(roi.dadosVendasAte) : conta(d.cestas || 0, 'cesta', 'cestas'), 'receita', d && vendasAtras ? 'yellow' : '') +
    kpi('Recebido hoje', d ? reais(d.recebido) : '–', !d ? 'sem dado' : recebAtras ? 'lançado até ' + dataBR(roi.dadosRecebAte) : '', 'caixa', d && recebAtras ? 'yellow' : '') +
    kpi('A receber em 7 dias', cx && cx.previsao7d ? reais(cx.previsao7d.total) : '–', !cx || !cx.previsao7d ? 'sem dado' : baseLida ? 'parcelas a vencer' : 'base não lida', 'previsao', baseLida ? '' : 'red') +
    kpi('Atraso até 90 dias', io ? reais(io.total) : '–', ih ? 'mais de 90 dias: ' + reais(ih.total) : 'sem dado', 'atraso', baseLida ? '' : 'red') +
    kpi('Equipe digital no mês', rc ? reais(rc.total) : '–', rc ? conta(rc.cestas, 'cesta', 'cestas') + ' em ' + rc.mes : 'sem dado', 'receita') + '</div>');
}
function pintaEquipe(c) {
  const sits = EQUIPE.map(f => situacao(f, c)), n = cod => sits.filter(s => s.cod === cod).length;
  const resumo = !c.conectado ? '' : [n('trabalhando') && n('trabalhando') + ' trabalhando', n('janela') && n('janela') + ' aguardando', n('pausa') && n('pausa') + ' em pausa', n('falha') && n('falha') + ' com falha'].filter(Boolean).join(', ');
  const linhas = EQUIPE.map((f, i) => {
    const s = sits[i], nome = `<td><div class="fw-medium">${esc(f.cargo)}</div><div class="d-md-none mt-1">${selo(s.cod, s.txt)}</div></td><td class="d-none d-md-table-cell">${selo(s.cod, s.txt)}</td>`;
    if (!c.admin) return `<tr>${nome}</tr>`;   // sem login a linha não abre nada: só mostra o estado
    const ns = numeros(f, c), ligadas = f.outras.filter(k => pega(c.chaves.get(k), 'ligada', false)).length;
    const hoje = !ns || num(ns.n) == null ? '–' : inteiro(ns.n) + (ns.de ? `<span class="text-secondary">/${inteiro(ns.de)}</span>` : '') + (ns.total ? ' <span class="text-secondary small">total</span>' : '');
    const fila = !ns || num(ns.fila) == null ? '–' : inteiro(ns.fila);
    const ctl = f.chave ? chaveHtml(f.chave, c) : f.outras.length ? `<span class="text-secondary" title="funções ligadas">${ligadas}/${f.outras.length}</span>` : '<span class="text-secondary">fixo</span>';
    return `<tr class="linha-abre" data-abre="${f.id}" tabindex="0" aria-haspopup="dialog">${nome}<td class="text-end" title="${esc(ns ? ns.un : '')}">${hoje}</td><td class="text-end d-none d-sm-table-cell${ns && ns.alerta ? ' text-red fw-medium' : ''}">${fila}</td><td class="text-end" data-nao-abre>${ctl}</td></tr>`;
  }).join('');
  poe($('equipe'), `<div class="card"><div class="card-header"><h3 class="card-title">Funcionários digitais</h3><div class="card-actions text-secondary small">${esc(resumo)}</div></div>` +
    `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Funcionário</th><th class="d-none d-md-table-cell">Estado</th>` +
    (c.admin ? '<th class="text-end">Hoje</th><th class="text-end d-none d-sm-table-cell">Fila</th><th class="text-end w-1">Chave</th>' : '') + `</tr></thead><tbody>${linhas}</tbody></table></div></div>`);
}
function etapas(c) {
  const cr = c.cr, t = pega(cr, 'funil.total', null), cart = pega(cr, 'regua.carteira', null), ex = (cr.excecoes || []).length;
  const aEntregar = Array.isArray(cr.pedidos) ? cr.pedidos.reduce((s, g) => s + (g.pedidos || []).length, 0) : null;
  return [
    { id: 'captacao', nome: 'Captação', n: t ? t.leads || 0 : null, un: ['cadastro', 'cadastros'] },
    { id: 'credito', nome: 'Análise', n: t ? t.aprovados || 0 : null, un: ['aprovado', 'aprovados'], alerta: ex > 0 },
    { id: 'entrega', nome: 'Entrega na rota', n: aEntregar, un: ['para entregar', 'para entregar'] },
    { id: 'quitacao', nome: 'Quitação', n: cart ? cart.pedidosAtivos || 0 : null, un: ['pagando', 'pagando'] },
    { id: 'recuperador', nome: 'Recompra', n: pega(cr, 'recompra.reconvertidos.total', null), un: ['recompra', 'recompras'] },
  ];
}
function pintaEsteira(c) {
  const el = $('esteira'); el.hidden = !c.admin || !c.fin; if (el.hidden) { poe(el, ''); return; }
  poe(el, '<div class="card"><div class="card-header"><h3 class="card-title">Esteira do site</h3></div><div class="table-responsive"><table class="table table-vcenter card-table"><tbody>' +
    etapas(c).map(e => `<tr class="linha-abre" data-abre="${e.id}" tabindex="0" aria-haspopup="dialog"><td>${esc(e.nome)}${e.alerta ? ' <span class="badge bg-yellow-lt">decidir</span>' : ''}</td><td class="text-end">${e.n == null ? '–' : `<span class="fw-medium">${inteiro(e.n)}</span> <span class="text-secondary">${esc(plural(e.n, e.un[0], e.un[1]))}</span>`}</td><td class="w-1 seta" aria-hidden="true">›</td></tr>`).join('') +
    '</tbody></table></div></div>');
}
function ordemHtml(o) {
  const d = o.dados || {}, x = d.dados || {}, st = d.status || 'pendente', cor = st === 'feito' ? 'bg-green-lt' : st === 'pendente' ? 'bg-azure-lt' : 'bg-red-lt';
  const alvo = d.tipo === 'chave' ? (x.valor ? 'ligar ' : 'pausar ') + pega(contexto().chaves.get(x.nome), 'titulo', humano(x.nome)) : d.tipo === 'credito_decidir' ? x.decisao || '' : d.tipo === 'entrega_confirmar' ? 'pedido ' + (x.pedidoId || '') : d.tipo === 'diretriz' ? String(x.texto || '').slice(0, 80) : '';
  return `<tr><td class="text-secondary">${esc(hora(d.criadoEm || o.atualizado_em))}</td><td>${esc(ORDEM_TIPO[d.tipo] || humano(d.tipo))}${alvo ? ': ' + esc(alvo) : ''}${d.resultado ? `<div class="text-secondary small">${esc(d.resultado)}</div>` : ''}</td><td class="text-end"><span class="badge ${cor}">${esc(st)}</span></td></tr>`;
}
function pintaControles(c) {
  const el = $('controles'); el.hidden = !c.admin; if (!c.admin) { poe(el, ''); return; }
  if (document.activeElement && document.activeElement.id === 'diretriz') return;   // não apaga o que o Gestor está digitando
  const donas = new Set(EQUIPE.flatMap(f => [f.chave, ...f.outras]).filter(Boolean)), soltas = [...c.chaves.values()].filter(k => !donas.has(k.nome));
  const aberto = !!(el.querySelector('details') || {}).open;   // não fecha o bloco na cara do Gestor a cada leitura
  poe(el, `<details class="card"${aberto ? ' open' : ''}><summary class="card-header"><h3 class="card-title">Ordens e controles</h3><div class="card-actions seta" aria-hidden="true">›</div></summary>` +
    (E.ordens.length ? `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>Hora</th><th>Ordem</th><th class="text-end">Estado</th></tr></thead><tbody>${E.ordens.map(ordemHtml).join('')}</tbody></table></div>` : '<div class="card-body text-secondary">Nenhuma ordem ainda.</div>') +
    (soltas.length ? `<div class="card-body"><div class="subheader mb-1">Outras chaves</div>${soltas.map(k => linhaChave(k.nome, c)).join('')}</div>` : '') +
    '<div class="card-body"><label class="form-label" for="diretriz">Diretriz para a equipe</label><textarea class="form-control" id="diretriz" rows="2" maxlength="500"></textarea><button type="button" class="btn mt-2" data-diretriz>Registrar</button></div></details>');
}
function pintaRodape(c) {
  const m = c.motor, dados = c.admin && m && m.dadosEm ? 'dados até ' + dataBR(m.dadosEm) : '';
  poe($('rodape'), '<div class="row text-center align-items-center flex-row-reverse"><div class="col-lg-auto ms-lg-auto">' +
    (c.admin ? '<ul class="list-inline list-inline-dots mb-0"><li class="list-inline-item"><a class="link-secondary" href="../">Resultados</a></li><li class="list-inline-item"><a class="link-secondary" href="../cobranca/">Cobrança diária</a></li><li class="list-inline-item"><a class="link-secondary" href="../central/">Central</a></li></ul>' : '') +
    `</div><div class="col-12 col-lg-auto mt-3 mt-lg-0 text-secondary">${esc(c.admin ? [E.g.email, dados].filter(Boolean).join(', ') : 'Visão pública: só o estado da equipe.')}</div></div>`);
}

/* ---------------- gaveta (detalhe de um funcionário, de um indicador ou de uma etapa) ---------------- */
function cicloHtml(u) {
  if (!u) return '';
  const erro = u.erro || (u.ok === false ? 'o ciclo falhou' : '');
  return erro ? erroHtml('Erro no último ciclo (' + quando(u.em) + '): ' + erro) : `<div class="text-secondary small mb-3">Último ciclo ${esc(quando(u.em))}${u.motivo ? ', ' + esc(MOTIVO_CICLO[u.motivo] || humano(u.motivo)) : ''}</div>`;
}
function esperaHtml(e) { const l = Object.entries(e || {}); return l.length ? sec('Segurando o envio', l.map(([k, v]) => lin(frase(humano(k)), inteiro(v))).join('')) : ''; }
function filaHtml(itens, quandoDe, linhaDe) {   // separa o que está programado para o próximo dia útil do resto
  const alvo = proximoDiaUtil(), nome = alvo.hoje ? 'hoje' : DIA_SEMANA[alvo.sem], doDia = [], outros = [];
  for (const x of itens || []) (noFuso(new Date(quandoDe(x))).dia === alvo.dia ? doDia : outros).push(x);
  const li = comDia => x => `<li><time>${esc((comDia ? dataBR(noFuso(new Date(quandoDe(x))).dia) + ' ' : '') + hora(quandoDe(x)))}</time><span>${linhaDe(x)}</span></li>`;
  return sec('Fila para ' + nome, doDia.length ? '<ul class="lista">' + doDia.map(li(false)).join('') + '</ul>' : vazio('Nada programado.'), dataBR(alvo.dia)) +
    (outros.length ? sec('Outros dias', '<ul class="lista">' + outros.map(li(true)).join('') + '</ul>') : '');
}
function chavesDe(f, c) { const l = [f.chave, ...f.outras].filter(Boolean); return l.length ? sec('Chaves', l.map(k => linhaChave(k, c)).join('')) : ''; }
const cartao = (titulo, sub, corpo, acoes) => `<div class="card card-sm mb-2"><div class="card-body"><div class="fw-medium">${esc(titulo)}${sub ? ` <span class="text-secondary fw-normal">${esc(sub)}</span>` : ''}</div>${corpo}<div class="btn-list mt-2">${acoes}</div></div></div>`;

const GAVETAS = {
  atendente(c) {
    const ind = c.ind || {}, dp = ind.donoPedido, tr = c.triagem, tipos = Object.entries(ind.pendenciasPorTipo || {}).sort((a, b) => b[1] - a[1]);
    const robos = c.robos.length ? '<table class="table table-sm table-vcenter mb-0"><tbody>' + c.robos.map(r => `<tr><td>${esc(r.nome)}<div class="text-secondary small">${esc([r.nivel ? 'no ' + r.onde.toLowerCase() : '', r.nivel === 3 ? r.motivo : '', r.atendidos != null && r.nivel === 3 ? conta(r.atendidos, 'atendimento hoje', 'atendimentos hoje') : '', r.naoLidas ? conta(r.naoLidas, 'não lida', 'não lidas') : ''].filter(Boolean).join(', '))}</div></td><td class="text-end">${selo(r.nivel === 3 ? 'trabalhando' : r.nivel === 0 ? 'pausa' : 'falha', r.nivel === 3 ? 'conectado' : r.nivel === 0 ? 'desligado' : 'sem sinal')}</td><td class="text-end w-1">${r.nivel >= 2 && r.onde === 'Servidor' && r.id ? `<button type="button" class="btn btn-sm" data-reinicia="${esc(r.id)}" data-nome="${esc(r.nome)}">Reiniciar</button>` : ''}</td></tr>`).join('') + '</tbody></table>' : vazio('Sem dado dos números.');
    return sec('Fila de atendimento (7 dias)', ind.pendenciasAbertas != null ? lin('Pendências para uma pessoa', inteiro(ind.pendenciasAbertas)) + tipos.slice(0, 7).map(([k, v]) => lin(PENDENCIA[k] || humano(k), inteiro(v))).join('') : vazio('Sem dado da fila.')) +
      sec('Fila dos robôs', ind.filas ? lin('Ofertas de pós-quitação', inteiro(ind.filas.posQuitacao || 0)) + lin('Perguntas de nova data', inteiro(ind.filas.perguntaData || 0)) : '') +
      sec('Pedidos de compra sem atendimento', dp ? lin('Há mais de 3 h', inteiro(dp.semAtender3h || 0), dp.semAtender3h ? 'O mais antigo espera há ' + dp.maisAntigoNovoH + ' h' : '') + lin('Há mais de 36 h', inteiro(dp.antigos || 0)) : '') +
      sec('Triagem do financeiro', tr ? lin('Casos abertos', inteiro(tr.abertos || 0)) + Object.entries(tr.porCategoria || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => lin(frase(humano(k)), inteiro(v))).join('') : '') +
      sec('Números de WhatsApp', robos) + chavesDe(this.f, c);
  },
  credito(c) {
    const cr = c.cr, t = pega(cr, 'funil.total', {}), ex = cr.excecoes || [], rec = cr.recentes || [];
    const cartoes = ex.map(x => cartao(x.nome, [x.cidade, x.origem && origem(x.origem)].filter(Boolean).join(', '),
      (x.linhas || []).map(l => `<div class="text-secondary">${esc(l)}</div>`).join('') + `<div class="mt-1">${esc((x.motivos || []).join('; ') || 'sem motivo registrado')}</div>`,
      acoesHtml({ tipo: 'credito', k: 'credito:' + x.leadId, lead: x.leadId }))).join('');
    return sec('Esperando decisão', ex.length ? cartoes : vazio('Nenhum cadastro esperando.'), ex.length ? String(ex.length) : '') +
      sec('Fila do analista', cr.funil ? lin('Aguardando dados ou comprovante', inteiro(t.aguardando || 0)) + lin('Pararam no primeiro passo', inteiro(t.parciais || 0)) : '') +
      sec('Total até agora', cr.funil ? lin('Cadastros recebidos', inteiro(t.leads || 0)) + lin('Aprovados', inteiro(t.aprovados || 0)) + lin('Reprovados', inteiro(t.reprovados || 0)) + lin('Vieram para revisão', inteiro(t.excecoes || 0)) : vazio('Sem dado do funil.')) +
      sec('Últimas análises', rec.length ? '<ul class="lista">' + rec.map(x => `<li><span><b>${esc(x.nome)}</b> ${esc(x.cidade || '')}<small>${esc(x.desfecho || x.rotulo || x.status || '')}</small></span></li>`).join('') + '</ul>' : '');
  },
  vip(c) {
    const v = c.cr.indicacaoVip; if (!v) return vazio('O servidor ainda não publicou este estado.');
    const t = v.totais || {}, mot = Object.entries(v.motivosRecusa || {});
    return cicloHtml(v.ultimoCiclo) + filaHtml(pega(v, 'convites.proximos', []), x => x.agendadoEm, x => `${esc(x.nome)}<small>${esc(x.cidade || '')}</small>`) + esperaHtml(pega(v, 'convites.espera', null)) +
      sec('Total até agora', lin('Convites na fila', inteiro(pega(v, 'convites.agendados', 0))) + lin('Convites enviados', inteiro(pega(v, 'convites.enviados', 0))) + lin('Indicações recebidas', inteiro(t.recebidas || 0)) + lin('Aprovadas', inteiro(t.aprovadas || 0)) + lin('Recusadas', inteiro(t.recusadas || 0), mot.map(([k, n]) => humano(k) + ' (' + n + ')').join(', '))) +
      sec('Bônus', lin('Por amigo aprovado', reais(v.bonusPorIndicado)) + lin('Pendentes de entrega', reais(t.pendente)) + lin('Disponíveis', reais(t.disponivel)) + lin('Reservados', reais(t.reservado)) + lin('Já usados', reais(t.usado))) +
      sec('Quem mais indica', (v.ranking || []).length ? '<ul class="lista">' + v.ranking.slice(0, 8).map((p, i) => `<li><i>${i + 1}</i><span><b>${esc(p.nome)}</b><small>${conta(p.recebidas || 0, 'recebida', 'recebidas')}, ${conta(p.aprovadas || 0, 'aprovada', 'aprovadas')}, bônus ${reais(p.disponivel)}</small></span></li>`).join('') + '</ul>' : vazio('Ainda não há indicações.')) +
      chavesDe(this.f, c);
  },
  recuperador(c) {
    const r = c.cr.recompra; if (!r) return vazio('O servidor ainda não publicou este estado.');
    const el = r.elegiveis, ign = el ? Object.entries(el.ignorados || {}).sort((a, b) => b[1] - a[1]).slice(0, 6) : [], rec = r.reconvertidos || {};
    return cicloHtml(r.ultimoCiclo) + filaHtml([...pega(r, 'hoje.fila', []).filter(x => x.status === 'agendado'), ...pega(r, 'renovacoes.proximas', []).map(x => ({ ...x, renovacao: true }))], x => x.agendadoEm, x => `${esc(x.nome)}<small>${esc([x.cidade, x.rota && 'rota ' + x.rota, x.renovacao && 'renovação'].filter(Boolean).join(', '))}</small>`) +
      sec('Hoje', lin('Reativações enviadas', inteiro(pega(r, 'hoje.enviados', 0)) + ' de ' + inteiro(pega(r, 'hoje.limite', 0))) + lin('Reativações programadas', inteiro(pega(r, 'hoje.programados', 0))) + lin('Renovações agendadas', inteiro(pega(r, 'renovacoes.agendadas', 0))) + lin('Renovações enviadas', inteiro(pega(r, 'renovacoes.enviadas', 0)))) +
      sec('Total até agora', lin('Pedidos reconvertidos', inteiro(rec.total || 0)) + lin('Pela renovação rápida', inteiro((rec.pelaRenovacaoRapida || []).length)) + lin('Por resposta no WhatsApp', inteiro((rec.porRespostaNoWhatsApp || []).length))) +
      sec('Quem pode ser chamado', el ? lin('Bons pagadores elegíveis', inteiro(el.total) + ' de ' + inteiro(el.totalBase)) + ign.map(([k, n]) => lin('Fora: ' + humano(k), inteiro(n))).join('') : vazio('Ainda sem varredura da base.')) +
      chavesDe(this.f, c);
  },
  cobrador(c) {
    const g = c.cr.regua; if (!g) return vazio('O servidor ainda não publicou este estado.');
    const a = g.agendados || {}, sc = g.carteira || {};
    return cicloHtml(g.ultimoCiclo) + filaHtml(g.proximos || [], x => x.agendadoEm, x => `${esc(x.nome)}, ${reais(x.valor)}<small>${esc(humano(x.faixa).replace('d menos 3', '3 dias antes').replace('d mais 3', '3 dias depois').replace('d0', 'no dia'))}, vence em ${esc(dataBR(x.vencimento))}</small>`) + esperaHtml(g.espera) +
      sec('Lembretes', lin('3 dias antes', inteiro(a.d_menos_3 || 0)) + lin('No dia do vencimento', inteiro(a.d0 || 0)) + lin('3 dias depois', inteiro(a.d_mais_3 || 0)) + lin('Enviados hoje', inteiro(g.enviadosHoje || 0) + ' de ' + inteiro(g.limiteDiario || 0)) + lin('Enviados até agora', inteiro(g.enviados || 0))) +
      sec('Carteira do site', lin('Em aberto', reais(sc.abertoTotal)) + lin('A vencer em 7 dias', reais(sc.aVencer7d)) + lin('Vencido', reais(sc.vencido), (+sc.inadimplenciaPct || 0).toLocaleString('pt-BR') + '% do aberto, ' + conta(sc.inadimplentes || 0, 'pedido', 'pedidos')) + lin('Parcelas pagas em dia', inteiro(sc.pagasEmDia || 0)) + lin('Parcelas pagas com atraso', inteiro(sc.pagasComAtraso || 0))) +
      chavesDe(this.f, c) +
      sec('Cobrança da base', '<button type="button" class="btn" data-cobranca>Disparar a rodada de cobrança</button>');
  },
  secretario(c) {
    const b = pega(c.fin, 'boletim', null); if (!b) return vazio('O servidor ainda não publicou este estado.');
    const grupos = Object.entries(b.porGrupo || {}), hj = b.hoje || {}, prox = b.proximo;
    return cicloHtml(b.ultimoCiclo) +
      sec('Próximo boletim', (prox ? lin('Sai ' + (prox.dia === noFuso().dia ? 'hoje' : DIA_SEMANA[noFuso(new Date(prox.dia + 'T12:00:00-03:00')).sem]) + ' às ' + prox.hora, conta(b.aguardando || 0, 'recado', 'recados')) : '') + grupos.map(([g, n]) => lin(g, inteiro(n))).join('') || vazio('Nenhum recado esperando.'), prox ? dataBR(prox.dia) : '') +
      sec('Hoje', lin('Boletins montados', inteiro(hj.boletins || 0)) + lin('Recados agrupados', inteiro(hj.recados || 0)) + lin('Urgentes que saíram na hora', inteiro(hj.urgentes || 0))) +
      sec('Últimos boletins', (b.ultimos || []).length ? '<ul class="lista">' + b.ultimos.map(x => `<li><i>${esc(dataBR(x.dia))}</i><span>${esc(x.grupo || '')} ${esc(x.turno || '')}<small>${conta(x.n || 0, 'recado', 'recados')}, ${esc(humano(x.status))}</small></span></li>`).join('') + '</ul>' : vazio('Nenhum boletim ainda.')) +
      chavesDe(this.f, c);
  },
  caixa(c) {
    const cx = c.cr.caixa, px = caixaPix(c), bx = c.cr.baixaPix || {}, d = pega(c.fin, 'roi.dia.empresa', null); if (!cx) return vazio('Sem dado de caixa.');
    return sec('Pix de hoje', (px && px.estado !== 'sem' ? lin('Confirmado pelo banco', reais(px.total), conta(px.n, 'Pix', 'Pix') + ', leitura das ' + px.hora) : lin('Confirmado pelo banco', '–', pega(px, 'motivo', 'Sem leitura do banco hoje'))) +
        lin('Parcelas do site baixadas', reais(pega(cx, 'pixHoje.site', 0)), conta(pega(cx, 'pixHoje.baixasSite', 0), 'parcela', 'parcelas')) + lin('Baixas lançadas no sistema', reais(pega(cx, 'pixHoje.lancadoNoSistema.valor', 0)), conta(pega(cx, 'pixHoje.lancadoNoSistema.n', 0), 'baixa', 'baixas')) + lin('Baixa automática por Pix', reais(bx.valorBaixadoHoje), conta(bx.baixasHoje || 0, 'parcela', 'parcelas'))) +
      sec('Empresa hoje', d ? lin('Recebido', reais(d.recebido)) + lin('Vendido', reais(d.vendido), conta(d.cestas || 0, 'cesta', 'cestas')) : '') +
      sec('Bônus VIP na carteira', lin('Disponíveis', reais(cx.bonusDisponivel)) + lin('Pendentes de entrega', reais(cx.bonusPendente)));
  },
  previsao(c) {
    const p = pega(c.cr, 'caixa.previsao7d', null); if (!p) return vazio('Sem dado de previsão.');
    return sec('Parcelas a vencer em 7 dias', lin('Pedidos do site', reais(p.site)) + lin('Base de clientes', reais(p.base)) + lin('Total', reais(p.total)));
  },
  atraso(c) {
    const i = pega(c.cr, 'caixa.inadimplencia', null); if (!i) return vazio('Sem dado de atraso.');
    const o = i.operacional || {}, h = i.historico || {};
    return (i.baseLida === false ? erroHtml('A base não foi lida: números incompletos.') : '') +
      sec('De 1 a 90 dias', lin('Pedidos do site', reais(o.site)) + lin('Base de clientes', reais(o.base)) + lin('Total', reais(o.total))) +
      sec('Mais de 90 dias', lin('Pedidos do site', reais(h.site)) + lin('Base de clientes', reais(h.base)) + lin('Total', reais(h.total)));
  },
  receita(c) {
    const r = receita(c); if (!r) return vazio('Sem dado de vendas do mês.');
    const m = r.roi.mes, e = m.empresa || {}, s = m.sistema || {}, d = pega(r.roi, 'dia', {}), de = d.empresa || {}, ds = d.sistema || {};
    const tabela = (a, b) => `<table class="table table-sm table-vcenter mb-0"><thead><tr><th></th><th class="text-end">Empresa</th><th class="text-end">Equipe digital</th></tr></thead><tbody><tr><td>Cestas</td><td class="text-end">${inteiro(a.cestas)}</td><td class="text-end">${inteiro(b.cestas)}</td></tr><tr><td>Vendido</td><td class="text-end">${reais(a.vendido)}</td><td class="text-end">${reais(b.vendido)}</td></tr><tr><td>Recebido</td><td class="text-end">${reais(a.recebido)}</td><td class="text-end">${reais(b.recebido)}</td></tr></tbody></table>`;
    return sec('Trazido pela equipe digital em ' + r.mes, lin('Indicação VIP', reais(r.indicacao)) + lin('Reativação', reais(r.reativacao)) + lin('Renovação de quem quitou', reais(r.renovacao)) + lin('Total', reais(r.total), conta(r.cestas, 'cesta', 'cestas')) + lin('Depois de atendimento ou lembrete', reais(r.outras))) +
      sec('Hoje', tabela(de, ds)) + sec('Mês até hoje', tabela(e, s), r.roi.dadosVendasAte && r.roi.dadosVendasAte < r.roi.hoje ? 'vendas até ' + dataBR(r.roi.dadosVendasAte) : '');
  },
  captacao(c) {
    const f = c.cr.funil; if (!f) return vazio('Sem dado do funil.');
    const t = f.total || {};
    return sec('Cadastros por origem', (f.porOrigem || []).length ? `<table class="table table-sm table-vcenter mb-0"><thead><tr><th>Origem</th><th class="text-end">Cadastros</th><th class="text-end">Aprovados</th><th class="text-end">Reprovados</th></tr></thead><tbody>${f.porOrigem.map(o => `<tr><td>${esc(frase(origem(o.origem)))}</td><td class="text-end">${inteiro(o.leads)}</td><td class="text-end">${inteiro(o.aprovados)}</td><td class="text-end">${inteiro(o.reprovados)}</td></tr>`).join('')}</tbody></table>` : vazio('Nenhum cadastro ainda.')) +
      sec('Onde cada um parou', lin('Pararam no primeiro passo', inteiro(t.parciais || 0)) + lin('Aguardando dados ou comprovante', inteiro(t.aguardando || 0)) + lin('Vieram para revisão', inteiro(t.excecoes || 0)));
  },
  entrega(c) {
    const fila = c.cr.pedidos; if (!Array.isArray(fila)) return vazio('Sem dado da fila de rota.');
    if (!fila.length) return vazio('Nenhum pedido aguardando entrega.');
    return fila.map(g => sec('Rota ' + (g.rota || 'sem rota') + (g.cidade ? ', ' + g.cidade : ''), (g.pedidos || []).map(p => cartao(p.nome, (p.bairro || '') + (p.semCep ? ' (sem CEP)' : ''),
      `<div class="text-secondary">${esc(p.cesta || '')}. Parcelas: ${(p.parcelas || []).map(x => reais(x.valor) + ' em ' + esc(dataBR(x.vencimento))).join(' e ')}</div><div class="text-secondary">Pedido ${esc(p.pedidoId)}, código VIP ${esc(p.codigoVip || '–')}${p.selo ? ', ' + esc(p.selo) : ''}${p.origem ? ', ' + esc(p.origem) : ''}${p.avisoRota ? ', aviso à rota: ' + esc(humano(p.avisoRota)) : ''}</div>`,
      acoesHtml({ tipo: 'entrega', k: 'entrega:' + p.pedidoId, pedido: p.pedidoId }))).join(''), String((g.pedidos || []).length))).join('');
  },
  quitacao(c) {
    const sc = pega(c.cr, 'regua.carteira', null), bx = c.cr.baixaPix || {}, rev = bx.revisao || [], ult = bx.ultimas || [];
    return cicloHtml(bx.ultimoCiclo) +
      sec('Pix para revisão', rev.length ? '<ul class="lista">' + rev.map(x => `<li><span><b>${esc(x.pagador || '')}</b>, ${reais(x.valor)}<small>${esc(dataBR(x.data))}, ${esc(humano(x.motivo))}${x.pedidoId ? ', pedido ' + esc(x.pedidoId) : ''}</small></span></li>`).join('') + '</ul>' : vazio('Nenhum Pix esperando revisão.'), rev.length ? String(rev.length) : '') +
      sec('Carteira do site', sc ? lin('Pedidos pagando', inteiro(sc.pedidosAtivos || 0)) + lin('Já quitados', inteiro(sc.quitados || 0)) + lin('Aguardando entrega', inteiro(sc.aguardandoEntrega || 0)) + lin('Em aberto', reais(sc.abertoTotal)) + lin('Vencido até 5 dias', reais(sc.vencidoAte5d)) + lin('Vencido acima de 5 dias', reais(sc.vencidoMais5d)) : vazio('Sem dado da carteira.')) +
      sec('Baixas automáticas por Pix', lin('Hoje', reais(bx.valorBaixadoHoje), conta(bx.baixasHoje || 0, 'parcela', 'parcelas')) + (ult.length ? '<ul class="lista">' + ult.map(x => `<li><i>${esc(dataBR(x.data))}</i><span>${esc(x.pedidoId || '')}, parcela ${esc(x.parcela)}, ${reais(x.valor)}<small>${x.emDia ? 'em dia' : 'com atraso'}${x.quitado ? ', quitou o pedido' : ''}</small></span></li>`).join('') + '</ul>' : ''));
  },
  avisos(c) {
    const a = pega(c.fin, 'gestor', null); if (!a) return vazio('Sem registro de avisos.');
    return sec('Hoje', lin('Foram para o seu WhatsApp', inteiro(pega(a, 'hoje.whatsapp', 0))) + lin('Ficaram só aqui', inteiro(pega(a, 'hoje.silenciosos', 0)))) +
      sec('Últimos avisos', (a.ultimos || []).length ? '<ul class="lista">' + a.ultimos.map(x => `<li><span><b>${esc(frase(humano(x.tipo)))}</b> <span class="text-secondary">${esc(quando(x.em))}${x.whatsapp ? ', foi para o WhatsApp' : ''}</span><small>${esc(x.texto)}</small></span></li>`).join('') + '</ul>' : vazio('Nenhum aviso registrado ainda.'));
  },
};
function pintaGaveta(c = contexto()) {
  const id = E.gaveta, f = EQUIPE.find(x => x.id === id), corpo = $('gaveta-corpo');
  if (corpo.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
  let cabeca, html;
  if (f) { const s = situacao(f, c), e = erroCiclo(f, c);
    cabeca = `<h5 class="modal-title" id="gaveta-titulo">${esc(f.cargo)}</h5><div class="mt-1">${selo(s.cod, s.txt)}</div>`;
    html = !c.admin ? vazio('Disponível só para o Gestor.') : (GAVETAS[id] ? GAVETAS[id].call({ f }, c) : '');
    if (e && c.admin && !CICLO_DE[id]) html = erroHtml(e) + html;
  } else {
    cabeca = `<h5 class="modal-title" id="gaveta-titulo">${esc(TITULOS[id] || frase(humano(id)))}</h5>`;
    html = c.admin && GAVETAS[id] ? GAVETAS[id].call({}, c) : vazio('Disponível só para o Gestor.'); }
  const rolagem = corpo.scrollTop; poe($('gaveta-cabeca'), cabeca); poe(corpo, html); corpo.scrollTop = rolagem;
}
function abreGaveta(id) { if (!E.g.admin) return; E.gaveta = id; $('gaveta-corpo').__html = null; pintaGaveta(); const d = $('gaveta'); if (!d.open) { d.showModal(); $('gaveta-corpo').scrollTop = 0; } }
function fecha(d) { if (d && d.open) d.close(); }
function limpaGaveta() { E.gaveta = null; for (const id of ['gaveta-cabeca', 'gaveta-corpo']) { const el = $(id); el.innerHTML = ''; el.__html = ''; } }   // fechou ou saiu: nada do detalhe fica guardado na página

/* ---------------- ações do Gestor ---------------- */
let avisoRelogio = null;
function avisa(texto, tipo = '') { const el = $('aviso'); el.textContent = texto; el.className = 'aviso' + (tipo ? ' ' + tipo : ''); el.hidden = false; clearTimeout(avisoRelogio); avisoRelogio = setTimeout(() => { el.hidden = true; }, 6000); }
function confirma({ titulo, texto, botao, vermelho = false }) {   // chave e ordens de risco passam por aqui: nada sai com um toque só
  return new Promise(resolve => {
    const d = $('confirma'), sim = $('confirma-sim'), nao = $('confirma-nao');
    $('confirma-titulo').textContent = titulo; $('confirma-texto').textContent = texto; sim.textContent = botao; sim.className = 'btn ' + (vermelho ? 'btn-danger' : 'btn-primary');
    const fim = v => { sim.onclick = nao.onclick = d.onclose = null; fecha(d); resolve(v); };
    sim.onclick = () => fim(true); nao.onclick = () => fim(false); d.onclose = () => resolve(false);
    d.showModal(); nao.focus();
  });
}
async function gravaOrdem(tipo, dados) {   // mesmo contrato do worker: linha hq-cmd-..., status pendente, executada no servidor numa lista fechada
  if (!E.g.admin || !E.g.sb) throw new Error('entre como Gestor');
  const agora = new Date().toISOString(), id = 'hq-cmd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const { error } = await E.g.sb.from('painel_dados').insert({ id, dados: { tipo, dados, status: 'pendente', criadoEm: agora, por: E.g.email }, atualizado_em: agora });
  if (error) throw new Error(error.message);
  E.rapidoAte = Date.now() + 180000; agenda();
  return id;
}
async function ordem(tipo, dados, pergunta, marca) {
  if (!(await confirma(pergunta))) return false;
  try { const id = await gravaOrdem(tipo, dados); if (marca) E.enviadas[marca[0]] = { txt: marca[1], id }; avisa('Ordem enviada. O servidor aplica em até 1 minuto.'); await ciclo(); return true; }
  catch (e) { avisa('O banco recusou a ordem: ' + ((e && e.message) || 'erro'), 'erro'); return false; }
}
/* Pendência de 1 toque: a ordem espera 5 segundos (dá para desfazer) e só então sai. Se o Gestor trocar de aplicativo nesse intervalo, ela sai na hora. */
function agendaOrdem(k, tipo, dados, fazendo, feito) {
  if (!E.g.admin || E.agendadas[k] || E.enviadas[k]) return;
  E.agendadas[k] = { tipo, dados, fazendo, feito, enviando: false, relogio: setTimeout(() => executaAgendada(k), DESFAZER_MS) };
  pinta();
}
function desfaz(k) { const a = E.agendadas[k]; if (!a || a.enviando) return; clearTimeout(a.relogio); delete E.agendadas[k]; pinta(); avisa('Desfeito. Nada foi enviado.'); }
async function executaAgendada(k) {
  const a = E.agendadas[k]; if (!a || a.enviando) return;
  clearTimeout(a.relogio); a.enviando = true;
  try { const id = await gravaOrdem(a.tipo, a.dados); E.enviadas[k] = { txt: a.feito, id }; avisa('Ordem enviada. O servidor aplica em até 1 minuto.'); }
  catch (e) { avisa('O banco recusou a ordem: ' + ((e && e.message) || 'erro'), 'erro'); }
  delete E.agendadas[k];
  await ciclo();
}
function cancelaAgendadas() { for (const a of Object.values(E.agendadas)) clearTimeout(a.relogio); E.agendadas = {}; }
async function alternaChave(nome, ligar) {
  const c = contexto(), ch = c.chaves.get(nome), info = CHAVES[nome] || { alvo: 'cliente', txt: '' }, titulo = pega(ch, 'titulo', humano(nome));
  if (info.travada) return;
  const ok = await confirma(ligar
    ? { titulo: 'Ligar: ' + titulo + '?', texto: [info.txt, QUEM_RECEBE[info.alvo] || QUEM_RECEBE.cliente].filter(Boolean).join('\n\n'), botao: 'Ligar agora' }
    : { titulo: 'Pausar: ' + titulo + '?', texto: [info.txt, 'Ao pausar, isso para até você ligar de novo.'].filter(Boolean).join('\n\n'), botao: 'Pausar agora' });
  if (!ok) return;
  try { const id = await gravaOrdem('chave', { nome, valor: ligar ? 1 : 0 }); E.espera[nome] = { valor: !!ligar, id, desde: Date.now() }; avisa('Ordem enviada. A chave muda quando o servidor confirmar (até 1 minuto).'); }
  catch (e) { avisa('O banco recusou a ordem: ' + ((e && e.message) || 'erro'), 'erro'); }
  await ciclo();
}
function resolveEsperas(c) {   // a chave só sai de "aguardando" quando o servidor publica a posição pedida, ou quando a ordem é recusada
  for (const [nome, e] of Object.entries(E.espera)) {
    const o = E.ordens.find(x => x.id === e.id), st = pega(o, 'dados.status', 'pendente'), ch = c.chaves.get(nome);
    if (st === 'recusada' || st === 'expirada') { delete E.espera[nome]; avisa('O servidor não aplicou a ordem: ' + pega(o, 'dados.resultado', st), 'erro'); }
    else if (ch && ch.ligada === e.valor && st === 'feito') delete E.espera[nome];
    else if (Date.now() - e.desde > 4 * 60000) { delete E.espera[nome]; avisa('O servidor ainda não confirmou a ordem. Veja em "Ordens e controles".', 'erro'); }
  }
  for (const [k, e] of Object.entries(E.enviadas)) {   // decisão ou entrega que o servidor recusou volta a mostrar os botões
    const o = E.ordens.find(x => x.id === e.id), st = pega(o, 'dados.status', 'pendente');
    if (st === 'recusada' || st === 'expirada') { delete E.enviadas[k]; avisa('O servidor não aplicou a ordem: ' + pega(o, 'dados.resultado', st), 'erro'); }
  }
}
async function entrar(email, senha) {
  const sb = await cliente(), { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : 'Não consegui entrar: ' + error.message);
  if (!(await confereGestor({ sairSeNaoFor: true }))) throw new Error('Essa conta não é de Gestor.');
}
async function sair() {
  cancelaAgendadas();   // o que estava nos 5 segundos de desfazer não sai
  try { if (E.g.sb) await E.g.sb.auth.signOut(); } catch (e) { /* segue: o estado local é limpo de qualquer jeito */ }
  E.g.admin = false; E.g.email = ''; E.fin = null; E.finEm = null; E.ordens = []; E.espera = {}; E.enviadas = {}; fecha($('gaveta')); limpaGaveta(); pinta();
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', async ev => {
  const alvo = ev.target.closest ? ev.target : ev.target.parentElement; if (!alvo) return;
  const b = sel => alvo.closest(sel);
  let x;
  if (ev.target.tagName === 'DIALOG') { const r = ev.target.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) fecha(ev.target); return; }   // só o toque FORA da folha fecha
  if ((x = b('[data-fecha]'))) { fecha(x.closest('dialog')); return; }
  if ((x = b('[data-chave]'))) { ev.preventDefault(); if (!x.disabled) alternaChave(x.dataset.chave, x.dataset.ligar === '1'); return; }   // a chave não vira sozinha: só quando o servidor confirma
  if ((x = b('[data-desfaz]'))) { desfaz(x.dataset.desfaz); return; }
  if ((x = b('[data-credito]'))) { const d = x.dataset.credito; agendaOrdem('credito:' + x.dataset.lead, 'credito_decidir', { leadId: x.dataset.lead, decisao: d }, d === 'aprovar' ? 'Aprovando' : 'Recusando', d === 'aprovar' ? 'Aprovação enviada' : 'Recusa enviada'); return; }
  if ((x = b('[data-entrega]'))) { agendaOrdem('entrega:' + x.dataset.entrega, 'entrega_confirmar', { pedidoId: x.dataset.entrega }, 'Confirmando', 'Confirmação enviada'); return; }
  if ((x = b('[data-reinicia]'))) { await ordem('reiniciar_robo', { conta: x.dataset.reinicia }, { titulo: 'Reiniciar o número ' + (x.dataset.nome || '') + '?', texto: 'Ele fica alguns minutos sem responder os clientes enquanto volta.', botao: 'Reiniciar', vermelho: true }); return; }
  if ((x = b('[data-cobranca]'))) { await ordem('cobranca_1215', {}, { titulo: 'Disparar a rodada de cobrança agora?', texto: 'Sai cobrança de verdade para os clientes da base que passarem na conferência da ficha.\n\nSegunda a sábado, das 12h às 17h, no máximo uma vez a cada 3 h.', botao: 'Disparar', vermelho: true }); return; }
  if ((x = b('[data-diretriz]'))) { const campo = $('diretriz'), t = campo ? campo.value.trim() : ''; if (!t) { avisa('Escreva a diretriz antes de registrar.', 'erro'); return; }
    if (await ordem('diretriz', { texto: t }, { titulo: 'Registrar a diretriz?', texto: t, botao: 'Registrar' })) { campo.value = ''; $('controles').__html = null; pinta(); } return; }
  if (b('[data-nao-abre]')) return;
  if ((x = b('[data-abre]'))) { abreGaveta(x.dataset.abre); return; }
});
document.addEventListener('keydown', ev => {   // linha de tabela que abre a gaveta também responde ao teclado
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('tr[data-abre]')) { ev.preventDefault(); abreGaveta(ev.target.dataset.abre); }
});
$('botao-entrar').addEventListener('click', () => { if (E.g.admin) sair(); else { $('login-erro').textContent = ''; $('login').showModal(); $('login-email').focus(); } });
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); const erro = $('login-erro'), ok = $('login-ok'), email = $('login-email').value.trim(), senha = $('login-senha').value;
  if (!email || !senha) { erro.textContent = 'Preencha o e-mail e a senha.'; return; }
  ok.disabled = true; erro.textContent = 'Entrando';
  try { await entrar(email, senha); $('login-senha').value = ''; erro.textContent = ''; fecha($('login')); await ciclo(); } catch (e) { erro.textContent = (e && e.message) || 'Não consegui entrar.'; }
  ok.disabled = false;
});
$('gaveta').addEventListener('close', limpaGaveta);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { for (const k of Object.keys(E.agendadas)) executaAgendada(k); }   // saiu da tela com um toque ainda nos 5 segundos: a ordem sai agora
  else roda();
});

/* ---------------- partida ---------------- */
async function inicia() {
  if (!URL_BANCO || !CHAVE_PUBLICA) { E.pub = { ...E.pub, ok: false, erro: 'configuração do banco ausente', primeira: false }; pinta(); return; }
  pinta();
  let sessao = Promise.resolve(false);
  if (temSessaoGuardada()) { E.g.conferindo = true; sessao = confereGestor().catch(() => false); }
  await ciclo();
  const era = await sessao; E.g.conferindo = false;
  if (era) await ciclo(); else pinta();
  agenda();
}
window.HQ = { estado: E, pinta, contexto, pendencias };   // só para depurar no navegador: não guarda nem expõe dado além do que a tela já mostra
inicia();
})();
