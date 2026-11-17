# painel-alianca — Painel de Resultados e Aliança HQ no GitHub Pages (repositório PÚBLICO)

Responder sempre em português. Este repositório é **público**: nunca colocar nome de cliente, CPF, telefone, valor, parcela, número de pedido, e-mail, senha, token ou chave de serviço em nenhum arquivo (nem em comentário, nem neste manual). A chave *anon* do Supabase (em `config.js` e `hq/index.html`) é pública por desenho: o que ela lê é decidido pelo RLS. Os dados reais só aparecem depois do login (linha privada `hq-financeiro` e linhas do painel).

## Mapa: o que mora onde (abra só o arquivo da tela em que vai mexer)

| Tela ou assunto | Arquivos | De onde vem o dado |
|---|---|---|
| **Painel de Resultados** (a página se chama "Painel Aliança": abas O mês, Clientes, Histórico) | `index.html`, `carregar.js` (login e busca), `mes.js`, `clientes.js`, `historico.js`, `extras.js` (resumo por vendedor), `atualizar.js` (botão Atualizar agora), `painel.css` | linha `v2` de `painel_dados`, calculada no repositório do ecossistema (`scripts/painel_v2_*.js`) |
| **Cobrança Diária** | `cobranca/` | linha `cobranca` (ecossistema: `scripts/cobranca_diaria_v2.js`) |
| **Carregamento e Trocas** | `carregamento/` | tabelas do carregamento no Supabase |
| **Central Aliança** (porta de entrada) | `central/index.html` | — |
| **Aliança HQ** | `hq/index.html` (**gerado**, não editar à mão), `hq/office.css` | linhas públicas `hq-pc` e `hq-servidor`; linha privada `hq-financeiro` só com login do Gestor |
| **App WhatsApp** (celular do Gestor e do pai: Agora, Conversas, Envios, Perguntar; responder, Pix, catálogo e assumir viram ordens app-cmd-...) | `whatsapp/index.html` (página única, login próprio) | linha privada `app-whatsapp`, montada no servidor dos robôs (`ecossistema/app-whatsapp/`) |
| Login | `login-gate.js`, `config.js` (chaves públicas) | Supabase Auth |
| Visual comum | `estilo-alianca.css` (design system: cor sempre por token) | — |
| Esteiras e governança | `.github/workflows/pages.yml`, `.github/workflows/saude.yml`, `.github/ci/` | regras em `.github/ci/governanca.json` e `permitidos.json` |

Fora daqui: o site de vendas do cliente fica no repositório `site-cesta-alianca`; os robôs, motores e a geração do HQ ficam no repositório privado do ecossistema.

## Economia de tokens (vale para toda sessão)
- Não reler o repositório: o mapa acima diz o arquivo. Abra só ele.
- `hq/index.html` tem cerca de mil linhas e é **gerado**: nunca ler inteiro. Para achar um trecho: `grep -n "texto" hq/index.html` e ler só a faixa. A fonte são os módulos de `ecossistema/hq/` no repositório do ecossistema.
- Para saber o que mudou: `git log --oneline -10`, depois `git diff main...HEAD --stat` e só então o diff do arquivo que interessa.
- Uma tarefa, uma branch curta (`feat/...` ou `fix/...`) saída do `main` atualizado. Depois do merge, a limpeza semanal apaga a branch.
- Estado do repositório em um comando (branches, esteiras, páginas no ar): `node .github/ci/saude-repo.js`.
- Pendências e ideias não ficam em arquivo: o backlog oficial são as Issues do repositório privado do ecossistema (rótulo `Painéis/UX` para telas).

## Esteiras do GitHub
- **`pages.yml`**, em todo push e todo pull request, em qualquer branch:
  1. **trava da linha pública** (`.github/ci/conferir-publico.js`): barra `.bak-*`, segredo, planilha/CSV/PDF, sessão, chave de serviço, CPF, telefone, valor em reais, número de pedido e e-mail;
  2. **sintaxe** (`conferir-sintaxe.js`): todo `.js` e todo `<script>` embutido nas páginas precisa compilar;
  3. **versão limpa** (`montar-site.js` monta `_site/`, só páginas) e **prévia baixável** (artefato `previa-hq-<commit>`, 14 dias);
  4. **só o `main` publica** no GitHub Pages (job `publicar`, ambiente `github-pages`). Se algo falhar, nada é publicado e o site continua na versão anterior.
- **`saude.yml`**, toda segunda-feira: audita branches, esteiras e se as páginas estão no ar; apaga as branches já incorporadas ao `main` e paradas há mais de 7 dias. Alerta vira falha e Issue com o rótulo `saude-automatica`.
- **Ganchos locais** (ligar uma vez por computador: `node .github/ci/instalar-ganchos.js`): a mesma trava roda antes de cada commit e de cada envio. Como o repositório é público, é ela que impede o dado de sair do computador.
- Antes de subir, três comandos: `node .github/ci/conferir-publico.js`, `node .github/ci/conferir-sintaxe.js`, `node .github/ci/montar-site.js`.
- Exceção justificada da trava (por exemplo, um telefone da própria empresa): `.github/ci/permitidos.json`, com o motivo escrito.

## Fluxo oficial para tela nova: branch separada e prévia antes do merge
1. Trabalhar sempre numa branch `feat/...` (`feat/novo-layout-hq`, `feat/novo-painel-resultados`), nunca direto no `main`.
2. **Prévia local**: na pasta do repositório, `npx --yes http-server -p 8080 -c-1 .` e abrir `http://localhost:8080/` (painel) ou `http://localhost:8080/hq/` (HQ). As páginas leem o Supabase ao vivo com a chave pública; o conteúdo privado só aparece com login.
3. **Prévia da nuvem**: cada push na branch roda a esteira. Na aba Actions, abrir a execução, baixar o artefato `previa-hq-<commit>` e abrir `index.html` ou `hq/index.html`.
4. Abrir um pull request da branch para o `main`. A esteira (trava, sintaxe e versão limpa) tem de passar.
5. O Gestor confere a prévia no computador e no celular e aprova o merge. **Só depois do merge no `main`** o Pages publica.
6. Exceção: correção urgente de dado sensível que vazou entra direto no `main`, num commit pequeno.

## De onde vem a página do HQ
- `hq/index.html` é gerada no repositório do ecossistema (pasta `Painel Alianca`). Para atualizar o módulo ao vivo e copiar a página para cá, rodar lá: `node ecossistema/hq/atualizar-modulo.js --pages`. A limpeza da linha pública (`ecossistema/hq/linha-publica.js`) tira valores em reais do texto fixo.
- Nunca criar arquivo `.bak-*` dentro deste repositório. Backup de página fica no repositório do ecossistema, que ignora `.bak`.
