// Kanban de pedidos: uma coluna por fase, cards arrastáveis entre elas
import { $, escapeHtml, supabaseClient, AppState } from './config.js';
import { FASES, ordemFase, rotuloFase, carregarKanban, carregarPendentes, moverFase, registrarNoHistorico, salvarPendente, gravarPreparo } from './db.js';
import { formatarFrete, lerValor } from './planilha.js';
import { oferecerPixFrete } from './pixFrete.js';
import { confirmar, pedirCampos } from './dialogo.js';
import { FASES_SEM_NF, mesmoTecnico, pessoaDoRegistro, inicioJanelaJuncao, pedidoDoHistorico, pedidoDoRascunho, juntarPedidos, precisaNovoEmail, escolherParaJuntar } from './juncao.js';
import { toast } from './toast.js';
import { pendenciasEnvio } from './importarEstoque.js';
import { config } from './configuracoes.js';

// Dias parado na fase a partir dos quais o card fica amarelo / vermelho (Gerenciar Dados > Configurações)
const limitesAtraso = () => config('kanban_atraso') || {};

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
}

// Id do rascunho aberto para o pedido do histórico, se houver
export const rascunhoDoPedido = id => rascunhoPorPedido[id] || null;

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

// --- Configuração dos equipamentos: etapa paralela às fases (pode configurar enquanto espera a NF) ---
export const ETAPAS_PREPARO = [
    { chave: 'estoque',      rotulo: 'Saída do estoque' },
    { chave: 'configurando', rotulo: 'Em configuração' },
    { chave: 'configurado',  rotulo: 'Configurado' }
];
// Pedido sem etapa gravada acabou de sair do estoque
export const preparoDe = dados => ETAPAS_PREPARO.some(e => e.chave === dados?.preparo) ? dados.preparo : 'estoque';
const rotuloPreparo = chave => ETAPAS_PREPARO.find(e => e.chave === chave)?.rotulo || chave;

// chave do card: 'h:<id>' (histórico) ou 'r:<id>' (rascunho)
function registroDaChave(chave) {
    const id = chave.slice(2);
    return chave.startsWith('r:')
        ? rascunhos.find(r => String(r.id) === id) || (window.__rascunhosCache || []).find(r => String(r.id) === id)
        : acharPedido(id);
}

// Grava a etapa com atualização otimista; volta se o banco falhar
export async function definirPreparo(chave, preparo) {
    const reg = registroDaChave(chave);
    if (!reg) return false;
    const rascunho = chave.startsWith('r:');
    const id = chave.slice(2);
    const anterior = reg.dados_completos?.preparo;
    const aplicar = valor => {
        const copias = rascunho ? [reg] : [...pedidos, ...(window.__historicoCache || [])].filter(r => String(r.id) === id);
        copias.forEach(r => { r.dados_completos = { ...(r.dados_completos || {}), preparo: valor }; });
        // Formulário com este pedido aberto: "Salvar rascunho" não pode desfazer a etapa
        const aberto = rascunho ? String(AppState.currentDraftId) === id : String(AppState.currentHistoricoId) === id;
        if (aberto) AppState.extrasEnvio = { ...(AppState.extrasEnvio || {}), preparo: valor };
        if (kanbanVisivel()) renderKanban();
    };

    aplicar(preparo);
    const ok = await gravarPreparo(rascunho ? 'pedidos_pendentes' : 'historico', id, preparo);
    if (!ok) {
        aplicar(anterior);
        toast('Não foi possível salvar a etapa de configuração. Verifique a conexão.', 'error', 5000);
    }
    return ok;
}

// Clique no selo do card: avança para a próxima etapa (de "Configurado" volta ao começo)
window.avancarPreparo = function (chave) {
    const reg = registroDaChave(chave);
    if (!reg) return;
    const i = ETAPAS_PREPARO.findIndex(e => e.chave === preparoDe(reg.dados_completos));
    const proxima = ETAPAS_PREPARO[(i + 1) % ETAPAS_PREPARO.length].chave;
    definirPreparo(chave, proxima).then(ok => ok && toast(`${reg.destinatario || 'Pedido'}: ${rotuloPreparo(proxima)}.`));
};

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

const transportadoraDe = (reg, rascunho) => rascunho ? reg.dados_completos?.carrier : reg.transportadora;
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

    const idDraft = rascunho ? reg.id : rascunhoPorPedido[reg.id];
    // Rascunho criado da planilha de estoque: ícone e o que ainda falta preencher
    const doEstoque = reg.dados_completos?.origem?.perfil === 'estoque';
    const falta = rascunho && doEstoque ? pendenciasEnvio(reg.dados_completos) : [];
    const acao = rascunho ? `editarRascunho('${reg.id}')` : `abrirDetalheHistorico('${reg.id}')`;
    // Depois de despachado, só mostra a etapa de configuração se ela foi marcada
    const preparo = preparoDe(reg.dados_completos);
    const mostraPreparo = reg.dados_completos?.preparo || !['despachado', 'entregue'].includes(fase);
    const seloPreparo = mostraPreparo
        ? `<span class="kanban-tag preparo preparo-${preparo}" title="Configuração dos equipamentos. Clique para avançar a etapa."
                 onclick="event.stopPropagation(); avancarPreparo('${chave}')">⚙ ${rotuloPreparo(preparo)}</span>` : '';
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
    const meta = [
        transportadora && escapeHtml(transportadora),
        qtd && `${qtd} item(ns)`,
        reg.rastreio && `Rastreio <strong>${escapeHtml(reg.rastreio)}</strong>`,
        reg.frete != null && `Frete <strong>R$ ${formatarFrete(reg.frete)}</strong>`
    ].filter(Boolean).join(' &middot; ');
    const icones = [
        doEstoque ? '<span class="kanban-icone" title="Importado da planilha de estoque">📥</span>' : '',
        !rascunho && idDraft ? `<span class="kanban-icone clicavel" title="Tem rascunho aberto: clique para abrir no formulário" onclick="event.stopPropagation(); editarRascunho('${idDraft}')">✎</span>` : ''
    ].join('');

    return `
        <div class="${classes.join(' ')}" ${arrastar} ${soltar} onclick="${acao}">
            <div class="kanban-card-topo">
                <div class="kanban-card-titulo">${escapeHtml(reg.destinatario || 'Sem destinatário')}</div>
                <span class="kanban-dias">${textoDias(dias)}</span>
            </div>
            ${sub ? `<div class="kanban-card-sub">${sub}</div>` : ''}
            ${meta ? `<div class="kanban-card-meta">${meta}</div>` : ''}
            ${falta.length ? `<div class="kanban-card-falta">Falta: ${falta.map(escapeHtml).join(', ')}</div>` : ''}
            <div class="kanban-card-tags">${seloPreparo}${seloJuncao}</div>
            <div class="kanban-card-rodape">
                ${rascunho ? '<span class="status-badge" title="Ainda não gerou e-mail, romaneio nem etiqueta">não gerado</span>'
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

    const chip = (filtro, classe, texto) => `
        <button class="resumo-chip ${classe}${filtroResumo === filtro ? ' ativo' : ''}"
                onclick="filtrarResumoKanban('${filtro}')" title="Clique para mostrar só estes">${texto}</button>`;

    el.innerHTML = `
        <span class="resumo-chip neutro">${andamento} em andamento</span>
        ${atrasadosPorFase.map(({ fase, qtd }) => chip('atrasados', 'alerta',
            `${qtd} em ${rotuloFase(fase)} há ${limites[fase][0]}+ dia${limites[fase][0] > 1 ? 's' : ''}`)).join('')}
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
    preencher('kanban_transportadora', [...pedidos.map(r => r.transportadora), ...rascunhos.map(r => r.dados_completos?.carrier)], 'Todas as transportadoras');
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
    if (chave.startsWith('r:')) return true;
    const reg = acharPedido(chave.slice(2));
    return !!reg && FASES_SEM_NF.includes(reg.fase) && !reg.mesclado_em;
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
const AVISO_FORMULARIO = 'Um destes pedidos está aberto no formulário. Clique em "Novo envio" lá antes de juntar.';

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
export async function moverPedidoPara(id, fase, extrasIniciais = {}) {
    let reg = acharPedido(id);
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

    const extras = { ...extrasIniciais };
    if (fase === 'despachado') {
        if (!(await confirmarEtapasDoDespacho(reg))) return false;
        const despacho = await pedirDadosDespacho(reg, { despachando: true });
        if (!despacho) return false;
        Object.assign(extras, despacho);
    }

    // O quadro pode ter recarregado enquanto o modal estava aberto
    reg = acharPedido(id);
    if (!reg) return false;
    // Data de envio: voltar de "Entregue" mantém a original; voltar para antes do despacho a apaga
    if (fase === 'despachado' && !reg.despachado_em) extras.despachado_em = new Date().toISOString();
    else if (reg.despachado_em && fase !== 'cancelado' && ordemFase(fase) < ordemFase('despachado')) extras.despachado_em = null;
    const antes = { fase: reg.fase, fase_em: reg.fase_em };
    Object.keys(extras).forEach(campo => { antes[campo] = reg[campo]; });
    atualizarCaches(id, { fase, fase_em: new Date().toISOString(), ...extras });
    if (kanbanVisivel()) renderKanban();

    const ok = await moverFase(id, fase, extras);
    if (!ok) {
        atualizarCaches(id, antes);
        if (kanbanVisivel()) renderKanban();
        toast('Não foi possível mudar a fase. Verifique a conexão.', 'error', 5000);
    } else if (fase === 'despachado') {
        oferecerPixFrete(reg);
    }
    return ok;
}

// Despachar trava os itens: avisa se ainda falta alguma etapa do pedido
async function confirmarEtapasDoDespacho({ destinatario, status, dados_completos } = {}) {
    const preparo = preparoDe(dados_completos);
    const faltam = [
        !status?.email && 'pedido de NF por e-mail',
        !status?.romaneio && 'romaneio',
        !status?.etiqueta && 'etiqueta',
        preparo !== 'configurado' && `configuração dos equipamentos (está em "${rotuloPreparo(preparo)}")`
    ].filter(Boolean);
    if (!faltam.length) return true;
    return confirmar({
        titulo: 'Faltam etapas neste pedido',
        mensagem: `"${destinatario || 'Sem destinatário'}" ainda não tem: ${faltam.join(', ')}.\n\nDepois de despachado, os itens não podem mais ser alterados.`,
        tipo: 'aviso',
        sim: 'Despachar mesmo assim',
        nao: 'Voltar'
    });
}

// Pergunta rastreio e valor do frete (ambos opcionais). null se cancelou.
export async function pedirDadosDespacho(reg = {}, { despachando = false } = {}) {
    const dados = await pedirCampos({
        titulo: despachando ? 'Despachar pedido' : 'Rastreio e frete',
        mensagem: despachando
            ? 'Os dois campos são opcionais e podem ser preenchidos depois, no detalhe do pedido. Depois de despachado, os itens ficam bloqueados.'
            : 'Os dois campos são opcionais.',
        sim: despachando ? 'Despachar' : 'Salvar',
        campos: [
            { nome: 'rastreio', rotulo: 'Código de rastreio', valor: reg.rastreio || '' },
            { nome: 'frete', rotulo: 'Valor do frete (R$)', valor: formatarFrete(reg.frete), placeholder: 'Ex: 25,90' }
        ],
        validar: v => Number.isNaN(lerValor(v.frete))
            ? { campo: 'frete', mensagem: 'Valor do frete inválido. Use, por exemplo, 25,90.' } : null
    });
    return dados && { rastreio: dados.rastreio || null, frete: lerValor(dados.frete) };
}

// Rascunho arrastado para uma fase: cria o registro no histórico já nessa fase.
// O rascunho continua aberto, vinculado ao registro (como acontece ao gerar a partir dele).
async function moverRascunhoPara(draftId, fase) {
    const rasc = rascunhos.find(r => String(r.id) === String(draftId));
    if (!rasc || fase === 'rascunho') return false;

    let extras = {};
    if (fase === 'despachado') {
        if (!(await confirmarEtapasDoDespacho({ destinatario: rasc.destinatario, dados_completos: rasc.dados_completos }))) return false;
        extras = await pedirDadosDespacho({}, { despachando: true });
        if (!extras) return false;
        extras.despachado_em = new Date().toISOString();
    }

    const salvo = await registrarNoHistorico({ ...rasc.dados_completos, rascunho_em: rasc.created_at });
    if (!salvo) {
        toast('Não foi possível mover o rascunho. Verifique a conexão.', 'error', 5000);
        return false;
    }
    if (salvo.fase !== fase || Object.keys(extras).length) await moverFase(salvo.id, fase, extras);
    await salvarPendente({ ...rasc.dados_completos, historico_id: salvo.id }, draftId, true);
    // Formulário com este rascunho aberto passa a atualizar o mesmo registro
    if (String(AppState.currentDraftId) === String(draftId)) AppState.currentHistoricoId = String(salvo.id);

    await carregarViewKanban();
    if (fase === 'despachado') oferecerPixFrete(acharPedido(salvo.id));
    return true;
}

// Impresso antes da NF: o pedido já avançou para "Pronto"; avisa e permite voltar
export async function avisarProntoSemNF(id, { fase, faseAnterior, faseEmAnterior }) {
    if (fase !== 'pronto' || faseAnterior === fase || ordemFase(faseAnterior) >= ordemFase('nf_emitida')) return;
    const voltar = await confirmar({
        titulo: 'Pedido pronto, mas sem NF emitida',
        mensagem: `Com etiqueta e romaneio impressos, o pedido foi para "Pronto p/ envio", mas a NF ainda não foi emitida.\n\nQuer manter ou voltar para "${rotuloFase(faseAnterior)}"?`,
        tipo: 'aviso',
        sim: `Voltar para "${rotuloFase(faseAnterior)}"`,
        nao: 'Manter em Pronto'
    });
    if (!voltar) return;
    const extras = faseEmAnterior ? { fase_em: faseEmAnterior } : {};
    const ok = await moverFase(id, faseAnterior, extras);
    if (ok) {
        atualizarCaches(id, { fase: faseAnterior, fase_em: faseEmAnterior || new Date().toISOString() });
        if (kanbanVisivel()) renderKanban();
    }
    toast(ok ? 'Fase restaurada.' : 'Não foi possível voltar a fase. Verifique a conexão.', ok ? 'success' : 'error');
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
