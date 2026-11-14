# painel-alianca — GitHub Pages do Aliança HQ (repositório PÚBLICO)

Responder sempre em português. Este repositório é **público**: nunca colocar nome de cliente, CPF, telefone, valor, parcela, número de pedido, e-mail, senha, token ou chave de serviço em nenhum arquivo. A chave *anon* do Supabase (em `config.js` e `hq/index.html`) é pública por desenho: o que ela lê é decidido pelo RLS. Os dados reais só aparecem depois do login do Gestor (linha privada `hq-financeiro`).

## Esteira do GitHub (`.github/workflows/pages.yml`)
- Todo push e todo pull request, em qualquer branch:
  - roda a **trava da linha pública** (`.github/ci/conferir-publico.js`). Ela barra arquivo `.bak-*`, chave de serviço, CPF, telefone, valor em reais, número de pedido do site e e-mail;
  - monta a **versão limpa** (`_site/`, só páginas, pelo `.github/ci/montar-site.js`);
  - guarda a **prévia baixável** (artifact `previa-hq-<commit>`).
- **Só o `main` publica** no GitHub Pages (job `publicar`, ambiente `github-pages`). Se a trava falhar, nada é publicado e o site continua na versão anterior.
- Rodar a trava antes de subir: `node .github/ci/conferir-publico.js`.

## Fluxo oficial para layout novo do HQ: branch separada e prévia antes do merge
1. Trabalhar sempre na branch `feat/novo-layout-hq` (ou outra `feat/...`), nunca direto no `main`.
2. Para ver a **prévia local**, rode na pasta do repositório:
   ```
   npx --yes http-server -p 8080 -c-1 .
   ```
   Depois abra `http://localhost:8080/hq/`. O HQ lê o Supabase ao vivo com a chave pública; o painel privado só aparece com o login do Gestor.
3. **Prévia da nuvem**: cada push na branch roda a esteira. Na aba Actions, baixe o artifact `previa-hq-<commit>` e abra `hq/index.html`.
4. Abra um pull request da branch para o `main`. A esteira (trava e versão limpa) tem de passar.
5. O Gestor confere a prévia no computador e no celular e aprova o merge. **Só depois do merge no `main`** o Pages publica.
6. Exceção: correção urgente de dado sensível que vazou entra direto no `main`, num commit pequeno.

## De onde vem a página
- `hq/index.html` é gerada no repositório do ecossistema (`Painel Alianca`). Para atualizar o módulo ao vivo e copiar a página para cá, rode lá:
  ```
  node ecossistema/hq/atualizar-modulo.js --pages
  ```
  A limpeza da linha pública (`ecossistema/hq/linha-publica.js`) tira valores em reais do texto fixo.
- Nunca criar arquivo `.bak-*` dentro deste repositório. Backup de página fica no repositório do ecossistema, que ignora `.bak`.
