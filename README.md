# Gerador de Etiquetas e Romaneio — Ranor

Sistema interno desenvolvido em **HTML, CSS e JavaScript** com banco de dados **Supabase (PostgreSQL)** para automatizar o fluxo de envio de equipamentos na Ranor Rastreamento.

## Funcionalidades

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
    └── app.js          # Inicialização, bindagem de eventos e orquestração
```

## Como rodar localmente

1. Clone o repositório.
2. Abra a pasta no seu IDE.
3. Inicie com a extensão **Live Server** (necessário para ES Modules).
4. Acesse `http://127.0.0.1:5500` no navegador.
5. Faça login com as credenciais cadastradas no painel do Supabase.

> **Nota:** Abrir o `index.html` diretamente pelo explorador de arquivos (`file:///`) não funciona devido ao bloqueio de módulos ES6 pelo navegador.

## Segurança

- Os dados sensíveis (documentos, endereços) são armazenados no Supabase com **Row Level Security (RLS)** ativado.
- Apenas usuários autenticados têm permissão de leitura e escrita no banco.
- A chave pública (`anon key`) presente no código é segura por design — ela não dá acesso aos dados sem autenticação válida.

## Motivação

Projeto criado para **automatizar processos repetitivos do trabalho**, aumentando produtividade e reduzindo erros operacionais no fluxo de envios da empresa.
