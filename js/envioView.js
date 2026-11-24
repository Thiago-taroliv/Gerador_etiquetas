// Visualização de envios, só leitura: o resumo de um envio (datas, destinatário, itens) e os envios
// no modelo da planilha de envio. Abre do Histórico e do Painel; para editar, "Abrir no editor".
import { escapeHtml } from './config.js';
import { carregarPedido, rotuloFase, estadoNF, ROTULOS_NF, FASES } from './db.js';
import { COLUNAS, GRUPOS, gerarLinhasPlanilha, envioDoRegistro, formatarFrete, unidadeDoItem } from './planilha.js';
import { LARGURAS } from './planilhaPreview.js';
import { semEnvio, entregaDe, rotuloEntrega, iconeEntrega } from './entrega.js';
import { toast } from './toast.js';

// --- Modais empilhados: Esc e o clique fora fecham só o de cima ---
const pilha = [];

export function abrirModal(html, classe = '') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visao-overlay';
    overlay.innerHTML = `<div class="modal-card ${classe}" role="dialog" aria-modal="true">${html}</div>`;
    overlay.style.display = 'flex';
    const modal = {
        el: overlay,
        card: overlay.firstElementChild,
        fechar() {
            overlay.remove();
            const i = pilha.indexOf(modal);
            if (i >= 0) pilha.splice(i, 1);
        }
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) modal.fechar(); });
    overlay.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) modal.fechar(); });
    document.body.appendChild(overlay);
    pilha.push(modal);
    return modal;
}

export const fecharTodosModais = () => [...pilha].reverse().forEach(m => m.fechar());

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !pilha.length) return;
    if (document.querySelector('.dialogo-overlay')) return; // a pergunta de cima fecha primeiro
    e.stopPropagation();
    pilha[pilha.length - 1].fechar();
}, true);

// --- Formatação ---
const DIA = 864e5;
const data = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
const dataHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const dias = (a, b) => {
    if (!a || !b) return null;
    const d = (new Date(b) - new Date(a)) / DIA;
    return d >= 0 ? d : null;
};
const textoDias = d => d == null ? '' : d < 1 ? 'menos de 1 dia' : `${Math.round(d)} dia${Math.round(d) === 1 ? '' : 's'}`;
const valor = v => v === null || v === undefined || v === '' ? '<span class="visao-vazio">—</span>' : escapeHtml(v);

// Registro antigo, anterior ao formulário completo: o que dá para montar a partir das colunas
export const dadosDoRegistro = reg => reg.dados_completos || {
    sender_company: reg.remetente || '', dest_name: reg.destinatario || '', unit_name: reg.unidade || '',
    reference: reg.referencia || '', carrier: reg.transportadora || '', items: reg.itens || [], client_mode: 'single'
};

// --- Linha do tempo: quando o pedido passou por cada etapa ---
function etapas(reg, dados) {
    const sem = semEnvio(dados);
    const st = reg.status || {};
    const f = reg.fases_em || {};
    const ordem = FASES.findIndex(x => x.chave === reg.fase);
    const passou = chave => ordem >= FASES.findIndex(x => x.chave === chave);
    const lista = [
        { rotulo: 'Pedido criado', em: dados.rascunho_em || f.rascunho || reg.created_at, feito: true },
        ...(sem ? [] : [
            { rotulo: 'NF pedida', em: st.email_em, feito: !!st.email },
            { rotulo: 'NF emitida', em: st.nf_emitida_em, feito: !!st.nf_emitida }
        ]),
        { rotulo: 'A configurar', em: f.a_configurar, feito: passou('a_configurar') },
        { rotulo: 'Em configuração', em: f.configurando, feito: passou('configurando') },
        { rotulo: 'Pronto p/ envio', em: f.pronto, feito: passou('pronto') },
        ...(sem
            ? [{ rotulo: rotuloEntrega(entregaDe(dados)), em: reg.entregue_em || reg.despachado_em, feito: reg.fase === 'entregue', confirmada: reg.entrega_confirmada, data: true }]
            : [
                { rotulo: 'Despachado', em: reg.despachado_em, feito: passou('despachado'), confirmada: reg.despacho_confirmado, data: true },
                { rotulo: 'Entregue', em: reg.entregue_em || (reg.fase === 'entregue' ? reg.fase_em : null), feito: reg.fase === 'entregue', confirmada: reg.entrega_confirmada, data: true }
            ])
    ];
    return lista;
}

function linhaDoTempo(reg, dados) {
    if (reg.fase === 'cancelado') {
        return `<div class="visao-cancelado">Pedido cancelado em ${data(reg.fase_em)}${reg.mesclado_em ? ' (juntado a outro envio)' : ''}.</div>`;
    }
    return `<ol class="visao-tempo">${etapas(reg, dados).map(e => `
        <li class="${e.feito ? 'feito' : ''}">
            <span class="visao-tempo-ponto"></span>
            <span class="visao-tempo-rotulo">${escapeHtml(e.rotulo)}</span>
            <span class="visao-tempo-data">${e.em ? data(e.em) : e.feito ? 'sem data' : ''}</span>
            ${e.data && e.em ? `<span class="data-selo ${e.confirmada ? 'ok' : 'pendente'}">${e.confirmada ? '✓ confirmada' : 'não confirmada'}</span>` : ''}
        </li>`).join('')}</ol>`;
}

function prazos(reg, dados) {
    const inicio = dados.rascunho_em || reg.fases_em?.rascunho || reg.created_at;
    const entrega = reg.entregue_em || (reg.fase === 'entregue' ? reg.fase_em : null);
    const partes = [];
    const ateDespacho = dias(inicio, reg.despachado_em);
    if (ateDespacho != null && !semEnvio(dados)) partes.push(`<b>${textoDias(ateDespacho)}</b> do pedido ao despacho`);
    const transito = dias(reg.despachado_em, entrega);
    if (transito != null && !semEnvio(dados)) partes.push(`<b>${textoDias(transito)}</b> em trânsito`);
    if (reg.fase === 'despachado' && reg.despachado_em) partes.push(`em trânsito há <b>${textoDias(dias(reg.despachado_em, new Date().toISOString()))}</b>`);
    if (ateDespacho == null && reg.fase !== 'cancelado' && !reg.despachado_em) partes.push(`aberto há <b>${textoDias(dias(inicio, new Date().toISOString()))}</b>`);
    return partes.length ? `<div class="visao-prazos">${partes.join(' · ')}</div>` : '';
}

// --- Itens: quantidade, descrição e os números (IMEI, kit rastreador + teclado, chip) ---
function numeros(it) {
    return (it.imeis || []).map(im => {
        const chip = im.iccid ? ` <span class="visao-chip" title="ICCID ${escapeHtml(im.iccid)}">+ chip</span>` : '';
        if (im.tipo === 'kit') return `<span class="visao-num">${escapeHtml(im.rastreador || '?')} <small>+ teclado</small> ${escapeHtml(im.teclado || '?')}${chip}</span>`;
        return im.imei ? `<span class="visao-num">${escapeHtml(im.imei)}${chip}</span>` : '';
    }).join('');
}

function tabelaItens(dados) {
    const itens = (dados.items || []).filter(it => String(it.desc || '').trim());
    if (!itens.length) return '<div class="visao-vazio">Sem itens registrados.</div>';
    const multi = dados.client_mode === 'multi';
    return `<table class="visao-itens"><thead><tr><th>Qtd</th><th>Descrição</th>${multi ? '<th>Unidade</th>' : ''}<th>Números</th></tr></thead>
        <tbody>${itens.map(it => `<tr>
            <td class="num">${escapeHtml(it.qty || 1)}</td>
            <td>${escapeHtml(it.desc)}</td>
            ${multi ? `<td>${escapeHtml(unidadeDoItem(dados, it))}</td>` : ''}
            <td>${numeros(it) || '<span class="visao-vazio">—</span>'}</td>
        </tr>`).join('')}</tbody></table>`;
}

const campo = (rotulo, v) => `<div class="visao-campo"><span>${rotulo}</span><div>${v}</div></div>`;

// --- Resumo de um envio ---
export async function abrirVisualizacaoEnvio(id) {
    const reg = await carregarPedido(id);
    if (!reg) { toast('Não foi possível abrir o envio.', 'error'); return; }
    const dados = dadosDoRegistro(reg);
    const sem = semEnvio(dados);
    const nf = estadoNF(reg.status);
    const ref = dados.reference_type === 'none' || !reg.referencia ? '' : `${dados.reference_type === 'os' ? 'OS' : 'Ticket'} ${reg.referencia}`;
    const mesclados = dados.mesclados || [];

    const modal = abrirModal(`
        <div class="modal-header visao-topo">
            <div>
                <strong>${escapeHtml(reg.destinatario || 'Sem destinatário')}</strong>
                <div class="visao-sub">
                    ${ref ? `<span class="visao-ref">${escapeHtml(ref)}</span>` : ''}
                    ${reg.unidade && reg.unidade !== reg.destinatario ? `<span>${escapeHtml(reg.unidade)}</span>` : ''}
                    <span class="fase-badge fase-${escapeHtml(reg.fase)}">${escapeHtml(rotuloFase(reg.fase))}</span>
                    ${sem ? `<span class="kanban-tag">${iconeEntrega(entregaDe(dados))} ${escapeHtml(rotuloEntrega(entregaDe(dados)))}</span>`
                          : `<span class="kanban-tag nf nf-${nf}">🧾 ${ROTULOS_NF[nf]}</span>`}
                    ${dados.planilha_tipo ? `<span class="visao-tipo">${escapeHtml(dados.planilha_tipo)}</span>` : ''}
                </div>
            </div>
            <button class="modal-close" data-fechar title="Fechar (Esc)">&times;</button>
        </div>

        ${linhaDoTempo(reg, dados)}
        ${prazos(reg, dados)}

        <div class="visao-blocos">
            <section class="visao-bloco">
                <h4>Destinatário</h4>
                ${campo('Nome', valor(dados.dest_name || reg.destinatario))}
                ${dados.receiver ? campo('A/C', valor(dados.receiver)) : ''}
                ${campo('Documento', valor(dados.dest_doc))}
                ${campo('Telefone', valor(dados.dest_phone))}
                ${campo('Endereço', [dados.dest_addr1, dados.dest_addr2].filter(Boolean).map(escapeHtml).join('<br>') || valor(''))}
            </section>
            <section class="visao-bloco">
                <h4>Envio</h4>
                ${campo('Remetente', valor(reg.remetente || dados.sender_company))}
                ${campo('Saída', sem ? valor(rotuloEntrega(entregaDe(dados))) : valor(reg.transportadora))}
                ${sem ? '' : campo('Rastreio', valor(reg.rastreio))}
                ${sem ? '' : campo('Frete', reg.frete != null ? 'R$ ' + formatarFrete(reg.frete) : valor(''))}
                ${sem ? '' : campo('Volumes', valor(dados.total_vol))}
                ${campo('Cliente (planilha)', valor(dados.planilha_cliente))}
                ${campo('Criado em', valor(dataHora(reg.created_at)))}
            </section>
        </div>

        ${reg.mesclado_em ? `<div class="detalhe-juncao">🔗 Juntado a outro envio — os itens seguiram nele.
            <a href="#" data-abrir="${escapeHtml(reg.mesclado_em)}">Ver o envio</a></div>` : ''}
        ${mesclados.length ? `<div class="detalhe-juncao">🔗 Inclui os pedidos: ${mesclados.map(m => escapeHtml(m.referencia || m.unidade || 'sem referência')).join(', ')}</div>` : ''}

        <section class="visao-bloco largo">
            <h4>Itens</h4>
            ${tabelaItens(dados)}
        </section>

        <div class="modal-actions">
            <button class="btn-neutral" data-acao="planilha" title="As linhas deste envio no modelo da planilha de envio">Ver como planilha</button>
            <span style="flex:1"></span>
            <button class="btn-neutral" data-fechar>Fechar</button>
            <button data-acao="editor" title="Abre o pedido no editor (só leitura se já saiu ou foi cancelado)">Abrir no editor</button>
        </div>`, 'visao-card');

    modal.card.addEventListener('click', e => {
        const outro = e.target.closest('[data-abrir]');
        if (outro) { e.preventDefault(); abrirVisualizacaoEnvio(outro.dataset.abrir); return; }
        const acao = e.target.closest('[data-acao]')?.dataset.acao;
        if (acao === 'planilha') abrirPlanilhaLeitura([reg], `Planilha · ${reg.destinatario || ''}`);
        if (acao === 'editor') { fecharTodosModais(); window.abrirPedido('h:' + reg.id); }
    });
}

// --- Envios no modelo da planilha de envio (só leitura) ---
// pedidos: registros completos (com dados_completos). sub: texto abaixo do título.
export function abrirPlanilhaLeitura(pedidos, titulo, sub = '') {
    const linhas = [];
    pedidos.forEach(reg => {
        const dados = dadosDoRegistro(reg);
        const geradas = gerarLinhasPlanilha(dados, { envio: envioDoRegistro(reg, dados) });
        geradas.forEach((l, i) => linhas.push({ l, reg, primeira: i === 0 }));
    });
    const grupoDa = c => GRUPOS.find(g => c >= g.de && c <= g.ate).id;
    const cls = c => `g-${grupoDa(c)}`;

    const corpo = linhas.length ? `<table class="planilha-table planilha-leitura">
        <colgroup><col style="width:48px">${LARGURAS.map((w, c) => `<col class="${cls(c)}" style="width:${w}px">`).join('')}</colgroup>
        <thead>
            <tr class="grupos"><th class="col-acoes"></th>${GRUPOS.map(g => `<th class="g-${g.id}" colspan="${g.ate - g.de + 1}">${g.nome}</th>`).join('')}</tr>
            <tr class="nomes"><th class="col-acoes">#</th>${COLUNAS.map((n, c) => `<th class="${cls(c)}"><div class="th-inner"><span>${escapeHtml(n)}</span></div></th>`).join('')}</tr>
        </thead>
        <tbody>${linhas.map(({ l, reg, primeira }, r) => `
            <tr class="${primeira ? 'novo-envio' : ''}" data-id="${escapeHtml(reg.id)}" title="${escapeHtml(reg.destinatario || '')} · clique para ver o envio">
                <td class="col-acoes"><span class="num">${r + 1}</span></td>
                ${l.map((v, c) => `<td class="${cls(c)}"><div class="cel" title="${escapeHtml(v)}">${escapeHtml(v)}</div></td>`).join('')}
            </tr>`).join('')}</tbody>
    </table>` : '<div class="empty-state">Nenhuma linha para mostrar.</div>';

    const modal = abrirModal(`
        <div class="modal-header">
            <div>
                <strong>${escapeHtml(titulo)}</strong>
                <div class="small" style="margin-top:2px;">${linhas.length} linha(s) de ${pedidos.length} envio(s) · só visualização${sub ? ' · ' + escapeHtml(sub) : ''}</div>
            </div>
            <button class="modal-close" data-fechar title="Fechar (Esc)">&times;</button>
        </div>
        <div class="planilha-toolbar">
            <div class="planilha-grupos">
                <span class="small" style="margin:0;">Mostrar:</span>
                ${GRUPOS.map(g => `<label class="chip g-${g.id}"><input type="checkbox" checked data-grupo="${g.id}"> ${g.nome}</label>`).join('')}
            </div>
            <div class="planilha-dicas small">Clique numa linha para ver o envio. Configuração (FW, checklist...) ainda é preenchida na planilha.</div>
        </div>
        <div class="planilha-wrap">${corpo}</div>
        <div class="modal-actions"><button class="btn-neutral" data-fechar>Fechar</button></div>`, 'planilha-card');

    const tabela = modal.card.querySelector('table');
    modal.card.addEventListener('change', e => {
        const g = e.target.dataset?.grupo;
        if (g && tabela) tabela.classList.toggle(`hide-${g}`, !e.target.checked);
    });
    tabela?.addEventListener('click', e => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) abrirVisualizacaoEnvio(tr.dataset.id);
    });
}
