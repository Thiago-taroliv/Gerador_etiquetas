// Aba Histórico: todos os pedidos (inclusive entregues e cancelados), com busca e filtros feitos no banco.
// Clicar abre o resumo do envio (só leitura); "Ver como planilha" mostra tudo no modelo da planilha de envio.
import { $, escapeHtml } from './config.js';
import { carregarHistorico, carregarHistoricoCompleto, HISTORICO_POR_PAGINA, rotuloFase, estadoNF, ROTULOS_NF, FASES } from './db.js';
import { TIPOS, formatarFrete } from './planilha.js';
import { semEnvio, entregaDe, rotuloEntrega, iconeEntrega } from './entrega.js';
import { abrirVisualizacaoEnvio, abrirPlanilhaLeitura } from './envioView.js';
import { toast } from './toast.js';

let pagina = 0;
let temMais = false;
let consulta = 0; // descarta respostas de buscas antigas (digitação rápida)
let espera = null;

function filtros() {
    const periodo = $('historico_periodo')?.value || '';
    const hoje = new Date();
    const desde = {
        mes: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
        '30': new Date(Date.now() - 30 * 864e5),
        '90': new Date(Date.now() - 90 * 864e5),
        ano: new Date(hoje.getFullYear(), 0, 1)
    }[periodo];
    return {
        termo: ($('historico_search')?.value || '').trim(),
        fase: $('historico_fase')?.value || '',
        tipo: $('historico_tipo')?.value || '',
        desde: desde ? desde.toISOString() : ''
    };
}
const filtrando = f => !!(f.termo || f.fase || f.tipo || f.desde);

// Opções dos filtros (uma vez)
function prepararFiltros() {
    const fase = $('historico_fase');
    if (fase && !fase.options.length) {
        fase.innerHTML = '<option value="">Todas as fases</option><option value="em_andamento">Em andamento (antes da saída)</option>' +
            FASES.map(f => `<option value="${f.chave}">${f.rotulo}</option>`).join('') + '<option value="cancelado">Cancelado</option>';
    }
    const tipo = $('historico_tipo');
    if (tipo && !tipo.options.length) {
        tipo.innerHTML = '<option value="">Todos os tipos</option>' + TIPOS.map(t => `<option value="${t}">${t}</option>`).join('');
    }
}

export async function carregarHistoricoView() {
    prepararFiltros();
    const container = $('historico_list');
    const minha = ++consulta;
    container.innerHTML = '<div class="empty-state">Carregando...</div>';
    const lista = await carregarHistorico(0, filtros());
    if (minha !== consulta) return;
    if (!lista) { container.innerHTML = '<div class="empty-state">Erro ao carregar o histórico. Tente atualizar.</div>'; return; }
    window.__historicoCache = lista; // usado ao abrir o pedido e para atualizar as listas
    pagina = 0;
    temMais = lista.length === HISTORICO_POR_PAGINA;
    renderLista();
}

async function carregarMais(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando...'; }
    const minha = consulta;
    const lista = await carregarHistorico(pagina + 1, filtros());
    if (minha !== consulta) return;
    if (!lista) { toast('Erro ao carregar mais envios.', 'error'); renderLista(); return; }
    window.__historicoCache = (window.__historicoCache || []).concat(lista);
    pagina++;
    temMais = lista.length === HISTORICO_POR_PAGINA;
    renderLista();
}

// --- Células ---
const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
const seloData = ok => ok ? '' : ' <span class="data-selo pendente" title="Data não confirmada: só o momento em que o card foi movido">?</span>';

function celulaSaida(reg) {
    const dados = reg.dados_completos;
    if (semEnvio(dados)) return `${iconeEntrega(entregaDe(dados))} ${escapeHtml(rotuloEntrega(entregaDe(dados)))}`;
    return `${escapeHtml(reg.transportadora) || '—'}${reg.rastreio ? `<br><small class="mono">${escapeHtml(reg.rastreio)}</small>` : ''}`;
}

function celulaDespacho(reg) {
    if (!reg.despachado_em) return '<span class="visao-vazio">—</span>';
    const frete = reg.frete != null ? `<br><small>R$ ${formatarFrete(reg.frete)}</small>` : '';
    return `${dataCurta(reg.despachado_em)}${seloData(reg.despacho_confirmado)}${semEnvio(reg.dados_completos) ? '' : frete}`;
}

function celulaEntrega(reg) {
    if (reg.fase !== 'entregue') {
        if (reg.fase === 'despachado' && reg.despachado_em) {
            const d = Math.floor((Date.now() - new Date(reg.despachado_em)) / 864e5);
            return `<small class="${d >= 7 ? 'texto-alerta' : ''}">em trânsito há ${d} dia${d === 1 ? '' : 's'}</small>`;
        }
        return '<span class="visao-vazio">—</span>';
    }
    return `${dataCurta(reg.entregue_em || reg.fase_em)}${seloData(reg.entrega_confirmada)}`;
}

function renderLista() {
    const container = $('historico_list');
    const historico = window.__historicoCache || [];
    const f = filtros();

    if (!historico.length) {
        container.innerHTML = `<div class="empty-state">${filtrando(f) ? 'Nenhum envio corresponde aos filtros.' : 'Nenhum envio encontrado no histórico.'}</div>`;
        return;
    }

    const linhas = historico.map(reg => {
        const dados = reg.dados_completos || {};
        const nf = estadoNF(reg.status);
        const sem = semEnvio(dados);
        return `<tr class="clickable" onclick="verEnvioDoHistorico('${reg.id}')">
            <td class="col-date">${dataCurta(dados.rascunho_em || reg.created_at)}</td>
            <td class="col-ref">${escapeHtml(reg.referencia) || '—'}</td>
            <td><strong>${escapeHtml(reg.destinatario)}</strong>
                ${reg.unidade && reg.unidade !== reg.destinatario ? `<br><small>${escapeHtml(reg.unidade)}</small>` : ''}</td>
            <td>${dados.planilha_tipo ? `<span class="visao-tipo">${escapeHtml(dados.planilha_tipo)}</span>` : ''}</td>
            <td>${celulaSaida(reg)}</td>
            <td class="col-date">${celulaDespacho(reg)}</td>
            <td class="col-date">${celulaEntrega(reg)}</td>
            <td><div class="status-badges">
                <span class="fase-badge fase-${escapeHtml(reg.fase)}">${escapeHtml(rotuloFase(reg.fase))}</span>
                ${sem || reg.fase === 'cancelado' ? '' : `<span class="status-badge${nf === 'emitida' ? ' done' : ''}" title="${ROTULOS_NF[nf]}">NF</span>`}
            </div></td>
        </tr>`;
    }).join('');

    container.innerHTML = `<table class="data-table historico-tabela"><thead><tr>
            <th>Pedido</th><th>OS/Ticket</th><th>Destinatário / Unidade</th><th>Tipo</th><th>Saída / Rastreio</th>
            <th>Despacho</th><th>Entrega</th><th>Situação</th>
        </tr></thead><tbody>${linhas}</tbody></table>
        <div class="empty-state" style="padding:14px;">
            ${historico.length} envio(s)${filtrando(f) ? ' com estes filtros' : ''}
            ${temMais ? ' &middot; <button class="btn-sm btn-neutral" onclick="carregarMaisHistorico(this)">Carregar mais antigos</button>' : ''}
            <div class="small" style="margin-top:6px;"><span class="data-selo pendente">?</span> data não confirmada (fica fora dos prazos do painel)</div>
        </div>`;
}

// Todos os envios dos filtros, no modelo da planilha de envio (sem os cancelados, a não ser que o filtro peça)
async function verComoPlanilha(btn) {
    const f = filtros();
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando...'; }
    const r = await carregarHistoricoCompleto(f);
    if (btn) { btn.disabled = false; btn.textContent = '▦ Ver como planilha'; }
    if (!r) { toast('Erro ao carregar os envios.', 'error'); return; }
    const pedidos = r.pedidos.filter(p => f.fase === 'cancelado' || p.fase !== 'cancelado').reverse(); // mais antigo primeiro, como na planilha
    const partes = [filtrando(f) ? 'filtros da lista aplicados' : 'todos os envios', r.cortado ? `só os ${r.pedidos.length} mais recentes` : ''];
    abrirPlanilhaLeitura(pedidos, 'Envios no modelo da planilha', partes.filter(Boolean).join(' · '));
}

window.loadHistoricoView = carregarHistoricoView;
window.carregarMaisHistorico = carregarMais;
window.verEnvioDoHistorico = id => abrirVisualizacaoEnvio(id);
window.verHistoricoComoPlanilha = verComoPlanilha;
// Busca no banco: espera a pessoa parar de digitar
window.filtrarHistorico = function (imediato = false) {
    clearTimeout(espera);
    espera = setTimeout(carregarHistoricoView, imediato ? 0 : 350);
};
