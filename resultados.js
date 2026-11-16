/* PAINEL DE RESULTADOS — Aliança, padrão Tabler 1.7.5, tema claro (16/11/2026, branch feat/novo-painel-resultados).
   Painel executivo: quatro indicadores, sem texto explicativo. De onde vem cada um (tudo já publicado pelo servidor, nada novo foi criado):
     1. Vendas por canal (mês)            hq-financeiro: roi.mes (empresa, sistema e porOrigem)
     2. Recuperação de atrasados          hq-financeiro: credito.caixa.inadimplencia e roi.mes.sistema; v2: historico.origem (dinheiro que entrou pela idade da venda)
     3. Resposta e conversão por fluxo    hq-servidor: campanhas (7 dias); hq-financeiro: roi.mes.sistema e credito (indicacaoVip, recompra, funil)
     4. Comparativo mensal e do ano       v2: mes.serieEmpresa, mes.empresa.ritmo e historico.ytd
   Marcação e componentes são os do Tabler (docs.tabler.io). A página não guarda dado nenhum: tudo vem do banco DEPOIS do login do Gestor (papel admin).
   Regra da casa: número sem fonte não aparece. O que o servidor ainda não publica (a semana, quem respondeu no mês) fica com um traço. */
(() => {
'use strict';

const URL_BANCO = window.SUPABASE_URL || '', CHAVE_PUBLICA = window.SUPABASE_ANON_KEY || '';
const BIBLIOTECA_LOGIN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
const CICLO_MS = 5 * 60000, VELHO_MIN = 30, MESES_NA_TABELA = 6;
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CAMPANHAS = [['renovacaoVip', 'Renovação VIP'], ['indique', 'Indique e Ganhe (campanha)'], ['reativacao', 'Reativação comercial']];

const E = { g: { sb: null, admin: false, email: '', conferindo: true, recusa: '' }, fin: null, finEm: null, v2: null, campanhas: null, erro: '', lendo: false, lido: false };

/* ---------------- utilidades ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pega = (o, caminho, pad) => { let x = o; for (const k of caminho.split('.')) { if (x == null) return pad; x = x[k]; } return x == null ? pad : x; };
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const plural = (n, um, varios) => (n === 1 ? um : varios);
const inteiro = v => Math.round(+v || 0).toLocaleString('pt-BR');
const conta = (n, um, varios) => inteiro(n) + ' ' + plural(n, um, varios);
const reais = v => (num(+v) == null ? '–' : 'R$ ' + inteiro(v));   // espaço que não quebra: o valor nunca se separa do R$
const pct = (v, casas = 1) => (num(v) == null ? '–' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas }) + '%');
const comSinal = (v, casas = 0) => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const dataBR = dia => String(dia || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const nomeMes = ym => { const [a, m] = String(ym || '').split('-'); return MES_CURTO[(+m || 1) - 1] + '/' + String(a || '').slice(2); };
const minDesde = iso => { const t = Date.parse(iso); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); };
const variacao = (a, b) => (num(a) != null && b > 0 ? (a - b) / b : null);
const poe = (el, html) => { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } };
const credito = () => { const cr = pega(E.fin, 'credito', null); return Array.isArray(cr) || !cr ? {} : cr; };

/* Componentes do Tabler (o script dele expõe "tabler"). Se a CDN falhar, um dublê mínimo mantém o login usável. */
const pecas = () => window.tabler || window.bootstrap || {};
const modal = el => (pecas().Modal ? pecas().Modal.getOrCreateInstance(el) : { show() { el.style.display = 'block'; el.classList.add('show'); }, hide() { el.classList.remove('show'); el.style.display = ''; } });

/* ---------------- peças de marcação (classes e exemplos da documentação do Tabler) ---------------- */
const icone = caminhos => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="icon ms-0 icon-sm">${caminhos}</svg>`;
const CIMA = icone('<path d="M12 5l0 14" /><path d="M18 11l-6 -6" /><path d="M6 11l6 -6" />'), BAIXO = icone('<path d="M12 5l0 14" /><path d="M18 13l-6 6" /><path d="M6 13l6 6" />'), IGUAL = icone('<path d="M5 12l14 0" />');
function tendencia(delta, texto) {   // tendência do Tabler: verde sobe, vermelho desce, cinza quando não mudou
  if (num(delta) == null) return '';
  const parado = Math.abs(delta) < 0.005;
  return `<span class="${parado ? 'text-secondary' : delta > 0 ? 'text-green' : 'text-red'} d-inline-flex align-items-center lh-1">${esc(texto)} ${parado ? IGUAL : delta > 0 ? CIMA : BAIXO}</span>`;
}
const bloco = (rotulo, valor, sub, dica = '') => `<div class="col-6 col-lg-3"><div class="card card-sm"${dica ? ` title="${esc(dica)}"` : ''}><div class="card-body"><div class="subheader">${esc(rotulo)}</div><div class="valor">${valor}</div><div class="sub text-secondary">${sub || '&nbsp;'}</div></div></div></div>`;
const cartao = (titulo, lado, corpo, pe = '') => `<div class="col-lg-6"><div class="card"><div class="card-header"><h3 class="card-title">${esc(titulo)}</h3>${lado ? `<div class="card-actions text-secondary small">${esc(lado)}</div>` : ''}</div>${corpo}${pe ? `<div class="card-footer text-secondary py-2">${esc(pe)}</div>` : ''}</div></div>`;
const tabela = (cab, linhas, pe = '') => `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr>${cab.map((c, i) => `<th class="text-wrap${i ? ' text-end' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody>${pe ? `<tfoot>${pe}</tfoot>` : ''}</table></div>`;   // text-wrap: no celular o título da coluna quebra em duas linhas em vez de criar rolagem lateral
const semDado = t => `<div class="card-body text-secondary">${esc(t)}</div>`;
const traco = '<span class="text-secondary">–</span>';
const estado = (titulo, texto = '', botao = '') => `<div class="empty"><p class="empty-title">${esc(titulo)}</p>${texto ? `<p class="empty-subtitle text-secondary">${esc(texto)}</p>` : ''}${botao ? `<div class="empty-action">${botao}</div>` : ''}</div>`;

/* ---------------- login e leitura ---------------- */
function temSessaoGuardada() { try { return !!localStorage.getItem('sb-' + new URL(URL_BANCO).hostname.split('.')[0] + '-auth-token'); } catch (e) { return false; } }
function carregaBiblioteca() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((ok, falha) => { const s = document.createElement('script'); s.src = BIBLIOTECA_LOGIN; s.onload = () => ok(); s.onerror = () => falha(new Error('não consegui carregar o login (sem internet?)')); document.head.appendChild(s); });
}
async function cliente() { if (!E.g.sb) { await carregaBiblioteca(); E.g.sb = window.supabase.createClient(URL_BANCO, CHAVE_PUBLICA); } return E.g.sb; }
async function confereGestor({ sairSeNaoFor = false } = {}) {   // só entra quem tem sessão E papel admin no banco
  const sb = await cliente(), { data } = await sb.auth.getSession();
  if (!data || !data.session) { E.g.admin = false; E.g.email = ''; return false; }
  const r = await sb.from('al_papeis').select('papel').limit(1);
  E.g.admin = !r.error && !!r.data && !!r.data[0] && r.data[0].papel === 'admin';
  E.g.email = E.g.admin ? (data.session.user.email || '') : '';
  E.g.recusa = E.g.admin ? '' : 'Esta conta não é de Gestor.';
  if (!E.g.admin && sairSeNaoFor) await sb.auth.signOut();   // só desfaz um login feito aqui
  return E.g.admin;
}
async function ler() {   // três leituras pequenas: do Painel v2 vêm só a série mensal, o ritmo, o ano e a idade do dinheiro; do servidor, só as contagens das campanhas
  const sb = E.g.sb;
  const [f, v, p] = await Promise.all([
    sb.from('painel_dados').select('dados,atualizado_em').eq('id', 'hq-financeiro').maybeSingle(),
    sb.from('painel_dados').select('serie:dados->mes->serieEmpresa,ritmo:dados->mes->empresa->ritmo,dia:dados->mes->diaAtual,origem:dados->historico->origem,ytd:dados->historico->ytd').eq('id', 'v2').maybeSingle(),
    sb.from('painel_dados').select('id,campanhas:dados->campanhas').in('id', ['hq-servidor', 'hq-pc'])]);
  if (f.error) throw new Error(f.error.message);
  E.fin = pega(f, 'data.dados', null); E.finEm = pega(f, 'data.atualizado_em', null);
  E.v2 = v && !v.error && v.data ? v.data : null;
  const linhas = (p && !p.error && p.data) || [], de = id => pega(linhas.find(x => x.id === id), 'campanhas', null);
  E.campanhas = de('hq-servidor') || de('hq-pc');
}
async function ciclo() {
  if (!E.g.admin || E.lendo) return; E.lendo = true; pintaTopo();
  try { await ler(); E.erro = ''; } catch (e) { E.erro = (e && e.message) || 'falhou'; }
  E.lendo = false; E.lido = true; pinta();
}

/* ---------------- tela ---------------- */
function pintaTopo() {
  const b = $('botao-entrar'), a = $('botao-atualizar');
  b.textContent = E.g.admin ? 'Sair' : 'Entrar'; b.disabled = E.g.conferindo; b.className = E.g.admin ? 'btn' : 'btn btn-primary';
  a.hidden = !E.g.admin; a.disabled = E.lendo; a.textContent = E.lendo ? 'Lendo' : 'Atualizar';
}
function pintaRodape() {
  poe($('rodape'), '<div class="row text-center align-items-center flex-row-reverse"><div class="col-lg-auto ms-lg-auto"><ul class="list-inline list-inline-dots mb-0"><li class="list-inline-item"><a class="link-secondary" href="painel-completo.html">Painel completo</a></li><li class="list-inline-item"><a class="link-secondary" href="hq/">Aliança HQ</a></li><li class="list-inline-item"><a class="link-secondary" href="cobranca/">Cobrança diária</a></li></ul></div>' +
    `<div class="col-12 col-lg-auto mt-3 mt-lg-0 text-secondary">${esc(E.g.admin ? E.g.email : '')}</div></div>`);
}
function pinta() {
  pintaTopo(); pintaRodape();
  const tela = $('tela');
  if (E.g.conferindo) return poe(tela, estado('Conferindo o acesso'));
  if (!E.g.admin) return poe(tela, estado('Resultados', E.g.recusa || 'Só para o Gestor.', '<button type="button" class="btn btn-primary" data-entrar>Entrar</button>'));
  if (!E.lido) return poe(tela, estado('Lendo os resultados'));
  if (!E.fin) return poe(tela, estado('Sem resultados', E.erro ? 'Não consegui ler agora: ' + E.erro : 'O servidor ainda não publicou os números do mês.', '<button type="button" class="btn" data-atualizar>Tentar de novo</button>'));
  poe(tela, cabeca() + '<div class="row row-deck row-cards">' + indicadores() + canais() + fluxos() + atrasados() + comparativo() + '</div>');
}
function cabeca() {
  const roi = pega(E.fin, 'roi', {}), hoje = String(roi.hoje || ''), ate = roi.dadosVendasAte || '', velho = minDesde(E.finEm);
  const mes = hoje ? MES[(+hoje.slice(5, 7) || 1) - 1] + ' de ' + hoje.slice(0, 4) : '';
  return `<div class="page-header d-print-none mt-0 mb-3"><div class="row g-2 align-items-center"><div class="col"><div class="page-pretitle">${esc(mes)}</div><h2 class="page-title">Resultados</h2></div>` +
    `<div class="col-auto ms-auto text-secondary small">${esc(ate && hoje && ate < hoje ? 'vendas até ' + dataBR(ate) : hoje ? 'até ' + dataBR(hoje) : '')}</div></div></div>` +
    (E.erro ? `<div class="alert alert-danger" role="alert">Não consegui atualizar agora (${esc(E.erro)}). Estes são os últimos números lidos.</div>` : '') +
    (velho != null && velho > VELHO_MIN ? `<div class="alert alert-warning" role="alert">Números publicados há ${velho < 120 ? velho + ' min' : Math.round(velho / 60) + ' h'}.</div>` : '');
}
function indicadores() {   // o resumo do comparativo: mês, ritmo do recebimento, atraso e ano
  const m = pega(E.fin, 'roi.mes', null), e = pega(m, 'empresa', {}), r = pega(E.v2, 'ritmo', null), y = pega(E.v2, 'ytd', null);
  const io = pega(E.fin, 'credito.caixa.inadimplencia.operacional', null), ih = pega(E.fin, 'credito.caixa.inadimplencia.historico', null);
  const dif = r && num(r.pctIdeal) != null && num(r.pctNormalNoDia) != null ? r.pctIdeal - r.pctNormalNoDia : null;
  return bloco('Vendido no mês', m ? reais(e.vendido) : '–', m ? conta(e.cestas || 0, 'cesta', 'cestas') : '') +
    bloco('Recebido no mês', m ? reais(e.recebido) : '–', r && num(r.pctIdeal) != null ? Math.round(r.pctIdeal) + '% da meta ' + tendencia(dif, comSinal(Math.round(dif)) + ' pts') : '', 'Recebido até hoje em % da meta do mês. A seta compara com o normal para este dia nos últimos 12 meses.') +
    bloco('Atraso até 90 dias', io ? reais(io.total) : '–', ih ? 'mais de 90 dias: ' + reais(ih.total) : '') +
    bloco('Ano contra ano', y && num(y.variacao) != null ? tendencia(y.variacao, comSinal(y.variacao, 1) + '%') : '–', y ? 'jan a ' + MES_CURTO[(y.meses || 1) - 1] + ': ' + reais(y.vendido) : '', 'Vendido nos meses fechados deste ano contra os mesmos meses do ano passado.');
}
function canais() {   // 1. vendas fechadas por canal, no mês
  const m = pega(E.fin, 'roi.mes', null); if (!m) return cartao('Vendas por canal', '', semDado('O servidor ainda não publicou as vendas do mês.'));
  const e = m.empresa || {}, s = m.sistema || {}, total = e.vendido || 0;
  const linhas = [...(m.porOrigem || []).map(o => ({ nome: o.nome, cestas: o.cestas || 0, vendido: o.vendido || 0 })),
    { nome: 'Vendedores, sem contato digital', cestas: Math.max(0, (e.cestas || 0) - (s.cestas || 0)), vendido: Math.max(0, total - (s.vendido || 0)) }].sort((a, b) => b.vendido - a.vendido);
  const linha = l => { const w = total > 0 ? Math.round((l.vendido / total) * 100) : 0;
    return `<tr><td><div>${esc(l.nome)}</div><div class="progress progress-sm mt-1"><div class="progress-bar" style="width: ${w}%" role="progressbar" aria-valuenow="${w}" aria-valuemin="0" aria-valuemax="100" aria-label="${w}% das vendas"></div></div></td><td class="text-end">${inteiro(l.cestas)}</td><td class="text-end">${reais(l.vendido)}</td><td class="text-end text-secondary">${w}%</td></tr>`; };
  return cartao('Vendas por canal', 'mês', tabela(['Canal', 'Cestas', 'Vendido', '%'], linhas.map(linha).join(''), `<tr class="fw-bold"><td>Empresa</td><td class="text-end">${inteiro(e.cestas)}</td><td class="text-end">${reais(e.vendido)}</td><td class="text-end">100%</td></tr>`));
}
function fluxos() {   // 3. resposta e conversão de cada fluxo dos robôs
  const c = E.campanhas, cr = credito(), s = pega(E.fin, 'roi.mes.sistema', null), l = [];
  if (s && num(s.abordados) != null) l.push({ nome: 'Todos os contatos dos robôs', periodo: 'mês', env: s.abordados, resp: num(s.responderam), conv: num(s.compradores) });
  for (const [k, nome] of CAMPANHAS) { const x = pega(c, k, null); if (x && (x.semana || 0) > 0) l.push({ nome, periodo: '7 dias', env: x.semana, resp: x.interesse || 0, conv: x.conversoes || 0 }); }
  if (cr.indicacaoVip) l.push({ nome: 'Indique e Ganhe VIP', periodo: 'total', env: pega(cr, 'indicacaoVip.convites.enviados', 0), resp: pega(cr, 'indicacaoVip.totais.recebidas', 0), conv: pega(cr, 'indicacaoVip.totais.aprovadas', 0) });
  if (cr.recompra) l.push({ nome: 'Renovação rápida', periodo: 'total', env: pega(cr, 'recompra.renovacoes.enviadas', 0), resp: null, conv: (pega(cr, 'recompra.reconvertidos.pelaRenovacaoRapida', []) || []).length });
  const f = pega(cr, 'funil.total', null); if (f) l.push({ nome: 'Cadastro do site', periodo: 'total', env: f.leads || 0, resp: null, conv: f.aprovados || 0 });
  const cel = (n, env) => (n == null || !(env > 0) ? traco : `${pct(n / env)}<div class="text-secondary small">${inteiro(n)}</div>`);
  return cartao('Resposta e conversão por fluxo', '', l.length
    ? tabela(['Fluxo', 'Resposta', 'Conversão'], l.map(x => `<tr><td><div>${esc(x.nome)}</div><div class="text-secondary small">${conta(x.env, 'enviado', 'enviados')}, ${esc(x.periodo)}</div></td><td class="text-end">${cel(x.resp, x.env)}</td><td class="text-end">${cel(x.conv, x.env)}</td></tr>`).join(''))
    : semDado('O servidor ainda não publicou os fluxos.'));
}
function atrasados() {   // 2. recuperação de atrasados: o que está em aberto, o que entrou depois de lembrete e o que entrou de venda velha
  const io = pega(E.fin, 'credito.caixa.inadimplencia.operacional', null), ih = pega(E.fin, 'credito.caixa.inadimplencia.historico', null), s = pega(E.fin, 'roi.mes.sistema', null);
  const item = (rotulo, valor) => `<div class="datagrid-item"><div class="datagrid-title">${esc(rotulo)}</div><div class="datagrid-content">${valor}</div></div>`;
  const grade = '<div class="card-body"><div class="datagrid">' + item('Em aberto até 90 dias', io ? reais(io.total) : traco) + item('Em aberto há mais de 90 dias', ih ? reais(ih.total) : traco) +
    item('Recebido após lembrete, no mês', s && num(+s.recebido) != null ? reais(s.recebido) + (num(s.recebimentos) != null ? ` <span class="text-secondary">${conta(s.recebimentos, 'parcela', 'parcelas')}</span>` : '') : traco) + '</div></div>';
  const origem = pega(E.v2, 'origem', null), velhas = Array.isArray(origem) ? origem.filter(o => !/at[eé] 60/i.test(String(o.faixa))) : [];   // a faixa de até 60 dias é venda ainda no prazo
  const soma = campo => velhas.reduce((t, o) => t + (+o[campo] || 0), 0);
  return cartao('Recuperação de atrasados', '', grade + (velhas.length
    ? tabela(['Idade da venda', 'Em aberto', 'Entrou em 12 meses'], velhas.map(o => `<tr><td>${esc(o.faixa)}</td><td class="text-end">${reais(o.aberto)}</td><td class="text-end">${reais(o.entrou12m)}</td></tr>`).join(''), `<tr class="fw-bold"><td>Mais de 60 dias</td><td class="text-end">${reais(soma('aberto'))}</td><td class="text-end">${reais(soma('entrou12m'))}</td></tr>`)
    : semDado('Sem leitura do histórico de recebimentos.')));
}
function comparativo() {   // 4. mês contra mês (o mês corrente aparece parcial); a semana o servidor ainda não publica
  const serie = pega(E.v2, 'serie', null), dia = pega(E.v2, 'dia', ''), semana = 'Semana: ainda não publicada pelo servidor.';
  if (!Array.isArray(serie) || serie.length < 2) return cartao('Comparativo mensal', '', semDado('Sem leitura do histórico mensal.'), semana);
  const ult = serie.slice(-(MESES_NA_TABELA + 1)), linhas = [];   // um mês a mais, só para a variação do mais antigo da tabela
  for (let i = ult.length - 1; i >= 1; i--) { const x = ult[i], v = x.parcial ? null : variacao(x.vendido, ult[i - 1].vendido);
    linhas.push(`<tr><td>${esc(nomeMes(x.mes))}${x.parcial ? ` <span class="badge bg-azure-lt">até dia ${esc(dia)}</span>` : ''}</td><td class="text-end">${reais(x.vendido)}${v == null ? '' : `<div class="small">${tendencia(v, comSinal(Math.round(v * 100)) + '%')}</div>`}</td>` +
      `<td class="text-end">${reais(x.recebido)}${num(x.atingimento) != null ? `<div class="text-secondary small">${Math.round(x.atingimento)}% da meta</div>` : ''}</td></tr>`); }
  return cartao('Comparativo mensal', '', tabela(['Mês', 'Vendido', 'Recebido'], linhas.join('')), semana);
}

/* ---------------- ações ---------------- */
async function entrar(email, senha) {
  const sb = await cliente(), { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : 'Não consegui entrar: ' + error.message);
  if (!(await confereGestor({ sairSeNaoFor: true }))) throw new Error('Essa conta não é de Gestor.');
}
async function sair() {
  try { if (E.g.sb) await E.g.sb.auth.signOut(); } catch (e) { /* o estado local é limpo de qualquer jeito */ }
  Object.assign(E, { fin: null, finEm: null, v2: null, campanhas: null, erro: '', lido: false }); E.g.admin = false; E.g.email = ''; E.g.recusa = ''; pinta();   // ao sair, nenhum número fica na página
}
function abreLogin() { $('login-erro').textContent = ''; modal($('login')).show(); }
document.addEventListener('click', ev => {
  const alvo = ev.target.closest ? ev.target : ev.target.parentElement; if (!alvo) return;
  if (alvo.closest('[data-entrar]')) return abreLogin();
  if (alvo.closest('[data-atualizar]')) return ciclo();
});
$('botao-entrar').addEventListener('click', () => (E.g.admin ? sair() : abreLogin()));
$('botao-atualizar').addEventListener('click', ciclo);
$('login').addEventListener('shown.bs.modal', () => $('login-email').focus());
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); const erro = $('login-erro'), ok = $('login-ok'), email = $('login-email').value.trim(), senha = $('login-senha').value;
  if (!email || !senha) { erro.textContent = 'Preencha o e-mail e a senha.'; return; }
  ok.disabled = true; erro.textContent = 'Entrando';
  try { await entrar(email, senha); $('login-senha').value = ''; erro.textContent = ''; modal($('login')).hide(); pinta(); await ciclo(); } catch (e) { erro.textContent = (e && e.message) || 'Não consegui entrar.'; }
  ok.disabled = false;
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && E.g.admin && minDesde(E.finEm) > 5) ciclo(); });
setInterval(() => { if (!document.hidden) ciclo(); }, CICLO_MS);

async function inicia() {
  if (!URL_BANCO || !CHAVE_PUBLICA) { E.g.conferindo = false; E.g.recusa = 'Configuração do banco ausente.'; pinta(); return; }
  pinta();
  if (temSessaoGuardada()) { try { await confereGestor(); } catch (e) { E.g.admin = false; } }
  E.g.conferindo = false; pinta();
  if (E.g.admin) await ciclo();
}
window.RESULTADOS = { estado: E, pinta, ciclo };   // só para depurar no navegador
inicia();
})();
