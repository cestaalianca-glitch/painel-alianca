/* ALIANÇA HQ — centro de comando (layout novo, 15/11/2026, branch feat/novo-layout-hq).
   SEM LOGIN: lê só as linhas de contagem (hq-pc e hq-servidor) e mostra se a equipe digital está online ou em pausa. Nada de valor, fila ou nome.
   COM LOGIN DO GESTOR (Supabase Auth + papel admin): lê a linha privada hq-financeiro e libera radar, pulso financeiro, filas e interruptores.
   Nenhum dado fica neste arquivo: tudo vem do banco, e quem decide o que cada um lê é a regra do banco (RLS), não esta página.
   As ordens (ligar chave, aprovar crédito, confirmar entrega) usam o mesmo contrato de sempre: uma linha hq-cmd-... com status "pendente",
   que o worker do servidor executa numa lista fechada de ações. O interruptor só muda de posição quando o servidor confirma. */
(() => {
'use strict';

/* ---------------- configuração ---------------- */
const URL_BANCO = window.SUPABASE_URL || '', CHAVE_PUBLICA = window.SUPABASE_ANON_KEY || '';   // vêm de ../config.js (chave pública por desenho)
const BIBLIOTECA_LOGIN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';   // só é baixada quando o Gestor entra
const CICLO_MS = 60000, CICLO_RAPIDO_MS = 10000, VELHO_MIN = 15, FUSO = 'America/Sao_Paulo';
const EXPEDIENTE_BANCO = ['08:00', '18:30'], LEITURA_ATRASADA_MIN = 120, PEDIDO_SEM_DONO_H = 20;

/* Os seis funcionários digitais. "chave" é o interruptor principal do cartão; "outras" aparecem na gaveta.
   As janelas de trabalho repetem as que estão configuradas nos motores do servidor (seg a sáb). */
const EQUIPE = [
  { id: 'atendente', cargo: 'Atendente da Central', faz: 'Atende o WhatsApp, os pedidos do site e o pós-quitação.', plantao: true, precisaCentral: true,
    outras: ['SITE_CADASTRO_AO_VIVO', 'POS_QUITACAO_AO_VIVO', 'PERGUNTA_DATA_AO_VIVO', 'ARQUIVA_CONCLUIDOS_AO_VIVO'],
    regras: ['Responde quem escreve, a qualquer hora, enquanto o número está conectado.', 'Só oferece nova cesta a quem quitou e teve o Pix baixado.', 'Caso que ele não resolve vira pendência para uma pessoa, nunca fica sem dono.'] },
  { id: 'credito', cargo: 'Analista de Crédito', faz: 'Confere cada cadastro, trava o que é risco e separa os casos duvidosos para você.', plantao: true,
    outras: [],
    regras: ['Não aprova no chute: sem o número real do cliente, o cadastro fica aguardando.', 'Só aprova sozinho quando não existe nenhum ponto de atenção.', 'Qualquer dúvida (autônomo, pouco tempo no endereço, margem apertada) vem para a sua revisão.', 'Ocupação vetada e situação grave no cadastro (protesto, SPC, fórum) travam na hora.'] },
  { id: 'vip', cargo: 'Especialista VIP', faz: 'Convida quem paga em dia a indicar amigos e acompanha os bônus.', chave: 'INDICACAO_VIP_AO_VIVO', janela: ['08:30', '17:30'],
    outras: ['CAMPANHAS_VENDAS_AO_VIVO'],
    regras: ['Só convida quem paga em dia (tolerância de 3 dias).', 'No máximo 25 convites por dia, sem repetir a mesma pessoa em 60 dias.', 'Espera se a pessoa recebeu outra mensagem nas últimas 72 h ou está conversando.', 'Indicação com o mesmo CPF, WhatsApp ou endereço do padrinho é recusada.'] },
  { id: 'recuperador', cargo: 'Recuperador de Base', faz: 'Chama de volta ex-clientes bons pagadores e renova quem acabou de quitar.', chave: 'REATIVACAO_BASE_AO_VIVO', janela: ['08:30', '17:30'],
    outras: ['REATIVACAO_AO_VIVO'],
    regras: ['Só bom pagador, sem saldo e sem bloqueio, com WhatsApp conferido.', 'No máximo 35 reativações e 20 renovações por dia, com intervalo entre os envios.', 'Sem contato repetido: espera 45 dias desde a última conversa.', 'As rotas de atendimento próprio (14 a 17 e 24) nunca entram na fila.'] },
  { id: 'cobrador', cargo: 'Cobrador Preventivo', faz: 'Lembra a parcela 3 dias antes, no dia e 3 dias depois, com valor e Pix.', chave: 'REGUA_COBRANCA_AO_VIVO', janela: ['08:30', '17:30'],
    outras: ['REGUA_ATRASADOS_AO_VIVO', 'LEMBRETE_VISITA_AO_VIVO'],
    regras: ['Cobre só os pedidos do site: a base já é cobrada pela rotina do dia.', 'No máximo 30 lembretes por dia.', 'O texto nunca mente a data: lembrete fora do dia certo é cancelado.', 'As rotas de atendimento próprio (14 a 17 e 24) nunca recebem.'] },
  { id: 'secretario', cargo: 'Secretário dos Vendedores', faz: 'Junta os recados em 3 boletins por dia e avisa o Pix na hora.', chave: 'RECADO_VENDEDOR_AO_VIVO', janela: ['08:00', '18:00'], precisaCentral: true,
    outras: ['ROMANEIO_AO_VIVO', 'DONO_DO_PEDIDO_AO_VIVO', 'COPILOTO_BRUNO_AO_VIVO'],
    regras: ['Um boletim por grupo de rota, às 08h30, 13h30 e 17h00.', 'Aviso de Pix e cancelamento urgente de rota saem na hora (até 10 min).', 'Nada vai solto para o grupo fora desses casos.'] },
];
const CICLO_DE = { vip: 'credito.indicacaoVip.ultimoCiclo', recuperador: 'credito.recompra.ultimoCiclo', cobrador: 'credito.regua.ultimoCiclo', secretario: 'boletim.ultimoCiclo' };

/* O que cada chave faz, em linguagem de dono. alvo: quem recebe mensagem quando ela está ligada. */
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
const ORDEM_TIPO = { chave: 'Interruptor', credito_decidir: 'Decisão de crédito', entrega_confirmar: 'Confirmar entrega', reiniciar_robo: 'Reinício de número', cobranca_1215: 'Rodada de cobrança', diretriz: 'Diretriz' };
const DIA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* ---------------- estado ---------------- */
const E = {
  pub: { ok: false, erro: 'carregando', pc: null, srv: null, em: 0, primeira: true },
  fin: null, finEm: null, finErro: '',
  g: { sb: null, admin: false, email: '', conferindo: false },
  ordens: [], espera: {}, enviadas: {}, rapidoAte: 0, lendo: false, gaveta: null,
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
const MOTIVO_CICLO = { chave_desligada: 'A chave está desligada: só montou a prévia.', fora_do_horario: 'Fora do horário de envio.', fora_da_janela: 'Fora do horário de envio.' };
const frase = s => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const origem = o => ORIGEM[o] || humano(o);
const inteiro = v => Math.round(+v || 0).toLocaleString('pt-BR');
const reais = v => (num(+v) == null ? '–' : 'R$\u00a0' + inteiro(v));   // espaço que não quebra: o valor nunca se separa do R$
const reaisGrande = v => (num(+v) == null ? '–' : '<small>R$</small>' + inteiro(v));
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
  if (!c.conectado) return { cod: 'semdado', txt: c.carregando ? 'Lendo…' : 'Sem sinal' };
  if (!c.srvFresco) return { cod: 'falha', txt: 'Sem sinal do servidor' };
  if (f.precisaCentral && !c.central) return { cod: 'falha', txt: 'Central desconectada' };
  if (erroCiclo(f, c)) return { cod: 'falha', txt: 'Erro no último ciclo' };
  if (f.plantao) return { cod: 'trabalhando', txt: 'Trabalhando' };
  const ch = c.chaves.get(f.chave);
  if (!ch) return { cod: 'semdado', txt: 'Sem dado' };
  if (!ch.ligada) return { cod: 'pausa', txt: 'Em pausa' };
  return naJanela(f.janela, c.agora) ? { cod: 'trabalhando', txt: 'Trabalhando' } : { cod: 'janela', txt: 'Aguardando janela' };
}
function numeros(f, c) {   // produção e fila de cada um (só com login)
  const cr = c.cr, t = pega(cr, 'funil.total', {});
  switch (f.id) {
    case 'atendente': return c.ind ? [{ n: c.ind.atendidosHoje, r: 'atendimentos hoje' }, { n: c.ind.pendenciasAbertas, r: 'na fila' }] : null;
    case 'credito': return cr.funil ? [{ n: t.leads || 0, r: 'cadastros até agora' }, { n: (cr.excecoes || []).length, r: 'esperam você', alerta: (cr.excecoes || []).length > 0 }] : null;
    case 'vip': return cr.indicacaoVip ? [{ n: pega(cr, 'indicacaoVip.convites.enviados', 0), r: 'convites enviados' }, { n: pega(cr, 'indicacaoVip.convites.agendados', 0), r: 'na fila' }] : null;
    case 'recuperador': return cr.recompra ? [{ n: pega(cr, 'recompra.hoje.enviados', 0), de: pega(cr, 'recompra.hoje.limite', null), r: 'enviados hoje' }, { n: pega(cr, 'recompra.hoje.programados', 0), r: 'na fila' }] : null;
    case 'cobrador': return cr.regua ? [{ n: cr.regua.enviadosHoje || 0, de: cr.regua.limiteDiario, r: 'lembretes hoje' }, { n: pega(cr, 'regua.agendados.total', 0), r: 'na fila' }] : null;
    case 'secretario': return pega(c.fin, 'boletim.hoje', null) ? [{ n: c.fin.boletim.hoje.boletins || 0, r: 'boletins hoje' }, { n: c.fin.boletim.aguardando || 0, r: 'recados na fila' }] : null;
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
function radar(c) {
  const idade = c.srvMin != null ? 'atualizado ' + haQuanto(c.srvMin) : '';
  if (!c.conectado) return c.carregando ? { nivel: 'mudo', rotulo: 'Lendo a operação…', quando: '', titulo: 'Um instante', sub: '', itens: [] }
    : { nivel: 'mudo', rotulo: 'Sem conexão', quando: '', titulo: 'Sem conexão com os dados', sub: 'Não consegui ler o servidor agora (' + c.erro + '). Tento de novo em 1 minuto.', itens: [] };
  const falhas = [], decisoes = [], atencoes = [];
  if (!c.temSrv) falhas.push({ txt: 'O servidor ainda não publicou o estado' });
  else if (!c.srvFresco) falhas.push({ txt: 'Servidor sem dar sinal ' + haQuanto(c.srvMin), det: 'Os robôs e os motores podem ter parado.' });
  for (const r of c.robos) if (r.nivel === 1 || r.nivel === 2) falhas.push({ txt: 'WhatsApp ' + r.nome + ' sem conexão', det: r.nivel === 2 ? 'Ligado, mas sem sinal recente. Pode precisar do QR Code.' : 'A origem (' + r.onde + ') parou de atualizar.', abre: 'atendente' });
  if (c.duplas.length) falhas.push({ txt: 'Chave ligada no PC e no servidor ao mesmo tempo', det: 'Risco de mensagem repetida: ' + c.duplas.join(', ') + '.' });

  if (!c.admin) {   // linha pública: só online ou em pausa, sem detalhe e sem número de operação
    const sit = EQUIPE.map(f => situacao(f, c).cod), ativos = sit.filter(s => s === 'trabalhando' || s === 'janela').length, pausa = sit.filter(s => s === 'pausa').length;
    return falhas.length
      ? { nivel: 'atencao', rotulo: 'Equipe digital', quando: idade, titulo: 'Equipe digital com instabilidade', sub: 'O detalhe aparece para o Gestor depois do login.', itens: [] }
      : { nivel: 'ok', rotulo: 'Equipe digital', quando: idade, titulo: 'Equipe digital online', sub: conta(ativos, 'funcionário a postos', 'funcionários a postos') + (pausa ? ' e ' + pausa + ' em pausa.' : '.') + ' Valores e pendências só aparecem para o Gestor.', itens: [] };
  }

  if (E.finErro || !c.fin) falhas.push({ txt: 'Não consegui ler os números privados', det: E.finErro || 'A linha privada ainda não foi publicada pelo servidor.' });
  else {
    const finMin = minDesde(E.finEm);
    if (finMin != null && finMin > VELHO_MIN) atencoes.push({ txt: 'Números privados desatualizados', det: 'Última publicação ' + quando(E.finEm) + '.' });
    for (const f of EQUIPE) { const e = erroCiclo(f, c); if (e) falhas.push({ txt: f.cargo + ': erro no último ciclo', det: e, abre: f.id }); }
    const bx = c.cr.baixaPix, cx = c.cr.caixa, ex = (c.cr.excecoes || []).length, rev = pega(bx, 'revisao', []).length;
    if (pega(bx, 'ultimoCiclo.erro', '')) falhas.push({ txt: 'Baixa automática por Pix: erro no último ciclo', det: String(bx.ultimoCiclo.erro), abre: 'quitacao' });
    if (pega(bx, 'ultimoCiclo.fonte', '') === 'sem_arquivo_de_excecoes') falhas.push({ txt: 'Baixa por Pix sem a lista do conciliador', det: 'A conciliação não gerou a lista de Pix sem cliente.', abre: 'quitacao' });
    if (cx && pega(cx, 'inadimplencia.baseLida', true) === false) falhas.push({ txt: 'A base não foi lida', det: 'Previsão de 7 dias e atraso estão incompletos.', abre: 'atraso' });
    const px = caixaPix(c);
    if (px && px.estado === 'atrasada') atencoes.push({ txt: 'Leitura do banco atrasada', det: 'Última leitura às ' + px.hora + ' (' + haQuanto(px.min) + ').', abre: 'caixa' });
    if (ex) decisoes.push({ txt: conta(ex, 'cadastro espera', 'cadastros esperam') + ' a sua decisão de crédito', abre: 'credito', rot: 'Decidir' });
    if (rev) decisoes.push({ txt: conta(rev, 'Pix precisa', 'Pix precisam') + ' de revisão', det: 'O sistema não conseguiu ligar o pagamento a um pedido com certeza.', abre: 'quitacao', rot: 'Revisar' });
  }
  const dp = pega(c.ind, 'donoPedido', null);
  if (dp && dp.semAtender3h > 0 && dp.maisAntigoNovoH >= PEDIDO_SEM_DONO_H) atencoes.push({ txt: conta(dp.semAtender3h, 'pedido de compra', 'pedidos de compra') + ' sem atendimento', det: 'O mais antigo espera há ' + dp.maisAntigoNovoH + ' h.', abre: 'atendente' });

  const itens = [...falhas.map(i => ({ ...i, nivel: 'falha' })), ...decisoes.map(i => ({ ...i, nivel: 'decisao' })), ...atencoes.map(i => ({ ...i, nivel: 'atencao' }))];
  const hoje = pega(c.fin, 'gestor.hoje', null), rodape = hoje ? conta((hoje.silenciosos || 0) + (hoje.whatsapp || 0), 'aviso registrado hoje', 'avisos registrados hoje') + ', ' + (hoje.whatsapp || 0) + ' no seu WhatsApp' : '';
  const base = { rotulo: 'Radar de decisão', quando: idade, itens, rodape };
  if (falhas.length) return { ...base, nivel: 'falha', titulo: conta(falhas.length, 'falha crítica', 'falhas críticas'), sub: decisoes.length ? 'E ' + conta(decisoes.length, 'decisão esperando', 'decisões esperando') + ' por você.' : 'Precisa de alguém olhando agora.' };
  if (decisoes.length) return { ...base, nivel: 'decisao', titulo: decisoes.length === 1 ? '1 decisão espera por você' : decisoes.length + ' decisões esperam por você', sub: 'O resto da operação segue sozinho.' };
  if (atencoes.length) return { ...base, nivel: 'atencao', titulo: 'Operação automática', sub: conta(atencoes.length, 'ponto de atenção', 'pontos de atenção') + ', sem decisão pendente.' };
  return { ...base, nivel: 'ok', titulo: 'Operação 100% automática', sub: 'Nenhuma pendência para você.' };
}

/* ---------------- pintura ---------------- */
function pinta() {
  const c = contexto();
  resolveEsperas(c);
  const b = $('botao-entrar'); b.textContent = E.g.admin ? 'Sair' : E.g.conferindo ? 'Conferindo…' : 'Entrar'; b.disabled = E.g.conferindo;
  pintaRadar(c); pintaPulso(c); pintaEquipe(c); pintaEsteira(c); pintaControles(c); pintaRodape(c);
  if (E.gaveta && $('gaveta').open) pintaGaveta(c);
}
function pintaRadar(c) {
  const r = radar(c), el = $('radar');
  el.className = 'radar ' + r.nivel + (r.itens.length ? ' com-itens' : '');
  poe(el, `<p class="radar-linha"><span class="ping" aria-hidden="true"></span><span>${esc(r.rotulo)}</span><span class="radar-quando">${esc(r.quando)}</span></p><h1>${esc(r.titulo)}</h1>` +
    (r.sub ? `<p class="sub">${esc(r.sub)}</p>` : '') +
    (r.itens.length ? '<ul class="pend">' + r.itens.map(i => `<li class="${i.nivel}"><div class="txt">${esc(i.txt)}${i.det ? `<small>${esc(i.det)}</small>` : ''}</div>${i.abre ? `<button type="button" class="botao ouro" data-abre="${esc(i.abre)}">${esc(i.rot || 'Ver')}</button>` : ''}</li>`).join('') + '</ul>' : '') +
    (r.rodape ? `<button type="button" class="radar-link" data-abre="avisos">${esc(r.rodape)}</button>` : ''));
}
function pintaPulso(c) {
  const el = $('pulso'); el.hidden = !c.admin; if (!c.admin) { poe(el, ''); return; }
  const cab = '<div class="bloco-cab"><h2>Pulso financeiro</h2><span>só você vê</span></div>';
  if (!c.fin) { poe(el, cab + '<div class="caixa"><p class="vazio" style="padding:16px">' + esc(E.finErro ? 'Não consegui ler os números agora: ' + E.finErro : 'O servidor ainda não publicou os números de hoje.') + '</p></div>'); return; }
  const cx = c.cr.caixa, px = caixaPix(c), rc = receita(c), io = pega(cx, 'inadimplencia.operacional', null), ih = pega(cx, 'inadimplencia.historico', null), baseLida = pega(cx, 'inadimplencia.baseLida', true) !== false;
  const celPix = !px ? `<span class="val sem">–</span><span class="obs">Sem dado de caixa.</span>`
    : px.estado === 'sem' ? `<span class="val sem">–</span><span class="obs alerta">Sem leitura do banco hoje</span><span class="obs">${esc(frase(String(px.motivo).replace(/^sem leitura do banco hoje\s*/i, '').replace(/^\(|\)$/g, '')))}</span>`
    : `<span class="val">${reaisGrande(px.total)}</span><span class="obs${px.estado === 'atrasada' ? ' alerta' : ''}">${px.estado === 'atrasada' ? 'Leitura atrasada: última às ' + esc(px.hora) : 'Banco lido às ' + esc(px.hora)}</span><span class="obs">${esc(px.n ? conta(px.n, 'Pix confirmado', 'Pix confirmados') : 'Nenhum Pix confirmado até agora')}</span>`;
  const celPrev = cx && cx.previsao7d ? `<span class="val">${reaisGrande(cx.previsao7d.total)}</span><span class="obs${baseLida ? '' : ' erro'}">${baseLida ? 'a vencer nos próximos 7 dias' : 'incompleta: a base não foi lida'}</span>` : `<span class="val sem">–</span><span class="obs">Sem dado.</span>`;
  const celAtraso = io && ih ? `<span class="duas"><span><span class="rot">Recuperável, de 1 a 90 dias</span><span class="val">${reaisGrande(io.total)}</span></span><span class="antigo"><span class="rot">Histórico antigo, mais de 90 dias</span><span class="val">${reaisGrande(ih.total)}</span></span></span>${baseLida ? '' : '<span class="obs erro">Incompleto: a base não foi lida.</span>'}` : `<span class="rot">Inadimplência</span><span class="val sem">–</span><span class="obs">Sem dado.</span>`;
  const celReceita = rc ? `<span class="val">${reaisGrande(rc.total)}</span><span class="tres"><span>Indicação VIP<b>${reais(rc.indicacao)}</b></span><span>Reativação<b>${reais(rc.reativacao)}</b></span><span>Renovação<b>${reais(rc.renovacao)}</b></span></span>` : `<span class="val sem">–</span><span class="obs">Sem dado de vendas do mês.</span>`;
  poe(el, cab + `<div class="caixa pulso">
    <button type="button" class="cel" data-abre="caixa"><span class="rot">Caixa Pix hoje</span>${celPix}</button>
    <button type="button" class="cel" data-abre="previsao"><span class="rot">Previsão para 7 dias</span>${celPrev}</button>
    <button type="button" class="cel larga" data-abre="atraso">${celAtraso}</button>
    <button type="button" class="cel larga" data-abre="receita"><span class="rot">Receita gerada pela equipe digital${rc ? ' em ' + esc(rc.mes) : ''}</span>${celReceita}</button></div>`);
}
function chaveHtml(nome, c) {
  const ch = c.chaves.get(nome), info = CHAVES[nome] || {}, esp = E.espera[nome];
  if (!ch) return '<span class="fixo">sem dado</span>';
  if (info.travada) return `<span class="fixo">${ch.ligada ? 'ligada' : 'desligada'}<br>só pelo terminal</span>`;
  const mostra = esp ? esp.valor : ch.ligada, leg = esp ? 'Aguardando o servidor' : ch.ligada ? 'Ligado' : 'Em pausa';
  return `<button type="button" class="chave" role="switch" aria-checked="${mostra}" aria-label="${esc(ch.titulo)}" data-chave="${esc(nome)}" data-ligar="${ch.ligada ? 0 : 1}"${esp ? ' data-espera disabled' : ''}><span class="leg">${leg}</span><span class="trilho" aria-hidden="true"></span></button>`;
}
function pintaEquipe(c) {
  const sits = EQUIPE.map(f => situacao(f, c)), n = cod => sits.filter(s => s.cod === cod).length;
  const resumo = !c.conectado ? '' : [n('trabalhando') && n('trabalhando') + ' trabalhando', n('janela') && n('janela') + ' aguardando janela', n('pausa') && n('pausa') + ' em pausa', n('falha') && n('falha') + ' com falha'].filter(Boolean).join(', ');
  const linhas = EQUIPE.map((f, i) => {
    const s = sits[i]; let baixo = '';
    if (c.admin) {
      const ns = numeros(f, c), ligadas = f.outras.filter(k => pega(c.chaves.get(k), 'ligada', false)).length;
      const ctl = f.chave ? chaveHtml(f.chave, c) : f.outras.length ? `<button type="button" class="fixo" data-abre="${f.id}">${ligadas} de ${f.outras.length} funções ligadas</button>` : '<span class="fixo">Sempre ativo</span>';
      baixo = `<div class="nums">${ns ? ns.map(x => `<div${x.alerta ? ' class="alerta"' : ''}><b>${num(x.n) == null ? '–' : inteiro(x.n)}${x.de ? `<small> de ${inteiro(x.de)}</small>` : ''}</b><span>${esc(x.r)}</span></div>`).join('') : '<div><b>–</b><span>sem dado ainda</span></div>'}</div><div class="ctl">${ctl}</div>`;
    }
    const miolo = `<span class="cargo">${esc(f.cargo)}</span><span class="sit s-${s.cod}">${esc(s.txt)}</span><span class="faz">${esc(f.faz)}</span>`;   // sem login o cartão não abre nada: só mostra o estado
    return `<article class="func s-${s.cod}">${c.admin ? `<button type="button" class="abre" data-abre="${f.id}" aria-haspopup="dialog">${miolo}</button>` : `<div class="abre">${miolo}</div>`}${baixo}</article>`;
  }).join('');
  poe($('equipe'), `<div class="bloco-cab"><h2>Equipe digital</h2><span>${esc(resumo)}</span></div><div class="caixa equipe-lista">${linhas}</div>` +
    (c.admin ? '' : '<p class="nota" style="margin:10px 4px 0">Produção, filas e interruptores aparecem depois do login do Gestor.</p>'));
}
function etapas(c) {
  const cr = c.cr, t = pega(cr, 'funil.total', null), por = pega(cr, 'funil.porOrigem', []), cart = pega(cr, 'regua.carteira', null), ex = (cr.excecoes || []).length;
  const aEntregar = Array.isArray(cr.pedidos) ? cr.pedidos.reduce((s, g) => s + (g.pedidos || []).length, 0) : null, baixas = pega(cr, 'baixaPix.baixasHoje', null);
  return [
    { id: 'captacao', nome: 'Captação', n: t ? t.leads || 0 : null, un: ['cadastro recebido', 'cadastros recebidos'], det: por.length ? 'Origem: ' + por.slice(0, 3).map(o => origem(o.origem) + ' ' + o.leads).join(', ') + '.' : '' },
    { id: 'credito', nome: 'Análise', n: t ? t.aprovados || 0 : null, un: ['aprovado', 'aprovados'], det: t ? (t.reprovados || 0) + ' reprovados, ' + (t.aguardando || 0) + ' aguardando documento' + (ex ? ', ' + ex + ' com você' : '') + '.' : '', alerta: ex > 0 },
    { id: 'entrega', nome: 'Entrega na rota', n: aEntregar, un: ['pedido para entregar', 'pedidos para entregar'], det: aEntregar ? 'Toque para confirmar a entrega.' : '' },
    { id: 'quitacao', nome: 'Quitação', n: cart ? cart.pedidosAtivos || 0 : null, un: ['pedido pagando', 'pedidos pagando'], det: cart ? conta(cart.quitados || 0, 'já quitado', 'já quitados') + (baixas != null ? ', ' + conta(baixas, 'parcela baixada', 'parcelas baixadas') + ' por Pix hoje' : '') + '.' : '' },
    { id: 'recuperador', nome: 'Recompra', n: pega(cr, 'recompra.reconvertidos.total', null), un: ['recompra fechada', 'recompras fechadas'], det: cr.recompra ? pega(cr, 'recompra.renovacoes.agendadas', 0) + ' renovações agendadas.' : '' },
  ];
}
function pintaEsteira(c) {
  const el = $('esteira'); el.hidden = !c.admin || !c.fin; if (el.hidden) { poe(el, ''); return; }
  const d = pega(c.fin, 'roi.dia.empresa', null), ate = pega(c.fin, 'roi.dadosVendasAte', ''), hoje = pega(c.fin, 'roi.hoje', '');
  const faixa = d ? `<p class="hoje-empresa">Hoje na empresa inteira: <b>${conta(d.cestas || 0, 'cesta vendida', 'cestas vendidas')}</b> (${reais(d.vendido)}) e <b>${reais(d.recebido)}</b> recebidos.${ate && hoje && ate < hoje ? ' Vendas lançadas até ' + esc(dataBR(ate)) + '.' : ''}</p>` : '';
  poe(el, '<div class="bloco-cab"><h2>Do cadastro à recompra</h2><span>pedidos do site, agora</span></div><div class="caixa">' + faixa + '<ol class="esteira">' +
    etapas(c).map((e, i) => `<li><button type="button" class="etapa${e.alerta ? ' alerta' : ''}" data-abre="${e.id}"><span class="no" aria-hidden="true">${i + 1}</span><span><span class="nome">${esc(e.nome)}</span><span class="qtd">${e.n == null ? 'sem dado' : esc(conta(e.n, e.un[0], e.un[1]))}</span>${e.det ? `<span class="det">${esc(e.det)}</span>` : ''}</span><span class="seta" aria-hidden="true">›</span></button></li>`).join('') + '</ol></div>');
}
function ordemHtml(o) {
  const d = o.dados || {}, x = d.dados || {}, st = d.status || 'pendente', cod = st === 'feito' ? 'trabalhando' : st === 'pendente' ? 'janela' : 'falha';
  const alvo = d.tipo === 'chave' ? (x.valor ? 'Ligar ' : 'Pausar ') + pega(contexto().chaves.get(x.nome), 'titulo', humano(x.nome)) : d.tipo === 'credito_decidir' ? x.decisao || '' : d.tipo === 'entrega_confirmar' ? 'pedido ' + (x.pedidoId || '') : d.tipo === 'diretriz' ? String(x.texto || '').slice(0, 80) : '';
  return `<li><i>${esc(hora(d.criadoEm || o.atualizado_em))}</i><span><b>${esc(ORDEM_TIPO[d.tipo] || humano(d.tipo))}</b>${alvo ? ': ' + esc(alvo) : ''} <span class="sit s-${cod}">${esc(st)}</span><small>${esc(d.resultado || (st === 'pendente' ? 'aguardando o servidor (até 1 min)' : ''))}</small></span></li>`;
}
function pintaControles(c) {
  const el = $('controles'); el.hidden = !c.admin; if (!c.admin) { poe(el, ''); return; }
  if (document.activeElement && document.activeElement.id === 'diretriz') return;   // não apaga o que o Gestor está digitando
  const donas = new Set(EQUIPE.flatMap(f => [f.chave, ...f.outras]).filter(Boolean)), soltas = [...c.chaves.values()].filter(k => !donas.has(k.nome));
  const aberto = !!(el.querySelector('details') || {}).open;   // não fecha o bloco na cara do Gestor a cada leitura
  poe(el, `<div class="caixa"><details class="mais"${aberto ? ' open' : ''}><summary>Ordens e outros controles</summary><div class="dentro">
    <section class="g-sec"><h3>Últimas ordens</h3>${E.ordens.length ? '<ul class="itens">' + E.ordens.map(ordemHtml).join('') + '</ul>' : '<p class="vazio">Nenhuma ordem ainda.</p>'}</section>
    ${soltas.length ? '<section class="g-sec"><h3>Outras chaves</h3>' + soltas.map(k => linhaChave(k.nome, c)).join('') + '</section>' : ''}
    <section class="g-sec"><h3>Diretriz para a equipe</h3><textarea class="campo" id="diretriz" maxlength="500" placeholder="Fica registrada no servidor. Ninguém executa o texto."></textarea><div style="margin-top:10px"><button type="button" class="botao pequeno" data-diretriz>Registrar diretriz</button></div></section>
  </div></details></div>`);
}
function pintaRodape(c) {
  const m = c.motor, dados = c.admin && m && m.dadosEm ? 'Dados do sistema até ' + dataBR(m.dadosEm) + '. ' : '';
  poe($('rodape'), `<p>${esc(dados)}${c.admin ? 'Você está no acesso do Gestor' + (E.g.email ? ' (' + esc(E.g.email) + ')' : '') + '.' : 'Esta é a visão pública: mostra só se a equipe digital está online ou em pausa.'}</p>` +
    (c.admin ? '<nav><a href="../">Painel de vendas</a><a href="../cobranca/">Cobrança diária</a><a href="../central/">Central</a></nav>' : ''));
}

/* ---------------- gaveta ---------------- */
const sec = (titulo, corpo, lado = '') => (corpo ? `<section class="g-sec"><h3>${esc(titulo)}${lado ? `<small>${esc(lado)}</small>` : ''}</h3>${corpo}</section>` : '');
const lin = (rot, val, obs = '') => `<div class="lin"><span>${esc(rot)}</span><b>${val}</b>${obs ? `<small>${esc(obs)}</small>` : ''}</div>`;   // val já chega pronto de quem chama
const vazio = t => `<p class="vazio">${esc(t)}</p>`;
const nota = t => `<p class="nota">${esc(t)}</p>`;
const regras = l => '<ul class="regras">' + l.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
function linhaChave(nome, c) {
  const ch = c.chaves.get(nome), info = CHAVES[nome] || {};
  return `<div class="lin ctl"><span><b>${esc(pega(ch, 'titulo', humano(nome)))}</b><em>${esc(info.txt || '')}${ch && ch.ligada && ch.onde === 'PC' ? ' Está ligada no PC.' : ''}</em></span>${chaveHtml(nome, c)}</div>`;
}
function cicloHtml(u) {
  if (!u) return '<p class="faixa-ok">Último ciclo: ainda não registrado.</p>';
  const erro = u.erro || (u.ok === false ? 'o ciclo falhou' : '');
  return erro ? `<p class="faixa-erro">Erro no último ciclo (${esc(quando(u.em))}): ${esc(erro)}</p>` : `<p class="faixa-ok">Último ciclo ${esc(quando(u.em))}, sem erro.${u.motivo ? ' ' + esc(MOTIVO_CICLO[u.motivo] || frase(humano(u.motivo)) + '.') : ''}</p>`;
}
function esperaHtml(e) { const l = Object.entries(e || {}); return l.length ? nota('Segurando o envio: ' + l.map(([k, v]) => humano(k) + ' (' + v + ')').join(', ') + '.') : ''; }
function filaHtml(itens, quandoDe, linhaDe, semNada) {   // separa o que está programado para o próximo dia útil do resto
  const alvo = proximoDiaUtil(), nome = alvo.hoje ? 'hoje' : DIA_SEMANA[alvo.sem], doDia = [], outros = [];
  for (const x of itens || []) (noFuso(new Date(quandoDe(x))).dia === alvo.dia ? doDia : outros).push(x);
  const li = comDia => x => `<li><time>${esc((comDia ? dataBR(noFuso(new Date(quandoDe(x))).dia) + ' ' : '') + hora(quandoDe(x)))}</time><span>${linhaDe(x)}</span></li>`;
  return sec('Fila para ' + nome, doDia.length ? '<ul class="itens">' + doDia.map(li(false)).join('') + '</ul>' : vazio(semNada || 'Nada programado para ' + nome + ' ainda. A fila aparece aqui assim que o motor montar.'), dataBR(alvo.dia)) +
    (outros.length ? sec('Programados em outros dias', '<ul class="itens largos">' + outros.map(li(true)).join('') + '</ul>') : '');
}
function chavesDe(f, c) { const l = [f.chave, ...f.outras].filter(Boolean); return l.length ? sec('Interruptores', l.map(k => linhaChave(k, c)).join('')) : ''; }

const GAVETAS = {
  atendente(c) {
    const ind = c.ind || {}, dp = ind.donoPedido, tr = c.triagem, tipos = Object.entries(ind.pendenciasPorTipo || {}).sort((a, b) => b[1] - a[1]);
    const robos = c.robos.map(r => `<div class="lin"><span>${esc(r.nome)}</span><b><span class="sit s-${r.nivel === 3 ? 'trabalhando' : r.nivel === 0 ? 'pausa' : 'falha'}">${r.nivel === 3 ? 'conectado' : r.nivel === 0 ? 'desligado' : 'sem sinal'}</span></b><small>${esc([r.nivel ? 'no ' + r.onde.toLowerCase() : '', r.nivel === 3 ? r.motivo : '', r.atendidos != null && r.nivel === 3 ? conta(r.atendidos, 'atendimento hoje', 'atendimentos hoje') : '', r.naoLidas ? conta(r.naoLidas, 'não lida', 'não lidas') : ''].filter(Boolean).join(', '))}${r.nivel >= 2 && r.onde === 'Servidor' && r.id ? ` <button type="button" class="botao secundario pequeno" style="margin-top:6px" data-reinicia="${esc(r.id)}" data-nome="${esc(r.nome)}">Reiniciar</button>` : ''}</small></div>`).join('');
    return sec('Fila de atendimento', ind.pendenciasAbertas != null ? lin('Pendências para uma pessoa resolver (7 dias)', inteiro(ind.pendenciasAbertas)) + tipos.slice(0, 7).map(([k, v]) => lin(PENDENCIA[k] || humano(k), inteiro(v))).join('') + nota('Fora da conta: ' + inteiro(ind.pendenciasAtualizarContato || 0) + ' de atualizar contato e o acúmulo antigo.') : vazio('Sem dado da fila.')) +
      sec('Na fila dos robôs', ind.filas ? lin('Ofertas de pós-quitação', inteiro(ind.filas.posQuitacao || 0)) + lin('Perguntas de nova data', inteiro(ind.filas.perguntaData || 0)) : '') +
      sec('Pedidos de compra sem atendimento do vendedor', dp ? lin('Sem atendimento há mais de 3 h', inteiro(dp.semAtender3h || 0), dp.semAtender3h ? 'O mais antigo espera há ' + dp.maisAntigoNovoH + ' h.' : '') + lin('Abertos há mais de 36 h', inteiro(dp.antigos || 0)) : '') +
      sec('Triagem do financeiro', tr ? lin('Casos abertos', inteiro(tr.abertos || 0)) + Object.entries(tr.porCategoria || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => lin(frase(humano(k)), inteiro(v))).join('') : '') +
      sec('Números de WhatsApp', robos || vazio('Sem dado dos números.')) + chavesDe(this.f, c) + sec('Regras ativas', regras(this.f.regras));
  },
  credito(c) {
    const cr = c.cr, t = pega(cr, 'funil.total', {}), ex = cr.excecoes || [], rec = cr.recentes || [];
    const cartoes = ex.map(x => { const k = 'credito:' + x.leadId, ja = E.enviadas[k];
      return `<div class="cartao"><h4>${esc(x.nome)} <small>${esc([x.cidade, x.origem && 'origem ' + origem(x.origem)].filter(Boolean).join(', '))}</small></h4>${(x.linhas || []).map(l => `<p>${esc(l)}</p>`).join('')}<p class="porque"><b>Por que veio para você:</b> ${esc((x.motivos || []).join('; ') || 'sem motivo registrado')}</p>` +
        (ja ? `<p class="faixa-ok">${esc(ja.txt)}</p>` : `<div class="acoes"><button type="button" class="botao pequeno" data-credito="aprovar" data-lead="${esc(x.leadId)}" data-nome="${esc(x.nome)}">Aprovar</button><button type="button" class="botao secundario pequeno" data-credito="recusar" data-lead="${esc(x.leadId)}" data-nome="${esc(x.nome)}">Recusar</button></div>`) + '</div>'; }).join('');
    return sec('Esperando a sua decisão', ex.length ? cartoes : vazio('Nenhum cadastro esperando decisão.'), ex.length ? String(ex.length) : '') +
      sec('Na fila do analista', cr.funil ? lin('Aguardando dados ou comprovante do cliente', inteiro(t.aguardando || 0)) + lin('Pararam no primeiro passo do cadastro', inteiro(t.parciais || 0)) : '') +
      sec('Histórico até agora', cr.funil ? lin('Cadastros recebidos', inteiro(t.leads || 0)) + lin('Aprovados', inteiro(t.aprovados || 0)) + lin('Reprovados', inteiro(t.reprovados || 0)) + lin('Vieram para revisão', inteiro(t.excecoes || 0)) : vazio('Sem dado do funil.')) +
      sec('Últimas análises', rec.length ? '<ul class="itens soltos">' + rec.map(x => `<li><b>${esc(x.nome)}</b> ${esc(x.cidade || '')}<small>${esc(x.desfecho || x.rotulo || x.status || '')}</small></li>`).join('') + '</ul>' : '') +
      sec('Regras ativas', regras(this.f.regras));
  },
  vip(c) {
    const v = c.cr.indicacaoVip; if (!v) return vazio('O servidor ainda não publicou o estado do Especialista VIP.');
    const t = v.totais || {}, mot = Object.entries(v.motivosRecusa || {});
    return cicloHtml(v.ultimoCiclo) + filaHtml(pega(v, 'convites.proximos', []), x => x.agendadoEm, x => `${esc(x.nome)}<small>${esc(x.cidade || '')}</small>`) + esperaHtml(pega(v, 'convites.espera', null)) +
      sec('Histórico até agora', lin('Convites na fila', inteiro(pega(v, 'convites.agendados', 0))) + lin('Convites enviados', inteiro(pega(v, 'convites.enviados', 0))) + lin('Indicações recebidas', inteiro(t.recebidas || 0)) + lin('Aprovadas', inteiro(t.aprovadas || 0)) + lin('Recusadas', inteiro(t.recusadas || 0), mot.length ? 'Trava antifraude: ' + mot.map(([k, n]) => humano(k) + ' (' + n + ')').join(', ') + '.' : '')) +
      sec('Bônus', lin('Por amigo aprovado', reais(v.bonusPorIndicado)) + lin('Pendentes de entrega', reais(t.pendente)) + lin('Disponíveis', reais(t.disponivel)) + lin('Reservados', reais(t.reservado)) + lin('Já usados', reais(t.usado))) +
      sec('Padrinhos que mais indicam', (v.ranking || []).length ? '<ul class="itens soltos">' + v.ranking.slice(0, 8).map((p, i) => `<li><b>${i + 1}. ${esc(p.nome)}</b><small>${conta(p.recebidas || 0, 'recebida', 'recebidas')}, ${conta(p.aprovadas || 0, 'aprovada', 'aprovadas')}, bônus disponível ${reais(p.disponivel)}</small></li>`).join('') + '</ul>' : vazio('Ainda não há indicações.')) +
      chavesDe(this.f, c) + sec('Regras ativas', regras(this.f.regras));
  },
  recuperador(c) {
    const r = c.cr.recompra; if (!r) return vazio('O servidor ainda não publicou o estado do Recuperador de Base.');
    const el = r.elegiveis, ign = el ? Object.entries(el.ignorados || {}).sort((a, b) => b[1] - a[1]).slice(0, 6) : [], rec = r.reconvertidos || {};
    return cicloHtml(r.ultimoCiclo) + filaHtml([...pega(r, 'hoje.fila', []).filter(x => x.status === 'agendado'), ...pega(r, 'renovacoes.proximas', []).map(x => ({ ...x, renovacao: true }))], x => x.agendadoEm, x => `${esc(x.nome)}<small>${esc([x.cidade, x.rota && 'rota ' + x.rota, x.renovacao && 'renovação'].filter(Boolean).join(', '))}</small>`) +
      sec('Hoje', lin('Reativações enviadas', inteiro(pega(r, 'hoje.enviados', 0)) + ' de ' + inteiro(pega(r, 'hoje.limite', 0))) + lin('Reativações programadas', inteiro(pega(r, 'hoje.programados', 0))) + lin('Renovações agendadas', inteiro(pega(r, 'renovacoes.agendadas', 0))) + lin('Renovações enviadas', inteiro(pega(r, 'renovacoes.enviadas', 0)))) +
      sec('Histórico até agora', lin('Pedidos reconvertidos', inteiro(rec.total || 0), 'Pela renovação rápida: ' + (rec.pelaRenovacaoRapida || []).length + '. Por resposta no WhatsApp: ' + (rec.porRespostaNoWhatsApp || []).length + '.')) +
      sec('Quem pode ser chamado', el ? lin('Bons pagadores elegíveis', inteiro(el.total) + ' de ' + inteiro(el.totalBase)) + ign.map(([k, n]) => lin('Fora: ' + humano(k), inteiro(n))).join('') : vazio('Ainda sem varredura da base.')) +
      chavesDe(this.f, c) + sec('Regras ativas', regras(this.f.regras));
  },
  cobrador(c) {
    const g = c.cr.regua; if (!g) return vazio('O servidor ainda não publicou o estado do Cobrador Preventivo.');
    const a = g.agendados || {}, sc = g.carteira || {};
    return cicloHtml(g.ultimoCiclo) + filaHtml(g.proximos || [], x => x.agendadoEm, x => `${esc(x.nome)} · ${reais(x.valor)}<small>${esc(humano(x.faixa).replace('d menos 3', '3 dias antes').replace('d mais 3', '3 dias depois').replace('d0', 'no dia'))}, vence em ${esc(dataBR(x.vencimento))}</small>`) + esperaHtml(g.espera) +
      sec('Lembretes na fila', lin('3 dias antes', inteiro(a.d_menos_3 || 0)) + lin('No dia do vencimento', inteiro(a.d0 || 0)) + lin('3 dias depois', inteiro(a.d_mais_3 || 0)) + lin('Enviados hoje', inteiro(g.enviadosHoje || 0) + ' de ' + inteiro(g.limiteDiario || 0)) + lin('Enviados até agora', inteiro(g.enviados || 0))) +
      sec('Carteira do site', lin('Em aberto', reais(sc.abertoTotal)) + lin('A vencer em 7 dias', reais(sc.aVencer7d)) + lin('Vencido', reais(sc.vencido), (+sc.inadimplenciaPct || 0).toLocaleString('pt-BR') + '% do aberto, em ' + conta(sc.inadimplentes || 0, 'pedido', 'pedidos') + '.') + lin('Parcelas pagas em dia', inteiro(sc.pagasEmDia || 0)) + lin('Parcelas pagas com atraso', inteiro(sc.pagasComAtraso || 0))) +
      chavesDe(this.f, c) +
      sec('Rodada de cobrança da base', '<p class="nota" style="margin-top:0">Dispara agora a rodada das 12h15 pelo PC. De segunda a sábado, das 12h às 17h, no máximo uma vez a cada 3 h. Só sai cliente que passar na conferência da ficha.</p><div style="margin-top:10px"><button type="button" class="botao secundario pequeno" data-cobranca>Disparar a rodada de cobrança</button></div>') +
      sec('Regras ativas', regras(this.f.regras));
  },
  secretario(c) {
    const b = pega(c.fin, 'boletim', null); if (!b) return vazio('O servidor ainda não publicou o estado do Secretário dos Vendedores.');
    const grupos = Object.entries(b.porGrupo || {}), hj = b.hoje || {}, prox = b.proximo;
    return cicloHtml(b.ultimoCiclo) +
      sec('Fila para o próximo boletim', (prox ? lin('Sai ' + (prox.dia === noFuso().dia ? 'hoje' : DIA_SEMANA[noFuso(new Date(prox.dia + 'T12:00:00-03:00')).sem]) + ' às ' + prox.hora, inteiro(b.aguardando || 0) + ' ' + plural(b.aguardando || 0, 'recado', 'recados')) : '') + grupos.map(([g, n]) => lin(g, inteiro(n))).join('') || vazio('Nenhum recado esperando.'), prox ? dataBR(prox.dia) : '') +
      sec('Hoje', lin('Boletins montados', inteiro(hj.boletins || 0)) + lin('Recados agrupados', inteiro(hj.recados || 0)) + lin('Urgentes que saíram na hora', inteiro(hj.urgentes || 0))) +
      sec('Últimos boletins', (b.ultimos || []).length ? '<ul class="itens">' + b.ultimos.map(x => `<li><i>${esc(dataBR(x.dia))}</i><span>${esc(x.grupo || '')} ${esc(x.turno || '')}<small>${conta(x.n || 0, 'recado', 'recados')}, ${esc(humano(x.status))}</small></span></li>`).join('') + '</ul>' : vazio('Nenhum boletim ainda.')) +
      chavesDe(this.f, c) + sec('Regras ativas', regras(this.f.regras) + nota('Horários: ' + (b.horarios || []).join(', ') + '. Sai na hora: ' + ((b.imediatos || []).map(humano).join(', ') || 'nada') + '.'));
  },
  caixa(c) {
    const cx = c.cr.caixa, px = caixaPix(c), bx = c.cr.baixaPix || {}; if (!cx) return vazio('Sem dado de caixa.');
    return sec('Pix de hoje', (px && px.estado !== 'sem' ? lin('Confirmado pelo banco', reais(px.total), conta(px.n, 'Pix', 'Pix') + ', leitura das ' + px.hora + '.') : lin('Confirmado pelo banco', '–', pega(px, 'motivo', 'Sem leitura do banco hoje.'))) +
        lin('Parcelas do site baixadas', reais(pega(cx, 'pixHoje.site', 0)), conta(pega(cx, 'pixHoje.baixasSite', 0), 'parcela', 'parcelas') + '.') + lin('Baixas lançadas no sistema', reais(pega(cx, 'pixHoje.lancadoNoSistema.valor', 0)), conta(pega(cx, 'pixHoje.lancadoNoSistema.n', 0), 'baixa', 'baixas') + '.') + lin('Baixa automática por Pix', reais(bx.valorBaixadoHoje), conta(bx.baixasHoje || 0, 'parcela', 'parcelas') + '.')) +
      sec('Bônus VIP na carteira', lin('Disponíveis', reais(cx.bonusDisponivel)) + lin('Pendentes de entrega', reais(cx.bonusPendente))) +
      sec('De onde vem', nota('É o que o banco confirmou hoje, lido pela conciliação do servidor. Sem leitura, o valor fica vazio: zero só aparece quando o banco foi lido e não entrou nada.')) +
      sec('Para que serve', nota('Saber, sem abrir o banco, quanto já entrou hoje e se a leitura está em dia.'));
  },
  previsao(c) {
    const p = pega(c.cr, 'caixa.previsao7d', null); if (!p) return vazio('Sem dado de previsão.');
    return sec('A vencer nos próximos 7 dias', lin('Pedidos do site', reais(p.site)) + lin('Base de clientes', reais(p.base)) + lin('Total', reais(p.total))) +
      sec('De onde vem', nota('Parcelas em aberto com vencimento de hoje até 7 dias: as do site vêm da carteira do site, as da base vêm do relatório de cobrança.')) +
      sec('Para que serve', nota('Enxergar o dinheiro esperado na semana. É o que vence, não uma promessa de que vai entrar.'));
  },
  atraso(c) {
    const i = pega(c.cr, 'caixa.inadimplencia', null); if (!i) return vazio('Sem dado de atraso.');
    const o = i.operacional || {}, h = i.historico || {};
    return (i.baseLida === false ? '<p class="faixa-erro">A base não foi lida: os números da base estão incompletos.</p>' : '') +
      sec('Atraso recuperável, de 1 a 90 dias', lin('Pedidos do site', reais(o.site)) + lin('Base de clientes', reais(o.base)) + lin('Total', reais(o.total))) +
      sec('Histórico antigo, mais de 90 dias', lin('Pedidos do site', reais(h.site)) + lin('Base de clientes', reais(h.base)) + lin('Total', reais(h.total))) +
      sec('De onde vem', nota('Saldo em aberto com data vencida, separado pela idade do atraso.')) +
      sec('Para que serve', nota('O atraso de até 90 dias é o que a operação ainda recupera no dia a dia. O histórico antigo fica separado para não esconder o que é de agora.'));
  },
  receita(c) {
    const r = receita(c); if (!r) return vazio('Sem dado de vendas do mês.');
    const m = r.roi.mes, e = m.empresa || {}, s = m.sistema || {}, p = m.participacao || {};
    return sec('O que a equipe digital foi buscar em ' + r.mes, lin('Indicação VIP', reais(r.indicacao)) + lin('Reativação', reais(r.reativacao)) + lin('Renovação de quem quitou', reais(r.renovacao)) + lin('Total', reais(r.total), conta(r.cestas, 'cesta', 'cestas') + '.')) +
      sec('Outras vendas com toque do robô', lin('Depois de atendimento ou de lembrete', reais(r.outras))) +
      sec('Empresa e sistema no mês', `<table class="tabela"><thead><tr><th></th><th>Empresa</th><th>Sistema</th></tr></thead><tbody><tr><td>Cestas</td><td>${inteiro(e.cestas)}</td><td>${inteiro(s.cestas)}</td></tr><tr><td>Vendido</td><td>${reais(e.vendido)}</td><td>${reais(s.vendido)}</td></tr><tr><td>Recebido</td><td>${reais(e.recebido)}</td><td>${reais(s.recebido)}</td></tr><tr><td>Conversão</td><td>${pct(e.conversao)}</td><td>${pct(s.conversao)}</td></tr></tbody></table>` + nota('O sistema responde por ' + pct(p.vendido) + ' das vendas e ' + pct(p.recebido) + ' dos recebimentos do mês.')) +
      sec('De onde vem', nota('Venda lançada até ' + r.roi.janelaDias + ' dias depois de um contato do robô com o mesmo cliente. É proximidade, não prova de causa.' + (r.roi.dadosVendasAte && r.roi.dadosVendasAte < r.roi.hoje ? ' Vendas lançadas até ' + dataBR(r.roi.dadosVendasAte) + '.' : ''))) +
      sec('Para que serve', nota('Comparar um mês com o outro e ver se a equipe digital está trazendo venda nova.'));
  },
  captacao(c) {
    const f = c.cr.funil; if (!f) return vazio('Sem dado do funil.');
    const t = f.total || {};
    return sec('Cadastros por origem', (f.porOrigem || []).length ? `<table class="tabela"><thead><tr><th>Origem</th><th>Cadastros</th><th>Aprovados</th><th>Reprovados</th></tr></thead><tbody>${f.porOrigem.map(o => `<tr><td>${esc(origem(o.origem))}</td><td>${inteiro(o.leads)}</td><td>${inteiro(o.aprovados)}</td><td>${inteiro(o.reprovados)}</td></tr>`).join('')}</tbody></table>` : vazio('Nenhum cadastro ainda.')) +
      sec('Onde cada um parou', lin('Pararam no primeiro passo', inteiro(t.parciais || 0)) + lin('Aguardando dados ou comprovante', inteiro(t.aguardando || 0)) + lin('Vieram para a sua revisão', inteiro(t.excecoes || 0)));
  },
  entrega(c) {
    const fila = c.cr.pedidos; if (!Array.isArray(fila)) return vazio('Sem dado da fila de rota.');
    if (!fila.length) return vazio('Nenhum pedido aguardando entrega.');
    return fila.map(g => sec('Rota ' + (g.rota || 'sem rota') + (g.cidade ? ', ' + g.cidade : ''), (g.pedidos || []).map(p => { const k = 'entrega:' + p.pedidoId, ja = E.enviadas[k];
      return `<div class="cartao"><h4>${esc(p.nome)} <small>${esc(p.bairro || '')}${p.semCep ? ' (sem CEP)' : ''}</small></h4><p>${esc(p.cesta || '')}. Parcelas: ${(p.parcelas || []).map(x => reais(x.valor) + ' em ' + esc(dataBR(x.vencimento))).join(' e ')}.</p><p>Pedido ${esc(p.pedidoId)} · código VIP ${esc(p.codigoVip || '–')}${p.selo ? ' · ' + esc(p.selo) : ''}${p.origem ? ' · ' + esc(p.origem) : ''}${p.avisoRota ? ' · aviso à rota: ' + esc(humano(p.avisoRota)) : ''}</p>` +
        (ja ? `<p class="faixa-ok">${esc(ja.txt)}</p>` : `<div class="acoes"><button type="button" class="botao pequeno" data-entrega="${esc(p.pedidoId)}" data-nome="${esc(p.nome)}">Confirmar entrega</button></div>`) + '</div>'; }).join(''), String((g.pedidos || []).length))).join('');
  },
  quitacao(c) {
    const sc = pega(c.cr, 'regua.carteira', null), bx = c.cr.baixaPix || {}, rev = bx.revisao || [], ult = bx.ultimas || [];
    return (bx.ultimoCiclo ? cicloHtml(bx.ultimoCiclo) : '') +
      sec('Pix para revisão', rev.length ? '<ul class="itens soltos">' + rev.map(x => `<li><b>${esc(x.pagador || '')}</b> · ${reais(x.valor)}<small>${esc(dataBR(x.data))}, ${esc(humano(x.motivo))}${x.pedidoId ? ', pedido ' + esc(x.pedidoId) : ''}</small></li>`).join('') + '</ul>' + nota('Confira no banco e dê a baixa pelo caminho de sempre: esta tela ainda não grava baixa.') : vazio('Nenhum Pix esperando revisão.'), rev.length ? String(rev.length) : '') +
      sec('Carteira do site', sc ? lin('Pedidos pagando', inteiro(sc.pedidosAtivos || 0)) + lin('Já quitados', inteiro(sc.quitados || 0)) + lin('Aguardando entrega', inteiro(sc.aguardandoEntrega || 0)) + lin('Em aberto', reais(sc.abertoTotal)) + lin('Vencido', reais(sc.vencido), 'Até 5 dias: ' + reais(sc.vencidoAte5d) + '. Acima de 5 dias: ' + reais(sc.vencidoMais5d) + '.') : vazio('Sem dado da carteira.')) +
      sec('Baixas automáticas por Pix', lin('Hoje', reais(bx.valorBaixadoHoje), conta(bx.baixasHoje || 0, 'parcela', 'parcelas') + '.') + (ult.length ? '<ul class="itens soltos">' + ult.map(x => `<li>${esc(x.pedidoId || '')}, parcela ${esc(x.parcela)} · ${reais(x.valor)}<small>${esc(dataBR(x.data))}${x.emDia ? ', em dia' : ', com atraso'}${x.quitado ? ', quitou o pedido' : ''}</small></li>`).join('') + '</ul>' : ''));
  },
  avisos(c) {
    const a = pega(c.fin, 'gestor', null); if (!a) return vazio('Sem registro de avisos.');
    return nota(a.regra || '') + sec('Hoje', lin('Foram para o seu WhatsApp', inteiro(pega(a, 'hoje.whatsapp', 0))) + lin('Ficaram só aqui', inteiro(pega(a, 'hoje.silenciosos', 0)))) +
      sec('Últimos avisos', (a.ultimos || []).length ? '<ul class="itens soltos">' + a.ultimos.map(x => `<li><b>${esc(humano(x.tipo))}</b> <small style="display:inline">${esc(quando(x.em))}${x.whatsapp ? ', foi para o WhatsApp' : ''}${x.origem ? ', ' + esc(x.origem) : ''}</small><small>${esc(x.texto)}</small></li>`).join('') + '</ul>' : vazio('Nenhum aviso registrado ainda.'));
  },
};
const TITULOS = { caixa: ['Caixa Pix hoje', 'O que o banco confirmou e o que já foi baixado.'], previsao: ['Previsão para 7 dias', 'Parcelas que vencem de hoje a uma semana.'], atraso: ['Inadimplência em duas camadas', 'O que ainda se recupera, separado do histórico antigo.'], receita: ['Receita da equipe digital', 'Vendas do mês ligadas ao trabalho dos robôs.'], captacao: ['Captação', 'Cadastros que chegaram pelo site e pelo link VIP.'], entrega: ['Entrega na rota', 'Pedidos aprovados esperando a entrega.'], quitacao: ['Quitação', 'Pedidos do site pagando e os Pix que entraram.'], avisos: ['Avisos do dia', 'O que o sistema registrou sem incomodar o seu WhatsApp.'] };
function pintaGaveta(c = contexto()) {
  const id = E.gaveta, f = EQUIPE.find(x => x.id === id), corpo = $('gaveta-corpo');
  if (corpo.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) return;
  let cabeca, html;
  if (f) { const s = situacao(f, c), e = erroCiclo(f, c);
    cabeca = `<h2 id="gaveta-titulo">${esc(f.cargo)}</h2><p>${esc(f.faz)}</p><span class="sit s-${s.cod}">${esc(s.txt)}</span>`;
    html = !c.admin ? vazio('Disponível só para o Gestor.') : (GAVETAS[id] ? GAVETAS[id].call({ f }, c) : '');
    if (e && c.admin && !CICLO_DE[id]) html = `<p class="faixa-erro">${esc(e)}</p>` + html;
  } else { const t = TITULOS[id] || [humano(id), ''];
    cabeca = `<h2 id="gaveta-titulo">${esc(t[0])}</h2><p>${esc(t[1])}</p>`;
    html = c.admin && GAVETAS[id] ? GAVETAS[id].call({}, c) : vazio('Disponível só para o Gestor.'); }
  const rolagem = corpo.scrollTop; poe($('gaveta-cabeca'), cabeca); poe(corpo, html); corpo.scrollTop = rolagem;
}
function abreGaveta(id) { if (!E.g.admin) return; E.gaveta = id; $('gaveta-corpo').__html = null; pintaGaveta(); const d = $('gaveta'); if (!d.open) { d.showModal(); $('gaveta-corpo').scrollTop = 0; } }
function fecha(d) { if (d && d.open) d.close(); }
function limpaGaveta() { E.gaveta = null; for (const id of ['gaveta-cabeca', 'gaveta-corpo']) { const el = $(id); el.innerHTML = ''; el.__html = ''; } }   // fechou ou saiu: nada do detalhe fica guardado na página

/* ---------------- ações do Gestor ---------------- */
let avisoRelogio = null;
function avisa(texto, tipo = '') { const el = $('aviso'); el.textContent = texto; el.className = 'aviso-flutuante' + (tipo ? ' ' + tipo : ''); el.hidden = false; clearTimeout(avisoRelogio); avisoRelogio = setTimeout(() => { el.hidden = true; }, 6000); }
function confirma({ titulo, texto, botao, vermelho = false }) {   // toda ordem passa por aqui: nada sai com um toque só
  return new Promise(resolve => {
    const d = $('confirma'), sim = $('confirma-sim'), nao = $('confirma-nao');
    $('confirma-titulo').textContent = titulo; $('confirma-texto').textContent = texto; sim.textContent = botao; sim.classList.toggle('vermelho', vermelho);
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
async function alternaChave(nome, ligar) {
  const c = contexto(), ch = c.chaves.get(nome), info = CHAVES[nome] || { alvo: 'cliente', txt: '' }, titulo = pega(ch, 'titulo', humano(nome));
  if (info.travada) return;
  const ok = await confirma(ligar
    ? { titulo: 'Ligar: ' + titulo + '?', texto: [info.txt, QUEM_RECEBE[info.alvo] || QUEM_RECEBE.cliente].filter(Boolean).join('\n\n'), botao: 'Ligar agora' }
    : { titulo: 'Pausar: ' + titulo + '?', texto: [info.txt, 'Ao pausar, isso para até você ligar de novo.'].filter(Boolean).join('\n\n'), botao: 'Pausar agora' });
  if (!ok) return;
  try { const id = await gravaOrdem('chave', { nome, valor: ligar ? 1 : 0 }); E.espera[nome] = { valor: !!ligar, id, desde: Date.now() }; avisa('Ordem enviada. O interruptor muda quando o servidor confirmar (até 1 minuto).'); }
  catch (e) { avisa('O banco recusou a ordem: ' + ((e && e.message) || 'erro'), 'erro'); }
  await ciclo();
}
function resolveEsperas(c) {   // o interruptor só sai de "aguardando" quando o servidor publica a chave na posição pedida, ou quando a ordem é recusada
  for (const [nome, e] of Object.entries(E.espera)) {
    const o = E.ordens.find(x => x.id === e.id), st = pega(o, 'dados.status', 'pendente'), ch = c.chaves.get(nome);
    if (st === 'recusada' || st === 'expirada') { delete E.espera[nome]; avisa('O servidor não aplicou a ordem: ' + pega(o, 'dados.resultado', st), 'erro'); }
    else if (ch && ch.ligada === e.valor && st === 'feito') delete E.espera[nome];
    else if (Date.now() - e.desde > 4 * 60000) { delete E.espera[nome]; avisa('O servidor ainda não confirmou a ordem. Veja em "Ordens e outros controles".', 'erro'); }
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
  if ((x = b('[data-chave]'))) { ev.stopPropagation(); if (!x.disabled) alternaChave(x.dataset.chave, x.dataset.ligar === '1'); return; }
  if ((x = b('[data-credito]'))) { const d = x.dataset.credito, nome = x.dataset.nome || 'este cadastro';
    await ordem('credito_decidir', { leadId: x.dataset.lead, decisao: d }, d === 'aprovar' ? { titulo: 'Aprovar ' + nome + '?', texto: 'O cliente é avisado da aprovação e o pedido entra na fila da rota.', botao: 'Aprovar' } : { titulo: 'Recusar ' + nome + '?', texto: 'O cliente é avisado de que o cadastro não foi aprovado.', botao: 'Recusar', vermelho: true }, ['credito:' + x.dataset.lead, d === 'aprovar' ? 'Aprovação enviada. O servidor aplica em até 1 minuto.' : 'Recusa enviada. O servidor aplica em até 1 minuto.']); return; }
  if ((x = b('[data-entrega]'))) { await ordem('entrega_confirmar', { pedidoId: x.dataset.entrega }, { titulo: 'Confirmar a entrega de ' + (x.dataset.nome || 'este pedido') + '?', texto: 'As 2 parcelas passam a contar 30 e 60 dias a partir de hoje, e o bônus do padrinho (se houver) fica disponível.', botao: 'Confirmar entrega' }, ['entrega:' + x.dataset.entrega, 'Confirmação enviada. O servidor recalcula as parcelas em até 1 minuto.']); return; }
  if ((x = b('[data-reinicia]'))) { await ordem('reiniciar_robo', { conta: x.dataset.reinicia }, { titulo: 'Reiniciar o número ' + (x.dataset.nome || '') + '?', texto: 'Ele fica alguns minutos sem responder os clientes enquanto volta.', botao: 'Reiniciar', vermelho: true }); return; }
  if ((x = b('[data-cobranca]'))) { await ordem('cobranca_1215', {}, { titulo: 'Disparar a rodada de cobrança agora?', texto: 'Sai cobrança de verdade para os clientes da base que passarem na conferência da ficha.', botao: 'Disparar', vermelho: true }); return; }
  if ((x = b('[data-diretriz]'))) { const campo = $('diretriz'), t = campo ? campo.value.trim() : ''; if (!t) { avisa('Escreva a diretriz antes de registrar.', 'erro'); return; }
    if (await ordem('diretriz', { texto: t }, { titulo: 'Registrar a diretriz?', texto: t, botao: 'Registrar' })) { campo.value = ''; $('controles').__html = null; pinta(); } return; }
  if ((x = b('[data-abre]'))) { abreGaveta(x.dataset.abre); return; }
});
$('botao-entrar').addEventListener('click', () => { if (E.g.admin) sair(); else { $('login-erro').textContent = ''; $('login').showModal(); $('login-email').focus(); } });
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); const erro = $('login-erro'), ok = $('login-ok'), email = $('login-email').value.trim(), senha = $('login-senha').value;
  if (!email || !senha) { erro.textContent = 'Preencha o e-mail e a senha.'; return; }
  ok.disabled = true; erro.textContent = 'Entrando…';
  try { await entrar(email, senha); $('login-senha').value = ''; fecha($('login')); await ciclo(); } catch (e) { erro.textContent = (e && e.message) || 'Não consegui entrar.'; }
  ok.disabled = false;
});
$('gaveta').addEventListener('close', limpaGaveta);
document.addEventListener('visibilitychange', () => { if (!document.hidden) roda(); });

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
window.HQ = { estado: E, pinta, contexto, radar };   // só para depurar no navegador: não guarda nem expõe dado além do que a tela já mostra
inicia();
})();
