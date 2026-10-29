-- Importação da planilha de estoque: tabela de-para (código/descrição do estoque -> item do sistema).
-- Rodar no SQL Editor do Supabase. Pode ser executado mais de uma vez.

create table if not exists public.de_para_itens (
    id                 bigint generated always as identity primary key,
    codigo_estoque     text,                 -- ex. '61.5' (texto: '8.10' não pode virar 8.1)
    descricao_estoque  text not null,        -- como vem na planilha, ex. 'Equipamento RA24 MNT-PLE'
    descricao_norm     text not null,        -- descrição sem acento/espaços, para a busca de reserva
    descricao_romaneio text not null,        -- nome no formulário/romaneio, ex. 'RASTREADOR RA24'
    papel              text not null
        check (papel in ('rastreador', 'teclado', 'chip', 'acessorio', 'ignorar')),
    atualizado_por     text,                 -- e-mail de quem criou/editou por último
    atualizado_em      timestamptz not null default now(),
    created_at         timestamptz not null default now()
);

-- Um mapeamento por código; sem código, um por descrição
create unique index if not exists de_para_codigo_uidx
    on public.de_para_itens (codigo_estoque) where coalesce(codigo_estoque, '') <> '';
create unique index if not exists de_para_desc_sem_codigo_uidx
    on public.de_para_itens (descricao_norm) where coalesce(codigo_estoque, '') = '';
create index if not exists de_para_desc_idx on public.de_para_itens (descricao_norm);

-- Mesma regra das outras tabelas: só usuários logados leem e gravam
alter table public.de_para_itens enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'de_para_itens' and policyname = 'de_para_autenticados') then
        create policy de_para_autenticados on public.de_para_itens
            for all to authenticated using (true) with check (true);
    end if;
end $$;
