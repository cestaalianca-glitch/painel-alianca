// Login compartilhado (Supabase Auth) — usado por qualquer página que tenha o
// bloco de HTML padrão do gate (ver dashboard/hub.html como referência de estrutura:
// #gateLogin, #inputEmail, #inputSenha, #btnEntrar, #linkEsqueciSenha, #erroLogin,
// #msgReset, #gateNovaSenha, #inputNovaSenha, #btnSalvarNovaSenha, #erroNovaSenha,
// #conteudoPainel).
//
// Uso: <script src="login-gate.js"></script> depois de config.js, e no fim da página:
//   <script>iniciarLoginGate(function(email){ ...código que só roda depois de logado... });</script>

function iniciarLoginGate(aoLiberar) {
  var db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.dbAuth = db; // outras partes da página (app.js etc.) reaproveitam esse mesmo cliente

  function liberar(email, token) {
    var gateLogin = document.getElementById('gateLogin');
    // páginas diferentes usam ids diferentes pro wrapper do conteúdo real
    // (herdado de quando cada uma tinha seu próprio gate de senha copiado à mão).
    var conteudo = document.getElementById('conteudoPainel') || document.getElementById('conteudo');
    if (gateLogin) gateLogin.style.display = 'none';
    if (conteudo) conteudo.style.display = conteudo.id === 'conteudo' ? 'block' : '';
    var elUsuario = document.getElementById('usuarioLogado');
    if (elUsuario) elUsuario.textContent = email || '';
    // Segundo argumento (token da sessão) é novo — passado pra quem quiser
    // buscar arquivo protegido por login (ver netlify/edge-functions/proteger-dados.js).
    // Callbacks antigos que só recebem (email) continuam funcionando normal.
    aoLiberar(email, token);
  }

  async function verificarSessao() {
    var { data } = await db.auth.getSession();
    if (data && data.session) liberar(data.session.user.email, data.session.access_token);
  }

  async function tentarLogin() {
    var email = document.getElementById('inputEmail').value.trim();
    var senha = document.getElementById('inputSenha').value;
    var erro = document.getElementById('erroLogin');
    erro.style.display = 'none';
    var { data, error } = await db.auth.signInWithPassword({ email: email, password: senha });
    if (error) {
      erro.textContent = error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : 'Não consegui entrar: ' + error.message;
      erro.style.display = 'block';
      return;
    }
    liberar(data.user.email, data.session.access_token);
  }

  db.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('gateLogin').style.display = 'none';
      document.getElementById('gateNovaSenha').style.display = 'flex';
    }
  });

  document.getElementById('btnSalvarNovaSenha').addEventListener('click', async function () {
    var novaSenha = document.getElementById('inputNovaSenha').value;
    var erro = document.getElementById('erroNovaSenha');
    erro.style.display = 'none';
    if (novaSenha.length < 6) {
      erro.textContent = 'A senha precisa ter pelo menos 6 caracteres.';
      erro.style.display = 'block';
      return;
    }
    var { data, error } = await db.auth.updateUser({ password: novaSenha });
    if (error) {
      erro.textContent = 'Não consegui salvar: ' + error.message;
      erro.style.display = 'block';
      return;
    }
    document.getElementById('gateNovaSenha').style.display = 'none';
    var sessaoAtual = await db.auth.getSession();
    liberar(data.user.email, sessaoAtual.data.session ? sessaoAtual.data.session.access_token : null);
  });

  document.getElementById('btnEntrar').addEventListener('click', tentarLogin);
  document.getElementById('inputSenha').addEventListener('keydown', function (e) { if (e.key === 'Enter') tentarLogin(); });
  document.getElementById('linkEsqueciSenha').addEventListener('click', async function (e) {
    e.preventDefault();
    var email = document.getElementById('inputEmail').value.trim();
    var msg = document.getElementById('msgReset');
    var erro = document.getElementById('erroLogin');
    erro.style.display = 'none';
    if (!email) {
      erro.textContent = 'Digite seu e-mail no campo acima primeiro.';
      erro.style.display = 'block';
      return;
    }
    var { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    if (error) {
      erro.textContent = 'Não consegui enviar: ' + error.message;
      erro.style.display = 'block';
      return;
    }
    msg.textContent = 'Enviamos um link pro seu e-mail (' + email + ') pra você criar uma senha nova.';
    msg.style.display = 'block';
  });
  var btnSair = document.getElementById('btnSair');
  if (btnSair) {
    btnSair.addEventListener('click', async function () {
      await db.auth.signOut();
      location.reload();
    });
  }

  verificarSessao();
}
