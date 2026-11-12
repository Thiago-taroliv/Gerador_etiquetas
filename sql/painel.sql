-- Painel: data de entrega e o momento em que o pedido entrou em cada fase (para os prazos).
-- Rodar no SQL Editor do Supabase depois do kanban.sql. Pode ser executado mais de uma vez.

alter table public.historico
    add column if not exists entregue_em timestamptz,
    add column if not exists fases_em    jsonb not null default '{}'::jsonb;

-- A cada mudança de fase, guarda quando ela aconteceu em fases_em ({"aguardando_nf": "...", ...}).
-- Voltar de fase apaga as datas das fases seguintes (o pedido vai passar por elas de novo).
-- Fica no banco para valer em qualquer caminho: kanban, formulário, junção ou outra aba.
create or replace function public.historico_registra_fase() returns trigger
language plpgsql as $$
declare
    ordem constant text[] := array['rascunho','aguardando_nf','nf_emitida','pronto','despachado','entregue'];
    pos int;
    f text;
    quando timestamptz;
begin
    if tg_op = 'UPDATE' and new.fase is not distinct from old.fase then
        return new;
    end if;

    quando := coalesce(new.fase_em, now());
    new.fases_em := coalesce(new.fases_em, '{}'::jsonb);
    pos := array_position(ordem, new.fase);
    if pos is not null then
        foreach f in array ordem[pos + 1:] loop
            new.fases_em := new.fases_em - f;
        end loop;
    end if;
    new.fases_em := new.fases_em || jsonb_build_object(new.fase, quando);

    if new.fase = 'entregue' then
        new.entregue_em := quando;
    elsif new.fase <> 'cancelado' then
        new.entregue_em := null;
    end if;
    return new;
end $$;

drop trigger if exists historico_registra_fase on public.historico;
create trigger historico_registra_fase
    before insert or update of fase on public.historico
    for each row execute function public.historico_registra_fase();

-- Pedidos que já existiam: aproveita as datas que já estão gravadas.
-- Os marcados como entregues na criação do kanban (fase_em = created_at) ficam sem data de entrega.
update public.historico
set entregue_em = fase_em
where fase = 'entregue' and entregue_em is null and fase_em > created_at + interval '1 minute';

update public.historico h
set fases_em = jsonb_strip_nulls(jsonb_build_object(
        'rascunho', coalesce(
            case when h.dados_completos->>'rascunho_em' ~ '^\d{4}-\d{2}-\d{2}'
                 then (h.dados_completos->>'rascunho_em')::timestamptz end,
            h.created_at),
        'despachado', h.despachado_em
    ) || case
        when h.fase in ('rascunho', 'despachado') then '{}'::jsonb
        when h.fase = 'entregue' and h.entregue_em is null then '{}'::jsonb
        else jsonb_build_object(h.fase, h.fase_em)
    end)
where h.fases_em = '{}'::jsonb;

create index if not exists historico_despachado_idx on public.historico (despachado_em desc);
