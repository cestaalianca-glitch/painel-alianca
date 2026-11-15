# Painel de Resultados (branch `feat/novo-painel-resultados`)

Página executiva de vendas e recebimentos, em `resultados/`. Esta branch existe para a prévia: nada daqui vai para o GitHub Pages antes do merge aprovado pelo Gestor. A esteira só publica o `main`.

O Painel de vendas atual (`index.html`, com as abas O mês, Clientes e Histórico) **não foi alterado**: só ganhou o atalho "Resultados" no topo.

## O que a página mostra
Tudo vem do banco **depois do login do Gestor** (papel `admin`). A página não guarda dado nenhum e, ao sair, nada fica na tela.

1. **O mês em duas contas**: vendido e recebido, com a parte que passou pela equipe digital.
2. **Do contato ao pagamento** (funil): enviados, responderam, fecharam e pagaram.
3. **O que funciona melhor**: cada abordagem com enviadas, taxa de resposta e taxa de fechamento, mais as vendas do mês por abordagem.
4. **Ranking de rotas e vendedores**: vendas do mês, pontualidade e atraso aberto.
5. **Retorno por funcionário digital**: quanto do mês passou pela mão de cada um.

Só existe um tipo de desenho: barra horizontal. Azul é a empresa, ouro é a parte da equipe digital, vermelho é atraso.

## De onde vem cada número
Nenhuma fonte nova foi criada. A página lê três coisas que o servidor já publica:

| Fonte | O que a página usa |
| --- | --- |
| linha `hq-financeiro` | ROI do mês (empresa e sistema), vendas por origem, rotas, vendedores e o estado dos motores |
| linha `v2` | só a lista de rotas, para a pontualidade (parte do valor que entra em até 60 dias) |
| linha `hq-servidor` | só as contagens das campanhas dos últimos 7 dias |

## O que ainda não é medido (e a página diz isso, em vez de inventar)
- **Responderam, no mês**: o servidor ainda não conta quantos clientes responderam aos contatos do mês. Hoje a taxa de resposta existe só para as campanhas (últimos 7 dias), e é essa que aparece. Quando o cálculo de ROI do servidor passar a publicar `roi.mes.sistema.responderam`, a etapa aparece sozinha no funil.
- **Por janela de pagamento**: o servidor não registra em qual janela cada mensagem saiu. Quando publicar `resultados.janelas` (lista com `nome`, `enviados`, `responderam` e `fecharam`) na linha `hq-financeiro`, a comparação aparece sozinha.

## Como ver a prévia
Na pasta desta branch:
```
npx --yes http-server -p 8080 -c-1 .
```
Abrir `http://localhost:8080/resultados/` e entrar com o login do Gestor.

## Antes do merge no `main`
- [x] A trava da linha pública passa (`node .github/ci/conferir-publico.js`).
- [x] Sem login a página mostra só o convite para entrar; ao sair, nenhum número fica na página.
- [x] Testado na largura de celular (375 px) e em tela larga, com dados de teste.
- [ ] Testado pelo Gestor com o login real, no celular.
- [ ] Prévia aprovada pelo Gestor no pull request.
