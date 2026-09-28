// Painel v2 — aba "Histórico". Lê window.DADOS_HISTORICO (scripts/painel_v2_historico.js).
(function () {
  const H = window.DADOS_HISTORICO;
  if (!H) return;
  const $ = (id) => document.getElementById(id);
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nm = (m, longo) => { const [y, mm] = m.split('-').map(Number); return longo ? MESES_L[mm - 1] : MESES[mm - 1] + '/' + String(y).slice(2); };
  const reais = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const mil = (n) => n >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : 'R$ ' + Math.round(n / 1000).toLocaleString('pt-BR') + ' mil';
  const pct = (n, d = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';

  // ---------- Dica ----------
  const dica = $('dica');
  function dicaOn(html, ev) {
    const pt = ev.touches ? ev.touches[0] : ev;
    dica.innerHTML = html; dica.classList.add('on');
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let left = pt.clientX + 14, top = pt.clientY - h - 12;
    if (left + w > innerWidth - 8) left = pt.clientX - w - 14;
    if (top < 8) top = pt.clientY + 16;
    dica.style.left = Math.max(8, left) + 'px'; dica.style.top = top + 'px';
  }
  const dicaOff = () => dica.classList.remove('on');
  function ligarAlvos(el, conteudo) {
    el.querySelectorAll('.alvo').forEach((a) => {
      const on = (ev) => { el.classList.add('focado'); el.querySelectorAll('[data-i]').forEach((b) => b.classList.toggle('ativo', b.dataset.i === a.dataset.i)); dicaOn(conteudo(+a.dataset.i), ev); };
      a.addEventListener('mousemove', on); a.addEventListener('touchstart', on, { passive: true });
      a.addEventListener('mouseleave', () => { el.classList.remove('focado'); dicaOff(); });
    });
  }
  const linha = (l, v) => '<div class="l">' + l + ' <b>' + v + '</b></div>';

  // Barra com topo arredondado (4px) e base reta
  function barra(x, y, w, base, cls, i) {
    const r = Math.min(4, (base - y) / 2, w / 2);
    return '<path class="' + cls + '" data-i="' + i + '" d="M' + x + ',' + base + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + base + 'Z"/>';
  }
  function eixoY(s, m, W, y, topo, passo, fmt) {
    for (let v = 0; v <= topo + 1e-9; v += passo) {
      s.push('<line class="grade-linha" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>');
      s.push('<text class="eixo" x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>');
    }
  }
  const passoBom = (max, n) => { const bruto = max / n, p = Math.pow(10, Math.floor(Math.log10(bruto))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= bruto); };

  // ---------- Topo: ano ----------
  const Y = H.ytd;
  $('hAnoSobre').textContent = Y.ano + ' · de janeiro a ' + MESES_L[Y.meses - 1];
  $('hAnoVar').textContent = (Y.variacao > 0 ? '+' : '−') + pct(Math.abs(Y.variacao));
  $('hAnoTxt').innerHTML = 'de vendas em relação ao mesmo período de ' + (Y.ano - 1) + '<br><b>' + mil(Y.vendido) + '</b> contra ' + mil(Y.anterior);

  function gAnos() {
    const el = $('gAnos'); if (!el.clientWidth) return;
    const W = el.clientWidth, estreito = W < 560, Hh = estreito ? 220 : 260;
    const m = { t: 16, r: 4, b: 26, l: estreito ? 50 : 64 }, ih = Hh - m.t - m.b, iw = W - m.l - m.r;
    const d = H.anos, max = Math.max(...d.map((x) => x.vendido)), passo = passoBom(max, 4), topo = Math.ceil(max / passo) * passo;
    const y = (v) => m.t + ih - (v / topo) * ih, slot = iw / d.length, bw = Math.min(24, slot * 0.62);
    const s = ['<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Valor vendido por ano">'];
    eixoY(s, m, W, y, topo, passo, (v) => v === 0 ? '0' : (v / 1e6).toLocaleString('pt-BR') + ' mi');
    d.forEach((a, i) => {
      const cx = m.l + slot * i + slot / 2;
      if (a.incompleto) s.push('<rect class="sem-dado" data-i="' + i + '" x="' + (cx - bw / 2) + '" y="' + (y(0) - 6) + '" width="' + bw + '" height="6" rx="2"/>');
      else s.push(barra(cx - bw / 2, y(a.vendido), bw, y(0), 'barra' + (a.parcial ? ' parcial' : ''), i));
      const cada = estreito ? 5 : 3;
      if ((i % cada === 0 && d.length - 1 - i >= (estreito ? 3 : 2)) || i === d.length - 1) s.push('<text class="eixo" x="' + cx + '" y="' + (Hh - 6) + '" text-anchor="middle">' + (estreito ? "'" + String(a.ano).slice(2) : a.ano) + '</text>');
      s.push('<rect class="alvo" data-i="' + i + '" x="' + (m.l + slot * i) + '" y="' + m.t + '" width="' + slot + '" height="' + ih + '"/>');
    });
    s.push('</svg>'); el.innerHTML = s.join('');
    ligarAlvos(el, (i) => '<div class="t">' + d[i].ano + (d[i].parcial ? ' · até agora' : '') + '</div>' + (d[i].incompleto ? '<div class="l">Sem dado completo: ' + d[i].mesesComDado + ' de 12 meses extraídos</div>' : linha('Vendido', reais(d[i].vendido))));
    const buracos = d.filter((a) => a.incompleto).map((a) => a.ano);
    $('notaAnos').textContent = buracos.length ? 'Os anos ' + buracos.join(' e ') + ' aparecem só com um traço: a extração do Opy veio com meses faltando nesse período, então não dá pra comparar.' : '';
  }

  // ---------- Quanto de cada mês de venda já voltou (valores reais) ----------
  (function () {
    const S = H.safras || [];
    const max = Math.max(...S.map((x) => x.vendido));
    const fechados = S.filter((x) => !x.parcial);
    const ref = fechados.find((x) => x.mes === (fechados[fechados.length - 7] || {}).mes) || fechados[0];
    if (ref) {
      const perdido = Math.max(0, ref.vendido - ref.entrou - ref.emAberto);
      $('subSafras').innerHTML = 'Cada linha é um mês de venda. Exemplo real: em <b>' + nm(ref.mes, true) + '</b> vocês venderam <b>' + reais(ref.vendido) + '</b>; até hoje já entraram <b>' + reais(ref.entrou) + '</b>, ainda falta receber <b>' + reais(ref.emAberto) + '</b>' + (perdido > 100 ? ' e <b>' + reais(perdido) + '</b> foram baixados ou não vão entrar' : '') + '. Os meses mais recentes ainda estão sendo pagos, é normal terem pouco "já entrou".';
    }
    $('tabSafras').innerHTML = '<div class="sf-cab"><span>Mês da venda</span><span>Vendido</span><span></span><span>Já entrou</span><span>Em aberto</span></div>' +
      S.slice().reverse().map((x) => {
        const perd = Math.max(0, x.vendido - x.entrou - x.emAberto);
        const w = (v) => (100 * v / max).toFixed(2) + '%';
        return '<div class="sf-linha' + (x.parcial ? ' parcial' : '') + '">' +
          '<span class="sf-mes">' + nm(x.mes, true).replace(/^./, (c) => c.toUpperCase()) + ' ' + x.mes.slice(2, 4) + (x.parcial ? ' <small>em andamento</small>' : '') + '</span>' +
          '<span class="sf-num sf-v">' + mil(x.vendido) + '</span>' +
          '<span class="sf-barra"><b class="sf-e" style="width:' + w(Math.min(x.entrou, x.vendido)) + '"></b><b class="sf-a" style="width:' + w(x.emAberto) + '"></b><b class="sf-p" style="width:' + w(perd) + '"></b></span>' +
          '<span class="sf-num sf-en">' + mil(x.entrou) + '</span>' +
          '<span class="sf-num sf-ab aberto">' + mil(x.emAberto) + '</span></div>';
      }).join('');
  })();

  // ---------- Origem ----------
  (function () {
    const o = H.origem, max = Math.max(...o.map((x) => Math.max(x.pctAberto, x.pctEntrou)));
    $('gOrigem').innerHTML = '<div class="or-cab"><span></span><span>Em aberto hoje</span><span>Entrou em 12 meses</span></div>' +
      o.map((f) => '<div class="or-linha"><span class="or-faixa">' + f.faixa + '</span>' +
        '<span class="or-cel"><span class="or-trilho"><b class="or-aberto" style="width:' + (100 * f.pctAberto / max) + '%"></b></span><span class="or-val">' + pct(f.pctAberto) + '<small>' + mil(f.aberto) + '</small></span></span>' +
        '<span class="or-cel"><span class="or-trilho"><b class="or-entrou" style="width:' + (100 * f.pctEntrou / max) + '%"></b></span><span class="or-val">' + pct(f.pctEntrou) + '<small>' + mil(f.entrou12m) + '</small></span></span></div>').join('');
    const velho = o[o.length - 1], velhos = o.slice(-2);
    const pAberto = velhos.reduce((a, x) => a + x.pctAberto, 0), pEntrou = velhos.reduce((a, x) => a + x.pctEntrou, 0);
    $('notaOrigem').innerHTML = '<b>' + pct(pAberto) + ' da dívida em aberto (' + mil(velhos.reduce((a, x) => a + x.aberto, 0)) + ') vem de vendas com mais de 1 ano</b>, mas só ' + pct(pEntrou, 1) + ' do dinheiro que entrou veio delas. ' +
      'Na prática, quase todo recebimento vem de vendas com menos de 6 meses. A dívida velha pesa no total, mas não vira caixa. Por isso cobrar cedo vale mais do que correr atrás do que já envelheceu.';
  })();

  // ---------- Previsão ----------
  $('subPrev').innerHTML = 'Cada mês de venda é tratado como uma safra, e o painel aprende quanto de cada safra entra mês a mês. ' +
    (H.sempreAcima ? 'No teste com os últimos 6 meses, o método <b>sempre previu mais do que entrou</b> (em média ' + pct(H.vies, 1) + '): o recebimento vem ficando abaixo do próprio padrão recente. A previsão abaixo já desconta isso.' : 'Testado nos últimos 6 meses com erro médio de ' + pct(H.erroMedio, 1) + '.');
  function gPrev() {
    const el = $('gPrev'); if (!el.clientWidth) return;
    const W = el.clientWidth, estreito = W < 560, Hh = estreito ? 230 : 270;
    const m = { t: 22, r: 4, b: 26, l: estreito ? 44 : 60 }, ih = Hh - m.t - m.b, iw = W - m.l - m.r;
    const itens = H.real12.map((r) => ({ mes: r.mes, real: r.recebido })).concat(H.previsao.map((p) => ({ mes: p.mes, prev: p })));
    const max = Math.max(...itens.map((i) => i.real || i.prev.max)), passo = passoBom(max, 4), topo = Math.ceil(max / passo) * passo;
    const y = (v) => m.t + ih - (v / topo) * ih, slot = iw / itens.length, bw = Math.min(24, slot * 0.5);
    const s = ['<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Recebido nos últimos 12 meses e previsão dos próximos 3">'];
    eixoY(s, m, W, y, topo, passo, (v) => v === 0 ? '0' : (v / 1000) + ' mil');
    const x0 = m.l + slot * H.real12.length;
    s.push('<rect class="zona-prev" x="' + x0 + '" y="' + m.t + '" width="' + (W - m.r - x0) + '" height="' + ih + '"/>');
    s.push('<text class="eixo" x="' + (x0 + 8) + '" y="' + (m.t + 12) + '">previsão</text>');
    itens.forEach((it, i) => {
      const cx = m.l + slot * i + slot / 2;
      if (it.real !== undefined) s.push(barra(cx - bw / 2, y(it.real), bw, y(0), 'barra', i));
      else {
        const p = it.prev;
        if (p.jaEntrou) s.push(barra(cx - bw / 2, y(p.jaEntrou), bw, y(0), 'barra parcial', i));
        s.push('<rect class="faixa-prev" data-i="' + i + '" x="' + (cx - bw / 2 - 3) + '" y="' + y(p.max) + '" width="' + (bw + 6) + '" height="' + Math.max(2, y(p.min) - y(p.max)) + '" rx="4"/>');
        s.push('<line class="ideal-marca" x1="' + (cx - bw / 2 - 5) + '" x2="' + (cx + bw / 2 + 5) + '" y1="' + y(p.previsto) + '" y2="' + y(p.previsto) + '"/>');
        if (!estreito || i === H.real12.length) s.push('<text class="rotulo" x="' + cx + '" y="' + (y(p.max) - 8) + '" text-anchor="middle">' + Math.round(p.previsto / 1000) + ' mil</text>');
      }
      if (!estreito || i % 2 === 1) s.push('<text class="eixo" x="' + cx + '" y="' + (Hh - 6) + '" text-anchor="middle">' + nm(it.mes) + '</text>');
      s.push('<rect class="alvo" data-i="' + i + '" x="' + (m.l + slot * i) + '" y="' + m.t + '" width="' + slot + '" height="' + ih + '"/>');
    });
    s.push('</svg>'); el.innerHTML = s.join('');
    ligarAlvos(el, (i) => {
      const it = itens[i], t = '<div class="t">' + nm(it.mes, true) + ' ' + it.mes.slice(0, 4) + '</div>';
      if (it.real !== undefined) return t + linha('Recebido', reais(it.real));
      return t + linha('Previsto', reais(it.prev.previsto)) + linha('Faixa provável', mil(it.prev.min) + ' a ' + mil(it.prev.max)) + (it.prev.jaEntrou ? linha('Já entrou', reais(it.prev.jaEntrou)) : '');
    });
  }
  $('tabTeste').innerHTML = '<h4>Teste: o que o método teria previsto nos meses que já passaram</h4><div class="teste-grade">' +
    H.teste.map((t) => '<div><span class="t-mes">' + nm(t.mes) + '</span><span>previsto <b>' + mil(t.previsto) + '</b></span><span>entrou <b>' + mil(t.real) + '</b></span><span class="t-erro">' + (t.erroPct > 0 ? '+' : '') + pct(t.erroPct, 1) + '</span></div>').join('') + '</div>';

  // ---------- Sazonalidade ----------
  const Z = H.sazonalidade;
  const ord = [...Z].sort((a, b) => b.indice - a.indice);
  $('subSaz').innerHTML = 'Média de ' + H.sazonalidadeAnos[0] + ' a ' + H.sazonalidadeAnos[1] + ', com 100 = mês normal. Os meses mais fortes são <b>' + MESES_L[ord[0].mes - 1] + '</b> (' + ord[0].indice + ') e <b>' + MESES_L[ord[1].mes - 1] + '</b> (' + ord[1].indice + '); os mais fracos são <b>' + MESES_L[ord[11].mes - 1] + '</b> (' + ord[11].indice + ') e <b>' + MESES_L[ord[10].mes - 1] + '</b> (' + ord[10].indice + ').';
  function gSaz() {
    const el = $('gSaz'); if (!el.clientWidth) return;
    const W = el.clientWidth, estreito = W < 560, Hh = estreito ? 200 : 230;
    const m = { t: 20, r: 4, b: 26, l: 36 }, ih = Hh - m.t - m.b, iw = W - m.l - m.r;
    const lo = Math.min(80, ...Z.map((z) => z.indice)), hi = Math.max(120, ...Z.map((z) => z.indice));
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih, slot = iw / 12, bw = Math.min(24, slot * 0.55);
    const s = ['<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Índice de vendas por mês do ano">'];
    [lo, 100, hi].forEach((v) => { s.push('<line class="' + (v === 100 ? 'base-100' : 'grade-linha') + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>'); s.push('<text class="eixo" x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'); });
    Z.forEach((z, i) => {
      const cx = m.l + slot * i + slot / 2, acima = z.indice >= 100, y1 = y(Math.max(z.indice, 100)), y2 = y(Math.min(z.indice, 100));
      const r = Math.min(4, (y2 - y1) / 2);
      const x = cx - bw / 2;
      const d = acima
        ? 'M' + x + ',' + y2 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y1 + ' ' + (x + bw) + ',' + (y1 + r) + 'V' + y2 + 'Z'
        : 'M' + x + ',' + y1 + 'V' + (y2 - r) + 'Q' + x + ',' + y2 + ' ' + (x + r) + ',' + y2 + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y2 + ' ' + (x + bw) + ',' + (y2 - r) + 'V' + y1 + 'Z';
      s.push('<path class="' + (acima ? 'saz-acima' : 'saz-abaixo') + '" data-i="' + i + '" d="' + d + '"/>');
      s.push('<text class="eixo" x="' + cx + '" y="' + (Hh - 6) + '" text-anchor="middle">' + (estreito ? MESES[i][0].toUpperCase() : MESES[i]) + '</text>');
      s.push('<rect class="alvo" data-i="' + i + '" x="' + (m.l + slot * i) + '" y="' + m.t + '" width="' + slot + '" height="' + ih + '"/>');
    });
    s.push('</svg>'); el.innerHTML = s.join('');
    ligarAlvos(el, (i) => '<div class="t">' + MESES_L[i][0].toUpperCase() + MESES_L[i].slice(1) + '</div>' + linha('Índice', Z[i].indice) + '<div class="l">' + (Z[i].indice >= 100 ? 'vende ' + (Z[i].indice - 100) + '% acima do normal' : 'vende ' + (100 - Z[i].indice) + '% abaixo do normal') + '</div>');
  }

  function desenhar() { gAnos(); gPrev(); gSaz(); }
  desenhar();
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(desenhar, 120); });

  // ---------- Regras ----------
  const R = H.regras;
  $('regrasHist').innerHTML = [['Vendas por ano', R.anos], ['Quanto já voltou', 'Vendido: soma das vendas do mês (Relatório Vendas por Período). Já entrou: todo pagamento lançado até hoje para as vendas daquele mês. Em aberto: saldo de hoje dessas vendas no Relatório de Cobrança. O que sobra foi baixado, descontado ou não vai entrar.'], ['Dívida × dinheiro', R.origem], ['Previsão', R.previsao], ['Teste', R.teste], ['Meses fortes e fracos', R.sazonalidade]]
    .map(([t, x]) => '<li><b>' + t + ':</b> ' + x + '</li>').join('');
})();
