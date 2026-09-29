// Carregamento e Trocas V2 (28/09/2026). Quem lança é o CONFERENTE (Luan), pelo celular; o dono acompanha do
// escritório. Regras do negócio (explicadas pelo usuário):
//  * Só sai cesta GRANDE. Quando o cliente quer Padrão, o kit complemento volta: Padrão vendida = complemento.
//  * O carro é estoque de um dia pro outro: chegou com 2, carregou 4, saiu com 6; no dia seguinte chega com 3
//    → vendeu 3. A "volta" é a contagem da manhã seguinte.
//  * Compra fora do estoque acontece DEPOIS de registrar uma troca ou uma Montada, com o dinheiro do cliente.
// Tabelas cc_carregamento_v2, cc_trocas_v2, cc_montadas_v2 (Supabase), acesso por papel (al_papeis).
// No PC (localhost) roda num modo de teste que guarda tudo no navegador, sem tocar no banco.
(function () {
  const VENDEDORES = ['Pedro', 'Kinka', 'João', 'Juciano/Joãozinho', 'Jayme', 'Luan'];
  const CENARIO = { pap_na_hora: 'Na hora, na casa do cliente', antecipada_item_deixado: 'Combinada antes, item já estava aqui', antecipada_sem_item: 'Combinada antes, item ainda com o cliente' };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília
  const somaDias = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
  const dm = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  const valorDe = (txt) => parseFloat(String(txt).replace(/\./g, '').replace(',', '.'));
  let api, papel, email, dia = hojeISO(), aba = 'hoje';
  let carg = {}, anterior = {}, trocas = [], montadas = [];

  // ---------- Acesso a dados (Supabase ou teste local) ----------
  function apiSupabase(db) {
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      papel: async () => { const r = ok(await db.from('al_papeis').select('papel').limit(1)); return r[0] ? r[0].papel : null; },
      carregamento: async (de, ate) => ok(await db.from('cc_carregamento_v2').select('*').gte('data', de).lte('data', ate)),
      salvarCarregamento: async (l) => ok(await db.from('cc_carregamento_v2').upsert({ ...l, atualizado_por: email, atualizado_em: new Date().toISOString() })),
      trocasAbertasEDoDia: async (d) => ok(await db.from('cc_trocas_v2').select('*').or(`status.eq.pendente,data.eq.${d}`).order('criado_em')),
      novaTroca: async (t) => ok(await db.from('cc_trocas_v2').insert({ ...t, registrado_por: email })),
      mudarTroca: async (id, campos) => ok(await db.from('cc_trocas_v2').update(campos).eq('id', id)),
      montadasAbertasEDoDia: async (d) => ok(await db.from('cc_montadas_v2').select('*').or(`status.eq.aberta,saiu_em.eq.${d},data.eq.${d}`).order('criado_em')),
      novaMontada: async (m) => ok(await db.from('cc_montadas_v2').insert({ ...m, registrado_por: email })),
      mudarMontada: async (id, campos) => ok(await db.from('cc_montadas_v2').update(campos).eq('id', id)),
      periodo: async (de) => ({
        carg: ok(await db.from('cc_carregamento_v2').select('*').gte('data', somaDias(de, -10))),
        trocas: ok(await db.from('cc_trocas_v2').select('data,status,compra_valor,compra_em').gte('data', de)),
        montadas: ok(await db.from('cc_montadas_v2').select('data,status,saiu_em,compra_valor,compra_em').gte('data', de)),
      }),
    };
  }
  function apiTeste() { // só no PC: guarda no navegador pra testar as telas
    const ler = (k) => { try { return JSON.parse(localStorage.getItem('cc_teste_' + k)) || []; } catch (e) { return []; } };
    const gravar = (k, v) => { try { localStorage.setItem('cc_teste_' + k, JSON.stringify(v)); } catch (e) { /* ok */ } };
    let seq = Date.now();
    const mudar = (k) => async (id, campos) => gravar(k, ler(k).map((x) => x.id === id ? { ...x, ...campos } : x));
    return {
      papel: async () => 'admin',
      carregamento: async (de, ate) => ler('carg').filter((x) => x.data >= de && x.data <= ate),
      salvarCarregamento: async (l) => { const a = ler('carg').filter((x) => !(x.data === l.data && x.vendedor === l.vendedor)); a.push(l); gravar('carg', a); },
      trocasAbertasEDoDia: async (d) => ler('trocas').filter((t) => t.status === 'pendente' || t.data === d),
      novaTroca: async (t) => { const a = ler('trocas'); a.push({ id: ++seq, criado_em: new Date().toISOString(), ...t }); gravar('trocas', a); },
      mudarTroca: mudar('trocas'),
      montadasAbertasEDoDia: async (d) => ler('mont').filter((m) => m.status === 'aberta' || m.saiu_em === d || m.data === d),
      novaMontada: async (m) => { const a = ler('mont'); a.push({ id: ++seq, criado_em: new Date().toISOString(), status: 'aberta', ...m }); gravar('mont', a); },
      mudarMontada: mudar('mont'),
      periodo: async (de) => ({ carg: ler('carg').filter((x) => x.data >= somaDias(de, -10)), trocas: ler('trocas').filter((x) => x.data >= de), montadas: ler('mont').filter((x) => x.data >= de) }),
    };
  }

  function estado(txt, tipo) { const e = $('#estadoSalvo'); e.textContent = txt; e.className = 'estado ' + (tipo || ''); }
  async function tentar(fn, msgOk) {
    try { estado('salvando…'); await fn(); estado(msgOk || 'salvo ✓', 'ok'); return true; }
    catch (e) { estado('erro ao salvar', 'erro'); alert('Não consegui salvar: ' + e.message + '\n\nConfira a internet e tente de novo.'); return false; }
  }

  // ---------- Cestas: estoque do carro ----------
  const saiuCom = (l) => (Number(l.chegou_com) || 0) + (Number(l.carregou) || 0);
  function linhaDe(v) { return carg[v] || { data: dia, vendedor: v, veio: true, chegou_com: null, complementos: 0, carregou: 0, obs: '' }; }
  // venda do dia anterior: o que saiu no último registro menos o que chegou hoje
  function contaDe(v) {
    const l = linhaDe(v), a = anterior[v];
    if (!l.veio || l.chegou_com == null) return null;
    if (!a) return { semAnterior: true };
    const vendeu = saiuCom(a) - l.chegou_com, comp = Number(l.complementos) || 0;
    return { dia: a.data, saiu: saiuCom(a), vendeu, padrao: comp, grande: vendeu - comp, erroMais: vendeu < 0, erroComp: comp > Math.max(vendeu, 0) };
  }
  function passo(v, campo, valor, rotulo) {
    return `<div class="passo"><small>${rotulo}</small><div class="ctl"><button data-v="${esc(v)}" data-c="${campo}" data-d="-1" aria-label="menos ${rotulo}">−</button><input inputmode="numeric" data-v="${esc(v)}" data-c="${campo}" value="${valor == null ? '' : valor}" placeholder="–" aria-label="${rotulo}"><button data-v="${esc(v)}" data-c="${campo}" data-d="1" aria-label="mais ${rotulo}">+</button></div></div>`;
  }
  function renderHoje() {
    const linhas = VENDEDORES.map(linhaDe);
    const carregaram = linhas.reduce((t, l) => t + (l.veio ? Number(l.carregou) || 0 : 0), 0);
    const contas = VENDEDORES.map(contaDe).filter((c) => c && !c.semAnterior);
    const vendidas = contas.reduce((t, c) => t + Math.max(c.vendeu, 0), 0), padrao = contas.reduce((t, c) => t + c.padrao, 0);
    const faltaContar = linhas.filter((l) => l.veio && l.chegou_com == null).length;
    $('#totais').innerHTML = `<div class="tot"><b>${carregaram}</b><span>carregadas hoje</span></div><div class="tot"><b>${vendidas}</b><span>vendidas no dia anterior${padrao ? ` (${padrao} Padrão)` : ''}</span></div><div class="tot"><b>${faltaContar}</b><span>falta contar o carro</span></div>`;
    $('#listaVend').innerHTML = linhas.map((l) => {
      const c = contaDe(l.vendedor);
      const cls = !l.veio ? 'faltou' : l.chegou_com == null ? 'saiu' : 'voltou';
      let conta = '';
      if (l.veio && l.chegou_com != null) {
        conta = `<div class="conta">Sai hoje com <b>${saiuCom(l)} cestas</b> (${l.chegou_com} no carro + ${Number(l.carregou) || 0} carregadas).<br>` +
          (c.semAnterior ? 'Primeiro registro deste vendedor: a venda do dia anterior começa a aparecer a partir do próximo dia.'
            : `No dia ${dm(c.dia)} saiu com ${c.saiu} e hoje chegou com ${l.chegou_com}: <b>vendeu ${Math.max(c.vendeu, 0)}</b>${c.vendeu > 0 ? ` (${c.grande >= 0 ? c.grande : 0} Grande, ${c.padrao} Padrão)` : ''}.` +
              (c.erroMais ? '<span class="alerta">Chegou com mais cestas do que saiu. Conferir a contagem.</span>' : '') +
              (c.erroComp ? '<span class="alerta">Voltaram mais complementos do que cestas vendidas. Conferir.</span>' : '')) + '</div>';
      }
      return `<div class="vend ${cls}">
        <div class="vend-top"><b>${esc(l.vendedor)}</b><label><input type="checkbox" data-veio="${esc(l.vendedor)}" ${l.veio ? 'checked' : ''}> veio</label><span class="st">${!l.veio ? 'não veio' : l.chegou_com == null ? 'falta contar o carro' : 'contado'}</span></div>
        ${l.veio ? `<div class="passos">${passo(l.vendedor, 'chegou_com', l.chegou_com, 'Chegou com')}${passo(l.vendedor, 'complementos', l.complementos, 'Complementos')}${passo(l.vendedor, 'carregou', l.carregou, 'Carregou')}</div>${conta}` : ''}
        <textarea data-obs="${esc(l.vendedor)}" placeholder="Observação (opcional)">${esc(l.obs || '')}</textarea>
      </div>`;
    }).join('');
  }
  const salvarLinha = (() => { const timers = {}; return (v) => { clearTimeout(timers[v]); estado('…'); timers[v] = setTimeout(() => tentar(() => api.salvarCarregamento({ ...linhaDe(v), data: dia })), 700); }; })();
  function mudar(v, campo, valor) { carg[v] = { ...linhaDe(v), [campo]: valor }; salvarLinha(v); }
  $('#listaVend').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    const v = b.dataset.v, c = b.dataset.c; const atual = Number(linhaDe(v)[c]) || 0;
    mudar(v, c, Math.max(0, atual + Number(b.dataset.d))); renderHoje();
  });
  $('#listaVend').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.veio) { mudar(t.dataset.veio, 'veio', t.checked); renderHoje(); }
    else if (t.dataset.c) { const n = t.value.trim() === '' ? (t.dataset.c === 'chegou_com' ? null : 0) : Math.max(0, parseInt(t.value, 10) || 0); mudar(t.dataset.v, t.dataset.c, n); renderHoje(); }
  });
  $('#listaVend').addEventListener('input', (e) => { const t = e.target; if (t.dataset.obs) mudar(t.dataset.obs, 'obs', t.value); });

  // ---------- Compra ligada a troca/Montada ----------
  const faltaComprar = (x) => x.precisa_compra && !x.compra_em;
  const blocoCompra = (tipo, x) => `<div class="compra-form"><input placeholder="O que foi comprado" data-ci="${tipo}${x.id}"><input inputmode="decimal" placeholder="Valor (R$)" data-cv="${tipo}${x.id}"><button class="al-botao al-dourado" data-comprar="${tipo}" data-id="${x.id}">Registrar a compra</button></div>`;
  const linhaCompra = (x) => x.compra_em ? `<div class="l2">Comprado: <b>${esc(x.compra_item)}</b> · ${brl(x.compra_valor)}</div>` : '';
  async function registrarCompra(tipo, id) {
    const item = document.querySelector(`[data-ci="${tipo}${id}"]`).value.trim(), valor = valorDe(document.querySelector(`[data-cv="${tipo}${id}"]`).value);
    if (!item || !(valor >= 0)) return alert('Preencha o que foi comprado e o valor.');
    const campos = { compra_item: item, compra_valor: valor, compra_em: new Date().toISOString() };
    if (tipo === 't') { const t = trocas.find((x) => x.id === id); if (t && t.cenario !== 'antecipada_sem_item') { campos.status = 'concluida'; campos.concluida_em = campos.compra_em; } }
    if (await tentar(() => (tipo === 't' ? api.mudarTroca(id, campos) : api.mudarMontada(id, campos)), 'compra registrada ✓')) await carregar();
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('button[data-comprar]'); if (b) registrarCompra(b.dataset.comprar, Number(b.dataset.id)); });

  // ---------- Trocas ----------
  function itemTroca(t, modo) {
    return `<div class="item-cc ${modo === 'compra' ? 'compra' : modo === 'pend' ? 'pend' : ''}"><div class="l1"><b>${esc(t.cliente)}</b><span>· ${esc(t.vendedor)}</span><span class="dir">${modo ? 'desde ' + dm(t.data) : ''}</span></div>
      <div class="l2">Sai: <b>${esc(t.item_retirado)}</b> · No lugar: <b>${esc(t.item_entregue)}</b></div>
      <div class="l2">${esc(CENARIO[t.cenario] || t.cenario)}${t.obs ? ' · ' + esc(t.obs) : ''}</div>${linhaCompra(t)}
      ${modo === 'compra' ? blocoCompra('t', t) : ''}${modo === 'pend' ? `<button class="al-botao al-dourado" data-concluir="${t.id}">O item antigo voltou ✓</button>` : ''}</div>`;
  }
  function renderTrocas() {
    const compra = trocas.filter(faltaComprar);
    const pend = trocas.filter((t) => t.status === 'pendente' && !faltaComprar(t));
    const conc = trocas.filter((t) => t.status === 'concluida' && t.data === dia);
    $('#nCompraT').textContent = compra.length ? `(${compra.length})` : ''; $('#nPend').textContent = pend.length ? `(${pend.length})` : '';
    const n = compra.length + pend.length, b = $('#badgeTrocas'); b.hidden = !n; b.textContent = n;
    $('#listaCompraT').innerHTML = compra.length ? compra.map((t) => itemTroca(t, 'compra')).join('') : '<p class="vazio-cc">Nenhuma troca esperando compra.</p>';
    $('#listaPend').innerHTML = pend.length ? pend.map((t) => itemTroca(t, 'pend')).join('') : '<p class="vazio-cc">Nenhuma troca esperando item voltar.</p>';
    $('#listaConc').innerHTML = conc.length ? conc.map((t) => itemTroca(t, '')).join('') : '<p class="vazio-cc">Nenhuma troca concluída neste dia.</p>';
  }
  $('#tSalvar').addEventListener('click', async () => {
    const cen = document.querySelector('input[name=tCen]:checked').value, precisa = $('#tCompra').checked;
    const t = { data: dia, vendedor: $('#tVend').value, cliente: $('#tCli').value.trim(), cenario: cen, item_retirado: $('#tRet').value.trim(), item_entregue: $('#tEnt').value.trim(), obs: $('#tObs').value.trim() || null, precisa_compra: precisa, status: (precisa || cen === 'antecipada_sem_item') ? 'pendente' : 'concluida' };
    if (t.status === 'concluida') t.concluida_em = new Date().toISOString();
    if (!t.vendedor || !t.cliente || !t.item_retirado || !t.item_entregue) return alert('Preencha vendedor, cliente e os dois itens.');
    if (await tentar(() => api.novaTroca(t), 'troca registrada ✓')) { ['#tCli', '#tRet', '#tEnt', '#tObs'].forEach((s) => { $(s).value = ''; }); $('#tCompra').checked = false; $('#formTrocaBox').open = false; await carregar(); }
  });
  $('#listaPend').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-concluir]'); if (!b) return;
    if (!confirm('Confirmar que o item antigo voltou pra empresa?')) return;
    if (await tentar(() => api.mudarTroca(Number(b.dataset.concluir), { status: 'concluida', concluida_em: new Date().toISOString() }), 'troca concluída ✓')) await carregar();
  });

  // ---------- Montadas ----------
  function itemMont(m, modo) {
    return `<div class="item-cc ${modo === 'compra' ? 'compra' : modo === 'aberta' ? 'pend' : ''}"><div class="l1"><b>${esc(m.cliente)}</b><span>· ${esc(m.vendedor)}</span><span class="dir">${modo ? 'desde ' + dm(m.data) : ''}</span></div>
      <div class="l2">${esc(m.itens).replace(/\n/g, '<br>')}</div>${m.obs ? `<div class="l2">${esc(m.obs)}</div>` : ''}${linhaCompra(m)}
      ${modo === 'compra' ? blocoCompra('m', m) : ''}${modo === 'aberta' ? `<button class="al-botao al-dourado" data-saiu="${m.id}">Saiu com o vendedor ✓</button>` : ''}</div>`;
  }
  function renderMontadas() {
    const compra = montadas.filter((m) => m.status === 'aberta' && faltaComprar(m));
    const abertas = montadas.filter((m) => m.status === 'aberta' && !faltaComprar(m));
    const saiu = montadas.filter((m) => m.status === 'saiu' && m.saiu_em === dia);
    $('#nCompraM').textContent = compra.length ? `(${compra.length})` : ''; $('#nAbertas').textContent = abertas.length ? `(${abertas.length})` : '';
    const n = compra.length + abertas.length, b = $('#badgeMont'); b.hidden = !n; b.textContent = n;
    $('#listaCompraM').innerHTML = compra.length ? compra.map((m) => itemMont(m, 'compra')).join('') : '<p class="vazio-cc">Nenhuma Montada esperando compra.</p>';
    $('#listaAbertas').innerHTML = abertas.length ? abertas.map((m) => itemMont(m, 'aberta')).join('') : '<p class="vazio-cc">Nenhuma Montada esperando sair.</p>';
    $('#listaSaiu').innerHTML = saiu.length ? saiu.map((m) => itemMont(m, '')).join('') : '<p class="vazio-cc">Nenhuma Montada saiu neste dia.</p>';
  }
  $('#mSalvar').addEventListener('click', async () => {
    const m = { data: dia, vendedor: $('#mVend').value, cliente: $('#mCli').value.trim(), itens: $('#mItens').value.trim(), precisa_compra: $('#mCompra').checked, obs: $('#mObs').value.trim() || null };
    if (!m.vendedor || !m.cliente || !m.itens) return alert('Preencha vendedor, cliente e o que o cliente pediu.');
    if (await tentar(() => api.novaMontada(m), 'Montada registrada ✓')) { ['#mCli', '#mItens', '#mObs'].forEach((s) => { $(s).value = ''; }); $('#mCompra').checked = false; $('#formMontBox').open = false; await carregar(); }
  });
  $('#listaAbertas').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-saiu]'); if (!b) return;
    if (!confirm('Confirmar que essa Montada saiu com o vendedor?')) return;
    if (await tentar(() => api.mudarMontada(Number(b.dataset.saiu), { status: 'saiu', saiu_em: dia }), 'Montada saiu ✓')) await carregar();
  });

  // ---------- Resumo (só admin) ----------
  async function renderResumo() {
    const de = somaDias(hojeISO(), -13), p = await api.periodo(de);
    const vend = {}; // venda de cada dia = saiu naquele dia − chegou no registro seguinte do mesmo vendedor
    VENDEDORES.forEach((v) => {
      const ls = p.carg.filter((x) => x.vendedor === v && x.veio && x.chegou_com != null).sort((a, b) => a.data.localeCompare(b.data));
      for (let i = 1; i < ls.length; i++) { const d = ls[i - 1].data, q = saiuCom(ls[i - 1]) - ls[i].chegou_com; const o = vend[d] = vend[d] || { total: 0, padrao: 0 }; o.total += Math.max(q, 0); o.padrao += Number(ls[i].complementos) || 0; }
    });
    const dias = [...new Set([...p.carg.map((x) => x.data).filter((d) => d >= de), ...p.trocas.map((x) => x.data), ...p.montadas.map((x) => x.data)])].sort().reverse();
    if (!dias.length) { $('#resumo').innerHTML = '<p class="vazio-cc">Ainda não há lançamentos nos últimos 14 dias.</p>'; return; }
    const compraDia = (arr, d) => arr.filter((x) => x.compra_em && new Date(new Date(x.compra_em).getTime() - 3 * 3600e3).toISOString().slice(0, 10) === d).reduce((t, x) => t + Number(x.compra_valor || 0), 0);
    $('#resumo').innerHTML = `<div class="painel-card"><table class="res-tab"><thead><tr><th>Dia</th><th>Carregadas</th><th>Vendidas</th><th>Montadas</th><th>Trocas</th><th>Compras</th></tr></thead><tbody>${dias.map((d) => {
      const ls = p.carg.filter((x) => x.data === d && x.veio), cg = ls.reduce((t, l) => t + (Number(l.carregou) || 0), 0), vd = vend[d];
      const mt = p.montadas.filter((x) => x.saiu_em === d).length, tr = p.trocas.filter((x) => x.data === d).length, cp = compraDia(p.trocas, d) + compraDia(p.montadas, d);
      return `<tr><td>${dm(d)}</td><td>${cg}</td><td>${vd ? vd.total + (vd.padrao ? ` <small>(${vd.padrao} P)</small>` : '') : '<small>—</small>'}</td><td>${mt || '—'}</td><td>${tr || '—'}</td><td>${cp ? brl(cp) : '—'}</td></tr>`;
    }).join('')}</tbody></table><p class="nota">"Vendidas" de um dia só aparece depois que o carro é contado na manhã seguinte. (P) = vendidas como Padrão (complementos que voltaram). Compras são as feitas pra trocas e Montadas, com o dinheiro do cliente.</p></div>`;
  }

  // ---------- Geral ----------
  async function carregar() {
    try {
      const lin = await api.carregamento(somaDias(dia, -10), dia);
      carg = {}; anterior = {};
      lin.forEach((l) => { if (l.data === dia) carg[l.vendedor] = l; else if (l.veio && l.chegou_com != null && (!anterior[l.vendedor] || l.data > anterior[l.vendedor].data)) anterior[l.vendedor] = l; });
      trocas = await api.trocasAbertasEDoDia(dia);
      montadas = await api.montadasAbertasEDoDia(dia);
      renderHoje(); renderTrocas(); renderMontadas();
      if (aba === 'resumo') await renderResumo();
    } catch (e) { estado('sem conexão', 'erro'); }
  }
  function trocarAba(a) {
    aba = a;
    document.querySelectorAll('.aba-b').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === a));
    ['hoje', 'trocas', 'montadas', 'resumo'].forEach((x) => { $('#aba-' + x).hidden = x !== a; });
    if (a === 'resumo') renderResumo();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.aba-b').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  const mudarDia = (d) => { dia = d; $('#dia').value = d; carregar(); };
  $('#dia').addEventListener('change', (e) => mudarDia(e.target.value || hojeISO()));
  $('#diaAnt').addEventListener('click', () => mudarDia(somaDias(dia, -1)));
  $('#diaProx').addEventListener('click', () => mudarDia(somaDias(dia, 1)));

  async function iniciarTela() {
    try { papel = await api.papel(); } catch (e) { papel = null; }
    if (!papel) { document.getElementById('conteudoPainel').style.display = 'none'; $('#semAcesso').hidden = false; return; }
    document.querySelectorAll('.so-admin').forEach((el) => { el.hidden = papel !== 'admin'; });
    const opts = '<option value="">Selecione</option>' + VENDEDORES.map((v) => `<option>${esc(v)}</option>`).join('');
    $('#tVend').innerHTML = opts; $('#mVend').innerHTML = opts;
    $('#dia').value = dia;
    await carregar();
    setInterval(() => { if (!document.hidden && !document.activeElement.matches('input,textarea,select')) carregar(); }, 20000); // tempo real: busca de novo a cada 20s
  }
  $('#btnSair2').addEventListener('click', async () => { await window.dbAuth.auth.signOut(); location.reload(); });

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    api = apiTeste(); email = 'teste';
    document.getElementById('gateLogin').style.display = 'none';
    document.getElementById('conteudoPainel').style.display = '';
    $('#usuarioLogado').textContent = 'modo teste (só neste PC)';
    iniciarTela();
  } else {
    iniciarLoginGate((mail) => { email = mail; api = apiSupabase(window.dbAuth); iniciarTela(); });
  }
})();
