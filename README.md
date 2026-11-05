# Gerador de Etiquetas e Romaneio — Ranor

Sistema interno desenvolvido em **HTML, CSS e JavaScript** com banco de dados **Supabase (PostgreSQL)** para automatizar o fluxo de envio de equipamentos na Ranor Rastreamento.

## Funcionalidades

- **Kanban de pedidos** (aba principal): cada envio aparece na coluna da sua fase — Rascunho, Aguardando NF, NF emitida, Pronto p/ envio, Despachado e Entregue. Os cards podem ser arrastados entre colunas, e as ações do sistema (e-mail, etiqueta, romaneio) avançam a fase sozinhas
- **Importação da planilha de estoque**: o responsável do estoque sobe a planilha de saída e cada envio vira um rascunho no kanban, com aviso do que falta preencher à mão (CPF/CNPJ, endereço, volumes...). Os nomes do estoque viram itens do sistema pela tabela de-para (Gerenciar Dados → De-para Estoque); o chip fica na linha do rastreador na planilha de envio. Linhas do mesmo dia, destinatário e unidade viram um envio só, mesmo com várias OS (a prévia permite separar por OS ou juntar envios)
- **Troca de equipamento com defeito**: cada número (IMEI) de um item tem "Substituir", que já pede o número novo e mantém chip e OS de origem, e "Excluir", que tira o número e baixa a quantidade. Ao salvar, o sistema avisa se o romaneio impresso ou o pedido de NF ficaram desatualizados
- **Guia na tela**: confirmações e avisos em modais próprios, e aviso de alterações não salvas antes de trocar de pedido, iniciar outro envio ou sair
- **Montar kit** (prévia da importação e formulário): sugere qual item é cada componente da receita (ex. KIT RA24) e quantos kits dá por OS; tudo ajustável antes de montar, e o kit pode ser desmontado
- **Junção de pedidos**: ao pedir a NF, o sistema avisa se há outro pedido para o mesmo técnico ainda sem nota (últimos dias, configurável) e permite juntar tudo num envio só
- Geração automática de **etiquetas de envio** (com suporte a múltiplos volumes)
- Geração de **romaneio de entrega** para impressão
- **Linhas p/ Veículos**: um veículo por rastreador no padrão da planilha de importação de veículos da plataforma (cliente na plataforma lembrado por unidade, placa provisória "RA24 52-01", ICCID e operadora do chip)
- **Envio de e-mail ao financeiro** solicitando emissão de nota fiscal, com os itens separados por OS e conferência/edição antes de enviar
- **Pedido de PIX do frete ao financeiro**: oferecido ao despachar e no detalhe de pedidos enviados, com o formulário preenchido a partir do pedido e conferência antes de abrir o e-mail
- **Cadastro de destinatários na nuvem** com persistência segura via Supabase
- **Importação e exportação de base** em formato JSON (backup/restore)
- **Autenticação com login e senha** para proteger dados sensíveis (CPF, CNPJ, endereços)
- Seleção rápida de remetente (cadastrados em Configurações, ou Personalizado)
- **Configurações** (Gerenciar Dados → Configurações): e-mails do financeiro, remetentes, motivo → tipo, prazos de atraso do kanban, janela da junção, transportadora padrão, textos do e-mail e receitas de kit

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
├── index.html          # Página principal (login + formulário)
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
    ├── juncao.js       # Alerta e junção de pedidos do mesmo técnico
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
    ├── configuracoesTela.js # Tela Gerenciar Dados → Configurações
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

O kanban usa as colunas `fase`, `fase_em`, `rastreio`, `frete` e `mesclado_em` da tabela `historico`. Para criá-las, rode [`sql/kanban.sql`](sql/kanban.sql) no SQL Editor do Supabase (pode ser executado mais de uma vez).

A importação da planilha de estoque usa a tabela `de_para_itens`: rode [`sql/estoque.sql`](sql/estoque.sql) da mesma forma.

As receitas de kit ficam na tabela `kit_receitas` ([`sql/kit.sql`](sql/kit.sql)) e as configurações na tabela `configuracoes` ([`sql/configuracoes.sql`](sql/configuracoes.sql)). Sem essas tabelas o sistema funciona com os valores padrão, mas não salva as alterações.

## Segurança

- Os dados sensíveis (documentos, endereços) são armazenados no Supabase com **Row Level Security (RLS)** ativado.
- Apenas usuários autenticados têm permissão de leitura e escrita no banco.
- A chave pública (`anon key`) presente no código é segura por design — ela não dá acesso aos dados sem autenticação válida.

## Motivação

Projeto criado para **automatizar processos repetitivos do trabalho**, aumentando produtividade e reduzindo erros operacionais no fluxo de envios da empresa.
