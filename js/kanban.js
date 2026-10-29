// Kanban de pedidos: uma coluna por fase, cards arrastáveis entre elas
import { $, escapeHtml } from './config.js';
import { FASES, ordemFase, rotuloFase, carregarKanban, carregarPendentes, moverFase } from './db.js';
import { FASES_SEM_NF, mesmoTecnico, pessoaDoRegistro, inicioJanelaJuncao } from './juncao.js';
import { toast } from './toast.js';

// Dias parado na fase a partir dos quais o card fica amarelo / vermelho
const LIMITES_ATRASO = { aguardando_nf: [2, 5], nf_emitida: [2, 5], pronto: [1, 3] };

let pedidos = [];          // registros do histórico
let rascunhos = [];        // rascunhos que ainda não têm registro no histórico
let rascunhoDoPedido = {}; // historico_id -> id do rascunho aberto para ele
let destacado = null;      // card cujo grupo "mesmo técnico" está destacado

export const kanbanVisivel = () => $('tab-pedidos')?.style.display === 'block';

export async function carregarViewKanban() {
    const board = $('kanban_board');
    if (!pedidos.length && !rascunhos.length) board.innerHTML = '<div class="empty-state">Carregando pedidos...</div>';

    const [regs, pendentes] = await Promise.all([carregarKanban(), carregarPendentes()]);
    if (regs === null) {
        board.innerHTML = '<div class="empty-state">Erro ao carregar os pedidos. Tente atualizar.</div>';
        return;
    }
    pedidos = regs;
    window.__rascunhosCache = pendentes; // usado por editarRascunho
    rascunhos = pendentes.filter(r => !r.dados_completos?.historico_id);
    rascunhoDoPedido = {};
    pendentes.forEach(r => { if (r.dados_completos?.historico_id) rascunhoDoPedido[r.dados_completos.historico_id] = r.id; });
    renderKanban();
}

// Registro do histórico por id, venha do kanban ou da lista do Histórico
export function acharPedido(id) {
    return pedidos.find(r => String(r.id) === String(id))
        || (window.__historicoCache || []).find(r => String(r.id) === String(id));
}

// Aplica os campos em todas as cópias do registro (kanban e lista do Histórico)
export function atualizarCaches(id, campos) {
    [...pedidos, ...(window.__historicoCache || [])]
        .filter(r => String(r.id) === String(id))
        .forEach(r => Object.assign(r, campos));
}

const diasDesde = data => Math.max(0, Math.floor((Date.now() - new Date(data)) / 864e5));
const textoDias = n => n === 0 ? 'hoje' : `há ${n} dia${n > 1 ? 's' : ''}`;

function nivelAtraso(fase, dias) {
    const [amarelo, vermelho] = LIMITES_ATRASO[fase] || [];
    if (vermelho !== undefined && dias >= vermelho) return 2;
    if (amarelo !== undefined && dias >= amarelo) return 1;
    return 0;
}

// Pedidos sem NF na janela da junção, para o selo "mesmo técnico"
function candidatosJuncao() {
    const desde = new Date(inicioJanelaJuncao());
    const recente = (...datas) => datas.some(d => d && new Date(d) >= desde);
    return [
        ...pedidos.filter(r => FASES_SEM_NF.includes(r.fase) && !r.mesclado_em && recente(r.created_at, r.fase_em))
            .map(r => ({ chave: 'h:' + r.id, pessoa: pessoaDoRegistro(r) })),
        ...rascunhos.filter(r => recente(r.created_at))
            .map(r => ({ chave: 'r:' + r.id, pessoa: pessoaDoRegistro(r) }))
    ];
}

// chave do card -> chaves dos outros cards do mesmo técnico
function gruposMesmoTecnico() {
    const cands = candidatosJuncao();
    const grupos = {};
    cands.forEach(a => {
        const outros = cands.filter(b => b !== a && mesmoTecnico(a.pessoa, b.pessoa)).map(b => b.chave);
        if (outros.length) grupos[a.chave] = outros;
    });
    return grupos;
}

function cardHtml(reg, chave, grupos, { rascunho = false } = {}) {
    const itens = rascunho ? (reg.dados_completos?.items || []) : (reg.itens || []);
    const qtd = itens.reduce((s, it) => s + (parseInt(it.qty) || 1), 0);
    const transportadora = rascunho ? reg.dados_completos?.carrier : reg.transportadora;
    const st = reg.status || {};
    const fase = rascunho ? 'rascunho' : reg.fase;
    const dias = diasDesde(rascunho ? reg.created_at : reg.fase_em);
    const atraso = rascunho ? 0 : nivelAtraso(fase, dias);
    const selo = (feito, label) => `<span class="status-badge${feito ? ' done' : ''}">${label}</span>`;

    const outros = grupos[chave];
    const classes = ['kanban-card'];
    if (rascunho) classes.push('kanban-card-rascunho');
    if (atraso) classes.push('atraso-' + atraso);
    if (destacado && (destacado === chave || (grupos[destacado] || []).includes(chave))) classes.push('destaque');

    const idDraft = rascunho ? reg.id : rascunhoDoPedido[reg.id];
    const acao = rascunho ? `editarRascunho('${reg.id}')` : `abrirDetalheHistorico('${reg.id}')`;
    const arrastar = rascunho ? '' : `draggable="true" ondragstart="kanbanDragStart(event, '${reg.id}')" ondragend="kanbanDragEnd(event)"`;

    return `
        <div class="${classes.join(' ')}" ${arrastar} onclick="${acao}">
            <div class="kanban-card-titulo">${escapeHtml(reg.destinatario || 'Sem destinatário')}</div>
            ${reg.unidade && reg.unidade !== reg.destinatario ? `<div class="kanban-card-sub">${escapeHtml(reg.unidade)}</div>` : ''}
            ${reg.referencia ? `<div class="kanban-card-ref">${escapeHtml(reg.referencia)}</div>` : ''}
            <div class="kanban-card-meta">
                ${[transportadora, qtd ? `${qtd} item(ns)` : ''].filter(Boolean).map(escapeHtml).join(' &middot; ')}
            </div>
            ${reg.rastreio ? `<div class="kanban-card-meta">Rastreio: <strong>${escapeHtml(reg.rastreio)}</strong></div>` : ''}
            <div class="kanban-card-tags">
                ${outros ? `<span class="kanban-tag juncao" title="Clique para destacar" onclick="event.stopPropagation(); destacarMesmoTecnico('${chave}')">🔗 +${outros.length} p/ este técnico</span>` : ''}
                ${!rascunho && idDraft ? `<span class="kanban-tag rasc" title="Abrir rascunho no formulário" onclick="event.stopPropagation(); editarRascunho('${idDraft}')">rascunho aberto</span>` : ''}
            </div>
            <div class="kanban-card-rodape">
                ${rascunho ? '<span class="status-badge">não gerado</span>'
                    : `<div class="status-badges">${selo(st.email, 'E')}${selo(st.romaneio, 'R')}${selo(st.etiqueta, 'Et')}</div>`}
                <span class="kanban-dias">${textoDias(dias)}</span>
            </div>
        </div>`;
}

export function renderKanban() {
    const board = $('kanban_board');
    if (!board) return;
    const termo = ($('kanban_search')?.value || '').trim().toLowerCase();
    const bate = r => !termo || [r.destinatario, r.unidade, r.referencia, r.rastreio].join(' ').toLowerCase().includes(termo);
    const grupos = gruposMesmoTecnico();

    board.innerHTML = FASES.map(({ chave: fase, rotulo }) => {
        const doHistorico = pedidos.filter(r => r.fase === fase && bate(r));
        const dosRascunhos = fase === 'rascunho' ? rascunhos.filter(bate) : [];
        const cards = [
            ...dosRascunhos.map(r => cardHtml(r, 'r:' + r.id, grupos, { rascunho: true })),
            ...doHistorico.map(r => cardHtml(r, 'h:' + r.id, grupos))
        ];
        return `
            <div class="kanban-col" data-fase="${fase}"
                 ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event, '${fase}')">
                <div class="kanban-col-header">
                    <span>${rotulo}</span>
                    <span class="kanban-count">${cards.length}</span>
                </div>
                <div class="kanban-col-body">
                    ${cards.join('') || '<div class="kanban-vazio">Nenhum pedido</div>'}
                    ${fase === 'entregue' ? '<div class="kanban-nota">Últimos 30 dias</div>' : ''}
                </div>
            </div>`;
    }).join('');
}

window.destacarMesmoTecnico = function (chave) {
    destacado = destacado === chave ? null : chave;
    renderKanban();
};

// Move o pedido de fase com atualização otimista; volta ao estado anterior se o banco falhar
// extrasIniciais: outros campos a gravar junto, ex. { mesclado_em: null }
export async function moverPedidoPara(id, fase, extrasIniciais = {}) {
    const reg = acharPedido(id);
    if (!reg || reg.fase === fase) return false;

    if (fase !== 'cancelado' && ordemFase(fase) < ordemFase(reg.fase) &&
        !confirm(`Voltar "${reg.destinatario}" para "${rotuloFase(fase)}"?`)) return false;

    const extras = { ...extrasIniciais };
    if (fase === 'despachado') {
        const codigo = prompt('Código de rastreio (opcional):', reg.rastreio || '');
        if (codigo === null) return false;
        extras.rastreio = codigo.trim() || null;
    }

    const antes = { fase: reg.fase, fase_em: reg.fase_em };
    Object.keys(extras).forEach(campo => { antes[campo] = reg[campo]; });
    atualizarCaches(id, { fase, fase_em: new Date().toISOString(), ...extras });
    if (kanbanVisivel()) renderKanban();

    const ok = await moverFase(id, fase, extras);
    if (!ok) {
        atualizarCaches(id, antes);
        if (kanbanVisivel()) renderKanban();
        toast('Não foi possível mudar a fase. Verifique a conexão.', 'error', 5000);
    }
    return ok;
}

// Impresso antes da NF: o pedido já avançou para "Pronto"; avisa e permite voltar
export function avisarProntoSemNF(id, { fase, faseAnterior, faseEmAnterior }) {
    if (fase !== 'pronto' || faseAnterior === fase || ordemFase(faseAnterior) >= ordemFase('nf_emitida')) return;
    toast('Movido para "Pronto p/ envio" sem NF emitida.', 'warning', 10000, {
        label: 'Desfazer',
        onClick: async () => {
            const extras = faseEmAnterior ? { fase_em: faseEmAnterior } : {};
            const ok = await moverFase(id, faseAnterior, extras);
            if (ok) {
                atualizarCaches(id, { fase: faseAnterior, fase_em: faseEmAnterior || new Date().toISOString() });
                if (kanbanVisivel()) renderKanban();
            }
            toast(ok ? 'Fase restaurada.' : 'Não foi possível desfazer.', ok ? 'success' : 'error');
        }
    });
}

// --- Arrastar e soltar (HTML5) ---
window.kanbanDragStart = function (ev, id) {
    ev.dataTransfer.setData('text/plain', id);
    ev.dataTransfer.effectAllowed = 'move';
    ev.currentTarget.classList.add('arrastando');
};
window.kanbanDragEnd = ev => ev.currentTarget.classList.remove('arrastando');
window.kanbanDragOver = function (ev) {
    ev.preventDefault();
    ev.currentTarget.classList.add('drag-over');
};
window.kanbanDragLeave = function (ev) {
    if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drag-over');
};
window.kanbanDrop = function (ev, fase) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    const id = ev.dataTransfer.getData('text/plain');
    if (id) moverPedidoPara(id, fase);
};

window.carregarViewKanban = carregarViewKanban;
window.renderKanban = renderKanban;
