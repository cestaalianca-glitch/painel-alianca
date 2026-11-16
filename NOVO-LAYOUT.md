# Novo layout do Aliança HQ (branch `feat/novo-layout-hq`)

Esta branch existe para desenhar o layout novo **sem mexer no `main` em produção**. Nada daqui vai para o GitHub Pages antes do merge aprovado pelo Gestor. A esteira só publica o `main`.

## O que tem aqui (16/11/2026)
A página antiga (o escritório em pixel) saiu desta branch e continua intacta no `main`. No lugar entrou um painel no padrão **Tabler 1.7.5** (github.com/tabler/tabler), tema claro fixo, sem texto explicativo:

- `hq/index.html`: a estrutura, com a marcação da documentação do Tabler (página, cartões, painel lateral, modal e aviso). Não guarda dado nenhum.
- `hq/hq.css`: só o que o Tabler não traz (as duas cores pedidas pelo Gestor, a linha de dado da gaveta, o "desfazer" e o aperto de espaço no celular).
- `hq/hq.js`: a leitura do banco e a tela.

O Tabler vem da CDN com versão fixa e trava de integridade. Para trocar de versão, copiar de novo as linhas da documentação (`docs.tabler.io`): a trava vale só para uma versão. Ele precisa de navegador recente (Chrome 123, Safari 17.5 ou mais novos); em navegador antigo a página mostra um aviso no topo.

**Sem login** a página lê só as linhas de contagem (`hq-pc` e `hq-servidor`) e mostra uma tabela: o estado de cada funcionário digital. Sem número, sem fila, sem detalhe.

**Com o login do Gestor** (o mesmo do Painel, papel `admin`) ela lê a linha privada `hq-financeiro` e abre com três blocos:

1. **Pendências**: decisões de crédito (Aprovar ou Recusar), Pix para revisar, entregas a confirmar, falhas e pontos de atenção.
2. **Indicadores**: Pix hoje, vendido hoje, recebido hoje, a receber em 7 dias, atraso até 90 dias e equipe digital no mês. Sem leitura do banco o Pix fica vazio, nunca zero.
3. **Funcionários digitais**: tabela com estado, volume de hoje, fila e chave. Tocar na linha abre o painel lateral com a fila, os números e as outras chaves.

Abaixo ficam a esteira do site (do cadastro à recompra) e o bloco "Ordens e controles".

## Como as ordens são seguras
- Só aparecem para o Gestor logado, e a permissão de verdade é a regra do banco (RLS), não o botão.
- **Pendência (crédito e entrega)**: 1 toque. A ordem espera 5 segundos, com o botão "Desfazer", e só então sai. Se o Gestor trocar de aplicativo nesses 5 segundos, ela sai na hora.
- **Chave e ordens de risco** (reiniciar número, rodada de cobrança, diretriz): sempre com uma pergunta que diz o que vai acontecer. Cancelar não grava nada.
- A ordem usa o contrato de sempre: uma linha `hq-cmd-...` com status `pendente`, executada pelo worker do servidor numa lista fechada.
- A chave só muda de posição quando o servidor publica o novo estado. Enquanto isso fica travada.
- A chave de gravar baixa sozinha não liga por aqui: só pelo terminal.

## Como ver a prévia
- No computador, na pasta desta branch:
  ```
  npx --yes http-server -p 8080 -c-1 .
  ```
  Abrir `http://localhost:8080/hq/`.
- Na nuvem: na aba Actions, baixar o artifact `previa-hq-<commit>` do push.

## O que ficou de fora de propósito
- O mapa do escritório e o "Contratar" (pedido de vaga no mapa).
- O resumo dos relatórios protegidos (v2, cobrança e comissão): continuam no Painel.
- As frases que explicavam cada regra e cada número: o detalhe mostra só dado.

## Antes do merge no `main`
- [x] A trava da linha pública passa (`node .github/ci/conferir-publico.js`).
- [x] O painel privado só aparece depois do login, e ao sair nada fica guardado na página.
- [x] Testado na largura de celular (375 px) e em tela larga, com dados de teste.
- [ ] Testado pelo Gestor com o login real, no celular.
- [ ] Prévia aprovada pelo Gestor no pull request.
- [ ] **Depois do merge, não rodar mais `node ecossistema/hq/atualizar-modulo.js --pages`**: esse comando copia a página antiga por cima de `hq/index.html`. A página nova não é gerada: é editada aqui.
