// Painel: gasto com frete e prazos dos envios, a partir do histórico de pedidos.
// As contas são feitas aqui no navegador (o volume é pequeno); as datas de cada fase vêm do sql/painel.sql.
// Prazos só usam datas confirmadas (informadas no despacho / na entrega, ou corrigidas no pedido), a não ser
// que "Incluir datas não confirmadas" esteja marcado. A aba Retornos (beta) fica no retornos.js.
import { $, escapeHtml } from './config.js';
import { carregarDadosPainel } from './db.js';
import { formatarFrete } from './planilha.js';
import { abrirVisualizacaoEnvio, abrirModal } from './envioView.js';
import { renderRetornos } from './retornos.js';
import { abrirEntregasLote } from './entregasLote.js';

let dados = null;          // { pedidos, semColunas, semConfirmacao }
let carregadoDesde = null; // data mais antiga já carregada
let carregando = null;
let visao = 'envios';      // 'envios' | 'retornos'
let listas = {};           // listas que os números e as pendências abrem, por chave

const DIA = 864e5;
const TRANSITO_ALERTA = 7; // dias em trânsito sem entrega marcada para virar pendência
const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCurto = v => v >= 10000
    ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil'
    : brl(v).replace(/,\d\d$/, '');
const fmtDias = d => d == null ? '—' : `${d.toLocaleString('pt-BR', { maximumFractionDigits: d < 10 ? 1 : 0 })} dia${d >= 0.95 && d < 1.05 ? '' : 's'}`;
const fmtData = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const media = l => l.length ? l.reduce((s, x) => s + x, 0) / l.length : null;
const mediana = l => {
    if (!l.length) return null;
    const o = [...l].sort((a, b) => a - b), m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ordenarPt = l => [...new Set(l.map(v => (v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// --- Período ---
function periodo() {
    const hoje = new Date();
    const ini = (a, m, d = 1) => new Date(a, m, d);
    const amanha = ini(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    switch ($('painel_periodo')?.value || 'mes') {
        case 'mes_passado': return { de: ini(hoje.getFullYear(), hoje.getMonth() - 1), ate: ini(hoje.getFullYear(), hoje.getMonth()) };
        case '30': return { de: new Date(amanha - 30 * DIA), ate: amanha };
        case '90': return { de: new Date(amanha - 90 * DIA), ate: amanha };
        case 'ano': return { de: ini(hoje.getFullYear(), 0), ate: amanha };
        case 'custom': {
            const de = $('painel_de')?.value, ate = $('painel_ate')?.value;
            if (de && ate && de <= ate) {
                const [a1, m1, d1] = de.split('-').map(Number), [a2, m2, d2] = ate.split('-').map(Number);
                return { de: ini(a1, m1 - 1, d1), ate: ini(a2, m2 - 1, d2 + 1) };
            }
            return { de: ini(hoje.getFullYear(), hoje.getMonth()), ate: amanha };
        }
        default: return { de: ini(hoje.getFullYear(), hoje.getMonth()), ate: amanha };
    }
}

// --- Datas de cada pedido ---
const t = iso => iso ? new Date(iso).getTime() : null;
const inicioDe = r => t(r.fases_em?.rascunho || r.rascunho_em || r.created_at);
const naFase = (r, f) => t(r.fases_em?.[f]);
const despachoDe = r => t(r.despachado_em) || naFase(r, 'despachado');
const entregaDe = r => r.fase === 'entregue' ? (t(r.entregue_em) || naFase(r, 'entregue')) : null;
// Retirada / instalação na Ranor: sem frete nem trânsito, fica fora das contas (só é contada à parte)
const SEM_ENVIO = ['retirada', 'instalacao'];
const comEnvio = r => !SEM_ENVIO.includes(r.entrega);
const entre = (x, p) => x != null && x >= p.de.getTime() && x < p.ate.getTime();
const intervalo = (a, b) => a != null && b != null && b >= a ? (b - a) / DIA : null;

// Datas que entram nos prazos: confirmadas, ou todas se a pessoa pediu
const incluirTodas = () => !!$('painel_nao_confirmadas')?.checked;
const despachoOk = r => incluirTodas() || !!r.despacho_confirmado;
const entregaOk = r => incluirTodas() || !!r.entrega_confirmada;
const despachoPrazo = r => despachoOk(r) ? despachoDe(r) : null;
const entregaPrazo = r => entregaOk(r) && despachoOk(r) ? entregaDe(r) : null;

// A NF anda em paralelo à configuração: as datas dela ficam no status (email_em, nf_emitida_em)
const nfPedidaEm = r => t(r.status?.email_em);
const nfEmitidaEm = r => t(r.status?.nf_emitida_em);
const ETAPAS = [
    { rotulo: 'Até pedir a NF', de: inicioDe, ate: nfPedidaEm },
    { rotulo: 'Esperando a NF', de: nfPedidaEm, ate: nfEmitidaEm },
    { rotulo: 'Esperando configuração', de: r => naFase(r, 'a_configurar'), ate: r => naFase(r, 'configurando') },
    { rotulo: 'Em configuração', de: r => naFase(r, 'configurando'), ate: r => naFase(r, 'pronto') },
    { rotulo: 'Pronto até despachar', de: r => naFase(r, 'pronto'), ate: despachoPrazo },
    { rotulo: 'Em trânsito (até entregar)', de: despachoPrazo, ate: entregaPrazo }
];

// --- Carregamento ---
// Carrega 12 meses antes do fim do período (o gráfico mensal) ou desde o início do período, o que for antes
async function garantirDados(p) {
    const mesesAtras = new Date(p.ate.getFullYear(), p.ate.getMonth() - 11, 1);
    const desde = p.de < mesesAtras ? p.de : mesesAtras;
    if (dados && carregadoDesde && carregadoDesde <= desde) return true;
    if (carregando) return carregando;
    carregando = (async () => {
        const r = await carregarDadosPainel(desde.toISOString());
        carregando = null;
        if (!r) return false;
        dados = r;
        carregadoDesde = desde;
        return true;
    })();
    return carregando;
}

export async function carregarPainel(recarregar = false) {
    if (recarregar) { dados = null; carregadoDesde = null; }
    mostrarFiltros();
    if (visao === 'retornos') { renderRetornos($('painel_corpo'), recarregar); $('painel_aviso').innerHTML = ''; return; }
    const corpo = $('painel_corpo');
    if (!dados) corpo.innerHTML = '<div class="empty-state">Carregando o painel...</div>';
    const p = periodo();
    if (!(await garantirDados(p))) {
        corpo.innerHTML = '<div class="empty-state">Erro ao carregar o painel. Tente atualizar.</div>';
        return;
    }
    renderPainel();
}

// Os filtros do topo só valem para a visão de envios
function mostrarFiltros() {
    document.querySelectorAll('.painel-so-envios').forEach(el => { el.style.display = visao === 'envios' ? '' : 'none'; });
    $('painel_datas').style.display = visao === 'envios' && $('painel_periodo').value === 'custom' ? 'flex' : 'none';
    document.querySelectorAll('[data-visao]').forEach(b => b.classList.toggle('ativo', b.dataset.visao === visao));
}

// --- Componentes ---
// explica: o que o número mede, em uma frase. lista: chave em `listas` (clicar abre os pedidos)
function tile({ rotulo, valor, sub = '', explica = '', hero = false, lista = null }) {
    return `<div class="painel-tile${hero ? ' hero' : ''}${lista ? ' clicavel' : ''}" ${lista ? `onclick="abrirListaPainel('${lista}')" title="Clique para ver os pedidos"` : ''}>
        <div class="painel-tile-rotulo">${rotulo}${lista ? ' <span class="painel-ver">ver ›</span>' : ''}</div>
        <div class="painel-tile-valor">${valor}</div>
        ${sub ? `<div class="painel-tile-sub">${sub}</div>` : ''}
        ${explica ? `<div class="painel-explica">${explica}</div>` : ''}
    </div>`;
}

function deltaHtml(atual, anterior) {
    if (!anterior || !atual) return '';
    const pct = (atual - anterior) / anterior * 100;
    if (Math.abs(pct) < 1) return '<span class="painel-delta">= período anterior</span>';
    // Gasto subindo é ruim
    const sobe = pct > 0;
    return `<span class="painel-delta ${sobe ? 'ruim' : 'bom'}">${sobe ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}% vs período anterior (${brl(anterior)})</span>`;
}

// Colunas verticais (um por mês). Rótulo só no maior e no último; o resto no tooltip e na tabela.
function graficoColunas(barras) {
    const max = Math.max(...barras.map(b => b.valor), 0);
    if (!max) return '<div class="painel-vazio">Nenhum frete registrado nestes meses.</div>';
    const iMax = barras.findIndex(b => b.valor === max);
    const ticks = [max, max / 2].map(v => `<div class="painel-grade" style="bottom:${v / max * 100}%"><span>${brlCurto(v)}</span></div>`).join('');
    return `<div class="painel-colunas">
        <div class="painel-colunas-area">
            ${ticks}
            ${barras.map((b, i) => `
                <div class="painel-coluna" data-tip="${escapeHtml(`${b.rotuloLongo}: ${brl(b.valor)} · ${b.envios} envio(s)`)}">
                    ${(i === iMax || i === barras.length - 1) && b.valor ? `<span class="painel-coluna-valor" style="bottom:calc(${b.valor / max * 100}% + 4px)">${brlCurto(b.valor)}</span>` : ''}
                    <div class="painel-coluna-barra" style="height:${b.valor / max * 100}%"></div>
                </div>`).join('')}
        </div>
        <div class="painel-colunas-eixo">${barras.map(b => `<span>${b.rotulo}</span>`).join('')}</div>
    </div>`;
}

// Barras horizontais com o valor na ponta
function graficoBarras(barras, vazio) {
    const max = Math.max(...barras.map(b => b.valor), 0);
    if (!barras.length || !max) return `<div class="painel-vazio">${vazio}</div>`;
    return `<div class="painel-barras">${barras.map(b => `
        <div class="painel-barra-linha${b.lista ? ' clicavel' : ''}" data-tip="${escapeHtml(b.tip)}" ${b.lista ? `onclick="abrirListaPainel('${b.lista}')"` : ''}>
            <div class="painel-barra-rotulo">${escapeHtml(b.rotulo)}</div>
            <div class="painel-barra-trilho">
                <div class="painel-barra" style="width:${Math.max(b.valor / max * 100, 0.5)}%"></div>
                <span class="painel-barra-valor">${b.texto}</span>
            </div>
        </div>`).join('')}</div>`;
}

function tabela(colunas, linhas) {
    return `<details class="painel-tabela"><summary>Ver tabela</summary>
        <table><thead><tr>${colunas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </details>`;
}

function lista(pedidos, vazio) {
    if (!pedidos.length) return `<div class="painel-vazio">${vazio}</div>`;
    return `<table class="painel-lista"><tbody>${pedidos.map(({ r, extra }) => `
        <tr onclick="abrirPedidoDoPainel('${r.id}')" title="Ver o envio">
            <td><strong>${escapeHtml(r.destinatario || 'Sem destinatário')}</strong>
                <div class="painel-lista-sub">${escapeHtml([r.referencia, r.transportadora].filter(Boolean).join(' · '))}</div></td>
            <td class="painel-lista-extra">${extra}</td>
        </tr>`).join('')}</tbody></table>`;
}

// Guarda uma lista de pedidos para abrir no modal. extra(r): texto da última coluna
function guardarLista(chave, titulo, explica, pedidos, extra = null) {
    listas[chave] = { titulo, explica, pedidos, extra };
    return chave;
}

// --- Pendências: o que falta para os números ficarem certos ---
function pendencias(itens) {
    const total = itens.reduce((s, i) => s + i.n, 0);
    return `<div class="painel-card largo painel-pendencias">
        <div class="painel-card-titulo">${total ? `Para os números ficarem certos <span class="painel-contador">${total}</span>` : '✓ Dados em dia'}</div>
        <div class="painel-card-sub">Pedidos com algum dado faltando ou só estimado. Clique para ver e corrigir no pedido.</div>
        <div class="painel-pend-lista">${itens.map(i => `
            <div class="painel-pend${i.n ? '' : ' ok'}${i.n && (i.lista || i.acao) ? ' clicavel' : ''}" ${i.n && i.acao ? `onclick="${i.acao}"` : i.n && i.lista ? `onclick="abrirListaPainel('${i.lista}')"` : ''}>
                <span class="painel-pend-n">${i.n || '✓'}</span>
                <span><b>${i.titulo}</b><small>${i.dica}</small></span>
                ${i.n && i.acao ? `<span class="painel-ver">${i.textoAcao} ›</span>` : i.n && i.lista ? '<span class="painel-ver">ver ›</span>' : ''}
            </div>`).join('')}</div>
    </div>`;
}

// --- Filtros ---
function preencherSelect(id, valores, todos) {
    const sel = $(id);
    if (!sel) return '';
    const atual = sel.value;
    sel.innerHTML = `<option value="">${todos}</option>` + valores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.value = valores.includes(atual) ? atual : '';
    sel.classList.toggle('ativo', !!sel.value);
    return sel.value;
}

// --- Render ---
function renderPainel() {
    const p = periodo();
    listas = {};
    const todos = dados.pedidos;
    const transp = preencherSelect('painel_transportadora', ordenarPt(todos.filter(comEnvio).map(r => r.transportadora)), 'Todas as transportadoras');
    const tecnico = preencherSelect('painel_tecnico', ordenarPt(todos.map(r => r.destinatario)), 'Todos os técnicos');
    const unidade = preencherSelect('painel_unidade', ordenarPt(todos.map(r => r.unidade)), 'Todas as unidades');
    const tipo = preencherSelect('painel_tipo', ordenarPt(todos.map(r => r.tipo)), 'Todos os tipos');

    const passaFiltros = r => (!tecnico || (r.destinatario || '').trim() === tecnico)
        && (!unidade || (r.unidade || '').trim() === unidade)
        && (!tipo || (r.tipo || '').trim() === tipo);
    const filtrados = todos.filter(passaFiltros);
    const pedidos = filtrados.filter(r => comEnvio(r) && (!transp || (r.transportadora || '').trim() === transp));
    const semEnvioNoPeriodo = transp ? 0 : filtrados.filter(r => !comEnvio(r) && entre(despachoDe(r), p)).length;
    const despachados = pedidos.filter(r => entre(despachoDe(r), p));
    const comFrete = despachados.filter(r => r.frete != null);
    const gasto = comFrete.reduce((s, r) => s + Number(r.frete), 0);
    const semFrete = despachados.filter(r => r.frete == null);

    // Mesmo tamanho de período, logo antes (para comparar o gasto)
    const dur = p.ate - p.de;
    const anterior = { de: new Date(p.de - dur), ate: p.de };
    // Só compara se o período anterior inteiro está nos dados carregados
    const anteriorCarregado = !!carregadoDesde && carregadoDesde <= anterior.de;
    const gastoAnterior = pedidos
        .filter(r => entre(despachoDe(r), anterior) && r.frete != null)
        .reduce((s, r) => s + Number(r.frete), 0);

    // Prazos: só com as datas que valem (confirmadas, ou todas)
    const comPrazoDespacho = despachados.filter(r => despachoPrazo(r) != null);
    const prazosDespacho = comPrazoDespacho.map(r => intervalo(inicioDe(r), despachoPrazo(r))).filter(x => x != null);
    const entregues = pedidos.filter(r => entre(entregaDe(r), p));
    const comPrazoEntrega = entregues.filter(r => entregaPrazo(r) != null);
    const prazosEntrega = comPrazoEntrega.map(r => intervalo(despachoPrazo(r), entregaPrazo(r))).filter(x => x != null);
    const foraDespacho = despachados.length - comPrazoDespacho.length;
    const foraEntrega = entregues.length - comPrazoEntrega.length;

    // Gasto por mês: 12 meses terminando no mês do fim do período
    const ultimo = new Date(p.ate - 1);
    const meses = Array.from({ length: 12 }, (_, i) => {
        const de = new Date(ultimo.getFullYear(), ultimo.getMonth() - 11 + i, 1);
        const ate = new Date(de.getFullYear(), de.getMonth() + 1, 1);
        const doMes = pedidos.filter(r => entre(despachoDe(r), { de, ate }));
        return {
            rotulo: MESES[de.getMonth()] + (de.getMonth() === 0 || i === 0 ? `/${String(de.getFullYear()).slice(2)}` : ''),
            rotuloLongo: `${MESES[de.getMonth()]}/${de.getFullYear()}`,
            valor: doMes.reduce((s, r) => s + (r.frete != null ? Number(r.frete) : 0), 0),
            envios: doMes.length
        };
    });

    // Gasto por transportadora no período
    const porTransp = new Map();
    despachados.forEach(r => {
        const k = (r.transportadora || '').trim() || 'Sem transportadora';
        const x = porTransp.get(k) || { valor: 0, envios: 0, comFrete: 0, pedidos: [] };
        x.envios++;
        x.pedidos.push(r);
        if (r.frete != null) { x.valor += Number(r.frete); x.comFrete++; }
        porTransp.set(k, x);
    });
    const barrasTransp = [...porTransp.entries()].sort((a, b) => b[1].valor - a[1].valor).map(([k, x], i) => ({
        rotulo: k, valor: x.valor,
        texto: `${brl(x.valor)} · ${x.envios} envio(s)`,
        tip: `${k}: ${brl(x.valor)} em ${x.envios} envio(s)` + (x.comFrete ? ` · média ${brl(x.valor / x.comFrete)}` : '') + (x.envios > x.comFrete ? ` · ${x.envios - x.comFrete} sem frete` : '') + ' · clique para ver',
        lista: guardarLista(`transp${i}`, `Despachados · ${k}`, `Despachados no período pela ${k}.`, x.pedidos)
    }));

    // Tempo em cada etapa: pedidos iniciados no período
    const iniciados = pedidos.filter(r => entre(inicioDe(r), p));
    const etapas = ETAPAS.map(e => {
        const l = iniciados.map(r => intervalo(e.de(r), e.ate(r))).filter(x => x != null);
        return { rotulo: e.rotulo, valor: media(l) || 0, n: l.length, med: mediana(l) };
    });
    const barrasEtapas = etapas.filter(e => e.n).map(e => ({
        rotulo: e.rotulo, valor: e.valor,
        texto: `${fmtDias(e.valor)} · ${e.n} pedido(s)`,
        tip: `${e.rotulo}: média ${fmtDias(e.valor)}, mediana ${fmtDias(e.med)} (${e.n} pedido(s))`
    }));

    // Pendências. Em trânsito: todos os despachados ainda sem entrega, de qualquer data.
    const agora = Date.now();
    const emTransito = filtrados.filter(r => comEnvio(r) && r.fase === 'despachado' && despachoDe(r) && (agora - despachoDe(r)) / DIA >= TRANSITO_ALERTA)
        .sort((a, b) => despachoDe(a) - despachoDe(b));
    const semRastreio = despachados.filter(r => !String(r.rastreio || '').trim());
    const despachoNaoConf = filtrados.filter(r => entre(despachoDe(r), p) && !r.despacho_confirmado);
    const entregaNaoConf = filtrados.filter(r => entre(entregaDe(r), p) && !r.entrega_confirmada);
    const diasDe = r => Math.floor((agora - despachoDe(r)) / DIA);
    const itensPend = [
        { n: emTransito.length, titulo: `Em trânsito há ${TRANSITO_ALERTA} dias ou mais`, dica: 'Confira no rastreio e marque a entrega com a data certa.', acao: "abrirEntregasDoPainel('transito')", textoAcao: 'marcar',
          lista: guardarLista('transito', `Em trânsito há ${TRANSITO_ALERTA} dias ou mais`, 'Despachados ainda sem entrega marcada, de qualquer data. Abra o pedido e marque como entregue com a data do rastreio.', emTransito, r => `${diasDe(r)} dias`) },
        { n: semFrete.length, titulo: 'Despachados sem frete', dica: 'Ficam fora do gasto com frete.',
          lista: guardarLista('sem_frete', 'Despachados sem frete preenchido', 'Ficam fora do gasto. Abra o pedido e preencha em "Editar rastreio e frete".', semFrete) },
        { n: semRastreio.length, titulo: 'Despachados sem rastreio', dica: 'Sem o código, não dá para confirmar a entrega.',
          lista: guardarLista('sem_rastreio', 'Despachados sem rastreio', 'Abra o pedido e preencha em "Editar rastreio e frete".', semRastreio) },
        { n: despachoNaoConf.length, titulo: 'Despachos com data não confirmada', dica: 'Data é só a do arraste do card: fica fora dos prazos.',
          lista: guardarLista('desp_nc', 'Despachos com data não confirmada', 'A data gravada é o momento em que o card foi movido. Abra o pedido e use "Confirmar datas".', despachoNaoConf) },
        { n: entregaNaoConf.length, titulo: 'Entregas com data não confirmada', dica: 'Fica fora do tempo de trânsito.', acao: "abrirEntregasDoPainel('confirmar')", textoAcao: 'confirmar',
          lista: guardarLista('entr_nc', 'Entregas com data não confirmada', 'A data gravada é o momento em que o card foi movido. Abra o pedido e use "Confirmar datas" com a data do rastreio.', entregaNaoConf) }
    ];

    // Listas dos números
    guardarLista('despachados', 'Envios despachados', 'Pedidos despachados no período (pela data de despacho).', despachados);
    guardarLista('com_frete', 'Envios com frete', 'Os envios que entram no gasto com frete.', comFrete);
    guardarLista('prazo_despacho', 'Do pedido ao despacho', 'Dias entre a criação do pedido e o despacho. Só os com data de despacho que vale.',
        comPrazoDespacho.sort((a, b) => intervalo(inicioDe(b), despachoPrazo(b)) - intervalo(inicioDe(a), despachoPrazo(a))),
        r => fmtDias(intervalo(inicioDe(r), despachoPrazo(r))));
    guardarLista('prazo_entrega', 'Do despacho à entrega', 'Dias em trânsito. Só os com as duas datas que valem.',
        comPrazoEntrega.sort((a, b) => intervalo(despachoPrazo(b), entregaPrazo(b)) - intervalo(despachoPrazo(a), entregaPrazo(a))),
        r => fmtDias(intervalo(despachoPrazo(r), entregaPrazo(r))));

    const demorados = comPrazoDespacho
        .map(r => ({ r, d: intervalo(inicioDe(r), despachoPrazo(r)) }))
        .filter(x => x.d != null).sort((a, b) => b.d - a.d).slice(0, 8)
        .map(({ r, d }) => ({ r, extra: `${fmtDias(d)}<div class="painel-lista-sub">despachado ${fmtData(r.despachado_em)}</div>` }));

    const nomePeriodo = `${fmtData(p.de)} a ${fmtData(new Date(p.ate - 1))}`;
    const regra = incluirTodas() ? 'todas as datas, inclusive as não confirmadas' : 'só datas confirmadas';
    const fora = n => n ? ` · ${n} sem data confirmada fora da conta` : '';
    $('painel_aviso').innerHTML = [
        dados.semColunas ? '<div class="painel-alerta">⚠ Para medir as etapas e a entrega, rode o <code>sql/painel.sql</code> no SQL Editor do Supabase. Os prazos começam a ser registrados a partir daí.</div>' : '',
        dados.semConfirmacao ? '<div class="painel-alerta">⚠ Rode o <code>sql/datas_retornos.sql</code> no SQL Editor do Supabase: sem ele, nenhuma data fica marcada como confirmada e os prazos só aparecem com "Incluir datas não confirmadas".</div>' : ''
    ].join('');

    $('painel_corpo').innerHTML = `
        <div class="painel-tiles">
            ${tile({ rotulo: 'Gasto com frete', valor: brl(gasto), hero: true, lista: 'com_frete',
                sub: (anteriorCarregado ? deltaHtml(gasto, gastoAnterior) : '') + `<div>${nomePeriodo}</div>`,
                explica: `Soma do frete dos envios despachados no período.${semFrete.length ? ` ${semFrete.length} sem frete preenchido não entram.` : ''}` })}
            ${tile({ rotulo: 'Envios despachados', valor: despachados.length.toLocaleString('pt-BR'), lista: 'despachados',
                sub: `${comFrete.length} com frete` + (semEnvioNoPeriodo ? ` · fora estes, ${semEnvioNoPeriodo} retirada(s)/instalação(ões) na Ranor` : ''),
                explica: 'Pedidos que saíram pela transportadora no período.' })}
            ${tile({ rotulo: 'Frete médio por envio', valor: comFrete.length ? brl(gasto / comFrete.length) : '—',
                sub: comFrete.length ? `em ${comFrete.length} envio(s) com frete` : 'nenhum frete preenchido',
                explica: 'Gasto dividido pelos envios com frete.' })}
            ${tile({ rotulo: 'Do pedido ao despacho', valor: fmtDias(media(prazosDespacho)), lista: 'prazo_despacho',
                sub: (prazosDespacho.length ? `mediana ${fmtDias(mediana(prazosDespacho))} · ${prazosDespacho.length} pedido(s)` : 'nenhum despacho com data que vale') + fora(foraDespacho),
                explica: `Média de dias entre criar o pedido e despachar (${regra}).` })}
            ${tile({ rotulo: 'Do despacho à entrega', valor: fmtDias(media(prazosEntrega)), lista: 'prazo_entrega',
                sub: (prazosEntrega.length ? `mediana ${fmtDias(mediana(prazosEntrega))} · ${prazosEntrega.length} entrega(s)` : 'nenhuma entrega com data que vale') + fora(foraEntrega),
                explica: `Média de dias em trânsito, da data de despacho à de entrega (${regra}).` })}
        </div>

        <div class="painel-grade-cards">
            ${pendencias(itensPend)}

            <div class="painel-card largo">
                <div class="painel-card-titulo">Gasto com frete por mês</div>
                <div class="painel-card-sub">Últimos 12 meses, pela data de despacho${transp ? ` · ${escapeHtml(transp)}` : ''}</div>
                ${graficoColunas(meses)}
                ${tabela(['Mês', 'Gasto', 'Envios'], meses.map(m => [m.rotuloLongo, brl(m.valor), m.envios]))}
            </div>

            <div class="painel-card">
                <div class="painel-card-titulo">Gasto por transportadora</div>
                <div class="painel-card-sub">${nomePeriodo} · clique numa barra para ver os envios</div>
                ${graficoBarras(barrasTransp, 'Nenhum envio despachado no período.')}
            </div>

            <div class="painel-card">
                <div class="painel-card-titulo">Tempo médio em cada etapa</div>
                <div class="painel-card-sub">Pedidos iniciados no período · mostra onde o processo demora (${regra})</div>
                ${dados.semColunas
                    ? '<div class="painel-vazio">Disponível depois de rodar o sql/painel.sql.</div>'
                    : graficoBarras(barrasEtapas, 'Ainda não há pedidos com as etapas registradas neste período.')}
                ${barrasEtapas.length ? tabela(['Etapa', 'Média', 'Mediana', 'Pedidos'], etapas.filter(e => e.n).map(e => [e.rotulo, fmtDias(e.valor), fmtDias(e.med), e.n])) : ''}
            </div>

            <div class="painel-card largo">
                <div class="painel-card-titulo">Mais demorados até o despacho</div>
                <div class="painel-card-sub">${nomePeriodo} · ${regra}</div>
                ${lista(demorados, 'Nenhum despacho com data que vale no período.')}
            </div>
        </div>`;
}

// --- Lista de pedidos de um número (modal) ---
function abrirLista(chave) {
    const l = listas[chave];
    if (!l) return;
    const selo = ok => ok ? '' : ' <span class="data-selo pendente" title="Data não confirmada">?</span>';
    const linhas = l.pedidos.map(r => `<tr data-id="${escapeHtml(r.id)}" title="Ver o envio">
        <td><strong>${escapeHtml(r.destinatario || 'Sem destinatário')}</strong>
            ${r.unidade && r.unidade !== r.destinatario ? `<div class="painel-lista-sub">${escapeHtml(r.unidade)}</div>` : ''}</td>
        <td>${escapeHtml(r.referencia) || '—'}</td>
        <td>${escapeHtml(r.tipo) || ''}</td>
        <td>${escapeHtml(r.transportadora) || '—'}${r.rastreio ? `<div class="painel-lista-sub mono">${escapeHtml(r.rastreio)}</div>` : ''}</td>
        <td class="num">${r.despachado_em ? fmtData(r.despachado_em) + selo(r.despacho_confirmado) : '—'}</td>
        <td class="num">${r.fase === 'entregue' ? fmtData(r.entregue_em || r.fase_em) + selo(r.entrega_confirmada) : '—'}</td>
        <td class="num">${r.frete != null ? 'R$ ' + formatarFrete(r.frete) : '—'}</td>
        ${l.extra ? `<td class="num"><b>${l.extra(r)}</b></td>` : ''}
    </tr>`).join('');
    const modal = abrirModal(`
        <div class="modal-header">
            <div><strong>${escapeHtml(l.titulo)}</strong>
                <div class="small" style="margin-top:2px;">${l.pedidos.length} pedido(s) · ${escapeHtml(l.explica)}</div></div>
            <button class="modal-close" data-fechar title="Fechar (Esc)">&times;</button>
        </div>
        ${l.pedidos.length ? `<div class="table-wrap"><table class="data-table painel-modal-lista"><thead><tr>
            <th>Destinatário</th><th>OS/Ticket</th><th>Tipo</th><th>Transportadora</th><th>Despacho</th><th>Entrega</th><th>Frete</th>${l.extra ? '<th></th>' : ''}
        </tr></thead><tbody>${linhas}</tbody></table></div>` : '<div class="empty-state">Nenhum pedido.</div>'}
        <div class="modal-actions"><button class="btn-neutral" data-fechar>Fechar</button></div>`, 'visao-card');
    modal.card.addEventListener('click', e => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) abrirVisualizacaoEnvio(tr.dataset.id);
    });
}

// --- Tooltip (um só, segue o mouse) ---
function ligarTooltip() {
    const corpo = $('painel_corpo');
    if (!corpo || corpo.dataset.tooltip) return;
    corpo.dataset.tooltip = '1';
    const tip = document.createElement('div');
    tip.className = 'painel-tooltip';
    document.body.appendChild(tip);
    corpo.addEventListener('mousemove', e => {
        const alvo = e.target.closest('[data-tip]');
        if (!alvo) { tip.style.display = 'none'; return; }
        tip.textContent = alvo.dataset.tip;
        tip.style.display = 'block';
        const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
        tip.style.left = x + 'px';
        tip.style.top = (e.clientY + 16) + 'px';
    });
    corpo.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

// --- Ações ---
window.mudarPeriodoPainel = function () {
    $('painel_datas').style.display = $('painel_periodo').value === 'custom' ? 'flex' : 'none';
    carregarPainel();
};
window.mudarVisaoPainel = function (v) {
    visao = v;
    carregarPainel();
};
window.carregarPainel = carregarPainel;
window.renderPainel = () => dados && visao === 'envios' && renderPainel();
window.abrirListaPainel = abrirLista;
// Pendências de entrega abrem a tela em lote; depois de salvar, o painel recarrega
window.abrirEntregasDoPainel = qual => abrirEntregasLote({
    aba: qual, antigos: qual === 'transito', aoSalvar: () => carregarPainel(true)
});
window.abrirPedidoDoPainel = id => abrirVisualizacaoEnvio(id);

export const painelVisivel = () => $('tab-painel')?.style.display === 'block';
export function iniciarPainel() {
    ligarTooltip();
    carregarPainel();
}
