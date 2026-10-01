// Cobrança Diária — mede a lista real que cada vendedor leva pra rua (o mesmo recorte do Relatório de
// Cobrança que o escritório tira pra cada um), mostra o que ficou pra trás e imprime a folha do vendedor.
// O dado vem da linha 'cobranca' da tabela painel_dados (só quem está logado lê), recalculada todo dia
// na nuvem por scripts/cobranca_diaria_v2.js. No PC (localhost) usa dados-local.js do servidor local.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const brl = (v) => 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');
  const dm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—';
  const dmy = (iso) => iso ? iso.split('-').reverse().join('/') : '—';
  const cap = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  let D, atual = 'Todos';
  try { atual = localStorage.getItem('cobranca.vendedor') || 'Todos'; } catch (e) { /* sem storage: começa em Todos */ }

  // Junta as vendas por cliente (o vendedor visita a pessoa, não a venda)
  function clientesDe(nome) {
    const g = {};
    for (const i of D.itens.filter((x) => x.vendedor === nome)) {
      const c = g[i.cod] = g[i.cod] || { cod: i.cod, nome: i.nome, tel: i.tel, end: i.end, bairro: i.bairro, cidade: i.cidade, rota: i.rota, cestas: [], resta: 0, prioridade: 0, esquecido: false, vencida: 0, semRetorno: 0, ultPg: i.ultPg, diasSemPg: i.diasSemPg, sinais: [] };
      c.cestas.push(i); c.resta += i.resta;
      c.esquecido = c.esquecido || i.esquecido; c.vencida = Math.max(c.vencida, i.vencida); c.semRetorno = Math.max(c.semRetorno, i.semRetorno);
      if (i.prioridade > c.prioridade) { c.prioridade = i.prioridade; c.sinais = i.sinais; }
    }
    return Object.values(g).map((c) => ({ ...c, prioridade: c.prioridade + (c.cestas.length - 1) * 0.5 })).sort((a, b) => b.prioridade - a.prioridade);
  }
  const ultimoDiaTrabalhado = (v) => [...v.dias].reverse().find((d) => d.pagou + d.remarcou > 0) || v.dias[v.dias.length - 1];
  const recebido7 = (v) => v.dias.slice(-7).reduce((t, d) => t + d.recebido, 0);

  function seletor() {
    const nomes = ['Todos', ...D.vendedores.map((v) => v.nome)];
    if (!nomes.includes(atual)) atual = 'Todos';
    $('#seletor').innerHTML = nomes.map((n) => `<button class="pilula${n === atual ? ' ativa' : ''}" data-v="${esc(n)}">${esc(n)}</button>`).join('');
    $('#seletor').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => escolher(b.dataset.v)));
  }
  function escolher(n) {
    atual = n; try { localStorage.setItem('cobranca.vendedor', n); } catch (e) { /* ok */ }
    seletor(); render(); window.scrollTo(0, 0);
  }

  function visaoTodos() {
    const vs = D.vendedores;
    const cli = {}; vs.forEach((v) => { const cs = clientesDe(v.nome); cli[v.nome] = { viva: cs.filter((c) => !c.esquecido).length, esq: cs.filter((c) => c.esquecido).length }; });
    const viva = vs.reduce((t, v) => t + cli[v.nome].viva, 0), vViva = vs.reduce((t, v) => t + v.valorViva, 0);
    const esqV = vs.reduce((t, v) => t + v.valorEsquecidos, 0), esqN = vs.reduce((t, v) => t + cli[v.nome].esq, 0);
    return `<section class="al-secao">
      <p class="frase">Na captura de <b>${dmy(D.dadoAte)}</b>, as listas dos vendedores têm <b>${viva} clientes com visita marcada</b> (${brl(vViva)}) e <b>${esqN} clientes esquecidos</b>: visita vencida há mais de 30 dias sem ninguém marcar data nova, somando <b>${brl(esqV)}</b>.</p>
      <div class="painel-card"><div class="al-tabela-scroll"><table class="al-tabela tab-todos">
        <thead><tr><th>Vendedor</th><th class="n">Clientes na lista viva</th><th class="n">Esquecidos</th><th>Último dia de trabalho</th><th class="n">Recebido em 7 dias</th></tr></thead>
        <tbody>${vs.map((v) => { const u = ultimoDiaTrabalhado(v); return `<tr data-v="${esc(v.nome)}">
          <td><b>${esc(v.nome)}</b><br><span class="mudo">${esc(v.recorte)}</span></td>
          <td class="n">${cli[v.nome].viva}<br><span class="mudo">${brl(v.valorViva)}</span></td>
          <td class="n">${cli[v.nome].esq ? `<b>${cli[v.nome].esq}</b><br><span class="mudo">${brl(v.valorEsquecidos)}</span>` : '—'}</td>
          <td class="ult">${u ? `<b>${dm(u.dia)}</b> · ${u.lista} vendas na lista<br><span class="ok">${u.pagou} pagaram (${brl(u.valorPago)})</span> · ${u.remarcou} remarcaram · <b>${u.nada} sem retorno</b>` : '—'}</td>
          <td class="n">${brl(recebido7(v))}</td></tr>`; }).join('')}</tbody>
      </table></div><p class="nota">Toque num vendedor pra ver a lista dele e imprimir a folha.</p></div>
    </section>`;
  }

  function grafico(v) {
    const ds = v.dias; const max = Math.max(1, ...ds.map((d) => d.lista));
    const h = (n) => (100 * n / max).toFixed(1) + '%';
    return `<div class="painel-card">
      <div class="legenda leg"><span><i class="p"></i>Pagou</span><span><i class="r"></i>Remarcou sem pagar</span><span><i class="n"></i>Sem retorno</span></div>
      <div class="dias">${ds.map((d) => `<div class="dia" title="${dm(d.dia)}: ${d.lista} na lista · ${d.pagou} pagaram (${brl(d.valorPago)}) · ${d.remarcou} remarcaram · ${d.nada} sem retorno · recebido no dia ${brl(d.recebido)}"><i class="n" style="height:${h(d.nada)}"></i><i class="r" style="height:${h(d.remarcou)}"></i><i class="p" style="height:${h(d.pagou)}"></i></div>`).join('')}</div>
      <div class="dia-rot">${ds.map((d) => `<span>${dm(d.dia)}</span>`).join('')}</div>
      <p class="nota">Cada coluna é um dia: as vendas da lista viva daquele dia e o que aconteceu com cada um. Dia só cinza = ninguém pagou nem remarcou (domingo, chuva ou dia parado).</p>
    </div>`;
  }

  function cartao(c) {
    const cls = c.esquecido ? 'esq' : (c.semRetorno >= 3 ? 'parado' : '');
    return `<div class="cli ${cls}">
      <div class="cli-top"><b>${esc(c.nome)}</b><span class="sub">Cód. ${esc(c.cod)} · ${esc(c.tel || 'sem telefone')}</span><span class="val">${brl(c.resta)}</span></div>
      <div class="sub">${esc(c.end)} — ${esc(c.bairro)}, ${esc(cap(c.cidade))}</div>
      <div class="cestas">${c.cestas.map((i) => `compra ${dmy(i.compra)}: falta ${brl(i.resta)} de ${brl(i.valor)} · visita marcada ${dmy(i.visita)}`).join('<br>')}</div>
      <div class="sinais">${c.sinais.length ? esc(c.sinais.join(' · ')) : 'visita marcada pra hoje ou há poucos dias'} · último pagamento ${c.ultPg ? dmy(c.ultPg) : 'nunca'}</div>
    </div>`;
  }
  function porRota(lista) {
    const g = {}; lista.forEach((c) => (g[c.rota] = g[c.rota] || []).push(c));
    return Object.keys(g).sort((a, b) => a - b).map((r) => ({ rota: r, clientes: g[r] }));
  }

  function visaoVendedor(v) {
    const cs = clientesDe(v.nome), viva = cs.filter((c) => !c.esquecido), esq = cs.filter((c) => c.esquecido);
    const u = ultimoDiaTrabalhado(v);
    const frase = u ? `No último dia de trabalho do ${esc(v.nome)} (<b>${dmy(u.dia)}</b>), das ${u.lista} vendas da lista viva, <b>${plural(u.pagou, "pagou", "pagaram")}</b> (${brl(u.valorPago)}), ${plural(u.remarcou, 'remarcou', 'remarcaram')} sem pagar e <b>${u.nada} ficaram sem retorno</b>.` : '';
    const semRet = cs.filter((c) => !c.esquecido && c.semRetorno >= 3).length;
    return `<section class="al-secao">
      <p class="frase">${frase}</p>
      <div class="numeros">
        <div class="num"><b>${viva.length}</b><span>clientes na lista viva · ${brl(viva.reduce((t, c) => t + c.resta, 0))}</span></div>
        <div class="num ${esq.length ? 'ruim' : 'bom'}"><b>${esq.length}</b><span>esquecidos (visita vencida há +30 dias) · ${brl(esq.reduce((t, c) => t + c.resta, 0))}</span></div>
        <div class="num ${semRet ? 'meio' : 'bom'}"><b>${semRet}</b><span>na lista viva há 3+ dias de trabalho sem retorno</span></div>
        <div class="num"><b>${brl(recebido7(v))}</b><span>recebido nos últimos 7 dias (todas as vendas das rotas)</span></div>
      </div>
      <h2>Últimos ${v.dias.length} dias</h2>
      ${grafico(v)}
    </section>
    <section class="al-secao">
      <h2>Lista de ${esc(v.nome)}</h2>
      <p class="al-secao-sub">${esc(v.recorte)} · rotas ${v.rotas.join(', ')} · só clientes Ativo. Do pior pro menos pior em cada rota.</p>
      <div class="barra-acoes">
        <button class="al-botao al-dourado" id="imprimirTudo">Imprimir a lista (${cs.length})</button>
        ${esq.length ? `<button class="al-botao" id="imprimirEsq">Imprimir só os esquecidos (${esq.length})</button>` : ''}
      </div>
      ${esq.length ? `<details class="bloco" open><summary><span class="bloco-tit">Esquecidos</span><span class="bloco-resumo">${plural(esq.length, 'cliente', 'clientes')} · ${brl(esq.reduce((t, c) => t + c.resta, 0))} · visita vencida há mais de 30 dias e ninguém marcou data nova</span></summary><div class="bloco-corpo">${porRota(esq).map((g) => `<div class="rota-tit">Rota ${g.rota} · ${g.clientes.length}</div><div class="lista-cli">${g.clientes.map(cartao).join('')}</div>`).join('')}</div></details>` : ''}
      <details class="bloco" ${esq.length ? '' : 'open'}><summary><span class="bloco-tit">Lista viva</span><span class="bloco-resumo">${plural(viva.length, 'cliente', 'clientes')} · ${brl(viva.reduce((t, c) => t + c.resta, 0))} · visita marcada até hoje</span></summary><div class="bloco-corpo">${porRota(viva).map((g) => `<div class="rota-tit">Rota ${g.rota} · ${g.clientes.length}</div><div class="lista-cli">${g.clientes.map(cartao).join('')}</div>`).join('')}</div></details>
    </section>`;
  }

  // Folha de impressão: modelo aprovado em 28/09/2026 (A4 deitado, uma rota por página, do pior pro menos pior)
  function imprimir(v, soEsquecidos) {
    const cs = clientesDe(v.nome).filter((c) => !soEsquecidos || c.esquecido);
    const linhas = (lista) => lista.map((c, i) => `<tr class="${c.esquecido ? 'esq' : ''}">
      <td class="num">${i + 1}</td>
      <td><b>${esc(c.nome)}</b><br>Cód. ${esc(c.cod)} · ${esc(c.tel || 'sem tel.')}<br>${esc(c.end)} — ${esc(c.bairro)}, ${esc(cap(c.cidade))}</td>
      <td>${c.cestas.map((i) => `${dm(i.compra)}/${i.compra.slice(2, 4)}: <b>${brl(i.resta)}</b> de ${brl(i.valor)}`).join('<br>')}</td>
      <td>${c.ultPg ? dmy(c.ultPg) : 'nunca pagou'}<br>visita: ${c.cestas.map((i) => dm(i.visita)).join(', ')}</td>
      <td><b>${c.esquecido ? 'ESQUECIDO' : c.semRetorno >= 3 ? 'SEM RETORNO' : 'EM DIA DE VISITA'}</b><br>${esc(c.sinais.join('; '))}</td>
      <td class="resp"><span>Pagou? ☐S ☐N R$______</span><span>Nova data: ___/___</span><span>Obs.: ____________</span></td></tr>`).join('');
    $('#folha').innerHTML = `<div class="folha">
      <h1>Lista de cobrança — ${esc(v.nome)}${soEsquecidos ? ' (só esquecidos)' : ''}</h1>
      <p class="sub">Captura do Opy de ${dmy(D.dadoAte)} · ${esc(v.recorte)} · só clientes Ativo · ${cs.length} clientes · ${brl(cs.reduce((t, c) => t + c.resta, 0))} em aberto</p>
      <div class="guia"><b>Ordem:</b> em cada rota, do pior pro menos pior. Borda grossa = esquecido (visita vencida há +30 dias, ninguém marcou data nova). Anote o que aconteceu em cada casa pra lançar no Opy.</div>
      ${porRota(cs).map((g) => `<section><h2>Rota ${g.rota} · ${g.clientes.length} clientes · ${brl(g.clientes.reduce((t, c) => t + c.resta, 0))}</h2>
        <table><colgroup><col style="width:26px"><col style="width:30%"><col style="width:17%"><col style="width:11%"><col style="width:22%"><col style="width:17%"></colgroup>
        <thead><tr><th>#</th><th>Cliente · telefone · endereço</th><th>Cestas (falta)</th><th>Último pagto.</th><th>Situação e sinais</th><th>Resposta</th></tr></thead>
        <tbody>${linhas(g.clientes)}</tbody></table></section>`).join('')}
    </div>`;
    window.print();
  }

  function render() {
    $('#dadoAte').textContent = 'Captura do Opy: ' + dmy(D.dadoAte);
    $('#alertas').innerHTML = (D.alertas || []).map((a) => `<div class="aviso-trava">⚠ ${esc(a)}</div>`).join('');
    const v = D.vendedores.find((x) => x.nome === atual);
    $('#visao').innerHTML = v ? visaoVendedor(v) : visaoTodos();
    if (v) {
      $('#imprimirTudo').addEventListener('click', () => imprimir(v, false));
      const e = $('#imprimirEsq'); if (e) e.addEventListener('click', () => imprimir(v, true));
    } else {
      document.querySelectorAll('.tab-todos tbody tr').forEach((tr) => tr.addEventListener('click', () => escolher(tr.dataset.v)));
    }
  }

  function iniciarTela(dados) {
    D = dados;
    document.getElementById('gateLogin').style.display = 'none';
    document.getElementById('conteudoPainel').style.display = '';
    seletor(); render();
  }

  async function aposLogin() {
    const c = $('#carregando'); c.hidden = false;
    try {
      const { data, error } = await window.dbAuth.from('painel_dados').select('dados').eq('id', 'cobranca').single();
      if (error || !data) throw new Error(error ? error.message : 'sem dado');
      c.hidden = true; iniciarTela(data.dados);
      if (window.montarBotaoAtualizar) montarBotaoAtualizar(document.getElementById('atualizarOpy'), () => location.reload());
    } catch (e) {
      c.querySelector('p').textContent = 'Não consegui carregar a cobrança (' + e.message + '). Tente recarregar em alguns minutos.';
    }
  }

  async function iniciar() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try {
        await new Promise((ok, falha) => { const s = document.createElement('script'); s.src = 'dados-local.js'; s.onload = ok; s.onerror = falha; document.body.appendChild(s); });
        if (window.DADOS_COBRANCA) return iniciarTela(window.DADOS_COBRANCA);
      } catch (e) { /* sem servidor local: segue pro login */ }
    }
    iniciarLoginGate(aposLogin);
  }
  iniciar();
})();
