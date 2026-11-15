# Novo layout executivo do Aliança HQ (branch `feat/novo-layout-hq`)

Esta branch existe para desenhar o layout novo **sem mexer no `main` em produção**. Nada daqui vai para o GitHub Pages antes do merge aprovado pelo Gestor. A esteira só publica o `main`.

## O que tem aqui (15/11/2026)
A página antiga (o escritório em pixel) saiu desta branch e continua intacta no `main`. No lugar entrou uma página escrita à mão, leve, pensada primeiro para o celular:

- `hq/index.html`: a estrutura. Não guarda dado nenhum.
- `hq/hq.css`: o visual (cores da marca e de status do design system, com modo escuro).
- `hq/hq.js`: a leitura do banco e a tela.

**Sem login** a página lê só as linhas de contagem (`hq-pc` e `hq-servidor`) e mostra uma coisa: se cada funcionário digital está trabalhando, em pausa ou aguardando janela. Sem número, sem fila, sem gaveta.

**Com o login do Gestor** (o mesmo do Painel, papel `admin`) ela lê a linha privada `hq-financeiro` e mostra:

1. **Radar de decisão** no topo: "Operação 100% automática" ou a lista do que precisa de você (revisão de crédito, Pix para revisar, falha crítica).
2. **Pulso financeiro**: caixa Pix de hoje com a hora da leitura do banco (sem leitura o valor fica vazio, nunca zero), previsão de 7 dias, inadimplência em duas camadas (até 90 dias e histórico antigo) e a receita gerada pela equipe digital.
3. **Equipe digital**: seis funcionários (Atendente da Central, Analista de Crédito, Especialista VIP, Recuperador de Base, Cobrador Preventivo e Secretário dos Vendedores), cada um com estado, produção, fila e interruptor. Tocar abre a gaveta com a fila do próximo dia útil, as regras e o histórico.
4. **Do cadastro à recompra**: a esteira com os números de cada etapa.

## Como os interruptores são seguros
- Só aparecem para o Gestor logado, e a permissão de verdade é a regra do banco (RLS), não o botão.
- Todo toque abre uma confirmação que diz o que vai acontecer e quem recebe mensagem. Cancelar não grava nada.
- A ordem usa o contrato de sempre: uma linha `hq-cmd-...` com status `pendente`, executada pelo worker do servidor numa lista fechada.
- O interruptor só muda de posição quando o servidor publica a chave no novo estado. Enquanto isso mostra "Aguardando o servidor".
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

## Antes do merge no `main`
- [x] A trava da linha pública passa (`node .github/ci/conferir-publico.js`).
- [x] O painel privado só aparece depois do login, e ao sair nada fica guardado na página.
- [x] Testado na largura de celular (375 px), em tela larga e no modo escuro, com dados de teste.
- [ ] Testado pelo Gestor com o login real, no celular.
- [ ] Prévia aprovada pelo Gestor no pull request.
- [ ] **Depois do merge, não rodar mais `node ecossistema/hq/atualizar-modulo.js --pages`**: esse comando copia a página antiga por cima de `hq/index.html`. A página nova não é gerada: é editada aqui.
