/* PAINEL DE RESULTADOS — Aliança (15/11/2026, branch feat/novo-painel-resultados).
   Página executiva de vendas e recebimentos. Não guarda dado nenhum: tudo vem do banco DEPOIS do login do Gestor (papel admin).
   Fontes (todas já publicadas pelo servidor, nada novo foi criado):
     · hq-financeiro  → ROI do mês (empresa × sistema), vendas por origem, rotas, vendedores e o estado dos motores digitais;
     · v2             → só a parte das rotas (quanto do valor vendido entra em até 60 dias);
     · hq-servidor    → só as contagens das campanhas dos últimos 7 dias (enviadas, com interesse, pedidos).
   Regra da casa: número sem fonte não aparece. Onde o servidor ainda não mede, a tela diz "ainda não medido" em vez de inventar. */
(() => {
'use strict';

const URL_BANCO = window.SUPABASE_URL || '', CHAVE_PUBLICA = window.SUPABASE_ANON_KEY || '';
const BIBLIOTECA_LOGIN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';
const CICLO_MS = 5 * 60000, VELHO_MIN = 30, AMOSTRA_MIN = 30;   // AMOSTRA_MIN: mesma régua do Painel (menos de 30 vendas maduras distorce a porcentagem)
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* De qual funcionário digital é cada origem de venda (as origens são as do cálculo de ROI do servidor). */
const EQUIPE = [
  { id: 'atendente', cargo: 'Atendente da Central', origens: ['receptivo', 'pos-quitacao'], como: 'Vendas depois de atendimento no WhatsApp ou da oferta para quem quitou.' },
  { id: 'recuperador', cargo: 'Recuperador de Base', origens: ['reativacao', 'vip'], como: 'Vendas depois de reativação ou de convite de renovação.' },
  { id: 'vip', cargo: 'Especialista VIP', origens: ['indique'], como: 'Vendas que vieram de indicação.' },
  { id: 'cobrador', cargo: 'Cobrador Preventivo', origens: ['cobranca'], recebe: true, como: 'Parcelas pagas até 7 dias depois de lembrete ou promessa, mais as vendas depois de um lembrete.' },
  { id: 'credito', cargo: 'Analista de Crédito', origens: [], apoio: fin => { const t = pega(fin, 'credito.funil.total', null); return t ? conta(t.leads || 0, 'cadastro analisado', 'cadastros analisados') + ': ' + (t.aprovados || 0) + ' aprovados, ' + (t.reprovados || 0) + ' reprovados e ' + (t.excecoes || 0) + ' para revisão.' : 'Sem dado do funil de crédito.'; } },
  { id: 'secretario', cargo: 'Secretário dos Vendedores', origens: [], apoio: fin => { const b = pega(fin, 'boletim', null); return b ? conta(pega(b, 'hoje.boletins', 0), 'boletim hoje', 'boletins hoje') + ' e ' + conta(b.aguardando || 0, 'recado na fila', 'recados na fila') + '.' : 'Sem dado dos boletins.'; } },
];
const CAMPANHAS = [['renovacaoVip', 'Renovação VIP', 'últimos 7 dias'], ['indique', 'Indique e Ganhe (campanha)', 'últimos 7 dias'], ['reativacao', 'Reativação comercial', 'últimos 7 dias']];

const E = { g: { sb: null, admin: false, email: '', conferindo: true, recusa: '' }, fin: null, finEm: null, rotasV2: null, campanhas: null, erro: '', lendo: false, lido: false, visao: 'rotas', ordem: 'vendas' };

/* ---------------- utilidades ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pega = (o, caminho, pad) => { let x = o; for (const k of caminho.split('.')) { if (x == null) return pad; x = x[k]; } return x == null ? pad : x; };
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const plural = (n, um, varios) => (n === 1 ? um : varios);
const conta = (n, um, varios) => inteiro(n) + ' ' + plural(n, um, varios);
const inteiro = v => Math.round(+v || 0).toLocaleString('pt-BR');
const reais = v => (num(+v) == null ? '–' : 'R$\u00a0' + inteiro(v));   // espaço que não quebra: o valor nunca se separa do R$
const reaisGrande = v => (num(+v) == null ? '–' : '<small>R$</small>' + inteiro(v));
const pct = (v, casas = 1) => (num(v) == null ? '–' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas }) + '%');
const pct100 = v => (num(v) == null ? '–' : Math.round(v).toLocaleString('pt-BR') + '%');
const dataBR = dia => String(dia || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const minDesde = iso => { const t = Date.parse(iso); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); };
const largura = (v, max) => Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0)).toFixed(1);
const barra = (v, max, tipo = '') => `<span class="trilho${tipo ? ' ' + tipo : ''}" aria-hidden="true"><i style="width:${largura(v, max)}%"></i></span>`;
const fracao = (a, b) => (num(a) != null && b > 0 ? a / b : null);

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
  E.g.recusa = E.g.admin ? '' : 'Esta conta não é de Gestor. Os resultados são só para o Gestor.';
  if (!E.g.admin && sairSeNaoFor) await sb.auth.signOut();   // só desfaz um login feito aqui
  return E.g.admin;
}
async function ler() {   // três leituras pequenas: do Painel v2 vem só a lista de rotas, e do servidor só as contagens das campanhas
  const sb = E.g.sb;
  const [f, v, p] = await Promise.all([
    sb.from('painel_dados').select('dados,atualizado_em').eq('id', 'hq-financeiro').maybeSingle(),
    sb.from('painel_dados').select('rotas:dados->mes->rotas').eq('id', 'v2').maybeSingle(),
    sb.from('painel_dados').select('id,campanhas:dados->campanhas').in('id', ['hq-servidor', 'hq-pc'])]);
  if (f.error) throw new Error(f.error.message);
  E.fin = pega(f, 'data.dados', null); E.finEm = pega(f, 'data.atualizado_em', null);
  E.rotasV2 = v && !v.error && Array.isArray(pega(v, 'data.rotas', null)) ? v.data.rotas : null;
  const linhas = (p && !p.error && p.data) || [], de = id => pega(linhas.find(x => x.id === id), 'campanhas', null);
  E.campanhas = de('hq-servidor') || de('hq-pc');
}
async function ciclo() {
  if (!E.g.admin || E.lendo) return; E.lendo = true; pintaTopo();
  try { await ler(); E.erro = ''; } catch (e) { E.erro = (e && e.message) || 'falhou'; }
  E.lendo = false; E.lido = true; pinta();
}

/* ---------------- telas ---------------- */
function pintaTopo() {
  const b = $('botao-entrar'), a = $('botao-atualizar');
  b.textContent = E.g.admin ? 'Sair' : 'Entrar'; b.disabled = E.g.conferindo;
  a.hidden = !E.g.admin; a.disabled = E.lendo; a.textContent = E.lendo ? 'Lendo…' : 'Atualizar';
}
function pinta() {
  pintaTopo();
  const tela = $('tela');
  if (E.g.conferindo) { tela.innerHTML = '<section class="porta"><h1>Um instante</h1><p>Conferindo o seu acesso…</p></section>'; return; }
  if (!E.g.admin) { tela.innerHTML = `<section class="porta"><h1>Resultados de vendas e recebimentos</h1><p>${esc(E.g.recusa || 'Entre como Gestor para ver o funil, o ranking das rotas e o retorno de cada funcionário digital.')}</p><button type="button" class="botao" data-entrar>Entrar como Gestor</button><p class="outra-porta">Procurando as listas de clientes e o histórico? Estão no <a href="painel-completo.html">painel completo</a>.</p></section>`; return; }
  if (!E.lido) { tela.innerHTML = '<section class="porta"><h1>Um instante</h1><p>Lendo os resultados…</p></section>'; return; }
  if (!E.fin) { tela.innerHTML = `<section class="porta"><h1>Sem resultados para mostrar</h1><p>${esc(E.erro ? 'Não consegui ler os números agora: ' + E.erro : 'O servidor ainda não publicou os números do mês.')}</p><button type="button" class="botao" data-atualizar>Tentar de novo</button></section>`; return; }
  tela.innerHTML = abertura() + resumo() + funil() + abordagens() + ranking() + retorno() + comoCalcula() + rodape();
}
function abertura() {
  const roi = pega(E.fin, 'roi', null), hoje = pega(roi, 'hoje', ''), mes = MES[(+String(hoje).slice(5, 7) || 1) - 1], ate = pega(roi, 'dadosVendasAte', ''), velho = minDesde(E.finEm);
  return `<section class="abre"><h1>Resultados de ${esc(mes)}</h1><p>Do dia 1º até hoje.${ate && hoje && ate < hoje ? ' As vendas estão lançadas até ' + esc(dataBR(ate)) + '.' : ''}</p></section>` +
    (E.erro ? `<p class="aviso erro">Não consegui atualizar agora (${esc(E.erro)}). Estes são os últimos números lidos.</p>` : '') +
    (velho != null && velho > VELHO_MIN ? `<p class="aviso">O servidor publicou estes números há ${velho < 120 ? velho + ' min' : Math.round(velho / 60) + ' h'}.</p>` : '');
}
function resumo() {
  const m = pega(E.fin, 'roi.mes', null); if (!m) return '<section class="bloco"><div class="caixa"><p class="vazio">O servidor ainda não publicou as vendas e os recebimentos do mês.</p></div></section>';
  const e = m.empresa || {}, s = m.sistema || {}, p = m.participacao || {};
  return `<section class="bloco"><div class="caixa duas">
    <div><span class="rot">Vendido no mês</span><span class="val">${reaisGrande(e.vendido)}</span>${barra(p.vendido || 0, 1, 'ouro')}<span class="obs">${conta(e.cestas || 0, 'cesta', 'cestas')}. A equipe digital participou de <b>${reais(s.vendido)}</b> (${pct(p.vendido)}).</span></div>
    <div><span class="rot">Recebido no mês</span><span class="val">${reaisGrande(e.recebido)}</span>${barra(p.recebido || 0, 1, 'ouro')}<span class="obs">Com lembrete ou promessa do robô antes: <b>${reais(s.recebido)}</b> (${pct(p.recebido)}).</span></div>
  </div></section>`;
}
function funil() {
  const s = pega(E.fin, 'roi.mes.sistema', null), c = E.campanhas, tot = pega(c, 'total', null);
  if (!s) return '';
  const env = num(s.abordados), resp = num(s.responderam), fech = num(s.compradores), pagos = num(s.recebimentos);
  const etapa = (nome, q, un, taxa, det, valor, falta) => `<li${falta ? ' class="falta"' : ''}><span class="et">${nome}</span><span class="q">${q}${un ? ` <small>${un}</small>` : ''}</span><span class="taxa">${taxa || ''}</span>${falta ? '<span class="trilho" aria-hidden="true"></span>' : barra(valor, env || 1)}<span class="det">${det}</span></li>`;
  const campanha = tot ? (tot.semana > 0
    ? `Campanhas nos últimos 7 dias: <b>${inteiro(tot.semana)}</b> enviadas, <b>${inteiro(tot.interesse)}</b> responderam com interesse (${pct(fracao(tot.interesse, tot.semana))}) e <b>${inteiro(tot.conversoes)}</b> viraram pedido (${pct(fracao(tot.conversoes, tot.semana))}).`
    : 'Nenhuma campanha enviada nos últimos 7 dias.') : '';
  return `<section class="bloco"><h2>Do contato ao pagamento</h2><p class="sub">Clientes que os robôs tocaram neste mês e o que aconteceu depois.</p><div class="caixa"><ol class="funil">` +
    etapa('Enviados', env == null ? '–' : inteiro(env), plural(env, 'cliente', 'clientes'), '', 'Receberam mensagem ou atendimento dos robôs.', env || 0) +
    (resp != null
      ? etapa('Responderam', inteiro(resp), plural(resp, 'cliente', 'clientes'), pct(fracao(resp, env)) + ' de resposta', 'Escreveram de volta depois do contato.', resp)
      : etapa('Responderam', 'ainda não medido', '', '', 'O servidor ainda não conta quem respondeu no mês. A taxa de resposta que existe hoje é a das campanhas, logo abaixo.', 0, true)) +
    etapa('Fecharam', fech == null ? '–' : inteiro(fech), plural(fech, 'cliente', 'clientes'), (num(s.conversao) != null || fracao(fech, env) != null) ? pct(num(s.conversao) != null ? s.conversao : fracao(fech, env)) + ' dos enviados' : '', conta(s.cestas || 0, 'cesta', 'cestas') + ', ' + reais(s.vendido) + ' vendidos até 7 dias depois do contato.', fech || 0) +
    etapa('Pagaram', pagos == null ? '–' : inteiro(pagos), plural(pagos, 'parcela', 'parcelas'), '', reais(s.recebido) + ' recebidos até 7 dias depois de lembrete ou promessa. São parcelas de qualquer venda, não só das vendas deste funil.', Math.min(pagos || 0, env || 0)) +
    '</ol>' + (campanha ? `<p class="pad obs" style="margin:0;border-top:1px solid var(--linha)">${campanha}</p>` : '') + '</div></section>';
}
function abordagens() {
  const c = E.campanhas, cr = credito(), iv = cr.indicacaoVip, linhas = [];
  for (const [k, nome, periodo] of CAMPANHAS) { const x = pega(c, k, null); if (x) linhas.push({ nome, periodo, env: x.semana || 0, resp: x.interesse || 0, fech: x.conversoes || 0 }); }
  if (iv) linhas.push({ nome: 'Indique e Ganhe VIP (link do cliente)', periodo: 'desde o início', env: pega(iv, 'convites.enviados', 0), resp: pega(iv, 'totais.recebidas', 0), fech: pega(iv, 'totais.aprovadas', 0), previa: pega(iv, 'chave.ligada', true) === false });
  const comEnvio = linhas.filter(l => l.env >= 20), melhor = comEnvio.length > 1 ? comEnvio.reduce((a, b) => (b.resp / b.env > a.resp / a.env ? b : a)) : null;
  const parte1 = linhas.length ? '<ul class="linhas">' + linhas.map(l => `<li><div class="cab"><b>${esc(l.nome)} <small>${esc(l.periodo)}</small>${melhor === l && l.resp > 0 ? '<span class="selo">melhor resposta</span>' : ''}</b></div><div class="tres"><div><b>${inteiro(l.env)}</b><span>enviadas${l.previa ? ' (em prévia)' : ''}</span></div><div><b>${l.env ? pct(l.resp / l.env) : '–'}</b><span>responderam (${inteiro(l.resp)})</span></div><div><b>${l.env ? pct(l.fech / l.env) : '–'}</b><span>fecharam (${inteiro(l.fech)})</span></div></div></li>`).join('') + '</ul>' : '<p class="vazio">O servidor ainda não publicou as campanhas.</p>';

  const por = pega(E.fin, 'roi.mes.porOrigem', []), max = por.reduce((m, o) => Math.max(m, o.vendido || 0), 0), totalSis = pega(E.fin, 'roi.mes.sistema.vendido', 0);
  const parte2 = por.length ? '<ul class="linhas">' + por.map(o => `<li><div class="cab"><b>${esc(o.nome)}</b><span>${reais(o.vendido)}</span></div>${barra(o.vendido || 0, max)}<span class="mini">${conta(o.cestas || 0, 'cesta', 'cestas')}, <b>${pct(fracao(o.vendido, totalSis), 0)}</b> das vendas com toque do robô.</span></li>`).join('') + '</ul>' : '<p class="vazio">Nenhuma venda do mês ligada a contato dos robôs até agora.</p>';

  const janelas = pega(E.fin, 'resultados.janelas', null);
  const parte3 = Array.isArray(janelas) && janelas.length
    ? '<ul class="linhas">' + janelas.map(j => `<li><div class="cab"><b>${esc(j.nome)}</b></div><div class="tres"><div><b>${inteiro(j.enviados)}</b><span>enviadas</span></div><div><b>${j.enviados ? pct((j.responderam || 0) / j.enviados) : '–'}</b><span>responderam</span></div><div><b>${j.enviados ? pct((j.fecharam || 0) / j.enviados) : '–'}</b><span>fecharam</span></div></div></li>`).join('') + '</ul>'
    : '<p class="vazio">Ainda não medido. O servidor ainda não publica o resultado separado por janela de pagamento, então não dá para comparar as janelas sem inventar número. Quando ele publicar, a comparação aparece aqui.</p>';

  return `<section class="bloco"><h2>O que funciona melhor</h2><p class="sub">Cada abordagem com o que foi enviado, quem respondeu e quem fechou.</p><div class="caixa partes">
    <div class="parte"><p class="titulo-parte">Resposta e fechamento por abordagem</p>${parte1}</div>
    <div class="parte"><p class="titulo-parte">Vendas do mês por abordagem<small>Venda lançada até 7 dias depois do contato.</small></p>${parte2}</div>
  </div><div class="caixa" style="margin-top:12px"><p class="titulo-parte">Por janela de pagamento</p>${parte3}</div></section>`;
}
function credito() { const cr = pega(E.fin, 'credito', null); return Array.isArray(cr) || !cr ? {} : cr; }
function ranking() {
  const eq = pega(E.fin, 'equipe', null); if (!eq) return '';
  const pont = new Map((E.rotasV2 || []).map(r => [String(r.rota), r]));
  const rotas = (eq.rotas || []).filter(r => r.cestas || r.aberto || r.vendido).map(r => { const v = pont.get(String(r.rota)), amostra = pega(v, 'curva.vendas', 0); return { ...r, pontual: v && amostra >= AMOSTRA_MIN ? num(pega(v, 'curva.ate60', null)) : null, amostraPequena: !!v && amostra < AMOSTRA_MIN }; });
  const vendedores = (eq.vendedores || []).filter(v => !String(v.vendedor || '').startsWith('('));
  const ehRotas = E.visao === 'rotas', lista = ehRotas ? rotas : vendedores;
  const ORDENS = ehRotas ? [['vendas', 'Vendas'], ['pontual', 'Pontualidade'], ['atraso', 'Atraso aberto']] : [['vendas', 'Vendas'], ['recebido', 'Recebido'], ['atraso', 'Atraso aberto']];
  if (!ORDENS.some(o => o[0] === E.ordem)) E.ordem = 'vendas';
  const chave = { vendas: x => x.vendido || 0, pontual: x => (x.pontual == null ? -1 : x.pontual), atraso: x => x.vencido || 0, recebido: x => x.recebido || 0 }[E.ordem];
  const ord = [...lista].sort((a, b) => chave(b) - chave(a));
  const maxV = Math.max(1, ...lista.map(x => x.vendido || 0)), maxA = Math.max(1, ...lista.map(x => x.vencido || 0)), maxR = Math.max(1, ...lista.map(x => x.recebido || 0));
  const linhaRota = (r, i) => `<li><div class="cab"><b><span class="pos">${i + 1}</span>Rota ${esc(r.rota)} <small>${esc(r.vendedor || '')}</small></b></div><div class="tres">
      <div><b>${reais(r.vendido)}</b><span>${conta(r.cestas || 0, 'cesta', 'cestas')}</span>${barra(r.vendido || 0, maxV, 'fino')}</div>
      <div><b>${r.pontual == null ? '–' : pct100(r.pontual)}</b><span>${r.pontual == null ? (r.amostraPequena ? 'amostra pequena' : 'sem dado') : 'entra em até 60 dias'}</span>${r.pontual == null ? '' : barra(r.pontual, 100, 'fino ouro')}</div>
      <div><b class="${r.vencido > 0 ? 'ruim' : ''}">${reais(r.vencido)}</b><span>atraso aberto</span>${barra(r.vencido || 0, maxA, 'fino risco')}</div></div></li>`;
  const linhaVend = (v, i) => `<li><div class="cab"><b><span class="pos">${i + 1}</span>${esc(v.vendedor)} <small>${(v.rotas || []).length ? 'rotas ' + esc((v.rotas || []).join(', ')) : ''}</small></b></div><div class="tres">
      <div><b>${reais(v.vendido)}</b><span>${conta(v.cestas || 0, 'cesta', 'cestas')}</span>${barra(v.vendido || 0, maxV, 'fino')}</div>
      <div><b>${reais(v.recebido)}</b><span>recebido no mês</span>${barra(v.recebido || 0, maxR, 'fino ouro')}</div>
      <div><b class="${v.vencido > 0 ? 'ruim' : ''}">${reais(v.vencido)}</b><span>atraso aberto</span>${barra(v.vencido || 0, maxA, 'fino risco')}</div></div></li>`;
  const bot = (grupo, id, txt, ativo) => `<button type="button" data-${grupo}="${id}" aria-pressed="${ativo}">${txt}</button>`;
  return `<section class="bloco" id="ranking"><h2>Ranking de rotas e vendedores</h2><p class="sub">Vendas do mês, pontualidade e o atraso que está em aberto.</p>
    <div class="troca" role="group" aria-label="O que comparar">${bot('visao', 'rotas', 'Rotas', ehRotas)}${bot('visao', 'vendedores', 'Vendedores', !ehRotas)}<span class="sep"></span><span class="rotulo-troca">Ordenar por</span>${ORDENS.map(([id, txt]) => bot('ordem', id, txt, E.ordem === id)).join('')}</div>
    <div class="caixa">${ord.length ? '<ol class="linhas">' + ord.map(ehRotas ? linhaRota : linhaVend).join('') + '</ol>' : '<p class="vazio">Sem dado de ' + (ehRotas ? 'rotas' : 'vendedores') + ' neste mês.</p>'}</div>
    ${ehRotas && !E.rotasV2 ? '<p class="aviso">Não consegui ler a pontualidade das rotas (ela vem do Painel de vendas). As vendas e o atraso estão certos.</p>' : ''}</section>`;
}
function retorno() {
  const m = pega(E.fin, 'roi.mes', null); if (!m) return '';
  const por = {}; for (const o of m.porOrigem || []) por[o.id] = o;
  const soma = (ids, campo) => ids.reduce((t, id) => t + pega(por[id], campo, 0), 0);
  const linhas = EQUIPE.map(f => ({ ...f, vendido: soma(f.origens, 'vendido'), cestas: soma(f.origens, 'cestas'), recebido: f.recebe ? pega(m, 'sistema.recebido', 0) : 0 }));
  const comReceita = linhas.filter(l => l.origens.length).sort((a, b) => (b.vendido + b.recebido) - (a.vendido + a.recebido)), apoio = linhas.filter(l => !l.origens.length);
  const max = Math.max(1, ...comReceita.map(l => Math.max(l.vendido, l.recebido)));
  return `<section class="bloco"><h2>Retorno por funcionário digital</h2><p class="sub">Quanto do mês passou pela mão de cada um.</p><div class="caixa"><ul class="linhas colunas">` +
    comReceita.map(l => `<li><div class="cab"><b>${esc(l.cargo)}</b><span>${reais(l.vendido)}</span></div>${barra(l.vendido, max)}<span class="mini">${conta(l.cestas, 'cesta vendida', 'cestas vendidas')}. ${esc(l.como)}</span>` +
      (l.recebe ? `<div class="cab" style="margin-top:10px"><b><small>Recebido depois de lembrete</small></b><span>${reais(l.recebido)}</span></div>${barra(l.recebido, max, 'ouro')}<span class="mini">${conta(pega(m, 'sistema.recebimentos', 0), 'parcela', 'parcelas')}.</span>` : '') + '</li>').join('') +
    apoio.map(l => `<li><div class="cab"><b>${esc(l.cargo)}</b><span>sem venda direta</span></div><span class="mini">${esc(l.apoio(E.fin))}</span></li>`).join('') + '</ul></div></section>';
}
function comoCalcula() {
  const dias = pega(E.fin, 'roi.janelaDias', 7);
  const item = (nome, origem, serve) => `<li><b>${nome}</b><br><i>De onde vem:</i> ${origem}<br><i>Para que serve:</i> ${serve}</li>`;
  return `<details class="como"><summary>De onde vem cada número e para que ele serve</summary><ul>` +
    item('Vendido e recebido no mês', 'relatório de vendas por período e livro de recebimentos do sistema, do dia 1º até hoje. A parte da equipe digital é o que veio depois de um contato de robô.', 'ver se o mês está andando e quanto dele já passa pela equipe digital.') +
    item('Enviados', 'clientes que tiveram contato de um robô no mês (lembrete, cobrança da rotina, campanha ou atendimento), pelo registro de envios e pelo log de atendimento.', 'saber o tamanho do trabalho dos robôs antes de olhar o resultado.') +
    item('Fecharam', `desses clientes, quantos tiveram uma venda lançada até ${esc(dias)} dias depois do contato. É proximidade, não prova de que foi o robô que vendeu.`, 'comparar um mês com o outro e decidir se vale manter os robôs abordando.') +
    item('Pagaram', `parcelas baixadas no livro de recebimentos até ${esc(dias)} dias depois de um lembrete, de uma cobrança ou de uma promessa registrada pelo robô.`, 'ver se lembrete e promessa estão trazendo dinheiro.') +
    item('Resposta e fechamento por abordagem', 'fila de cada campanha: convites enviados, respostas com interesse e pedidos, nos últimos 7 dias. No Indique e Ganhe VIP: convites, indicações recebidas e aprovadas.', 'decidir qual abordagem manter, qual texto trocar e qual desligar.') +
    item('Vendas do mês por abordagem', 'cada venda com contato de robô nos 7 dias anteriores vai para a abordagem do contato mais recente.', 'saber de onde está vindo a venda nova.') +
    item('Vendas e recebido por rota e por vendedor', 'relatório de vendas por período e livro de recebimentos, pela rota atual do cliente (mesma atribuição da comissão).', 'ver quem está vendendo e quem está recebendo no mês.') +
    item('Pontualidade da rota', `parte do valor vendido que entra em até 60 dias da compra, nas vendas dos últimos 12 meses com 90 dias ou mais (mesma conta do painel completo). Rota com menos de ${AMOSTRA_MIN} vendas nessa conta aparece como amostra pequena.`, 'separar a rota que vende e recebe da rota que vende e não vê o dinheiro voltar.') +
    item('Atraso aberto', 'relatório de cobrança: saldo em aberto com a data combinada já vencida, pela rota atual do cliente.', 'decidir onde cobrar primeiro.') +
    item('Retorno por funcionário digital', 'as vendas por abordagem, somadas por funcionário: atendimento e oferta de quem quitou vão para o Atendente; reativação e renovação, para o Recuperador; indicação, para o Especialista VIP; lembrete, para o Cobrador.', 'decidir qual funcionário digital ligar, ajustar ou deixar em pausa.') +
    '</ul></details>';
}
function rodape() { return `<footer class="rodape"><p>Acesso do Gestor${E.g.email ? ' (' + esc(E.g.email) + ')' : ''}.</p><nav><a href="painel-completo.html">Painel completo (listas de clientes e histórico)</a><a href="hq/">Aliança HQ</a><a href="cobranca/">Cobrança diária</a></nav></footer>`; }

/* ---------------- ações ---------------- */
async function entrar(email, senha) {
  const sb = await cliente(), { error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : 'Não consegui entrar: ' + error.message);
  if (!(await confereGestor({ sairSeNaoFor: true }))) throw new Error('Essa conta não é de Gestor.');
}
async function sair() {
  try { if (E.g.sb) await E.g.sb.auth.signOut(); } catch (e) { /* o estado local é limpo de qualquer jeito */ }
  Object.assign(E, { fin: null, finEm: null, rotasV2: null, campanhas: null, erro: '', lido: false }); E.g.admin = false; E.g.email = ''; E.g.recusa = ''; pinta();   // ao sair, nenhum número fica na página
}
function abreLogin() { $('login-erro').textContent = ''; $('login').showModal(); $('login-email').focus(); }
document.addEventListener('click', ev => {
  const alvo = ev.target.closest ? ev.target : ev.target.parentElement; if (!alvo) return;
  let x;
  if (alvo.closest('[data-entrar]')) return abreLogin();
  if (alvo.closest('[data-atualizar]')) return ciclo();
  if ((x = alvo.closest('[data-visao]'))) { E.visao = x.dataset.visao; pinta(); const r = $('ranking'); if (r) r.scrollIntoView({ block: 'nearest' }); return; }
  if ((x = alvo.closest('[data-ordem]'))) { E.ordem = x.dataset.ordem; pinta(); const r = $('ranking'); if (r) r.scrollIntoView({ block: 'nearest' }); return; }
});
$('botao-entrar').addEventListener('click', () => (E.g.admin ? sair() : abreLogin()));
$('botao-atualizar').addEventListener('click', ciclo);
$('login-cancela').addEventListener('click', () => $('login').close());
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault(); const erro = $('login-erro'), ok = $('login-ok'), email = $('login-email').value.trim(), senha = $('login-senha').value;
  if (!email || !senha) { erro.textContent = 'Preencha o e-mail e a senha.'; return; }
  ok.disabled = true; erro.textContent = 'Entrando…';
  try { await entrar(email, senha); $('login-senha').value = ''; $('login').close(); pinta(); await ciclo(); } catch (e) { erro.textContent = (e && e.message) || 'Não consegui entrar.'; }
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
