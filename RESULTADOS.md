# Painel de Resultados (branch `feat/novo-painel-resultados`)

Painel executivo do Gestor, no padrão **Tabler 1.7.5** (github.com/tabler/tabler), tema claro fixo, sem texto explicativo. Esta branch existe para a prévia: nada daqui vai para o GitHub Pages antes do merge aprovado pelo Gestor. A esteira só publica o `main`.

## O que mudou de lugar
- A **entrada do painel** (`index.html`) passa a ser o painel executivo novo.
- O painel de antes (abas O mês, Clientes e Histórico) **não perdeu nada**: virou `painel-completo.html`, a um toque, no rodapé. Os arquivos dele (`carregar.js`, `mes.js`, `clientes.js`, `historico.js`, `extras.js`, `painel.css`) não foram alterados.

## O que a página mostra
Tudo vem do banco **depois do login do Gestor** (papel `admin`). A página não guarda dado nenhum e, ao sair, nada fica na tela.

No topo, quatro números: vendido no mês, recebido no mês (com o ritmo contra o normal do dia), atraso até 90 dias e o ano contra o ano passado. Abaixo, quatro blocos:

1. **Vendas por canal**: cada canal digital e os vendedores sem contato digital, com cestas, valor e parte do total do mês.
2. **Resposta e conversão por fluxo**: cada fluxo dos robôs com o que foi enviado, quem respondeu e quem fechou.
3. **Recuperação de atrasados**: o que está em aberto (até 90 dias e mais de 90), o que entrou depois de lembrete no mês e o que entrou em 12 meses de vendas com mais de 60 dias, pela idade da venda.
4. **Comparativo mensal**: os últimos seis meses, com a variação do vendido e a meta do recebido. O mês corrente aparece parcial.

O ranking de rotas e vendedores e o retorno por funcionário digital saíram desta tela (pedido do Gestor: só os indicadores que importam). Rotas e vendedores continuam no painel completo.

## De onde vem cada número
Nenhuma fonte nova foi criada. A página lê três coisas que o servidor já publica:

| Fonte | O que a página usa |
| --- | --- |
| linha `hq-financeiro` | `roi.mes` (empresa, sistema e vendas por origem), `credito.caixa.inadimplencia`, `credito.indicacaoVip`, `credito.recompra` e `credito.funil` |
| linha `v2` | só `mes.serieEmpresa`, `mes.empresa.ritmo`, `mes.diaAtual`, `historico.ytd` e `historico.origem` (dinheiro que entrou pela idade da venda) |
| linha `hq-servidor` | só as contagens das campanhas dos últimos 7 dias |

## O que o servidor ainda não publica (a célula fica com um traço, em vez de número inventado)
- **Comparativo semanal**: existe só o mensal. Quando o servidor publicar a semana, entra uma tabela igual à dos meses.
- **Quem respondeu, no mês**: a linha "Todos os contatos dos robôs" mostra a resposta quando o cálculo do servidor passar a publicar `roi.mes.sistema.responderam`.

## Visual
O Tabler vem da CDN com versão fixa e trava de integridade. Para trocar de versão, copiar de novo as linhas da documentação (`docs.tabler.io`): a trava vale só para uma versão. Ele precisa de navegador recente (Chrome 123, Safari 17.5 ou mais novos); em navegador antigo a página mostra um aviso no topo. `resultados.css` tem só o que o Tabler não traz.

## Como ver a prévia
Na pasta desta branch:
```
npx --yes http-server -p 8080 -c-1 .
```
Abrir `http://localhost:8080/` e entrar com o login do Gestor.

## Antes do merge no `main`
- [x] A trava da linha pública, a sintaxe e a versão limpa passam.
- [x] Sem login a página mostra só o botão de entrar; ao sair, nenhum número fica na página.
- [x] Testado na largura de celular (375 px) e em tela larga, com dados de teste.
- [ ] Testado pelo Gestor com o login real, no celular.
- [ ] Números conferidos pelo Gestor com a comissão e com a Cobrança Diária do mesmo dia.
- [ ] Prévia aprovada pelo Gestor no pull request.
