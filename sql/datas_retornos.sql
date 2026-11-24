-- Datas confirmadas de despacho e entrega + retornos de material (beta).
-- Rodar no SQL Editor do Supabase DEPOIS do fluxo_configuracao.sql e ANTES de publicar a versão nova do programa.
-- Pode ser executado mais de uma vez.

-- 1) Datas confirmadas
-- despacho_confirmado / entrega_confirmada: a data foi informada por alguém (no modal do despacho, da entrega
-- ou corrigida no pedido). Sem confirmação, a data é só o momento em que o card foi arrastado: o painel deixa
-- esses pedidos fora das médias de prazo. Os pedidos que já existiam começam como não confirmados.
alter table public.historico
    add column if not exists despacho_confirmado boolean not null default false,
    add column if not exists entrega_confirmada  boolean not null default false;

-- 2) Retornos de material (beta)
-- O que deve voltar é calculado pelo programa a partir dos envios (tipos MAN, COR e FOR).
-- Esta tabela guarda só o que já voltou: uma linha por unidade recebida de volta.
-- chave: o IMEI da unidade enviada ou, sem IMEI, "item<n>-<m>" (posição do item e da unidade no envio).
create table if not exists public.retornos (
    id            bigint generated always as identity primary key,
    historico_id  text        not null,   -- id do envio (texto: vale para uuid ou bigint)
    chave         text        not null,
    recebido_em   timestamptz not null default now(),
    obs           text,
    registrado_por text,
    created_at    timestamptz not null default now(),
    unique (historico_id, chave)
);

alter table public.retornos enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = 'retornos' and policyname = 'retornos_autenticados') then
        create policy retornos_autenticados on public.retornos
            for all to authenticated using (true) with check (true);
    end if;
end $$;
