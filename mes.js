// Painel v2 — aba "O mês". Lê window.DADOS_MES (gerado por scripts/painel_v2_mes.js).
(function () {
  const D = window.DADOS_MES;
  const $ = (id) => document.getElementById(id);
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const nomeMes = (m, longo) => { const [y, mm] = m.split('-').map(Number); return longo ? MESES_LONGOS[mm - 1] : MESES[mm - 1] + '/' + String(y).slice(2); };
  const reais = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const milhares = (n) => n >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : 'R$ ' + Math.round(n / 1000).toLocaleString('pt-BR') + ' mil';
  const pct = (n, d = 0) => n === null || n === undefined ? '–' : n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';
  const dataBR = (iso) => iso.split('-').reverse().join('/');
  const AMOSTRA_MIN = 30; // vendas maduras mínimas pra comparar rota sem enganar

  function statusRitmo(atual, normal) {
    if (atual === null || normal === null) return { cls: '', txt: 'Sem base' };
    const dif = atual - normal;
    if (dif >= -3) return { cls: 'bom', txt: 'No ritmo', badge: 'al-verde' };
    if (dif >= -12) return { cls: 'atencao', txt: 'Um pouco atrás', badge: 'al-amarelo' };
    return { cls: 'critico', txt: 'Bem atrás', badge: 'al-vermelho' };
  }

  // ---------- Dica flutuante ----------
  const dica = $('dica');
  function mostrarDica(html, x, y) {
    dica.innerHTML = html; dica.classList.add('on');
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let left = x + 14, top = y - h - 12;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 16;
    dica.style.left = Math.max(8, left) + 'px'; dica.style.top = top + 'px';
  }
  const esconderDica = () => dica.classList.remove('on');

  // ---------- Cabeçalho ----------
  $('dadoAte').textContent = 'Dado até ' + dataBR(D.dadoAte);

  // ---------- 1. Ritmo do mês ----------
  (function () {
    const r = D.empresa.ritmo;
    const st = statusRitmo(r.pctIdeal, r.pctNormalNoDia);
    $('ritmoSobre').textContent = nomeMes(D.mesAtual, true) + ' · até o dia ' + D.diaAtual;
    $('ritmoPct').textContent = pct(r.pctIdeal);
    $('ritmoTxt').innerHTML = 'do ideal já entrou<br><b>' + reais(r.recebido) + '</b> de ' + reais(r.ideal);
    const escala = Math.max(100, r.pctIdeal, r.pctNormalNoDia);
    const med = $('ritmoMedidor');
    med.querySelector('.medidor-marca').style.left = (100 * r.pctNormalNoDia / escala) + '%';
    requestAnimationFrame(() => { med.querySelector('.medidor-fill').style.width = (100 * r.pctIdeal / escala) + '%'; });
    $('ritmoLegenda').innerHTML =
      '<span class="' + (r.pctNormalNoDia / escala > 0.55 ? 'ancora-fim' : '') + '" style="left:' + (100 * r.pctNormalNoDia / escala) + '%">Normal no dia ' + D.diaAtual + ': ' + pct(r.pctNormalNoDia) + '</span>' +
      '<span class="fim">Ideal do mês</span>';
    const falta = (r.pctNormalNoDia - r.pctIdeal) / 100 * r.ideal;
    $('ritmoVeredito').innerHTML = '<span class="al-badge ' + st.badge + '">' + st.txt + '</span><span>' +
      (falta > 0
        ? 'Faltam <b>' + milhares(falta) + '</b> pra chegar onde os últimos 12 meses costumavam estar no dia ' + D.diaAtual + '.'
        : 'Vocês estão <b>' + milhares(-falta) + '</b> à frente do que é normal pro dia ' + D.diaAtual + '.') + '</span>';
  })();

  // ---------- 2. Recebido × Ideal ----------
  function desenharMeses() {
    const el = $('graficoMeses');
    const serie = D.serieEmpresa;
    if (!el.clientWidth) return; // aba escondida: redesenha quando ela aparecer
    const W = el.clientWidth;
    const estreito = W < 560;
    const H = estreito ? 240 : 300;
    const m = { t: 28, r: 4, b: 28, l: estreito ? 44 : 60 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...serie.map((s) => Math.max(s.recebido, s.ideal)));
    const passo = max > 300000 ? 100000 : 50000;
    const topo = Math.ceil(max / passo) * passo;
    const y = (v) => m.t + ih - (v / topo) * ih;
    const slot = iw / serie.length;
    const bw = Math.min(24, slot * 0.5);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Recebido e ideal por mês nos últimos 13 meses">';
    for (let v = 0; v <= topo; v += passo) {
      s += '<line class="grade-linha" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="eixo" x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + (v === 0 ? '0' : (v / 1000) + ' mil') + '</text>';
    }
    serie.forEach((p, i) => {
      const cx = m.l + slot * i + slot / 2;
      const x0 = cx - bw / 2, yv = y(p.recebido), base = y(0), rr = Math.min(4, (base - yv) / 2);
      s += '<path class="barra' + (p.parcial ? ' parcial' : '') + '" data-i="' + i + '" d="M' + x0 + ',' + base + 'V' + (yv + rr) + 'Q' + x0 + ',' + yv + ' ' + (x0 + rr) + ',' + yv + 'H' + (x0 + bw - rr) + 'Q' + (x0 + bw) + ',' + yv + ' ' + (x0 + bw) + ',' + (yv + rr) + 'V' + base + 'Z"/>';
      const iw2 = Math.min(slot * 0.8, bw + 16);
      s += '<line class="ideal-marca" x1="' + (cx - iw2 / 2) + '" x2="' + (cx + iw2 / 2) + '" y1="' + y(p.ideal) + '" y2="' + y(p.ideal) + '"/>';
      if (!estreito || i % 2 === serie.length % 2 - 1 || i === serie.length - 1)
        s += '<text class="eixo" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + nomeMes(p.mes) + '</text>';
      // rótulo seletivo: último mês fechado e o mês corrente
      if (i >= serie.length - 2) s += '<text class="rotulo" x="' + cx + '" y="' + (Math.min(yv, y(p.ideal)) - 10) + '" text-anchor="middle">' + pct(p.atingimento) + '</text>';
      s += '<rect class="alvo" data-i="' + i + '" x="' + (m.l + slot * i) + '" y="' + m.t + '" width="' + slot + '" height="' + ih + '"/>';
    });
    s += '</svg>';
    el.innerHTML = s;
    el.querySelectorAll('.alvo').forEach((a) => {
      const i = +a.dataset.i, p = serie[i];
      const on = (ev) => {
        el.classList.add('focado');
        el.querySelectorAll('.barra').forEach((b) => b.classList.toggle('ativo', +b.dataset.i === i));
        const pt = ev.touches ? ev.touches[0] : ev;
        mostrarDica('<div class="t">' + nomeMes(p.mes, true) + ' ' + p.mes.slice(0, 4) + (p.parcial ? ' · até dia ' + D.diaAtual : '') + '</div>' +
          '<div class="l">Recebido <b>' + reais(p.recebido) + '</b></div><div class="l">Ideal <b>' + reais(p.ideal) + '</b></div>' +
          '<div class="l">Atingiu <b>' + pct(p.atingimento) + '</b></div><div class="l">Vendido no mês <b>' + reais(p.vendido) + '</b></div>', pt.clientX, pt.clientY);
      };
      a.addEventListener('mousemove', on); a.addEventListener('touchstart', on, { passive: true });
      a.addEventListener('mouseleave', () => { el.classList.remove('focado'); esconderDica(); });
    });
  }
  desenharMeses();
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(desenharMeses, 120); });
  document.addEventListener('touchstart', (e) => { if (!e.target.closest('.alvo')) { esconderDica(); $('graficoMeses').classList.remove('focado'); } }, { passive: true });

  (function () {
    const fechados = D.serieEmpresa.filter((s) => !s.parcial).slice(-12);
    const acima = fechados.filter((s) => s.atingimento >= 100).length;
    const media = fechados.reduce((a, s) => a + s.atingimento, 0) / fechados.length;
    const faltou = fechados.reduce((a, s) => a + Math.max(0, s.ideal - s.recebido), 0);
    $('miniMeses').innerHTML =
      '<div>Meses que bateram o ideal<strong>' + acima + ' de ' + fechados.length + '</strong></div>' +
      '<div>Atingimento médio<strong>' + pct(media) + '</strong></div>' +
      '<div>Faltou pra chegar no ideal (12 meses)<strong>' + milhares(faltou) + '</strong></div>';
  })();

  // ---------- 3. Quando o dinheiro entra ----------
  (function () {
    const c = D.empresa.curva, rg = D.empresa.regua, pp = D.empresa.primeiroPagamento;
    const umEm = Math.round(100 / rg.pctNaRegua);
    $('reguaDestaques').innerHTML =
      '<div><div class="num">1 em ' + umEm + '</div><div class="txt">vendas cumpre a régua inteira: metade em 30 dias e tudo em 60.</div></div>' +
      '<div><div class="num">Dia ' + pp.mediana + '</div><div class="txt">é quando costuma cair o primeiro pagamento. Com isso, a meta dos 30 dias já começa perdida.</div></div>' +
      '<div><div class="num">' + pct(pp.pctSemNenhum) + '</div><div class="txt">das vendas com mais de 60 dias não receberam nenhum pagamento até hoje.</div></div>';
    const linhas = [
      { rot: 'Até 30 dias', v: c.ate30, meta: 50, metaRot: 'régua 50%' },
      { rot: 'Até 60 dias', v: c.ate60, meta: 100, metaRot: 'régua 100%' },
      { rot: 'Até 90 dias', v: c.ate90, meta: null },
    ];
    $('curvaEmpresa').innerHTML = linhas.map((l, i) =>
      '<div class="curva-linha' + (i === 0 ? ' primeira' : '') + '"><div class="rot">' + l.rot + '</div>' +
      '<div class="trilho"><div class="enche" data-w="' + l.v + '"></div>' +
      (l.meta ? '<div class="meta" style="left:calc(' + l.meta + '% - 1px)"></div>' + (i === 0 ? '<div class="meta-rot" style="left:' + l.meta + '%">' + l.metaRot + '</div>' : '') : '') +
      '</div><div class="val">' + pct(l.v) + '</div></div>').join('');
    requestAnimationFrame(() => document.querySelectorAll('.trilho .enche').forEach((e) => (e.style.width = e.dataset.w + '%')));
    const cs = D.coortes.filter((x) => x.curva).map((x) => x.curva.ate60);
    $('reguaNota').innerHTML = 'Porcentagem do valor vendido que já tinha entrado. A marca preta é o que a régua pede. ' +
      'Isso <b>não é de um mês ruim</b>: em cada um dos últimos ' + cs.length + ' meses, o que entrou até 60 dias ficou entre ' + pct(Math.min(...cs)) + ' e ' + pct(Math.max(...cs)) + '. ' +
      'A data usada é a do lançamento no Opy. Se um pagamento é lançado alguns dias depois de recebido, a realidade é um pouco melhor que isso.';
  })();

  // ---------- 4. Rotas ----------
  const rotas = D.rotas.filter((r) => r.clientesCompraram12m >= 10 && !r.vendedor.startsWith('('));
  const foraRotas = D.rotas.filter((r) => !rotas.includes(r));
  const vendedores = [...new Set(rotas.map((r) => r.vendedor))].sort();
  let filtro = 'Todos', ordem = { col: 'vendido12m', asc: false };
  const COLS = [
    { k: 'rota', t: 'Rota', v: (r) => +r.rota },
    { k: 'clientesCompraram12m', t: 'Compraram (12m)', n: 1, v: (r) => r.clientesCompraram12m },
    { k: 'vendido12m', t: 'Vendido (12m)', n: 1, v: (r) => r.vendido12m },
    { k: 'ritmo', t: nomeMes(D.mesAtual, true) + ' até agora', v: (r) => r.ritmo.pctIdeal - r.ritmo.pctNormalNoDia },
    { k: 'fechado', t: nomeMes(D.mesFechado, true) + ' (% do ideal)', n: 1, v: (r) => r.atingimentoMesFechado ?? -1 },
    { k: 'ate60', t: 'Entra até 60 dias', v: (r) => r.curva ? r.curva.ate60 : -1 },
    { k: 'dias', t: 'Dias até quitar', n: 1, v: (r) => r.diasQuitar ? r.diasQuitar.mediana : 999 },
    { k: 'aberta', t: 'Não quitadas (90+ dias)', n: 1, v: (r) => r.diasQuitar ? r.diasQuitar.pctAberta : -1 },
  ];
  const pequena = (r) => !r.regua || r.regua.vendas < AMOSTRA_MIN;

  function celulas(r) {
    const st = statusRitmo(r.ritmo.pctIdeal, r.ritmo.pctNormalNoDia);
    return {
      rota: '<span class="rota-id">Rota ' + r.rota + '</span><span class="vend">' + r.vendedor + '</span>',
      clientesCompraram12m: r.clientesCompraram12m.toLocaleString('pt-BR'),
      vendido12m: milhares(r.vendido12m),
      ritmo: pequena(r) ? '<span class="sub-cel">amostra pequena</span>' : '<span class="status ' + st.cls + '">' + pct(r.ritmo.pctIdeal) + '</span><span class="sub-cel">normal: ' + pct(r.ritmo.pctNormalNoDia) + '</span>',
      fechado: pct(r.atingimentoMesFechado),
      ate60: r.curva ? '<span class="mini-trilho"><b style="width:' + r.curva.ate60 + '%"></b></span>' + pct(r.curva.ate60) : '–',
      dias: r.diasQuitar ? r.diasQuitar.mediana + ' dias' : '–',
      aberta: r.diasQuitar ? pct(r.diasQuitar.pctAberta) : '–',
    };
  }
  function desenharRotas() {
    const col = COLS.find((c) => c.k === ordem.col);
    const lista = rotas.filter((r) => filtro === 'Todos' || r.vendedor === filtro)
      .sort((a, b) => (ordem.asc ? 1 : -1) * (col.v(a) - col.v(b)));
    $('tabelaRotas').innerHTML = '<thead><tr>' + COLS.map((c) =>
      '<th data-k="' + c.k + '" class="' + (c.n ? 'n ' : '') + (c.k === ordem.col ? 'ord' + (ordem.asc ? ' asc' : '') : '') + '">' + c.t + '</th>').join('') + '</tr></thead><tbody>' +
      lista.map((r) => { const c = celulas(r); return '<tr class="' + (pequena(r) ? 'pequena' : '') + '">' + COLS.map((k) => '<td class="' + (k.n ? 'n' : '') + '">' + c[k.k] + '</td>').join('') + '</tr>'; }).join('') + '</tbody>';
    $('tabelaRotas').querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      ordem = ordem.col === th.dataset.k ? { col: th.dataset.k, asc: !ordem.asc } : { col: th.dataset.k, asc: th.dataset.k === 'rota' || th.dataset.k === 'dias' ? true : false };
      desenharRotas();
    }));
    $('cardsRotas').innerHTML = lista.map((r) => {
      const c = celulas(r);
      return '<article class="card-rota' + (pequena(r) ? ' pequena' : '') + '"><header><strong>Rota ' + r.rota + '</strong><span class="vend">' + r.vendedor + '</span></header><dl>' +
        '<div><dt>' + nomeMes(D.mesAtual, true) + ' até agora</dt><dd>' + c.ritmo + '</dd></div>' +
        '<div><dt>' + nomeMes(D.mesFechado, true) + ' (% do ideal)</dt><dd>' + c.fechado + '</dd></div>' +
        '<div><dt>Entra até 60 dias</dt><dd>' + c.ate60 + '</dd></div>' +
        '<div><dt>Dias até quitar</dt><dd>' + c.dias + '</dd></div>' +
        '<div><dt>Compraram (12m)</dt><dd>' + c.clientesCompraram12m + '</dd></div>' +
        '<div><dt>Vendido (12m)</dt><dd>' + c.vendido12m + '</dd></div>' +
        '</dl></article>';
    }).join('');
  }
  $('filtroVendedor').innerHTML = ['Todos', ...vendedores].map((v) => '<button class="pilula' + (v === filtro ? ' ativa' : '') + '" data-v="' + v + '">' + v + '</button>').join('');
  $('filtroVendedor').addEventListener('click', (e) => {
    const b = e.target.closest('.pilula'); if (!b) return;
    filtro = b.dataset.v;
    $('filtroVendedor').querySelectorAll('.pilula').forEach((p) => p.classList.toggle('ativa', p === b));
    desenharRotas();
  });
  desenharRotas();
  $('rotasNota').innerHTML = '<b>' + nomeMes(D.mesAtual, true) + ' até agora</b> compara o que já entrou com o que a mesma rota costuma ter nesse mesmo dia do mês. ' +
    '<b>Dias até quitar</b> e <b>em aberto</b> olham as vendas com 90 dias ou mais. Rotas com menos de ' + AMOSTRA_MIN + ' vendas no período aparecem apagadas, porque poucos casos distorcem a porcentagem.' +
    (foraRotas.length ? ' Fora da lista, por serem muito pequenas: ' + foraRotas.map((r) => 'rota ' + r.rota).join(', ') + '.' : '');

  // ---------- Regras ----------
  const R = D.regras;
  $('listaRegras').innerHTML = [
    ['Ideal', R.ideal], ['Régua', R.regua], ['Quando o dinheiro entra', R.curva], ['Dias até quitar', R.diasQuitar], ['Rota', R.rota],
    ['Origem', 'Relatórios do Opy "Vendas por Período" e "Recebimento por Período", extraídos todo dia pelo robô. Nenhum número vem de planilha antiga.'],
  ].map(([t, x]) => '<li><b>' + t + ':</b> ' + x + '</li>').join('');
})();
