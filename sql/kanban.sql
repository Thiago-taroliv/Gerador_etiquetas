-- Kanban de pedidos: fase do envio, rastreio e junção de pedidos.
-- Rodar no SQL Editor do Supabase. Pode ser executado mais de uma vez.

do $$
declare
    tipo_id text;
    primeira_vez boolean;
begin
    primeira_vez := not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'historico' and column_name = 'fase'
    );

    alter table public.historico
        add column if not exists fase     text        not null default 'rascunho',
        add column if not exists fase_em  timestamptz not null default now(),
        add column if not exists rastreio text;

    -- mesclado_em usa o mesmo tipo de historico.id (uuid ou bigint)
    select format_type(a.atttypid, a.atttypmod) into tipo_id
    from pg_attribute a
    where a.attrelid = 'public.historico'::regclass and a.attname = 'id';

    execute format(
        'alter table public.historico add column if not exists mesclado_em %s references public.historico(id) on delete set null',
        tipo_id
    );

    if not exists (select 1 from pg_constraint where conname = 'historico_fase_check') then
        alter table public.historico add constraint historico_fase_check
            check (fase in ('rascunho','aguardando_nf','nf_emitida','pronto','despachado','entregue','cancelado'));
    end if;

    -- Registros que já existiam antes do kanban começam como entregues (só na primeira execução)
    if primeira_vez then
        update public.historico set fase = 'entregue', fase_em = created_at;
    end if;
end $$;

create index if not exists historico_fase_idx on public.historico (fase, fase_em desc);

-- Tempo real: o kanban se atualiza sozinho quando um pedido muda (em outra aba ou aparelho)
do $$
begin
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'historico') then
        alter publication supabase_realtime add table public.historico;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos_pendentes') then
        alter publication supabase_realtime add table public.pedidos_pendentes;
    end if;
end $$;
