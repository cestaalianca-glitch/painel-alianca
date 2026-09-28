// Carregamento e Trocas V2 (28/09/2026). Quem lança é o CONFERENTE (Luan), pelo celular; o dono acompanha
// do escritório. Dados nas tabelas cc_carregamento_v2, cc_trocas_v2 e cc_compras_v2 (Supabase), com acesso
// por papel (tabela al_papeis): conferente lança e corrige; admin também vê o Resumo e pode apagar.
// No PC (localhost) roda num modo de teste que guarda tudo no próprio navegador, sem tocar no banco.
(function () {
  const VENDEDORES = ['Pedro', 'Kinka', 'João', 'Juciano/Joãozinho', 'Jayme', 'Luan'];
  const TIPOS = [['padrao', 'Padrão'], ['grande', 'Grande'], ['montada', 'Montada']];
  const CENARIO = { pap_na_hora: 'Na hora, na casa do cliente', antecipada_item_deixado: 'Combinada antes, item já estava aqui', antecipada_sem_item: 'Combinada antes, item ainda com o cliente' };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília
  const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  let api, papel, email, dia = hojeISO(), aba = 'hoje';
  let carg = {}, trocas = [], compras = [];

  // ---------- Acesso a dados (Supabase ou teste local) ----------
  function apiSupabase(db) {
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    return {
      papel: async () => { const r = ok(await db.from('al_papeis').select('papel').limit(1)); return r[0] ? r[0].papel : null; },
      carregamento: async (d) => ok(await db.from('cc_carregamento_v2').select('*').eq('data', d)),
      salvarCarregamento: async (linha) => ok(await db.from('cc_carregamento_v2').upsert({ ...linha, atualizado_por: email, atualizado_em: new Date().toISOString() })),
      trocasPendentes: async () => ok(await db.from('cc_trocas_v2').select('*').eq('status', 'pendente').order('criado_em')),
      trocasDoDia: async (d) => ok(await db.from('cc_trocas_v2').select('*').eq('data', d).order('criado_em', { ascending: false })),
      novaTroca: async (t) => ok(await db.from('cc_trocas_v2').insert({ ...t, registrado_por: email })),
      concluirTroca: async (id) => ok(await db.from('cc_trocas_v2').update({ status: 'concluida', concluida_em: new Date().toISOString() }).eq('id', id)),
      comprasDoDia: async (d) => ok(await db.from('cc_compras_v2').select('*').eq('data', d).order('criado_em', { ascending: false })),
      novaCompra: async (c) => ok(await db.from('cc_compras_v2').insert({ ...c, registrado_por: email })),
      periodo: async (de) => ({
        carg: ok(await db.from('cc_carregamento_v2').select('*').gte('data', de)),
        trocas: ok(await db.from('cc_trocas_v2').select('data,status').gte('data', de)),
        compras: ok(await db.from('cc_compras_v2').select('data,valor').gte('data', de)),
      }),
    };
  }
  function apiTeste() { // só no PC: guarda no navegador pra testar as telas
    const ler = (k) => { try { return JSON.parse(localStorage.getItem('cc_teste_' + k)) || []; } catch (e) { return []; } };
    const gravar = (k, v) => { try { localStorage.setItem('cc_teste_' + k, JSON.stringify(v)); } catch (e) { /* ok */ } };
    let seq = Date.now();
    return {
      papel: async () => 'admin',
      carregamento: async (d) => ler('carg').filter((x) => x.data === d),
      salvarCarregamento: async (l) => { const a = ler('carg').filter((x) => !(x.data === l.data && x.vendedor === l.vendedor)); a.push({ ...l, atualizado_por: 'teste' }); gravar('carg', a); },
      trocasPendentes: async () => ler('trocas').filter((t) => t.status === 'pendente'),
      trocasDoDia: async (d) => ler('trocas').filter((t) => t.data === d).reverse(),
      novaTroca: async (t) => { const a = ler('trocas'); a.push({ id: ++seq, data: dia, criado_em: new Date().toISOString(), ...t }); gravar('trocas', a); },
      concluirTroca: async (id) => { gravar('trocas', ler('trocas').map((t) => t.id === id ? { ...t, status: 'concluida', concluida_em: new Date().toISOString() } : t)); },
      comprasDoDia: async (d) => ler('compras').filter((c) => c.data === d).reverse(),
      novaCompra: async (c) => { const a = ler('compras'); a.push({ id: ++seq, data: dia, criado_em: new Date().toISOString(), ...c }); gravar('compras', a); },
      periodo: async (de) => ({ carg: ler('carg').filter((x) => x.data >= de), trocas: ler('trocas').filter((x) => x.data >= de), compras: ler('compras').filter((x) => x.data >= de) }),
    };
  }

  function estado(txt, tipo) { const e = $('#estadoSalvo'); e.textContent = txt; e.className = 'estado ' + (tipo || ''); }
  async function tentar(fn, msgOk) {
    try { estado('salvando…'); await fn(); estado(msgOk || 'salvo ✓', 'ok'); return true; }
    catch (e) { estado('erro ao salvar', 'erro'); alert('Não consegui salvar: ' + e.message + '\n\nConfira a internet e tente de novo.'); return false; }
  }

  // ---------- Cestas (saída de manhã e volta) ----------
  const soma = (l, p) => TIPOS.reduce((t, [k]) => t + (Number(l[p + '_' + k]) || 0), 0);
  function linhaDe(v) { return carg[v] || { data: dia, vendedor: v, veio: true, saida_padrao: 0, saida_grande: 0, saida_montada: 0, volta_padrao: null, volta_grande: null, volta_montada: null, obs: '' }; }
  function passo(v, campo, valor, rotulo) {
    return `<div class="passo"><small>${rotulo}</small><div class="ctl"><button data-v="${esc(v)}" data-c="${campo}" data-d="-1" aria-label="menos ${rotulo}">−</button><input inputmode="numeric" data-v="${esc(v)}" data-c="${campo}" value="${valor == null ? '' : valor}" aria-label="${rotulo}"><button data-v="${esc(v)}" data-c="${campo}" data-d="1" aria-label="mais ${rotulo}">+</button></div></div>`;
  }
  function renderHoje() {
    const linhas = VENDEDORES.map(linhaDe);
    const saiu = linhas.reduce((t, l) => t + (l.veio ? soma(l, 'saida') : 0), 0);
    const temVolta = (l) => TIPOS.some(([k]) => l['volta_' + k] != null);
    const voltou = linhas.reduce((t, l) => t + (temVolta(l) ? soma(l, 'volta') : 0), 0);
    const faltaVolta = linhas.filter((l) => l.veio && soma(l, 'saida') > 0 && !temVolta(l)).length;
    $('#totais').innerHTML = `<div class="tot"><b>${saiu}</b><span>cestas saíram</span></div><div class="tot"><b>${voltou}</b><span>voltaram</span></div><div class="tot"><b>${faltaVolta}</b><span>falta registrar a volta</span></div>`;
    $('#listaVend').innerHTML = linhas.map((l) => {
      const s = soma(l, 'saida'), vt = temVolta(l), vv = soma(l, 'volta');
      const cls = !l.veio ? 'faltou' : vt ? 'voltou' : s ? 'saiu' : '';
      const st = !l.veio ? 'não veio' : vt ? `saíram ${s}, voltaram ${vv}` : s ? `saíram ${s}, falta a volta` : 'ainda não carregou';
      return `<div class="vend ${cls}">
        <div class="vend-top"><b>${esc(l.vendedor)}</b><label><input type="checkbox" data-veio="${esc(l.vendedor)}" ${l.veio ? 'checked' : ''}> veio</label><span class="st">${st}</span></div>
        ${l.veio ? `<div class="grupo-tit">Saída de manhã</div><div class="passos">${TIPOS.map(([k, r]) => passo(l.vendedor, 'saida_' + k, l['saida_' + k], r)).join('')}</div>
        ${vt ? `<div class="grupo-tit">Voltou no fim do dia</div><div class="passos">${TIPOS.map(([k, r]) => passo(l.vendedor, 'volta_' + k, l['volta_' + k], r)).join('')}</div>
          <div class="saldo">Ficaram na rua (vendidas ou deixadas): <b>${s - vv}</b>${TIPOS.map(([k, r]) => { const d = (l['saida_' + k] || 0) - (l['volta_' + k] || 0); return d ? ` · ${r} ${d}` : ''; }).join('')}</div>`
        : (s ? `<button class="al-botao btn-volta" data-volta="${esc(l.vendedor)}">Registrar a volta</button>` : '')}` : ''}
        <textarea data-obs="${esc(l.vendedor)}" placeholder="Observação (opcional)">${esc(l.obs || '')}</textarea>
      </div>`;
    }).join('');
  }
  const salvarLinha = (() => { const timers = {}; return (v) => { clearTimeout(timers[v]); estado('…'); timers[v] = setTimeout(() => tentar(() => api.salvarCarregamento({ ...linhaDe(v), data: dia })), 700); }; })();
  function mudar(v, campo, valor) { carg[v] = { ...linhaDe(v), [campo]: valor }; salvarLinha(v); }
  $('#listaVend').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.volta) { const v = b.dataset.volta; const l = linhaDe(v); carg[v] = { ...l, volta_padrao: 0, volta_grande: 0, volta_montada: 0 }; salvarLinha(v); renderHoje(); return; }
    if (b.dataset.d) { const v = b.dataset.v, c = b.dataset.c; const atual = Number(linhaDe(v)[c]) || 0; mudar(v, c, Math.max(0, atual + Number(b.dataset.d))); renderHoje(); }
  });
  $('#listaVend').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.veio) { mudar(t.dataset.veio, 'veio', t.checked); renderHoje(); }
    else if (t.dataset.c) { mudar(t.dataset.v, t.dataset.c, Math.max(0, parseInt(t.value, 10) || 0)); renderHoje(); }
  });
  $('#listaVend').addEventListener('input', (e) => { const t = e.target; if (t.dataset.obs) mudar(t.dataset.obs, 'obs', t.value); });

  // ---------- Trocas ----------
  function itemTroca(t, pend) {
    return `<div class="item-cc ${pend ? 'pend' : ''}"><div class="l1"><b>${esc(t.cliente)}</b><span>· ${esc(t.vendedor)}</span><span class="dir">${pend ? 'desde ' + dm(t.data) : ''}</span></div>
      <div class="l2">Saiu: <b>${esc(t.item_retirado)}</b> · Foi no lugar: <b>${esc(t.item_entregue)}</b></div>
      <div class="l2">${esc(CENARIO[t.cenario] || t.cenario)}${t.obs ? ' · ' + esc(t.obs) : ''}</div>
      ${pend ? `<button class="al-botao al-dourado" data-concluir="${t.id}">O item antigo voltou ✓</button>` : ''}</div>`;
  }
  function renderTrocas() {
    const pend = trocas.pend || [], conc = (trocas.dia || []).filter((t) => t.status === 'concluida');
    $('#nPend').textContent = pend.length ? `(${pend.length})` : '';
    const b = $('#badgePend'); b.hidden = !pend.length; b.textContent = pend.length;
    $('#listaPend').innerHTML = pend.length ? pend.map((t) => itemTroca(t, true)).join('') : '<p class="vazio-cc">Nenhuma troca pendente.</p>';
    $('#listaConc').innerHTML = conc.length ? conc.map((t) => itemTroca(t, false)).join('') : '<p class="vazio-cc">Nenhuma troca concluída neste dia.</p>';
  }
  $('#tSalvar').addEventListener('click', async () => {
    const cen = document.querySelector('input[name=tCen]:checked').value;
    const t = { data: dia, vendedor: $('#tVend').value, cliente: $('#tCli').value.trim(), cenario: cen, item_retirado: $('#tRet').value.trim(), item_entregue: $('#tEnt').value.trim(), obs: $('#tObs').value.trim() || null, status: cen === 'antecipada_sem_item' ? 'pendente' : 'concluida' };
    if (t.status === 'concluida') t.concluida_em = new Date().toISOString();
    if (!t.vendedor || !t.cliente || !t.item_retirado || !t.item_entregue) return alert('Preencha vendedor, cliente e os dois itens.');
    if (await tentar(() => api.novaTroca(t), 'troca registrada ✓')) { ['#tCli', '#tRet', '#tEnt', '#tObs'].forEach((s) => { $(s).value = ''; }); $('#formTrocaBox').open = false; await carregar(); }
  });
  $('#listaPend').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-concluir]'); if (!b) return;
    if (!confirm('Confirmar que o item antigo voltou pra empresa?')) return;
    if (await tentar(() => api.concluirTroca(Number(b.dataset.concluir)), 'troca concluída ✓')) await carregar();
  });

  // ---------- Compras fora do estoque ----------
  function renderCompras() {
    const cs = compras || [];
    const total = cs.reduce((t, c) => t + Number(c.valor || 0), 0);
    $('#listaCompras').innerHTML = (cs.length ? `<p class="sub-tit">${cs.length} compra${cs.length > 1 ? 's' : ''} no dia · ${brl(total)}</p>` : '') +
      (cs.length ? cs.map((c) => `<div class="item-cc"><div class="l1"><b>${esc(c.cliente)}</b><span>· ${esc(c.vendedor)}</span><span class="dir">${brl(c.valor)}</span></div><div class="l2">${esc(c.item)}${c.obs ? ' · ' + esc(c.obs) : ''}</div></div>`).join('') : '<p class="vazio-cc">Nenhuma compra fora do estoque neste dia.</p>');
  }
  $('#cSalvar').addEventListener('click', async () => {
    const valor = parseFloat(String($('#cValor').value).replace(/\./g, '').replace(',', '.'));
    const c = { data: dia, vendedor: $('#cVend').value, cliente: $('#cCli').value.trim(), item: $('#cItem').value.trim(), valor, obs: $('#cObs').value.trim() || null };
    if (!c.vendedor || !c.cliente || !c.item || !(valor >= 0)) return alert('Preencha vendedor, cliente, o que foi comprado e o valor.');
    if (await tentar(() => api.novaCompra(c), 'compra registrada ✓')) { ['#cCli', '#cItem', '#cValor', '#cObs'].forEach((s) => { $(s).value = ''; }); $('#formCompraBox').open = false; await carregar(); }
  });

  // ---------- Resumo (só admin) ----------
  async function renderResumo() {
    const de = new Date(Date.now() - 3 * 3600e3 - 13 * 864e5).toISOString().slice(0, 10);
    const p = await api.periodo(de);
    const dias = [...new Set([...p.carg.map((x) => x.data), ...p.trocas.map((x) => x.data), ...p.compras.map((x) => x.data)])].sort().reverse();
    if (!dias.length) { $('#resumo').innerHTML = '<p class="vazio-cc">Ainda não há lançamentos nos últimos 14 dias.</p>'; return; }
    $('#resumo').innerHTML = `<div class="painel-card"><table class="res-tab"><thead><tr><th>Dia</th><th>Saíram</th><th>Voltaram</th><th>Ficaram na rua</th><th>Trocas</th><th>Compras</th></tr></thead><tbody>${dias.map((d) => {
      const ls = p.carg.filter((x) => x.data === d && x.veio);
      const s = ls.reduce((t, l) => t + soma(l, 'saida'), 0), v = ls.reduce((t, l) => t + soma(l, 'volta'), 0);
      const semVolta = ls.filter((l) => soma(l, 'saida') > 0 && TIPOS.every(([k]) => l['volta_' + k] == null)).length;
      const tr = p.trocas.filter((x) => x.data === d), cp = p.compras.filter((x) => x.data === d);
      return `<tr><td>${dm(d)}</td><td>${s}</td><td>${v}${semVolta ? ` <small>(${semVolta} sem volta)</small>` : ''}</td><td>${s - v}</td><td>${tr.length}${tr.some((x) => x.status === 'pendente') ? ' <small>pend.</small>' : ''}</td><td>${cp.length ? brl(cp.reduce((t, c) => t + Number(c.valor), 0)) : '—'}</td></tr>`;
    }).join('')}</tbody></table><p class="nota">"Ficaram na rua" = saíram menos voltaram (vendidas ou deixadas com cliente).</p></div>`;
  }

  // ---------- Geral ----------
  async function carregar() {
    try {
      const lin = await api.carregamento(dia); carg = {}; lin.forEach((l) => { carg[l.vendedor] = l; });
      trocas = { pend: await api.trocasPendentes(), dia: await api.trocasDoDia(dia) };
      compras = await api.comprasDoDia(dia);
      renderHoje(); renderTrocas(); renderCompras();
      if (aba === 'resumo') await renderResumo();
    } catch (e) { estado('sem conexão', 'erro'); }
  }
  function trocarAba(a) {
    aba = a;
    document.querySelectorAll('.aba-b').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === a));
    ['hoje', 'trocas', 'compras', 'resumo'].forEach((x) => { $('#aba-' + x).hidden = x !== a; });
    if (a === 'resumo') renderResumo();
  }
  document.querySelectorAll('.aba-b').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  const mudarDia = (d) => { dia = d; $('#dia').value = d; carregar(); };
  $('#dia').addEventListener('change', (e) => mudarDia(e.target.value || hojeISO()));
  $('#diaAnt').addEventListener('click', () => mudarDia(new Date(new Date(dia + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10)));
  $('#diaProx').addEventListener('click', () => mudarDia(new Date(new Date(dia + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10)));

  async function iniciarTela() {
    papel = await api.papel();
    if (!papel) { document.getElementById('conteudoPainel').style.display = 'none'; $('#semAcesso').hidden = false; return; }
    document.querySelectorAll('.so-admin').forEach((el) => { el.hidden = papel !== 'admin'; });
    const opts = '<option value="">Selecione</option>' + VENDEDORES.map((v) => `<option>${esc(v)}</option>`).join('');
    $('#tVend').innerHTML = opts; $('#cVend').innerHTML = opts;
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
