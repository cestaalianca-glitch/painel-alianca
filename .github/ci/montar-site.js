// VERSÃO LIMPA DO ALIANÇA HQ PARA O GITHUB PAGES (Bloco 19). Copia para _site/ só o que é página (HTML, JS, CSS, imagens, manifest,
// robots.txt e .nojekyll) dos arquivos rastreados no git. Fica de fora: .github/, documentação (*.md), backup (.bak-*) e qualquer outro arquivo.
//   node .github/ci/montar-site.js
const fs = require('fs'), path = require('path'), cp = require('child_process');
const RAIZ = path.resolve(__dirname, '..', '..'), SAIDA = path.join(RAIZ, '_site');
const PERMITE = /\.(html?|js|css|png|jpe?g|gif|svg|ico|webp|woff2?|json|webmanifest|txt)$/i;
const arquivos = cp.execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);
fs.rmSync(SAIDA, { recursive: true, force: true }); fs.mkdirSync(SAIDA, { recursive: true });
let n = 0; const fora = [];
for (const f of arquivos) {
  const ok = (f === '.nojekyll' || PERMITE.test(f)) && !/^\.github\//.test(f) && !/\.bak-/i.test(f) && !/(^|\/)CLAUDE\.md$/i.test(f) && !/(^|\/)\.env/.test(f);
  if (!ok) { fora.push(f); continue; }
  fs.mkdirSync(path.dirname(path.join(SAIDA, f)), { recursive: true }); fs.copyFileSync(path.join(RAIZ, f), path.join(SAIDA, f)); n++;
}
if (!fs.existsSync(path.join(SAIDA, 'hq', 'index.html'))) { console.log('::error::hq/index.html não entrou na versão limpa'); process.exit(1); }
console.log(`versão limpa: ${n} arquivo(s) em _site/` + (fora.length ? ` · fora da publicação: ${fora.join(', ')}` : ''));
