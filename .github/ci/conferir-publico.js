// TRAVA DA LINHA PÚBLICA DO ALIANÇA HQ (Bloco 19, 14/11/2026). Este repositório é PÚBLICO (GitHub Pages): antes de publicar, a esteira
// confere que nada aqui tem arquivo .bak-*, chave de serviço ou dado de cliente/financeiro escrito na página: CPF, telefone, valor em reais,
// número de pedido do site ou e-mail. Os dados reais só chegam pelo Supabase depois do login do Gestor (linha privada hq-financeiro).
// Falhou = o build para e o GitHub Pages continua com a versão anterior. Nunca imprime o valor achado (só o tipo, o arquivo e a linha).
//   node .github/ci/conferir-publico.js
// Exceção conhecida e justificada: .github/ci/permitidos.json ({ "trechos": [{ "texto": "...", "porque": "..." }] }).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const RAIZ = path.resolve(__dirname, '..', '..');
const arquivos = cp.execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);
const permitidos = (() => { try { return (JSON.parse(fs.readFileSync(path.join(__dirname, 'permitidos.json'), 'utf8')).trechos || []).map(x => x.texto); } catch { return []; } })();
const TEXTO = /\.(html?|js|mjs|css|json|txt|md|svg|xml|webmanifest)$/i, IGNORA = /^\.github\/ci\//;
const PADROES = [
  ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g],
  ['CPF ou telefone sem pontuação', /(?<![\w.$#-])\d{11}(?![\w.])/g],
  ['telefone celular', /\(?\b[1-9]{2}\)?[\s.-]?9\d{4}[\s.-]?\d{4}\b/g],
  ['telefone fixo', /\(\d{2}\)\s?[2-5]\d{3}-\d{4}\b/g],
  ['valor em reais', /R\$\s?\d[\d.]*(,\d{2})?/g],
  ['número de pedido do site', /\bS\d{6}-\d{3}\b/g],
  ['e-mail', /\b[\w.+-]+@[\w-]+\.[a-z]{2,}(\.[a-z]{2,})?\b/gi],
  ['chave secreta do Supabase', /\bsb_secret_[\w-]{8,}/g],
];
const mascara = s => String(s).slice(0, 2) + '…(' + String(s).length + ')';
const problemas = [];
for (const f of arquivos) {
  if (/\.bak-/i.test(f)) { problemas.push(`${f}: arquivo .bak-* rastreado (backup nunca vai para o público)`); continue; }
  if (/(^|\/)\.env(\.|$)|\.pem$|\.key$/i.test(f)) { problemas.push(`${f}: arquivo de segredo rastreado`); continue; }
  if (!TEXTO.test(f) || IGNORA.test(f)) continue;
  const linhas = fs.readFileSync(path.join(RAIZ, f), 'utf8').split(/\r?\n/);
  linhas.forEach((l, i) => {
    for (const [tipo, re] of PADROES) for (const m of l.matchAll(re)) { if (permitidos.some(p => p && l.includes(p) && p.includes(m[0]))) continue; problemas.push(`${f}:${i + 1}: ${tipo} ${mascara(m[0])}`); }
    for (const m of l.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]+/g)) {   // JWT: só a chave pública (anon) pode aparecer; a de serviço nunca
      let papel = ''; try { papel = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).role || ''; } catch { papel = '?'; }
      if (papel !== 'anon') problemas.push(`${f}:${i + 1}: chave JWT com papel "${papel}" (só a anon é pública)`);
    }
  });
}
console.log(`linha pública: ${arquivos.length} arquivo(s) conferido(s)`);
if (problemas.length) { console.log(`\n${problemas.length} problema(s):\n- ` + problemas.join('\n- ')); for (const p of problemas) console.log(`::error::${p}`); process.exit(1); }
console.log('ok: nenhum .bak, segredo ou dado de cliente na linha pública');
