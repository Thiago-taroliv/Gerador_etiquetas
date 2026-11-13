// Painel: gasto com frete e prazos dos envios, a partir do histórico de pedidos.
// As contas são feitas aqui no navegador (o volume é pequeno); as datas de cada fase vêm do sql/painel.sql.
import { $, escapeHtml } from './config.js';
import { carregarDadosPainel, carregarPedido } from './db.js';
import { toast } from './toast.js';

let dados = null;          // { pedidos, semColunas }
let carregadoDesde = null; // data mais antiga já carregada
let carregando = null;

const DIA = 864e5;
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
const entregaDe = r => t(r.entregue_em) || naFase(r, 'entregue');
// Retirada / instalação na Ranor: sem frete nem trânsito, fica fora das contas (só é contada à parte)
const SEM_ENVIO = ['retirada', 'instalacao'];
const comEnvio = r => !SEM_ENVIO.includes(r.entrega);
const entre = (x, p) => x != null && x >= p.de.getTime() && x < p.ate.getTime();
const intervalo = (a, b) => a != null && b != null && b >= a ? (b - a) / DIA : null;

// A NF anda em paralelo à configuração: as datas dela ficam no status (email_em, nf_emitida_em)
const nfPedidaEm = r => t(r.status?.email_em);
const nfEmitidaEm = r => t(r.status?.nf_emitida_em);
const ETAPAS = [
    { rotulo: 'Até pedir a NF', de: inicioDe, ate: nfPedidaEm },
    { rotulo: 'Esperando a NF', de: nfPedidaEm, ate: nfEmitidaEm },
    { rotulo: 'Esperando configuração', de: r => naFase(r, 'a_configurar'), ate: r => naFase(r, 'configurando') },
    { rotulo: 'Em configuração', de: r => naFase(r, 'configurando'), ate: r => naFase(r, 'pronto') },
    { rotulo: 'Pronto até despachar', de: r => naFase(r, 'pronto'), ate: despachoDe },
    { rotulo: 'Em trânsito (até entregar)', de: despachoDe, ate: entregaDe }
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
    const corpo = $('painel_corpo');
    if (!dados) corpo.innerHTML = '<div class="empty-state">Carregando o painel...</div>';
    const p = periodo();
    if (!(await garantirDados(p))) {
        corpo.innerHTML = '<div class="empty-state">Erro ao carregar o painel. Tente atualizar.</div>';
        return;
    }
    renderPainel();
}

// --- Componentes ---
function tile(rotulo, valor, sub = '', hero = false) {
    return `<div class="painel-tile${hero ? ' hero' : ''}">
        <div class="painel-tile-rotulo">${rotulo}</div>
        <div class="painel-tile-valor">${valor}</div>
        ${sub ? `<div class="painel-tile-sub">${sub}</div>` : ''}
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
        <div class="painel-barra-linha" data-tip="${escapeHtml(b.tip)}">
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
        <tr onclick="abrirPedidoDoPainel('${r.id}')" title="Abrir o pedido">
            <td><strong>${escapeHtml(r.destinatario || 'Sem destinatário')}</strong>
                <div class="painel-lista-sub">${escapeHtml([r.referencia, r.transportadora].filter(Boolean).join(' · '))}</div></td>
            <td class="painel-lista-extra">${extra}</td>
        </tr>`).join('')}</tbody></table>`;
}

// --- Render ---
function renderPainel() {
    const p = periodo();
    const transpSel = $('painel_transportadora');
    const transportadoras = [...new Set(dados.pedidos.filter(comEnvio).map(r => (r.transportadora || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const atual = transpSel.value;
    transpSel.innerHTML = '<option value="">Todas as transportadoras</option>' +
        transportadoras.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    transpSel.value = transportadoras.includes(atual) ? atual : '';
    const transp = transpSel.value;

    const pedidos = dados.pedidos.filter(r => comEnvio(r) && (!transp || (r.transportadora || '').trim() === transp));
    const semEnvioNoPeriodo = transp ? 0 : dados.pedidos.filter(r => !comEnvio(r) && entre(despachoDe(r), p)).length;
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

    const prazosDespacho = despachados.map(r => intervalo(inicioDe(r), despachoDe(r))).filter(x => x != null);
    const entregues = pedidos.filter(r => entre(entregaDe(r), p));
    const prazosEntrega = entregues.map(r => intervalo(despachoDe(r), entregaDe(r))).filter(x => x != null);

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
        const x = porTransp.get(k) || { valor: 0, envios: 0, comFrete: 0 };
        x.envios++;
        if (r.frete != null) { x.valor += Number(r.frete); x.comFrete++; }
        porTransp.set(k, x);
    });
    const barrasTransp = [...porTransp.entries()].sort((a, b) => b[1].valor - a[1].valor).map(([k, x]) => ({
        rotulo: k, valor: x.valor,
        texto: `${brl(x.valor)} · ${x.envios} envio(s)`,
        tip: `${k}: ${brl(x.valor)} em ${x.envios} envio(s)` + (x.comFrete ? ` · média ${brl(x.valor / x.comFrete)}` : '') + (x.envios > x.comFrete ? ` · ${x.envios - x.comFrete} sem frete` : '')
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

    // Listas
    const demorados = despachados
        .map(r => ({ r, d: intervalo(inicioDe(r), despachoDe(r)) }))
        .filter(x => x.d != null).sort((a, b) => b.d - a.d).slice(0, 8)
        .map(({ r, d }) => ({ r, extra: `${fmtDias(d)}<div class="painel-lista-sub">despachado ${fmtData(r.despachado_em)}</div>` }));
    const listaSemFrete = semFrete.sort((a, b) => despachoDe(b) - despachoDe(a))
        .map(r => ({ r, extra: `despachado<div class="painel-lista-sub">${fmtData(r.despachado_em)}</div>` }));

    const nomePeriodo = `${fmtData(p.de)} a ${fmtData(new Date(p.ate - 1))}`;
    $('painel_aviso').innerHTML = dados.semColunas
        ? '<div class="painel-alerta">⚠ Para medir as etapas e a entrega, rode o <code>sql/painel.sql</code> no SQL Editor do Supabase. Os prazos começam a ser registrados a partir daí.</div>'
        : '';

    $('painel_corpo').innerHTML = `
        <div class="painel-tiles">
            ${tile('Gasto com frete', brl(gasto),
                (anteriorCarregado ? deltaHtml(gasto, gastoAnterior) : '') +
                `<div>${nomePeriodo}${semFrete.length ? ` · <a href="#painel_sem_frete">${semFrete.length} sem frete preenchido</a>` : ''}</div>`, true)}
            ${tile('Envios despachados', despachados.length.toLocaleString('pt-BR'), `${comFrete.length} com frete`
                + (semEnvioNoPeriodo ? ` · fora estes, ${semEnvioNoPeriodo} retirada(s)/instalação(ões) na Ranor` : ''))}
            ${tile('Frete médio por envio', comFrete.length ? brl(gasto / comFrete.length) : '—', comFrete.length ? `em ${comFrete.length} envio(s) com frete` : 'nenhum frete preenchido')}
            ${tile('Do pedido ao despacho', fmtDias(media(prazosDespacho)), prazosDespacho.length ? `mediana ${fmtDias(mediana(prazosDespacho))}` : 'nenhum despacho no período')}
            ${tile('Do despacho à entrega', fmtDias(media(prazosEntrega)), prazosEntrega.length ? `${prazosEntrega.length} entrega(s) com data` : 'sem entregas com data no período')}
        </div>

        <div class="painel-grade-cards">
            <div class="painel-card largo">
                <div class="painel-card-titulo">Gasto com frete por mês</div>
                <div class="painel-card-sub">Últimos 12 meses, pela data de despacho${transp ? ` · ${escapeHtml(transp)}` : ''}</div>
                ${graficoColunas(meses)}
                ${tabela(['Mês', 'Gasto', 'Envios'], meses.map(m => [m.rotuloLongo, brl(m.valor), m.envios]))}
            </div>

            <div class="painel-card">
                <div class="painel-card-titulo">Gasto por transportadora</div>
                <div class="painel-card-sub">${nomePeriodo}</div>
                ${graficoBarras(barrasTransp, 'Nenhum envio despachado no período.')}
            </div>

            <div class="painel-card">
                <div class="painel-card-titulo">Tempo médio em cada etapa</div>
                <div class="painel-card-sub">Pedidos iniciados no período · onde o processo demora</div>
                ${dados.semColunas
                    ? '<div class="painel-vazio">Disponível depois de rodar o sql/painel.sql.</div>'
                    : graficoBarras(barrasEtapas, 'Ainda não há pedidos com as etapas registradas neste período.')}
                ${barrasEtapas.length ? tabela(['Etapa', 'Média', 'Mediana', 'Pedidos'], etapas.filter(e => e.n).map(e => [e.rotulo, fmtDias(e.valor), fmtDias(e.med), e.n])) : ''}
            </div>

            <div class="painel-card" id="painel_sem_frete">
                <div class="painel-card-titulo">Despachados sem frete preenchido</div>
                <div class="painel-card-sub">Ficam fora do gasto. Clique para abrir e preencher.</div>
                ${lista(listaSemFrete, 'Todos os envios do período têm frete.')}
            </div>

            <div class="painel-card">
                <div class="painel-card-titulo">Mais demorados até o despacho</div>
                <div class="painel-card-sub">${nomePeriodo}</div>
                ${lista(demorados, 'Nenhum despacho no período.')}
            </div>
        </div>`;
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
window.carregarPainel = carregarPainel;
window.renderPainel = () => dados && renderPainel();

window.abrirPedidoDoPainel = async function (id) {
    const reg = await carregarPedido(id);
    if (!reg) { toast('Não foi possível abrir o pedido.', 'error'); return; }
    window.__painelCache = [reg];
    window.abrirDetalheHistorico(id);
};

export const painelVisivel = () => $('tab-painel')?.style.display === 'block';
export function iniciarPainel() {
    ligarTooltip();
    carregarPainel();
}
