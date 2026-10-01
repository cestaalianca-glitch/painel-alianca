// Botão "Atualizar agora" (30/09/2026): busca tudo de novo no Opy na hora, sem esperar a rotina agendada.
// Chama a função atualizar-opy do Supabase (só admin), que manda o GitHub rodar a atualização (~4 min).
// Uso, depois do login: montarBotaoAtualizar(elemento, aoTerminar)
//   aoTerminar → o que fazer quando terminar com sucesso (ex.: recarregar a página pra mostrar o dado novo).
(function () {
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaHora = (iso) => { const d = new Date(iso); const hoje = new Date().toDateString() === d.toDateString(); return (hoje ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) + ' às ' + hora(iso); };

  window.montarBotaoAtualizar = async function (alvo, aoTerminar) {
    if (!alvo || !window.dbAuth) return;
    const chamar = async (acao) => {
      const { data, error } = await window.dbAuth.functions.invoke('atualizar-opy', { body: { acao } });
      if (error) { const st = error.context && error.context.status; throw Object.assign(new Error(error.message), { status: st }); }
      return data;
    };
    let timer = null, acompanhando = false, pedidoEm = 0;
    const pintar = (html, desabilitado) => {
      alvo.innerHTML = `<button type="button" class="btn-atualizar" ${desabilitado ? 'disabled' : ''}>${html}</button>`;
      const b = alvo.querySelector('button'); if (!desabilitado) b.addEventListener('click', disparar);
    };
    const mostrar = (u) => {
      if (pedidoEm && (!u || new Date(u.inicio).getTime() < pedidoEm - 60000)) { pintar('<span class="gira">↻</span> Começando a atualização…', true); acompanhar(); return; }
      if (u && u.status !== 'completed') { pintar(`<span class="gira">↻</span> Atualizando… (começou ${hora(u.inicio)}, leva uns 2 min)`, true); acompanhar(); return; }
      clearInterval(timer); timer = null;
      if (u && acompanhando) { // acabou de terminar enquanto a página estava aberta
        acompanhando = false;
        if (u.conclusao === 'success') { pintar('✓ Atualizado agora', true); setTimeout(() => aoTerminar && aoTerminar(), 1500); return; }
        pintar('⚠ A atualização não deu certo. Tentar de novo', false); return;
      }
      pintar('↻ Atualizar agora' + (u && u.conclusao === 'success' ? ` <small>última: ${diaHora(u.fim)}</small>` : ''), false);
    };
    const acompanhar = () => { acompanhando = true; if (!timer) timer = setInterval(async () => { try { mostrar((await chamar('estado')).ultima); } catch (e) { /* tenta de novo no próximo ciclo */ } }, 10000); };
    async function disparar() {
      if (!confirm('Buscar tudo de novo no Opy agora? Leva uns 2 minutos; a página atualiza sozinha no fim.')) return;
      pintar('<span class="gira">↻</span> Pedindo a atualização…', true);
      try {
        const r = await chamar('disparar');
        if (r.jaRodando) return mostrar(r.ultima);
        pedidoEm = new Date(r.em).getTime();
        pintar(`<span class="gira">↻</span> Atualizando… (começou ${hora(r.em)}, leva uns 2 min)`, true); acompanhar();
      } catch (e) { pintar('⚠ Não consegui pedir a atualização. Tentar de novo', false); }
    }
    try { mostrar((await chamar('estado')).ultima); }
    catch (e) { if (e.status === 403 || e.status === 401) alvo.innerHTML = ''; else pintar('↻ Atualizar agora', false); } // não-admin: sem botão
  };

  const css = document.createElement('style');
  css.textContent = `.btn-atualizar{font:inherit;font-size:.82rem;padding:7px 14px;border-radius:99px;border:1px solid var(--borda);background:var(--superficie);color:var(--texto);cursor:pointer;white-space:nowrap}
.btn-atualizar:hover:not(:disabled){border-color:var(--texto-suave)}.btn-atualizar:disabled{cursor:default;color:var(--texto-suave)}
.btn-atualizar small{color:var(--texto-mudo);margin-left:4px}.btn-atualizar .gira{display:inline-block;animation:gira 1.2s linear infinite}
@keyframes gira{to{transform:rotate(360deg)}}@media (max-width:600px){.btn-atualizar small{display:none}}`;
  document.head.appendChild(css);
})();
