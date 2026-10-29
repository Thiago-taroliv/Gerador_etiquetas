# Gerador de Etiquetas e Romaneio — Ranor

Sistema interno desenvolvido em **HTML, CSS e JavaScript** com banco de dados **Supabase (PostgreSQL)** para automatizar o fluxo de envio de equipamentos na Ranor Rastreamento.

## Funcionalidades

- **Kanban de pedidos** (aba principal): cada envio aparece na coluna da sua fase — Rascunho, Aguardando NF, NF emitida, Pronto p/ envio, Despachado e Entregue. Os cards podem ser arrastados entre colunas, e as ações do sistema (e-mail, etiqueta, romaneio) avançam a fase sozinhas
- **Importação da planilha de estoque**: o responsável do estoque sobe a planilha de saída e cada envio vira um rascunho no kanban, com aviso do que falta preencher à mão (CPF/CNPJ, endereço, volumes...). Os nomes do estoque viram itens do sistema pela tabela de-para (Gerenciar Dados → De-para Estoque); o chip fica na linha do rastreador na planilha de envio, e rastreador + teclado podem ser montados em kit
- **Junção de pedidos**: ao pedir a NF, o sistema avisa se há outro pedido para o mesmo técnico ainda sem nota (últimos 7 dias) e permite juntar tudo num envio só
- Geração automática de **etiquetas de envio** (com suporte a múltiplos volumes)
- Geração de **romaneio de entrega** para impressão
- **Envio de e-mail ao financeiro** solicitando emissão de nota fiscal
- **Cadastro de destinatários na nuvem** com persistência segura via Supabase
- **Importação e exportação de base** em formato JSON (backup/restore)
- **Autenticação com login e senha** para proteger dados sensíveis (CPF, CNPJ, endereços)
- Seleção rápida de remetente (Ranor / Nortrack / Personalizado)

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

O kanban usa as colunas `fase`, `fase_em`, `rastreio` e `mesclado_em` da tabela `historico`. Para criá-las, rode [`sql/kanban.sql`](sql/kanban.sql) no SQL Editor do Supabase (pode ser executado mais de uma vez).

A importação da planilha de estoque usa a tabela `de_para_itens`: rode [`sql/estoque.sql`](sql/estoque.sql) da mesma forma.

## Segurança

- Os dados sensíveis (documentos, endereços) são armazenados no Supabase com **Row Level Security (RLS)** ativado.
- Apenas usuários autenticados têm permissão de leitura e escrita no banco.
- A chave pública (`anon key`) presente no código é segura por design — ela não dá acesso aos dados sem autenticação válida.

## Motivação

Projeto criado para **automatizar processos repetitivos do trabalho**, aumentando produtividade e reduzindo erros operacionais no fluxo de envios da empresa.
