// Painel v2 — aba "Clientes" + troca de abas. Lê window.DADOS_CLIENTES (scripts/painel_v2_clientes.js).
(function () {
  const C = window.DADOS_CLIENTES;
  const $ = (id) => document.getElementById(id);
  const reais = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nomeProprio = (s) => esc(s).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());
  const meses = (dias) => dias < 60 ? dias + ' dias' : (dias / 30.4).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' meses';
  const POR_PAGINA = 12;

  // ---------- Troca de abas ----------
  const abas = document.querySelectorAll('.aba[data-aba]');
  function abrir(nome) {
    abas.forEach((b) => { const on = b.dataset.aba === nome; b.classList.toggle('ativa', on); b.setAttribute('aria-selected', on); });
    document.querySelectorAll('main[id^="aba-"]').forEach((m) => (m.hidden = m.id !== 'aba-' + nome));
    try { history.replaceState(null, '', '#' + nome); } catch (e) {}
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('resize')); // redesenha o gráfico do mês na largura certa
  }
  abas.forEach((b) => b.addEventListener('click', () => abrir(b.dataset.aba)));
  if (location.hash === '#clientes' || location.hash === '#historico') abrir(location.hash.slice(1));
  if (!C) return;

  // ---------- Peças comuns ----------
  const onde = (c) => '<span class="onde">Rota ' + esc(c.rota) + ' · ' + esc(c.vendedor) + (c.bairro ? ' · ' + nomeProprio(c.bairro) : '') + (c.cidade ? ', ' + nomeProprio(c.cidade) : '') + '</span>';
  const fone = (c) => c.telefone ? '<span class="fone">' + esc(c.telefone) + '</span>' : '';
  const tag = (txt, tipo) => '<span class="tag ' + (tipo || '') + '">' + txt + '</span>';
  const obsHtml = (c) => c.observacao ? '<p class="obs"><b>Obs. no Opy:</b> ' + esc(c.observacao) + '</p>' : '';
  const historicoTxt = (h) => 'Antes: quitou ' + h.fechadas + (h.fechadas === 1 ? ' venda' : ' vendas') + ', ' + h.emDia + ' em até 90 dias · média de ' + h.mediaDias + ' dias pra quitar';

  function lista(id, filtroNome, itens, linha) {
    const el = $(id);
    const pil = document.querySelector('.pilulas[data-filtro="' + filtroNome + '"]');
    const vendedores = [...new Set(itens.map((i) => i.vendedor))].filter((v) => !v.startsWith('(')).sort();
    let filtro = 'Todos', mostrar = POR_PAGINA;
    const contar = (v) => v === 'Todos' ? itens.length : itens.filter((i) => i.vendedor === v).length;
    pil.innerHTML = ['Todos', ...vendedores].map((v) => '<button class="pilula' + (v === filtro ? ' ativa' : '') + '" data-v="' + esc(v) + '">' + esc(v) + ' <span class="cont">' + contar(v) + '</span></button>').join('');
    pil.addEventListener('click', (e) => {
      const b = e.target.closest('.pilula'); if (!b) return;
      filtro = b.dataset.v; mostrar = POR_PAGINA;
      pil.querySelectorAll('.pilula').forEach((p) => p.classList.toggle('ativa', p === b));
      desenhar();
    });
    function desenhar() {
      const sel = itens.filter((i) => filtro === 'Todos' || i.vendedor === filtro);
      el.innerHTML = sel.slice(0, mostrar).map(linha).join('') +
        (sel.length > mostrar ? '<button class="mais" type="button">Mostrar mais ' + Math.min(POR_PAGINA, sel.length - mostrar) + ' de ' + (sel.length - mostrar) + ' restantes</button>' : '') +
        (!sel.length ? '<p class="vazio">Nenhum cliente nesta lista.</p>' : '');
      const m = el.querySelector('.mais');
      if (m) m.addEventListener('click', () => { mostrar += POR_PAGINA; desenhar(); });
    }
    desenhar();
  }

  // ---------- Atalhos do topo ----------
  const empilhados = C.quebraram.filter((q) => q.empilhadas).length;
  $('atalhos').innerHTML = [
    { href: '#sec-travaram', n: C.quebraram.length, t: 'bons clientes com venda travada', s: empilhados ? empilhados + ' com várias vendas sem nenhum pagamento' : 'venda recente com menos da metade paga', cls: 'critico' },
    { href: '#sec-pararam', n: C.reativar.length, t: 'bons clientes pararam de comprar', s: 'sumiram bem além do próprio ritmo', cls: 'atencao' },
    { href: '#sec-piora', n: C.piora.length, t: 'demorando cada vez mais pra pagar', s: 'pagam, mas cada vez mais devagar', cls: 'serio' },
    { href: '#sec-revisar', n: (C.revisar || []).length, t: 'pra olhar antes de ligar', s: 'disseram que pagaram ou têm situação especial', cls: '' },
  ].map((a) => '<a class="atalho ' + a.cls + '" href="' + a.href + '"><strong>' + a.n + '</strong><span>' + a.t + '</span><small>' + a.s + '</small></a>').join('');
  $('atalhos').addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    const alvo = document.querySelector(a.getAttribute('href'));
    if (alvo) { alvo.open = true; window.scrollTo({ top: alvo.getBoundingClientRect().top + scrollY - 80, behavior: 'smooth' }); }
  });

  // ---------- 1. Travaram ----------
  lista('listaTravaram', 'travaram', C.quebraram, (q) =>
    '<article class="cliente' + (q.empilhadas ? ' urgente' : '') + '">' +
      '<div class="cli-cab"><strong>' + nomeProprio(q.nome) + '</strong>' + fone(q) + '</div>' + onde(q) +
      '<div class="tags">' +
        (q.empilhadas ? tag(q.agora.semPagamento + ' vendas seguidas sem nenhum pagamento', 'critico') : '') +
        tag(reais(q.agora.restante) + ' parado em ' + q.agora.vendas + (q.agora.vendas === 1 ? ' venda' : ' vendas'), 'forte') +
        tag('a mais antiga tem ' + q.agora.diasMax + ' dias') +
      '</div>' +
      '<p class="hist">' + historicoTxt(q.historico) + '</p>' + obsHtml(q) +
    '</article>');

  // ---------- 2. Pararam: comparação por vendedor ----------
  (function () {
    const vs = C.porVendedor;
    const max = Math.max(...vs.map((v) => v.taxa), C.medianaTaxa || 0);
    const escala = Math.ceil(max / 10) * 10 || 100;
    const med = C.medianaTaxa;
    $('barrasVendedor').innerHTML = vs.map((v) => {
      const alto = v.bons >= 8 && med && v.taxa >= med * 1.6;
      return '<div class="bv-linha' + (v.bons < 8 ? ' pouca' : '') + '">' +
        '<div class="bv-nome">' + esc(v.vendedor) + '<small>' + v.parados + ' de ' + v.bons + '</small></div>' +
        '<div class="bv-trilho"><div class="bv-barra' + (alto ? ' alto' : '') + '" style="width:' + (100 * v.taxa / escala) + '%"></div>' +
        (med ? '<div class="bv-med" style="left:' + (100 * med / escala) + '%"></div>' : '') + '</div>' +
        '<div class="bv-val">' + v.taxa.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div></div>';
    }).join('') +
      (med ? '<div class="bv-legenda"><span class="bv-med-chave"></span>metade dos vendedores fica abaixo de ' + med.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '</div>' : '');
    const altos = vs.filter((v) => v.bons >= 8 && med && v.taxa >= med * 1.6);
    $('notaVendedor').innerHTML = (altos.length
      ? '<b>' + altos.map((v) => esc(v.vendedor)).join(' e ') + '</b> ' + (altos.length > 1 ? 'estão' : 'está') + ' muito acima dos outros. Isso é um sinal pra olhar de perto, não uma prova: pode ser cobrança fraca, rota difícil ou cliente sendo levado pra outro lugar. '
      : '') + 'Barra em vermelho = taxa pelo menos 1,6 vez acima do normal da empresa. Vendedor com menos de 8 clientes bons aparece apagado, porque a amostra é pequena.';
  })();

  lista('listaPararam', 'pararam', C.reativar, (r) =>
    '<article class="cliente">' +
      '<div class="cli-cab"><strong>' + nomeProprio(r.nome) + '</strong>' + fone(r) + '</div>' + onde(r) +
      '<div class="tags">' +
        tag('comprava a cada ~' + r.ritmo + ' dias', '') +
        tag('está há ' + meses(r.diasSem) + ' sem comprar', 'forte') +
        tag(r.compras + ' compras') +
        (r.deveMais60 ? tag('deve ' + reais(r.deveMais60) + ' há mais de 60 dias: cobrar antes de vender', 'atencao') : '') +
      '</div>' +
      '<p class="hist">' + historicoTxt(r.historico) + '</p>' + obsHtml(r) +
    '</article>');

  // ---------- 3. Piora ----------
  function trajetoria(t, antes) {
    const max = Math.max(...t.map((x) => x.dias), 120);
    const W = 150, H = 38, bw = Math.min(12, (W - (t.length - 1) * 4) / t.length);
    const y60 = H - (60 / max) * H;
    let s = '<svg class="traj" viewBox="0 0 ' + W + ' ' + (H + 2) + '" width="' + W + '" height="' + (H + 2) + '" role="img" aria-label="Dias pra quitar nas últimas vendas: ' + t.map((x) => x.dias).join(', ') + '">';
    s += '<line class="traj-regua" x1="0" x2="' + W + '" y1="' + y60 + '" y2="' + y60 + '"/>';
    t.forEach((x, i) => {
      const h = Math.max(2, (x.dias / max) * H), xx = i * (bw + 4);
      s += '<rect class="traj-b' + (x.dias > 90 ? ' lenta' : '') + '" x="' + xx + '" y="' + (H - h) + '" width="' + bw + '" height="' + h + '" rx="2"><title>' + x.data.split('-').reverse().join('/') + ': ' + x.dias + ' dias</title></rect>';
    });
    return s + '</svg>';
  }
  lista('listaPiora', 'piora', C.piora, (p) =>
    '<article class="cliente com-traj">' +
      '<div class="cli-txt">' +
        '<div class="cli-cab"><strong>' + nomeProprio(p.nome) + '</strong>' + fone(p) + '</div>' + onde(p) +
        '<div class="antes-agora"><span><small>antes</small>' + p.antes + ' dias</span><i>→</i><span class="agora"><small>agora</small>' + p.agora + ' dias</span></div>' +
        (p.abertaAgora ? '<div class="tags">' + tag('em aberto: ' + reais(p.abertaAgora.restante) + ', a mais antiga com ' + p.abertaAgora.diasMax + ' dias', p.abertaAgora.diasMax > 90 ? 'atencao' : '') + '</div>' : '') +
      '</div>' +
      obsHtml(p) + '<div class="cli-traj">' + trajetoria(p.trajetoria, p.antes) + '<small>dias pra quitar, venda a venda · linha = 60 dias</small></div>' +
    '</article>');

  // ---------- Olhe antes de ligar ----------
  lista('listaRevisar', 'revisar', C.revisar || [], (c) =>
    '<article class="cliente revisar">' +
      '<div class="cli-cab"><strong>' + nomeProprio(c.nome) + '</strong>' + fone(c) + '</div>' + onde(c) +
      '<div class="tags">' + tag(esc(c.motivo), 'atencao') + tag('lista: ' + esc(c.lista)) + '</div>' +
      (c.agora ? '<p class="hist">Parado: ' + reais(c.agora.restante) + ' em ' + c.agora.vendas + (c.agora.vendas === 1 ? ' venda' : ' vendas') + ', a mais antiga com ' + c.agora.diasMax + ' dias</p>' : '') +
      obsHtml(c) +
    '</article>');

  // ---------- Frase-resumo de cada bloco ----------
  const V = C.verificacao;
  const porVend = (l) => { const m = {}; l.forEach((x) => { if (!x.vendedor.startsWith('(')) m[x.vendedor] = (m[x.vendedor] || 0) + 1; }); const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return top ? ' Mais casos: ' + top[0] + ' (' + top[1] + ').' : ''; };
  const totalParado = C.quebraram.reduce((s, q) => s + q.agora.restante, 0);
  $('resTravaram').textContent = C.quebraram.length + ' clientes, ' + reais(totalParado) + ' parados.' + porVend(C.quebraram);
  $('resPararam').textContent = C.reativar.length + ' clientes bons sumiram.' + porVend(C.reativar);
  $('resPiora').textContent = C.piora.length + ' clientes pagando cada vez mais devagar.' + porVend(C.piora);
  $('resRevisar').textContent = (C.revisar || []).length + ' casos pra você decidir se vale o contato.';
  if (V) {
    const saiu = V.removidos.length;
    const p = document.createElement('p'); p.className = 'conferido';
    p.innerHTML = '✓ Conferido direto no Opy em ' + new Date(V.em).toLocaleDateString('pt-BR') + ': ' + V.fichasConferidas + ' clientes. ' + saiu + ' saíram das listas (faleceu, já está com a DP, pagou nos últimos dias, voltou a comprar ou ainda deve venda antiga).';
    $('atalhos').after(p);
  }

  // ---------- Regras ----------
  const R = C.regras;
  $('regrasClientes').innerHTML = [
    ['Cliente de histórico bom', R.bom], ['Venda travada', R.quebraram], ['Parou de comprar', R.reativar], ['Demorando mais', R.piora], ['Por vendedor', R.porVendedor],
    ['Conferência no Opy', V ? V.regra : ''],
    ['O que não entra', 'A situação "Ativo" do cadastro não é usada pra achar cliente ativo, porque o Opy não muda esse rótulo quando o cliente some.'],
  ].map(([t, x]) => '<li><b>' + t + ':</b> ' + esc(x) + '</li>').join('');
})();
