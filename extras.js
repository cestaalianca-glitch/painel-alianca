// Painel v2 — bloco por vendedor (aba O mês) e frase-resumo de cada bloco recolhível (abas O mês e
// Histórico). Pedido do usuário 28/09/2026: "muito cheio de informação" → cada parte diz em uma
// frase o que quer dizer, e o detalhe só abre quando ele clicar.
(function () {
  const M = window.DADOS_MES, H = window.DADOS_HISTORICO;
  const $ = (id) => document.getElementById(id);
  const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = (m) => MESES_L[Number(m.split('-')[1]) - 1];
  const reais = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const mil = (n) => n >= 1e6 ? 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi' : 'R$ ' + Math.round(n / 1000).toLocaleString('pt-BR') + ' mil';
  const pct = (n) => (n === null || n === undefined ? '–' : Math.round(n) + '%');
  const status = (atual, normal) => {
    if (atual === null || normal === null) return { cls: '', txt: 'Sem base', badge: '' };
    const d = atual - normal;
    if (d >= -3) return { cls: 'bom', txt: 'No ritmo', badge: 'al-verde' };
    if (d >= -12) return { cls: 'atencao', txt: 'Um pouco atrás', badge: 'al-amarelo' };
    return { cls: 'critico', txt: 'Bem atrás', badge: 'al-vermelho' };
  };

  // Gráficos dentro de bloco fechado não têm largura: redesenha quando o bloco abre.
  document.addEventListener('toggle', () => window.dispatchEvent(new Event('resize')), true);

  // ---------- Aba O mês: cada vendedor ----------
  if (M && M.porVendedor) {
    const mesAtual = nomeMes(M.mesAtual), mesFechado = nomeMes(M.mesFechado);
    $('tituloVend').textContent = 'Cada vendedor em ' + mesAtual;
    $('cardsVendedor').innerHTML = M.porVendedor.map((v) => {
      const r = v.ritmo, st = status(r.pctIdeal, r.pctNormalNoDia);
      const escala = Math.max(100, r.pctIdeal || 0, r.pctNormalNoDia || 0);
      const falta = ((r.pctNormalNoDia || 0) - (r.pctIdeal || 0)) / 100 * r.ideal;
      const frase = falta > 0
        ? 'Faltam <b>' + reais(falta) + '</b> pra ficar no ritmo de sempre no dia ' + M.diaAtual + '.'
        : 'Está <b>' + reais(-falta) + '</b> à frente do ritmo de sempre.';
      return '<article class="vcard ' + st.cls + '">' +
        '<header><div><strong>' + v.vendedor + '</strong><small>rota' + (v.rotas.length > 1 ? 's ' : ' ') + v.rotas.join(', ') + '</small></div>' +
        (st.badge ? '<span class="al-badge ' + st.badge + '">' + st.txt + '</span>' : '') + '</header>' +
        '<div class="vc-ideal"><small>Ideal de ' + mesAtual + '</small><span>' + reais(r.ideal) + '</span></div>' +
        '<div class="vc-entrou">Já entrou <b>' + reais(r.recebido) + '</b> · ' + pct(r.pctIdeal) + ' do ideal</div>' +
        '<div class="medidor pequeno" aria-hidden="true"><div class="medidor-fill" style="width:' + (100 * (r.pctIdeal || 0) / escala) + '%"></div>' +
        '<div class="medidor-marca" style="left:' + (100 * (r.pctNormalNoDia || 0) / escala) + '%"></div></div>' +
        '<p class="vc-frase">' + frase + ' <span class="mudo">(risquinho = onde costuma estar no dia ' + M.diaAtual + ': ' + pct(r.pctNormalNoDia) + ')</span></p>' +
        '<p class="vc-rodape">Em ' + mesFechado + ' recebeu ' + pct(v.mesFechado.atingimento) + ' do ideal (' + mil(v.mesFechado.recebido) + ' de ' + mil(v.mesFechado.ideal) + ') · vendeu ' + mil(v.vendidoMesAtual) + ' em ' + mesAtual + ' até agora</p>' +
        '</article>';
    }).join('');
  }

  // ---------- Aba O mês: frases-resumo ----------
  if (M) {
    const fech = M.serieEmpresa.filter((s) => !s.parcial).slice(-12);
    const bateram = fech.filter((s) => s.atingimento >= 100).length;
    const media = fech.reduce((a, s) => a + s.atingimento, 0) / fech.length;
    $('resMeses').textContent = (bateram === 0 ? 'Nenhum' : bateram) + ' dos últimos 12 meses bateu o ideal. Em média entrou ' + pct(media) + ' do que deveria.';
    const rg = M.empresa.regua, pp = M.empresa.primeiroPagamento;
    $('resRegua').textContent = 'Só 1 em cada ' + Math.round(100 / rg.pctNaRegua) + ' vendas é paga no prazo. O 1º pagamento costuma vir lá pelo dia ' + pp.mediana + '.';
    const cont = { bom: 0, atencao: 0, critico: 0 };
    M.rotas.filter((r) => r.clientesCompraram12m >= 10 && r.regua && r.regua.vendas >= 30).forEach((r) => { const s = status(r.ritmo.pctIdeal, r.ritmo.pctNormalNoDia); if (s.cls) cont[s.cls]++; });
    $('resRotas').textContent = cont.bom + ' rotas no ritmo, ' + cont.atencao + ' um pouco atrás e ' + cont.critico + ' bem atrás neste mês.';
  }

  // ---------- Aba Histórico: frases-resumo ----------
  if (H) {
    const p = H.previsao && H.previsao[0];
    if (p) $('resPrev').textContent = nomeMes(p.mes).replace(/^./, (c) => c.toUpperCase()) + ' deve fechar entre ' + mil(p.min) + ' e ' + mil(p.max) + '. Já entrou ' + mil(p.jaEntrou || 0) + '.';
    const o = H.origem, velhos = o.slice(-2);
    const pa = velhos.reduce((a, x) => a + x.pctAberto, 0), pe = velhos.reduce((a, x) => a + x.pctEntrou, 0);
    $('resOrigem').textContent = Math.round(pa) + '% do que os clientes devem é de vendas com mais de 1 ano, mas só ' + pe.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% do dinheiro que entra vem delas.';
    const anos = H.anos, atual = anos[anos.length - 1], ant = anos[anos.length - 2];
    $('resAnos').textContent = atual.ano + ' até agora: ' + mil(atual.vendido) + '. ' + ant.ano + ' inteiro: ' + mil(ant.vendido) + '.';
    const z = H.sazonalidade.slice().sort((a, b) => b.indice - a.indice);
    $('resSaz').textContent = 'Vende mais em ' + MESES_L[z[0].mes - 1] + ' e ' + MESES_L[z[1].mes - 1] + '; menos em ' + MESES_L[z[11].mes - 1] + ' e ' + MESES_L[z[10].mes - 1] + '.';
  }
})();
