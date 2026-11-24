// Kanban de pedidos: uma coluna por etapa da configuração, cards arrastáveis entre elas; a NF é um selo no card
import { $, escapeHtml, supabaseClient, AppState } from './config.js';
import { FASES, FASES_ANTES_DA_SAIDA, ordemFase, rotuloFase, carregarKanban, carregarPendentes, moverFase, registrarNoHistorico, deletarPendente, estadoNF, ROTULOS_NF, atualizarStatusHistorico } from './db.js';
import { formatarFrete, lerValor } from './planilha.js';
import { oferecerPixFrete } from './pixFrete.js';
import { confirmar, pedirCampos } from './dialogo.js';
import { pedidoSemNF, mesmoTecnico, pessoaDoRegistro, inicioJanelaJuncao, pedidoDoHistorico, pedidoDoRascunho, juntarPedidos, precisaNovoEmail, escolherParaJuntar } from './juncao.js';
import { toast } from './toast.js';
import { pendenciasEnvio } from './importarEstoque.js';
import { prazosAtraso } from './configuracoes.js';
import { formularioAlterado } from './ui.js';
import { semEnvio, entregaDe, rotuloEntrega, iconeEntrega } from './entrega.js';
import { hojeInput, paraInput, deInput, problemaData, dataBR } from './datas.js';

// Dias parado na fase a partir dos quais o card fica amarelo / vermelho (Cadastros > Configurações)
const limitesAtraso = prazosAtraso;

let pedidos = [];          // registros do histórico
let rascunhos = [];        // rascunhos que ainda não têm registro no histórico
let rascunhoPorPedido = {}; // historico_id -> id do rascunho aberto para ele
let destacado = null;      // card cujo grupo "mesmo técnico" está destacado
let filtroResumo = null;   // 'atrasados' | 'juncao' | null — escolhido no resumo do topo
let arrastando = false;    // não redesenha o quadro no meio de um arraste

export const kanbanVisivel = () => $('tab-pedidos')?.style.display === 'block';

// --- Tempo real: recarrega quando um pedido muda em outra aba ou aparelho ---
let canalTempoReal = null;
let recargaAgendada = null;

function agendarRecarga() {
    clearTimeout(recargaAgendada);
    // Agrupa rajadas de eventos (ex. junção cancelando vários pedidos) numa recarga só
    recargaAgendada = setTimeout(() => {
        if (!kanbanVisivel()) return; // ao abrir a aba ele recarrega de qualquer forma
        if (arrastando) { agendarRecarga(); return; }
        carregarViewKanban();
    }, 800);
}

function ligarTempoReal() {
    if (canalTempoReal) return;
    canalTempoReal = supabaseClient.channel('kanban-pedidos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, agendarRecarga)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_pendentes' }, agendarRecarga)
        .subscribe();
}

export function desligarTempoReal() {
    if (!canalTempoReal) return;
    supabaseClient.removeChannel(canalTempoReal);
    canalTempoReal = null;
}

export async function carregarViewKanban() {
    ligarTempoReal();
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
    rascunhoPorPedido = {};
    pendentes.forEach(r => { if (r.dados_completos?.historico_id) rascunhoPorPedido[r.dados_completos.historico_id] = r.id; });
    renderKanban();

    // Pedidos que ainda têm rascunho ligado (versões anteriores): passam a existir só no quadro
    pedidos.filter(r => rascunhoPorPedido[r.id]).forEach(r => concluirRascunhoDoPedido(r.id));
}

// Id do rascunho aberto para o pedido do histórico, se houver
export const rascunhoDoPedido = id => rascunhoPorPedido[id] || null;

// Um pedido existe num lugar só: depois que vai para o quadro, o rascunho dele não existe mais.
// Versões anteriores deixavam um rascunho ligado ao pedido: os dados dele (sempre os mais novos)
// vão para o pedido e o rascunho é apagado. Despachado/entregue/cancelado: os itens já não mudam.
const FASES_ENVIADO = ['despachado', 'entregue'];

async function concluirRascunhoDoPedido(historicoId) {
    const draftId = rascunhoPorPedido[historicoId];
    if (!draftId) return;
    // Rascunho aberto no editor: o Salvar de lá faz a mesma coisa
    if (String(AppState.currentDraftId) === String(draftId)) return;
    const reg = acharPedido(historicoId);
    const rasc = (window.__rascunhosCache || []).find(r => String(r.id) === String(draftId));
    if (reg && rasc?.dados_completos && !FASES_ENVIADO.includes(reg.fase) && reg.fase !== 'cancelado') {
        const dados = { ...rasc.dados_completos, rascunho_em: rasc.dados_completos.rascunho_em || rasc.created_at };
        if (!(await registrarNoHistorico(dados, historicoId))) return;
        atualizarCaches(historicoId, { dados_completos: { ...dados, historico_id: undefined }, itens: dados.items });
    }
    if (!(await deletarPendente(draftId, false))) return;
    delete rascunhoPorPedido[historicoId];
}

// Registro do histórico por id, venha do kanban ou da lista do Histórico
export function acharPedido(id) {
    return pedidos.find(r => String(r.id) === String(id))
        || (window.__historicoCache || []).find(r => String(r.id) === String(id))
        || (window.__painelCache || []).find(r => String(r.id) === String(id));
}

// chave do card: 'h:<id>' (histórico) ou 'r:<id>' (rascunho)
function registroDaChave(chave) {
    const id = chave.slice(2);
    return chave.startsWith('r:')
        ? rascunhos.find(r => String(r.id) === id) || (window.__rascunhosCache || []).find(r => String(r.id) === id)
        : acharPedido(id);
}

// Aplica os campos em todas as cópias do registro (kanban e lista do Histórico)
export function atualizarCaches(id, campos) {
    [...pedidos, ...(window.__historicoCache || []), ...(window.__painelCache || [])]
        .filter(r => String(r.id) === String(id))
        .forEach(r => Object.assign(r, campos));
}

// --- NF: selo no card, anda em paralelo às colunas ---

// Clique no selo do card: pedida -> emitida; não pedida ou emitida -> pergunta antes
window.alternarNFDoCard = async function (id) {
    const reg = acharPedido(id);
    if (!reg) return;
    const estado = estadoNF(reg.status);
    const nome = reg.destinatario || 'Pedido';
    if (estado === 'emitida' || estado === 'nao_pedida') {
        const ok = await confirmar(estado === 'emitida'
            ? { titulo: 'Desmarcar a NF emitida?', mensagem: `"${nome}" volta a aparecer como "NF pedida".`, tipo: 'aviso', sim: 'Desmarcar', nao: 'Deixar emitida' }
            : { titulo: 'Marcar a NF como emitida?', mensagem: `O pedido de NF de "${nome}" não foi enviado por aqui. Marcar como emitida mesmo assim?`, sim: 'Marcar emitida', nao: 'Cancelar' });
        if (!ok) return;
    }
    await marcarNF(id, estado !== 'emitida');
};

// Grava a NF emitida (ou desmarca) com atualização otimista; volta se o banco falhar
export async function marcarNF(id, emitida) {
    const aberto = String(AppState.regAberto?.id) === String(id) ? AppState.regAberto : null;
    const reg = acharPedido(id) || aberto;
    if (!reg) return false;
    const antes = { status: reg.status };
    const marcado = { email: false, etiqueta: false, romaneio: false, ...(reg.status || {}), nf_emitida: emitida };
    const base = { ...reg, status: antes.status };
    atualizarCaches(id, { status: marcado });
    if (kanbanVisivel()) renderKanban();
    const r = await atualizarStatusHistorico(base, marcado);
    if (!r) {
        atualizarCaches(id, antes);
        if (kanbanVisivel()) renderKanban();
        toast('Não foi possível gravar a NF. Verifique a conexão.', 'error', 5000);
        return false;
    }
    atualizarCaches(id, { status: r.status, fase: r.fase, fase_em: r.fase_em });
    if (aberto) Object.assign(aberto, { status: r.status, fase: r.fase, fase_em: r.fase_em });
    if (kanbanVisivel()) renderKanban();
    toast(`${reg.destinatario || 'Pedido'}: ${emitida ? 'NF emitida' : 'NF desmarcada'}.`);
    return true;
}

// Pedido com a NF pedida e ainda não emitida (para o resumo do topo)
const esperandoNF = r => !semEnvio(r.dados_completos) && FASES_ANTES_DA_SAIDA.includes(r.fase) && estadoNF(r.status) === 'pedida';

const diasDesde = data => Math.max(0, Math.floor((Date.now() - new Date(data)) / 864e5));
const textoDias = n => n === 0 ? 'hoje' : `há ${n} dia${n > 1 ? 's' : ''}`;

function nivelAtraso(fase, dias) {
    const [amarelo, vermelho] = limitesAtraso()[fase] || [];
    if (vermelho !== undefined && dias >= vermelho) return 2;
    if (amarelo !== undefined && dias >= amarelo) return 1;
    return 0;
}

// Pedidos sem NF na janela da junção, para o selo "mesmo técnico"
function candidatosJuncao() {
    const desde = new Date(inicioJanelaJuncao());
    const recente = (...datas) => datas.some(d => d && new Date(d) >= desde);
    return [
        ...pedidos.filter(r => pedidoSemNF(r) && recente(r.created_at, r.fase_em))
            .map(r => ({ chave: 'h:' + r.id, pessoa: pessoaDoRegistro(r), sem: semEnvio(r.dados_completos) })),
        ...rascunhos.filter(r => recente(r.created_at))
            .map(r => ({ chave: 'r:' + r.id, pessoa: pessoaDoRegistro(r), sem: semEnvio(r.dados_completos) }))
    ].filter(c => !c.sem); // retirada / instalação na Ranor não pede NF: não há o que juntar
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

// Retirada / instalação na Ranor aparece no lugar da transportadora (e no filtro)
const transportadoraDe = (reg, rascunho) => semEnvio(reg.dados_completos)
    ? rotuloEntrega(entregaDe(reg.dados_completos))
    : rascunho ? reg.dados_completos?.carrier : reg.transportadora;
const qtdItens = (reg, rascunho) => (rascunho ? (reg.dados_completos?.items || []) : (reg.itens || []))
    .reduce((s, it) => s + (parseInt(it.qty) || 1), 0);

function cardHtml(reg, chave, grupos, { rascunho = false } = {}) {
    const qtd = qtdItens(reg, rascunho);
    const transportadora = transportadoraDe(reg, rascunho);
    const st = reg.status || {};
    const fase = rascunho ? 'rascunho' : reg.fase;
    const dias = diasDesde(rascunho ? reg.created_at : reg.fase_em);
    const atraso = rascunho ? 0 : nivelAtraso(fase, dias);
    const selo = (feito, label, titulo) => `<span class="status-badge${feito ? ' done' : ''}" title="${titulo}${feito ? ': feito' : ': pendente'}">${label}</span>`;

    const outros = grupos[chave];
    const classes = ['kanban-card'];
    if (rascunho) classes.push('kanban-card-rascunho');
    if (atraso) classes.push('atraso-' + atraso);
    if (destacado && (destacado === chave || (grupos[destacado] || []).includes(chave))) classes.push('destaque');

    // Rascunho criado da planilha de estoque: ícone e o que ainda falta preencher
    const doEstoque = reg.dados_completos?.origem?.perfil === 'estoque';
    const falta = rascunho && doEstoque ? pendenciasEnvio(reg.dados_completos) : [];
    const acao = `abrirPedido('${chave}')`;
    // NF: só antes da saída e só para quem pede NF (retirada / instalação na Ranor não pede)
    const nf = estadoNF(st);
    const seloNF = !rascunho && !semEnvio(reg.dados_completos) && FASES_ANTES_DA_SAIDA.includes(fase)
        ? `<span class="kanban-tag nf nf-${nf}" title="${nf === 'emitida' ? 'NF emitida. Clique para desmarcar.' : 'Clique quando a NF for emitida.'}"
                 onclick="event.stopPropagation(); alternarNFDoCard('${reg.id}')">🧾 ${ROTULOS_NF[nf]}</span>` : '';
    const seloJuncao = outros ? `
        <span class="kanban-tag juncao" title="Outros pedidos sem NF para este técnico. Clique para destacar." onclick="event.stopPropagation(); destacarMesmoTecnico('${chave}')">🔗 +${outros.length}</span>
        <span class="kanban-tag juncao juntar" title="Juntar com os outros pedidos deste técnico, para pedir uma NF só. Também dá para arrastar um card sobre o outro." onclick="event.stopPropagation(); juntarPedidoDoKanban('${chave}')">Juntar</span>` : '';
    const arrastar = `draggable="true" ondragstart="kanbanDragStart(event, '${rascunho ? 'r:' : ''}${reg.id}')" ondragend="kanbanDragEnd(event)"`;
    // Soltar outro card em cima deste junta os dois (se forem do mesmo técnico e sem NF)
    const soltar = `ondragover="kanbanDragOverCard(event, '${chave}')" ondragleave="kanbanDragLeaveCard(event)" ondrop="kanbanDropCard(event, '${chave}')"`;

    const sub = [
        reg.unidade && reg.unidade !== reg.destinatario ? escapeHtml(reg.unidade) : '',
        reg.referencia ? `<span class="kanban-card-ref">${escapeHtml(reg.referencia)}</span>` : ''
    ].filter(Boolean).join(' &middot; ');
    const sem = semEnvio(reg.dados_completos);
    const meta = [
        transportadora && (sem ? `${iconeEntrega(entregaDe(reg.dados_completos))} ` : '') + escapeHtml(transportadora),
        qtd && `${qtd} item(ns)`,
        reg.rastreio && `Rastreio <strong>${escapeHtml(reg.rastreio)}</strong>`,
        reg.frete != null && `Frete <strong>R$ ${formatarFrete(reg.frete)}</strong>`
    ].filter(Boolean).join(' &middot; ');
    const icones = doEstoque ? '<span class="kanban-icone" title="Importado da planilha de estoque">📥</span>' : '';

    return `
        <div class="${classes.join(' ')}" ${arrastar} ${soltar} onclick="${acao}">
            <div class="kanban-card-topo">
                <div class="kanban-card-titulo">${escapeHtml(reg.destinatario || 'Sem destinatário')}</div>
                <span class="kanban-dias">${textoDias(dias)}</span>
            </div>
            ${sub ? `<div class="kanban-card-sub">${sub}</div>` : ''}
            ${meta ? `<div class="kanban-card-meta">${meta}</div>` : ''}
            ${falta.length ? `<div class="kanban-card-falta">Falta: ${falta.map(escapeHtml).join(', ')}</div>` : ''}
            <div class="kanban-card-tags">${seloNF}${seloJuncao}</div>
            <div class="kanban-card-rodape">
                ${rascunho ? '<span class="status-badge" title="Ainda não gerou e-mail, romaneio nem etiqueta">não gerado</span>'
                    : sem ? `<div class="status-badges">${selo(st.romaneio, 'R', 'Romaneio')}</div>`
                    : `<div class="status-badges">${selo(st.email, 'E', 'E-mail de NF')}${selo(st.romaneio, 'R', 'Romaneio')}${selo(st.etiqueta, 'Et', 'Etiqueta')}</div>`}
                <span class="kanban-icones">${icones}</span>
            </div>
        </div>`;
}

const atrasado = r => nivelAtraso(r.fase, diasDesde(r.fase_em)) > 0;

// Contas do topo do quadro; cada linha clicável vira um filtro
function renderResumo(grupos) {
    const el = $('kanban_resumo');
    if (!el) return;

    const andamento = rascunhos.length + pedidos.filter(r => r.fase !== 'entregue').length;
    const limites = limitesAtraso();
    const atrasadosPorFase = Object.keys(limites)
        .map(fase => ({ fase, qtd: pedidos.filter(r => r.fase === fase && atrasado(r)).length }))
        .filter(x => x.qtd);
    const totalAtrasados = atrasadosPorFase.reduce((s, x) => s + x.qtd, 0);
    const paraJuntar = Object.keys(grupos).length;
    const aguardandoNF = pedidos.filter(esperandoNF).length;

    const chip = (filtro, classe, texto) => `
        <button class="resumo-chip ${classe}${filtroResumo === filtro ? ' ativo' : ''}"
                onclick="filtrarResumoKanban('${filtro}')" title="Clique para mostrar só estes">${texto}</button>`;

    el.innerHTML = `
        <span class="resumo-chip neutro">${andamento} em andamento</span>
        ${atrasadosPorFase.map(({ fase, qtd }) => chip('atrasados', 'alerta',
            `${qtd} em ${rotuloFase(fase)} há ${limites[fase][0]}+ dia${limites[fase][0] > 1 ? 's' : ''}`)).join('')}
        ${aguardandoNF ? chip('nf', 'nf', `🧾 ${aguardandoNF} aguardando NF`) : ''}
        ${paraJuntar ? chip('juncao', 'juncao', `🔗 ${paraJuntar} pedidos podem ser juntados`) : ''}
        ${!totalAtrasados && !paraJuntar ? '<span class="resumo-chip ok">Nada atrasado</span>' : ''}
        ${filtroResumo ? `<button class="resumo-chip limpar" onclick="filtrarResumoKanban(null)">Mostrar todos</button>` : ''}`;
}

window.filtrarResumoKanban = function (filtro) {
    filtroResumo = filtroResumo === filtro ? null : filtro;
    renderKanban();
};

// Filtros de destinatário (técnico) e transportadora: opções a partir dos pedidos do quadro
function popularFiltros() {
    const preencher = (id, valores, rotuloTodos) => {
        const el = $(id);
        if (!el) return;
        const atual = el.value;
        const lista = [...new Set(valores.map(v => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        el.innerHTML = `<option value="">${rotuloTodos}</option>` +
            lista.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        el.value = lista.includes(atual) ? atual : '';
        el.classList.toggle('ativo', !!el.value);
    };
    preencher('kanban_tecnico', [...pedidos, ...rascunhos].map(r => r.destinatario), 'Todos os destinatários');
    preencher('kanban_transportadora', [...pedidos.map(r => transportadoraDe(r, false)), ...rascunhos.map(r => transportadoraDe(r, true))], 'Todas as transportadoras');
}

// Cada coluna mostra os mais recentes; o resto fica atrás de "Ver mais" (atrasados e junções sempre aparecem)
const LIMITE_COLUNA = 8;
const colunasAbertas = new Set();

window.verMaisColuna = function (fase) {
    if (colunasAbertas.has(fase)) colunasAbertas.delete(fase); else colunasAbertas.add(fase);
    renderKanban();
};

export function renderKanban() {
    const board = $('kanban_board');
    if (!board) return;
    popularFiltros();
    const termo = ($('kanban_search')?.value || '').trim().toLowerCase();
    const tecnico = $('kanban_tecnico')?.value || '';
    const transp = $('kanban_transportadora')?.value || '';
    const filtrando = !!(termo || filtroResumo || tecnico || transp);
    const grupos = gruposMesmoTecnico();
    const bate = (r, chave, rascunho = false) => {
        if (termo && ![r.destinatario, r.unidade, r.referencia, r.rastreio].join(' ').toLowerCase().includes(termo)) return false;
        if (tecnico && String(r.destinatario || '').trim() !== tecnico) return false;
        if (transp && String(transportadoraDe(r, rascunho) || '').trim() !== transp) return false;
        if (filtroResumo === 'atrasados') return !rascunho && atrasado(r);
        if (filtroResumo === 'juncao') return !!grupos[chave];
        if (filtroResumo === 'nf') return !rascunho && esperandoNF(r);
        return true;
    };

    renderResumo(grupos);

    board.innerHTML = FASES.map(({ chave: fase, rotulo }) => {
        const todos = [
            ...(fase === 'rascunho' ? rascunhos.map(r => ({ reg: r, chave: 'r:' + r.id, rascunho: true })) : []),
            ...pedidos.filter(r => r.fase === fase).map(r => ({ reg: r, chave: 'h:' + r.id, rascunho: false }))
        ].filter(x => bate(x.reg, x.chave, x.rascunho));

        const aberta = filtrando || colunasAbertas.has(fase);
        const fixo = x => grupos[x.chave] || (!x.rascunho && atrasado(x.reg));
        const visiveis = aberta ? todos : todos.filter((x, i) => i < LIMITE_COLUNA || fixo(x));
        const escondidos = todos.length - visiveis.length;
        const itens = todos.reduce((s, x) => s + qtdItens(x.reg, x.rascunho), 0);
        const botaoMais = escondidos
            ? `<button class="kanban-ver-mais" onclick="verMaisColuna('${fase}')">Ver mais ${escondidos}</button>`
            : !filtrando && colunasAbertas.has(fase) && todos.length > LIMITE_COLUNA
                ? `<button class="kanban-ver-mais" onclick="verMaisColuna('${fase}')">Ver menos</button>` : '';

        return `
            <div class="kanban-col" data-fase="${fase}"
                 ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event, '${fase}')">
                <div class="kanban-col-header">
                    <span>${rotulo}</span>
                    <span class="kanban-count" title="${todos.length} pedido(s), ${itens} item(ns)">${todos.length}${itens ? ` &middot; ${itens} it.` : ''}</span>
                </div>
                <div class="kanban-col-body">
                    ${visiveis.map(x => cardHtml(x.reg, x.chave, grupos, { rascunho: x.rascunho })).join('') || '<div class="kanban-vazio">Nenhum pedido</div>'}
                    ${botaoMais}
                    ${fase === 'entregue' ? '<div class="kanban-nota">Últimos 30 dias</div>' : ''}
                </div>
            </div>`;
    }).join('');
    window.aoAtualizarPedidos?.(); // a coluna do pedido aberto no editor acompanha
}

window.destacarMesmoTecnico = function (chave) {
    destacado = destacado === chave ? null : chave;
    renderKanban();
};

// --- Juntar pelo kanban (botão "Juntar" ou card arrastado sobre outro) ---

// Pedido do card no formato da junção (null se for registro antigo, sem os dados do formulário)
function pedidoDoCard(chave) {
    const reg = registroDaChave(chave);
    if (!reg?.dados_completos) return null;
    return chave.startsWith('r:') ? pedidoDoRascunho(reg) : pedidoDoHistorico(reg);
}

const chaveDoPedido = p => (p.origem === 'rascunho' ? 'r:' : 'h:') + p.id;

function semNF(chave) {
    if (semEnvio(registroDaChave(chave)?.dados_completos)) return false; // não pede NF: não junta
    if (chave.startsWith('r:')) return true;
    return pedidoSemNF(acharPedido(chave.slice(2)));
}

// Algum dos cards está no formulário? Juntar por fora deixaria o formulário desatualizado
function abertoNoFormulario(chaves) {
    return chaves.some(c => {
        const id = c.slice(2);
        if (c.startsWith('r:')) return String(AppState.currentDraftId) === id;
        return String(AppState.currentHistoricoId) === id
            || (!!rascunhoPorPedido[id] && String(AppState.currentDraftId) === String(rascunhoPorPedido[id]));
    });
}
const AVISO_FORMULARIO = 'Um destes pedidos está aberto. Feche o pedido (botão Fechar) antes de juntar.';

async function executarJuncao(chaveAlvo, outrasChaves) {
    const alvo = pedidoDoCard(chaveAlvo);
    const outros = outrasChaves.map(pedidoDoCard).filter(Boolean);
    if (!alvo || !outros.length) return;
    const id = await juntarPedidos(alvo, outros);
    destacado = null;
    await carregarViewKanban();
    if (!id) return;
    toast(precisaNovoEmail(alvo, outros)
        ? 'Pedidos juntados em um só. A NF já tinha sido pedida: abra o pedido, confira os volumes e envie o e-mail de novo (ele avisa o financeiro para desconsiderar os pedidos anteriores).'
        : 'Pedidos juntados em um só. Confira os volumes antes de pedir a NF.', 'success', 10000);
}

window.juntarPedidoDoKanban = async function (chave) {
    const alvo = pedidoDoCard(chave);
    const candidatos = (gruposMesmoTecnico()[chave] || []).map(pedidoDoCard).filter(Boolean);
    if (!alvo || !candidatos.length) {
        toast('Nenhum outro pedido sem NF para este técnico.', 'warning');
        return;
    }
    if (abertoNoFormulario([chave, ...candidatos.map(chaveDoPedido)])) {
        toast(AVISO_FORMULARIO, 'warning', 7000);
        return;
    }
    const escolhidos = await escolherParaJuntar(registroDaChave(chave)?.destinatario, candidatos);
    if (escolhidos) await executarJuncao(chave, escolhidos.map(chaveDoPedido));
};

// Card arrastado sobre outro: dá para juntar se forem do mesmo técnico e os dois ainda sem NF.
// Se não der, o card de baixo não "pega" o arraste e a coluna move de fase, como sempre.
let chaveArrastada = null;

function podeJuntarCom(chave) {
    const a = chaveArrastada;
    if (!a || a === chave || !semNF(a) || !semNF(chave)) return false;
    const ra = registroDaChave(a), rb = registroDaChave(chave);
    return !!ra?.dados_completos && !!rb?.dados_completos && mesmoTecnico(pessoaDoRegistro(ra), pessoaDoRegistro(rb));
}

window.kanbanDragOverCard = function (ev, chave) {
    if (!podeJuntarCom(chave)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.add('drop-juntar');
    ev.currentTarget.closest('.kanban-col')?.classList.remove('drag-over');
};
window.kanbanDragLeaveCard = function (ev) {
    if (!ev.currentTarget.contains(ev.relatedTarget)) ev.currentTarget.classList.remove('drop-juntar');
};
window.kanbanDropCard = async function (ev, chave) {
    if (!podeJuntarCom(chave)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove('drop-juntar');
    const origem = chaveArrastada;
    if (abertoNoFormulario([origem, chave])) {
        toast(AVISO_FORMULARIO, 'warning', 7000);
        return;
    }
    const ro = registroDaChave(origem), ra = registroDaChave(chave);
    const nome = r => r.referencia || r.unidade || 'sem referência';
    const ok = await confirmar({
        titulo: 'Juntar estes pedidos?',
        mensagem: `Os itens de "${nome(ro)}" vão para "${nome(ra)}", e o card de "${nome(ro)}" sai do quadro.`,
        detalhe: ([ro, ra].some(r => r.status?.email) ? 'A NF de um deles já foi pedida: depois, envie o e-mail de novo com tudo junto. ' : '')
            + 'Dá para separar depois, no detalhe do pedido.',
        sim: 'Juntar',
        nao: 'Cancelar'
    });
    if (ok) await executarJuncao(chave, [origem]);
};

// Move o pedido de fase com atualização otimista; volta ao estado anterior se o banco falhar
// extrasIniciais: outros campos a gravar junto, ex. { mesclado_em: null }
// Retirada / instalação na Ranor não tem trânsito: "Despachado" vai direto para "Entregue"
// A saída e a entrega pedem a data em que aconteceram (vem marcada como confirmada)
export async function moverPedidoPara(id, fase, extrasIniciais = {}) {
    let reg = acharPedido(id);
    const sem = semEnvio(reg?.dados_completos);
    if (sem && fase === 'despachado') fase = 'entregue';
    if (!reg || reg.fase === fase) return false;

    if (fase !== 'cancelado' && ordemFase(fase) < ordemFase(reg.fase)) {
        const voltar = await confirmar({
            titulo: 'Voltar o pedido de fase?',
            mensagem: `"${reg.destinatario}" sai de "${rotuloFase(reg.fase)}" e volta para "${rotuloFase(fase)}".`,
            tipo: 'aviso',
            sim: 'Voltar de fase',
            nao: 'Deixar como está'
        });
        if (!voltar) return false;
    }

    // Saída do pedido: despacho pela transportadora, ou a entrega na Ranor (retirada / instalação)
    const saindo = !reg.despachado_em && (fase === 'despachado' || fase === 'entregue');
    if (saindo && !(await confirmarEtapasDoDespacho(reg))) return false;
    const datas = await dadosDaSaida(reg, fase, sem);
    if (!datas) return false;

    // O quadro pode ter recarregado enquanto o modal estava aberto
    reg = acharPedido(id);
    if (!reg) return false;
    const extras = { ...extrasIniciais, ...datas, ...datasAoVoltar(reg, fase) };
    const antes = { fase: reg.fase, fase_em: reg.fase_em };
    Object.keys(extras).forEach(campo => { antes[campo] = reg[campo]; });
    atualizarCaches(id, { fase, fase_em: new Date().toISOString(), ...extras });
    if (kanbanVisivel()) renderKanban();

    const ok = await moverFase(id, fase, extras);
    if (!ok) {
        atualizarCaches(id, antes);
        if (kanbanVisivel()) renderKanban();
        toast('Não foi possível mudar a fase. Verifique a conexão.', 'error', 5000);
    } else if (saindo) {
        await concluirRascunhoDoPedido(id);
        if (sem) toast(`${rotuloEntrega(entregaDe(reg.dados_completos))}: pedido marcado como entregue.`);
        else oferecerPixFrete(reg);
    }
    return ok;
}

// Voltar de fase apaga as datas que deixam de valer: antes do despacho, a de despacho; saindo de "Entregue", a de entrega.
// Voltar de "Entregue" para "Despachado" mantém a data de despacho original.
function datasAoVoltar(reg, fase) {
    if (fase === 'cancelado') return {};
    const extras = {};
    if (reg.despachado_em && ordemFase(fase) < ordemFase('despachado')) Object.assign(extras, { despachado_em: null, despacho_confirmado: false });
    if (reg.fase === 'entregue' && fase !== 'entregue') Object.assign(extras, { entregue_em: null, entrega_confirmada: false });
    return extras;
}

// Pergunta os dados da saída ao mover para "Despachado" / "Entregue". Devolve os campos a gravar ({} se não é saída),
// ou null se a pessoa cancelou. fase_em vai junto: a fase começa na data informada, não na hora do arraste.
async function dadosDaSaida(reg, fase, sem) {
    if (fase !== 'despachado' && fase !== 'entregue') return {};
    if (sem) {
        // Retirada / instalação: a saída e a entrega são a mesma data
        const quando = await pedirDataEntrega(reg, { sem: true });
        if (!quando) return null;
        return { despachado_em: quando, despacho_confirmado: true, fase_em: quando, entregue_em: quando, entrega_confirmada: true };
    }
    const extras = {};
    if (!reg.despachado_em) {
        const despacho = await pedirDadosDespacho(reg, { despachando: true });
        if (!despacho) return null;
        Object.assign(extras, despacho, { fase_em: despacho.despachado_em });
    }
    if (fase === 'entregue') {
        const quando = await pedirDataEntrega({ ...reg, ...extras });
        if (!quando) return null;
        Object.assign(extras, { fase_em: quando, entregue_em: quando, entrega_confirmada: true });
    }
    return extras;
}

// Data em que o pedido foi entregue (a do rastreio). ISO, ou null se cancelou.
// sem: retirada / instalação na Ranor (a data em que o técnico retirou / foi instalado)
export async function pedirDataEntrega(reg = {}, { sem = false, valor = '' } = {}) {
    const minimo = sem ? '' : paraInput(reg.despachado_em);
    const rotulo = sem ? `Data da ${rotuloEntrega(entregaDe(reg.dados_completos)).toLowerCase()}` : 'Data da entrega';
    const dados = await pedirCampos({
        titulo: sem ? rotuloEntrega(entregaDe(reg.dados_completos)) : 'Pedido entregue',
        mensagem: sem
            ? `"${reg.destinatario || 'Sem destinatário'}": quando saiu da Ranor?`
            : `"${reg.destinatario || 'Sem destinatário'}": confira no rastreio${reg.rastreio ? ` (${reg.rastreio})` : ''} o dia em que chegou.`,
        sim: sem ? 'Marcar entregue' : 'Confirmar entrega',
        campos: [{
            nome: 'data', rotulo, tipo: 'date', valor: valor || hojeInput(), max: hojeInput(), min: minimo,
            ajuda: minimo ? `Despachado em ${dataBR(minimo)}.` : ''
        }],
        validar: v => problemaData(v.data, { rotulo, minimo, rotuloMinimo: `do despacho (${dataBR(minimo)})` })
    });
    return dados && deInput(dados.data);
}

// Despachar trava os itens: avisa se ainda falta alguma etapa do pedido
// Retirada / instalação na Ranor não tem NF nem etiqueta: só confere romaneio e configuração
async function confirmarEtapasDoDespacho({ destinatario, status, dados_completos, fase } = {}) {
    const sem = semEnvio(dados_completos);
    const nf = estadoNF(status);
    const faltam = [
        !sem && nf === 'nao_pedida' && 'pedido de NF por e-mail',
        !sem && nf === 'pedida' && 'NF emitida (foi pedida, mas não está marcada como emitida)',
        !status?.romaneio && 'romaneio',
        !sem && !status?.etiqueta && 'etiqueta',
        fase !== 'pronto' && `configuração dos equipamentos (está em "${rotuloFase(fase || 'rascunho')}")`
    ].filter(Boolean);
    if (!faltam.length) return true;
    return confirmar({
        titulo: 'Faltam etapas neste pedido',
        mensagem: `"${destinatario || 'Sem destinatário'}" ainda não tem: ${faltam.join(', ')}.\n\nDepois de ${sem ? 'entregue' : 'despachado'}, os itens não podem mais ser alterados.`,
        tipo: 'aviso',
        sim: sem ? 'Marcar entregue mesmo assim' : 'Despachar mesmo assim',
        nao: 'Voltar'
    });
}

// Pergunta rastreio e valor do frete (ambos opcionais) e, ao despachar, a data do despacho. null se cancelou.
// Despachando, devolve também { despachado_em, despacho_confirmado: true }.
export async function pedirDadosDespacho(reg = {}, { despachando = false } = {}) {
    const dados = await pedirCampos({
        titulo: despachando ? 'Despachar pedido' : 'Rastreio e frete',
        mensagem: despachando
            ? 'Rastreio e frete são opcionais e podem ser preenchidos depois, no detalhe do pedido. Depois de despachado, os itens ficam bloqueados.'
            : 'Os dois campos são opcionais.',
        sim: despachando ? 'Despachar' : 'Salvar',
        campos: [
            ...(despachando ? [{ nome: 'data', rotulo: 'Data do despacho', tipo: 'date', valor: hojeInput(), max: hojeInput(),
                ajuda: 'O dia em que o pedido saiu da Ranor (se não foi hoje, corrija).' }] : []),
            { nome: 'rastreio', rotulo: 'Código de rastreio', valor: reg.rastreio || '', focar: despachando },
            { nome: 'frete', rotulo: 'Valor do frete (R$)', valor: formatarFrete(reg.frete), placeholder: 'Ex: 25,90' }
        ],
        validar: v => {
            if (despachando) {
                const p = problemaData(v.data, { rotulo: 'A data do despacho' });
                if (p) return { campo: 'data', mensagem: p };
            }
            return Number.isNaN(lerValor(v.frete))
                ? { campo: 'frete', mensagem: 'Valor do frete inválido. Use, por exemplo, 25,90.' } : null;
        }
    });
    if (!dados) return null;
    const campos = { rastreio: dados.rastreio || null, frete: lerValor(dados.frete) };
    return despachando ? { ...campos, despachado_em: deInput(dados.data), despacho_confirmado: true } : campos;
}

// Rascunho arrastado para uma fase: cria o registro no histórico já nessa fase.
// O rascunho continua aberto, vinculado ao registro (como acontece ao gerar a partir dele).
async function moverRascunhoPara(draftId, fase) {
    const rasc = rascunhos.find(r => String(r.id) === String(draftId));
    if (!rasc || fase === 'rascunho') return false;
    const sem = semEnvio(rasc.dados_completos);
    if (sem && fase === 'despachado') fase = 'entregue';

    const base = { destinatario: rasc.destinatario, dados_completos: rasc.dados_completos, created_at: rasc.created_at, fase: 'rascunho' };
    const saindo = fase === 'despachado' || fase === 'entregue';
    if (saindo && !(await confirmarEtapasDoDespacho(base))) return false;
    const extras = await dadosDaSaida(base, fase, sem);
    if (!extras) return false;

    const salvo = await registrarNoHistorico({ ...rasc.dados_completos, rascunho_em: rasc.created_at });
    if (!salvo) {
        toast('Não foi possível mover o rascunho. Verifique a conexão.', 'error', 5000);
        return false;
    }
    if (salvo.fase !== fase || Object.keys(extras).length) await moverFase(salvo.id, fase, extras);
    // O rascunho virou pedido do quadro: deixa de existir (o pedido fica num lugar só)
    const aberto = String(AppState.currentDraftId) === String(draftId);
    if (await deletarPendente(draftId, false) && aberto) {
        AppState.currentDraftId = null;
        AppState.currentHistoricoId = String(salvo.id);
    }

    await carregarViewKanban();
    if (fase === 'despachado') oferecerPixFrete(acharPedido(salvo.id));
    return true;
}

// --- Arrastar e soltar (HTML5) ---
window.kanbanDragStart = function (ev, id) {
    ev.dataTransfer.setData('text/plain', id);
    ev.dataTransfer.effectAllowed = 'move';
    ev.currentTarget.classList.add('arrastando');
    arrastando = true;
    chaveArrastada = id.startsWith('r:') ? id : 'h:' + id;
};
window.kanbanDragEnd = ev => {
    ev.currentTarget.classList.remove('arrastando');
    arrastando = false;
    chaveArrastada = null;
    document.querySelectorAll('.kanban-card.drop-juntar').forEach(el => el.classList.remove('drop-juntar'));
};
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
    if (id.startsWith('r:')) moverRascunhoPara(id.slice(2), fase);
    else if (id) moverPedidoPara(id, fase);
};

window.carregarViewKanban = carregarViewKanban;
window.renderKanban = renderKanban;
