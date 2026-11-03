-- Receitas de kit (ex. KIT RA24): quais itens do romaneio e quantos de cada formam 1 kit.
-- Editadas na tela "Montar kit". Rodar no SQL Editor do Supabase. Pode ser executado mais de uma vez.

create table if not exists public.kit_receitas (
    id             bigint generated always as identity primary key,
    nome           text not null unique,     -- nome do kit no romaneio, ex. 'KIT RA24'
    componentes    jsonb not null,           -- [{ "nome": "RASTREADOR RA24", "qtd": 1 }, ...]
    atualizado_por text,                     -- e-mail de quem criou/editou por último
    atualizado_em  timestamptz not null default now(),
    created_at     timestamptz not null default now()
);

-- Mesma regra das outras tabelas: só usuários logados leem e gravam
alter table public.kit_receitas enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'kit_receitas' and policyname = 'kit_receitas_autenticados') then
        create policy kit_receitas_autenticados on public.kit_receitas
            for all to authenticated using (true) with check (true);
    end if;
end $$;
