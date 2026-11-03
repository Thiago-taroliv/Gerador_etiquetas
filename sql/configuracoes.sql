-- Configurações editáveis na aba Gerenciar Dados > Configurações (e-mails do financeiro, remetentes,
-- motivo -> tipo, prazos do kanban...). Uma linha por configuração; sem linha, vale o padrão do código.
-- Rodar no SQL Editor do Supabase. Pode ser executado mais de uma vez.

create table if not exists public.configuracoes (
    chave          text primary key,     -- ex. 'financeiro_emails'
    valor          jsonb not null,
    atualizado_por text,                 -- e-mail de quem editou por último
    atualizado_em  timestamptz not null default now()
);

-- Mesma regra das outras tabelas: só usuários logados leem e gravam
alter table public.configuracoes enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'configuracoes' and policyname = 'configuracoes_autenticados') then
        create policy configuracoes_autenticados on public.configuracoes
            for all to authenticated using (true) with check (true);
    end if;
end $$;
