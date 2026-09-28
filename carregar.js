// Painel v2 — carregador. O dado real NUNCA fica em arquivo público: depois do login (Supabase Auth,
// o mesmo da Central Aliança), busca a linha 'v2' da tabela painel_dados (RLS: só quem está logado lê),
// que a rotina da nuvem atualiza todo dia. Só então carrega as 3 abas.
// No PC (localhost), o servidor local entrega dados-local.js direto de dados/painel_v2/, sem login.
(function () {
  const ABAS = ['mes.js', 'clientes.js', 'historico.js', 'extras.js'];
  const carregarScript = (src) => new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => falha(new Error('não carregou ' + src));
    document.body.appendChild(s);
  });
  async function iniciarAbas() {
    for (const a of ABAS) await carregarScript(a);
  }
  function mostrarErro(msg) {
    const c = document.getElementById('carregando');
    c.hidden = false;
    c.querySelector('p').textContent = msg;
  }

  async function aposLogin() {
    const c = document.getElementById('carregando');
    c.hidden = false;
    try {
      const { data, error } = await window.dbAuth.from('painel_dados').select('dados, atualizado_em').eq('id', 'v2').single();
      if (error || !data) throw new Error(error ? error.message : 'sem dado');
      window.DADOS_MES = data.dados.mes;
      window.DADOS_CLIENTES = data.dados.clientes;
      window.DADOS_HISTORICO = data.dados.historico;
      await iniciarAbas();
      c.hidden = true;
    } catch (e) {
      mostrarErro('Não consegui carregar o painel (' + e.message + '). Tente recarregar a página em alguns minutos.');
    }
  }

  async function iniciar() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try {
        await carregarScript('dados-local.js');
        if (window.DADOS_MES) {
          document.getElementById('gateLogin').style.display = 'none';
          document.getElementById('conteudoPainel').style.display = '';
          await iniciarAbas();
          return;
        }
      } catch (e) { /* sem servidor local de dado: segue pro login normal */ }
    }
    iniciarLoginGate(aposLogin);
  }
  iniciar();
})();
