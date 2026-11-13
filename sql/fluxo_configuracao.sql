-- Kanban por etapa da configuração: as colunas passam a ser
--   rascunho -> a_configurar -> configurando -> pronto -> despachado -> entregue
-- e a NF vira um selo no card, guardado no status:
--   email = NF pedida (email_em: quando), nf_emitida = NF emitida (nf_emitida_em: quando).
--
-- Rodar no SQL Editor do Supabase DEPOIS do kanban.sql e do painel.sql, e logo ANTES de publicar a versão nova
-- do programa: a versão antiga grava 'aguardando_nf', que deixa de ser aceita, e a nova grava 'a_configurar',
-- que antes não era aceita. Pode ser executado mais de uma vez. Se der erro, nada é alterado (roda tudo junto).
--
-- Pedidos que estavam em "Aguardando NF" ou "NF emitida" vão para a coluna da etapa de configuração
-- em que estavam (o antigo selo ⚙): Saída do estoque -> A configurar, Em configuração -> Em configuração,
-- Configurado -> Pronto p/ envio. Os de "Pronto p/ envio" ficam lá, a não ser que o selo dissesse outra etapa.

-- 1) Aceita as fases antigas e as novas durante a migração
alter table public.historico drop constraint if exists historico_fase_check;
alter table public.historico add constraint historico_fase_check
    check (fase in ('rascunho','aguardando_nf','nf_emitida','a_configurar','configurando','pronto','despachado','entregue','cancelado'));

-- 2) Gatilho das datas de cada fase (fases_em) com a ordem nova
create or replace function public.historico_registra_fase() returns trigger
language plpgsql as $$
declare
    ordem constant text[] := array['rascunho','a_configurar','configurando','pronto','despachado','entregue'];
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

-- 3) NF no status, a partir das fases por onde o pedido passou
--    (despachado/entregue: a NF saiu com o pedido, então conta como emitida)
update public.historico h
set status = coalesce(h.status::jsonb, '{}'::jsonb)
    || case when h.fases_em ? 'aguardando_nf'
            then jsonb_build_object('email_em', h.fases_em->'aguardando_nf') else '{}'::jsonb end
    || case when h.fase = 'nf_emitida' or h.fases_em ? 'nf_emitida' or h.fase in ('despachado', 'entregue')
            then jsonb_build_object('nf_emitida', true) else '{}'::jsonb end
    || case when h.fases_em ? 'nf_emitida'
            then jsonb_build_object('nf_emitida_em', h.fases_em->'nf_emitida') else '{}'::jsonb end
where h.fase in ('aguardando_nf', 'nf_emitida')
   or (h.fases_em ?| array['aguardando_nf', 'nf_emitida'])
   or (h.fase in ('despachado', 'entregue') and not (coalesce(h.status::jsonb, '{}'::jsonb) ? 'nf_emitida'));

-- 4) Fase nova pela etapa de configuração que estava no selo (dados_completos.preparo)
update public.historico h
set fase = case coalesce(h.dados_completos->>'preparo', 'estoque')
        when 'configurado'  then 'pronto'
        when 'configurando' then 'configurando'
        else 'a_configurar'
    end
where h.fase in ('aguardando_nf', 'nf_emitida');

update public.historico h
set fase = case h.dados_completos->>'preparo' when 'configurando' then 'configurando' else 'a_configurar' end
where h.fase = 'pronto' and h.dados_completos->>'preparo' in ('estoque', 'configurando');

-- 5) As datas das fases antigas já estão no status: saem de fases_em
update public.historico
set fases_em = fases_em - 'aguardando_nf' - 'nf_emitida'
where fases_em ?| array['aguardando_nf', 'nf_emitida'];

-- 6) O selo de configuração deixa de existir (a etapa agora é a coluna)
update public.historico set dados_completos = dados_completos - 'preparo' where dados_completos ? 'preparo';
update public.pedidos_pendentes set dados_completos = dados_completos - 'preparo' where dados_completos ? 'preparo';

-- 7) Só as fases novas
alter table public.historico drop constraint historico_fase_check;
alter table public.historico add constraint historico_fase_check
    check (fase in ('rascunho','a_configurar','configurando','pronto','despachado','entregue','cancelado'));

-- 8) Prazos de atraso salvos para as colunas antigas não valem mais (o programa usa o padrão das novas)
do $$
begin
    if to_regclass('public.configuracoes') is not null then
        update public.configuracoes
        set valor = valor - 'aguardando_nf' - 'nf_emitida'
        where chave = 'kanban_atraso' and jsonb_typeof(valor) = 'object';
    end if;
end $$;
