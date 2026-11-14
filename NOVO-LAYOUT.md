# Novo layout executivo do Aliança HQ (branch `feat/novo-layout-hq`)

Esta branch existe para desenhar o layout novo **sem mexer no `main` em produção**. Nada daqui vai para o GitHub Pages antes do merge aprovado pelo Gestor. A esteira só publica o `main`.

## Como trabalhar
- Página atual: `hq/index.html`, gerada no repositório do ecossistema.
- Layout novo: começar numa pasta separada (`hq/novo/`) ou direto no `hq/index.html` desta branch.
- Prévia local, na pasta do repositório:
  ```
  npx --yes http-server -p 8080 -c-1 .
  ```
  Abrir `http://localhost:8080/hq/`.
- Prévia da nuvem: na aba Actions, baixar o artifact `previa-hq-<commit>` de cada push.

## Para fazer o merge no `main`
- [ ] A trava da linha pública passa (`node .github/ci/conferir-publico.js`): nenhum nome, CPF, telefone, valor, parcela, pedido ou métrica financeira escrita na página.
- [ ] O painel privado (Gestor) continua aparecendo só depois do login.
- [ ] Testado no computador e no celular (largura de 375 px).
- [ ] Prévia aprovada pelo Gestor no pull request.
