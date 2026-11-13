# Gerador de Etiquetas e Romaneio — Ranor

Sistema interno desenvolvido em **HTML, CSS e JavaScript** com banco de dados **Supabase (PostgreSQL)** para automatizar o fluxo de envio de equipamentos na Ranor Rastreamento.

## Como o sistema se organiza

Menu: **Pedidos** (quadro) · **Painel** · **Histórico** · **Cadastros**. Com um pedido aberto, aparece também o botão dele no menu (✎ nome), para voltar a ele sem perder nada.

- **Um pedido, um lugar, um botão Salvar.** Pedido novo salvo vira um card na coluna Rascunho. No primeiro e-mail, impressão ou arrasto no quadro, ele passa a existir só no quadro (o rascunho deixa de existir). O botão **Salvar** (ou Ctrl+S), na barra do topo do pedido, grava sempre no lugar certo; a barra mostra a fase e se está "✓ Tudo salvo" ou com "● Alterações não salvas". Trocar de pedido, fechar ou sair da página com alterações pede confirmação
- **Abrir um pedido**: clique no card do quadro (ou na linha do Histórico ou do Painel). **+ Novo pedido** no quadro junta as três entradas: em branco, da planilha de estoque ou da planilha de controle
- **Tela do pedido**: à esquerda o formulário (remetente, destinatário, itens, dados adicionais); à direita **Próximos passos** na ordem do quadro — 1. Pedir NF (e-mail), 2. Imprimir (romaneio, etiqueta ou os dois), 3. Planilhas (Linhas p/ Planilha e p/ Veículos), 4. Despachar — e **Situação** (fase, NF, rastreio/frete, PIX, junção, cancelar/reativar). O e-mail e a impressão salvam o pedido antes. Pedido despachado, entregue ou cancelado abre só para leitura (dá para imprimir de novo e copiar as linhas)

## Funcionalidades

- **Kanban de pedidos** (aba principal): as colunas são as etapas da configuração dos equipamentos — Rascunho, A configurar, Em configuração, Pronto p/ envio, Despachado e Entregue. Os cards são arrastados entre as colunas; o primeiro e-mail ou impressão tira o pedido do Rascunho e o coloca em "A configurar"
- **NF como selo no card**: 🧾 NF não pedida → NF pedida (ao enviar o e-mail) → NF emitida (um clique no selo, ou na Situação/Próximos passos do pedido). Anda em paralelo às colunas (dá para configurar enquanto espera a NF); o topo do quadro mostra quantos pedidos estão aguardando NF, e o despacho avisa se a NF não foi marcada como emitida ou se o pedido não está em "Pronto p/ envio"
- **Importação da planilha de estoque**: o responsável do estoque sobe a planilha de saída e cada envio vira um rascunho no kanban, com aviso do que falta preencher à mão (CPF/CNPJ, endereço, volumes...). Os nomes do estoque viram itens do sistema pela tabela de-para (Cadastros → De-para Estoque); o chip fica na linha do rastreador na planilha de envio. Linhas do mesmo dia, destinatário e unidade viram um envio só, mesmo com várias OS (a prévia permite separar por OS ou juntar envios)
- **Retirada / instalação na Ranor** (ex. envios Rfleet): campo "Forma de saída" no formulário (Transportadora, Retirada na Ranor, Instalação na Ranor). Sem transportadora, o pedido não pede NF nem etiqueta, não pede rastreio/frete, o romaneio serve de comprovante e o card vai direto para Entregue; fica fora das contas de frete do Painel. Na importação do estoque, a forma vem de regras em Configurações (padrão: "Rfleet" no produto, cliente ou motivo → Retirada)
- **Troca de equipamento com defeito**: cada número (IMEI) de um item tem "Substituir", que já pede o número novo e mantém chip e OS de origem, e "Excluir", que tira o número e baixa a quantidade. Ao salvar, o sistema avisa se o romaneio impresso ou o pedido de NF ficaram desatualizados
- **Guia na tela**: confirmações e avisos em modais próprios, e aviso de alterações não salvas antes de trocar de pedido, iniciar outro envio ou sair
- **Montar kit** (prévia da importação e formulário): sugere qual item é cada componente da receita (ex. KIT RA24) e quantos kits dá por OS; tudo ajustável antes de montar, e o kit pode ser desmontado
- **Painel** (aba ao lado de Pedidos): gasto com frete no período (com comparação ao período anterior), envios despachados, frete médio, tempo do pedido ao despacho e do despacho à entrega; gráficos de gasto por mês (12 meses), por transportadora e tempo médio em cada etapa; listas de despachados sem frete e dos mais demorados. Filtros de período e transportadora. As datas de cada fase são gravadas pelo banco (rode [`sql/painel.sql`](sql/painel.sql))
- **Kanban enxuto**: ocupa a largura da tela, cada coluna mostra os 8 pedidos mais recentes (atrasados e juntáveis sempre aparecem) com "Ver mais", rola por dentro e mostra no cabeçalho o total de pedidos e itens. Filtros por destinatário e transportadora
- **Junção de pedidos** do mesmo técnico ainda sem NF (últimos dias, configurável; mesmo CPF/CNPJ ou mesmo nome), para pedir uma nota só:
  - no kanban, pelo botão "Juntar" do card ou arrastando um card sobre o outro: grava na hora, o card juntado sai do quadro
  - ao pedir a NF, o sistema avisa e oferece juntar; "Enviar só este" pede confirmação
  - na importação do estoque, um envio de técnico que já tem pedido aberto sem NF é adicionado a ele (dá para escolher "Criar card novo")
  - se a NF já tinha sido pedida, o próximo e-mail avisa o financeiro para desconsiderar os pedidos anteriores
  - "Separar", na Situação do pedido, desfaz: os itens saem e o pedido volta a ter card próprio
- Geração automática de **etiquetas de envio** (com suporte a múltiplos volumes)
- Geração de **romaneio de entrega** para impressão
- **Linhas p/ Veículos**: um veículo por rastreador no padrão da planilha de importação de veículos da plataforma (cliente na plataforma lembrado por unidade, modelo no padrão da plataforma, ex. "LV-12", placa provisória "RA24 52-01", ICCID e operadora do chip)
- **Envio de e-mail ao financeiro** solicitando emissão de nota fiscal, com os itens separados por OS e conferência/edição antes de enviar
- **Pedido de PIX do frete ao financeiro**: oferecido ao despachar e na Situação de pedidos enviados, com o formulário preenchido a partir do pedido e conferência antes de abrir o e-mail
- **Cadastro de destinatários na nuvem** com persistência segura via Supabase
- **Importação e exportação de base** em formato JSON (backup/restore)
- **Autenticação com login e senha** para proteger dados sensíveis (CPF, CNPJ, endereços)
- Seleção rápida de remetente (cadastrados em Configurações, ou Personalizado)
- **Configurações** (Cadastros → Configurações): e-mails do financeiro, remetentes, motivo → tipo, prazos de atraso do kanban, janela da junção, transportadora padrão, textos do e-mail e receitas de kit

## Tecnologias

| Camada     | Tecnologia                     |
|------------|--------------------------------|
| Frontend   | HTML, CSS, JavaScript (ES Modules) |
| Banco      | Supabase (PostgreSQL na nuvem) |
| Auth       | Supabase Auth (e-mail/senha)   |
| Segurança  | Row Level Security (RLS)       |
| Hospedagem | Vercel (gratuito)              |

## Estrutura do Projeto

```
├── index.html          # Página principal (login, quadro, pedido, painel, histórico, cadastros)
├── style.css           # Estilos globais, navbar, login e botões
├── img/
│   ├── logo.png        # Logo Ranor
│   └── ranor-ico.png   # Favicon
└── js/
    ├── config.js       # Chaves do Supabase, constantes e helpers
    ├── auth.js         # Login, logout e verificação de sessão
    ├── db.js           # CRUD de destinatários, importação/exportação JSON
    ├── ui.js           # Manipulação de formulário e coleta de dados
    ├── render.js       # Renderização de etiquetas, romaneio e e-mail
    ├── kanban.js       # Quadro de pedidos por fase (arrastar e soltar)
    ├── juncao.js       # Junção de pedidos do mesmo técnico (juntar, separar)
    ├── painel.js       # Painel: gasto com frete e prazos
    ├── importarEstoque.js      # Leitor da planilha de estoque (agrupa linhas em envios)
    ├── importarEstoqueModal.js # Prévia da importação e criação dos rascunhos
    ├── dePara.js       # De-para: item do estoque -> item do sistema + papel
    ├── kit.js          # Sugestão, montagem e desmontagem de kits
    ├── kitModal.js     # Tela "Montar kit"
    ├── kitReceitas.js  # Receitas de kit no Supabase
    ├── imeis.js        # Números de um item: colar, substituir e excluir
    ├── dialogo.js      # Modais de confirmação, aviso e pergunta
    ├── conferencia.js  # Conferência do e-mail e resumo antes de concluir
    ├── configuracoes.js     # Configurações editáveis (padrões + Supabase)
    ├── configuracoesTela.js # Tela Cadastros → Configurações
    └── app.js          # Inicialização, bindagem de eventos e orquestração
```

## Como rodar localmente

1. Clone o repositório.
2. Abra a pasta no seu IDE.
3. Inicie com a extensão **Live Server** (necessário para ES Modules).
4. Acesse `http://127.0.0.1:5500` no navegador.
5. Faça login com as credenciais cadastradas no painel do Supabase.

> **Nota:** Abrir o `index.html` diretamente pelo explorador de arquivos (`file:///`) não funciona devido ao bloqueio de módulos ES6 pelo navegador.

## Banco de dados

O kanban usa as colunas `fase`, `fase_em`, `rastreio`, `frete`, `despachado_em` e `mesclado_em` da tabela `historico`. Para criá-las, rode [`sql/kanban.sql`](sql/kanban.sql) no SQL Editor do Supabase (pode ser executado mais de uma vez).

O painel usa as colunas `entregue_em` e `fases_em` (quando o pedido entrou em cada fase, gravado por um gatilho no banco). Para criá-las, rode [`sql/painel.sql`](sql/painel.sql) depois do `kanban.sql`. Antes disso o painel funciona, mas sem o tempo de cada etapa e da entrega.

Bancos criados antes das colunas por etapa de configuração (com as fases "Aguardando NF" e "NF emitida") precisam rodar [`sql/fluxo_configuracao.sql`](sql/fluxo_configuracao.sql) uma vez, logo antes de publicar a versão nova: ele passa os pedidos para as colunas novas e a NF para o selo (`status.nf_emitida`).

A importação da planilha de estoque usa a tabela `de_para_itens`: rode [`sql/estoque.sql`](sql/estoque.sql) da mesma forma.

As receitas de kit ficam na tabela `kit_receitas` ([`sql/kit.sql`](sql/kit.sql)) e as configurações na tabela `configuracoes` ([`sql/configuracoes.sql`](sql/configuracoes.sql)). Sem essas tabelas o sistema funciona com os valores padrão, mas não salva as alterações.

## Segurança

- Os dados sensíveis (documentos, endereços) são armazenados no Supabase com **Row Level Security (RLS)** ativado.
- Apenas usuários autenticados têm permissão de leitura e escrita no banco.
- A chave pública (`anon key`) presente no código é segura por design — ela não dá acesso aos dados sem autenticação válida.

## Motivação

Projeto criado para **automatizar processos repetitivos do trabalho**, aumentando produtividade e reduzindo erros operacionais no fluxo de envios da empresa.
