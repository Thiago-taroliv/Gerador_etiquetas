import { AppState, $ } from './config.js';
import { checkSession, handleLogin, handleLogout } from './auth.js';
import { loadJsonFile, salvarDestinatarioAtual, salvarOuAtualizarDestinatario, popularSelectDestinatarios, exportToJSON, carregarHistorico, HISTORICO_POR_PAGINA, atualizarStatusHistorico, registrarNoHistorico, salvarPendente, deletarPendente, FASES, rotuloFase, faseSugerida, atualizarDespacho, cancelarPedido, gravarEscolhaKits, faseDoPedido, carregarPedido } from './db.js';
import { carregarViewKanban, renderKanban, kanbanVisivel, acharPedido, atualizarCaches, moverPedidoPara, avisarProntoSemNF, pedirDadosDespacho, rascunhoDoPedido, ETAPAS_PREPARO, preparoDe, definirPreparo } from './kanban.js';
import { verificarJuncao, finalizarJuncao, juncaoAberta, fecharJuncao, separarPedido, podeSeparar } from './juncao.js';
import { renderDeParaCRUD } from './dePara.js';
import { pendenciasEnvio } from './importarEstoque.js';
import { abrirImportarEstoque, fecharImportarEstoque, importarEstoqueAberto } from './importarEstoqueModal.js';

// Depois de criar os rascunhos, o kanban mostra os novos cards
window.abrirImportarEstoque = () => abrirImportarEstoque(() => { if (kanbanVisivel()) carregarViewKanban(); });
import { onSenderChange, popularSelectRemetentes, onClientSelect, addItem, removeItem, collectData, clearItems, preencherFormulario, limparFormulario, ligarMascaraDoc, validarDoc, buscarCep, marcarFormularioSalvo, formularioAlterado } from './ui.js';
import { confirmar } from './dialogo.js';
import { iniciarPainel, carregarPainel, painelVisivel } from './painel.js';
import './imeis.js';
import { composeDocuments, renderEmailPreview, buildEmailBody, buildEmailSubject, avisosEmail } from './render.js';
import { conferirEmail, resumoDoPedido } from './conferencia.js';
import { abrirPixFrete } from './pixFrete.js';
import { abrirMontarKit } from './kitModal.js';
import { montarKit, desmontarKit, totalKits } from './kit.js';
import { toast } from './toast.js';
import { renderItemsCRUD } from './items.js';
import { gerarLinhasPlanilha, contarKits, formatarFrete } from './planilha.js';
import { grupoParaFormulario } from './importarPlanilha.js';
import { abrirImportarPlanilha, fecharImportarPlanilha, importarPlanilhaAberto, novaBaseImportada, limparBaseImportada, escolherArquivoImportar, usarEnvioImportado } from './importarPlanilhaModal.js';
import { abrirPreviewPlanilha, fecharPreviewPlanilha, alternarGrupoPlanilha, adicionarLinhaPlanilha, restaurarPlanilha, confirmarCopiaPlanilha, previewPlanilhaAberto, alternarKitsPlanilha } from './planilhaPreview.js';

import { config } from './configuracoes.js';
import { semEnvio, entregaDe, rotuloEntrega } from './entrega.js';
import { renderConfiguracoes } from './configuracoesTela.js';
import { abrirLinhasVeiculos } from './veiculosModal.js';

// Anexa todas as funções engatilhadas pelo HTML ao escopo Global (window)
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.loadJsonFile = loadJsonFile;
window.exportToJSON = exportToJSON;
window.salvarDestinatarioAtual = salvarDestinatarioAtual;
window.onSenderChange = onSenderChange;
window.onClientSelect = onClientSelect;
window.addItem = addItem;
window.removeItem = removeItem;
window.clearItems = clearItems;
window.buscarCep = buscarCep;

// Filtro do seletor "Selecionar do cadastro" no formulário do pedido
window.filtrarSeletorDestinatarios = function (termo) {
    popularSelectDestinatarios(window.__destinatariosSupabase || [], termo);
};

// Abas: Pedidos (quadro), o pedido aberto, Painel, Histórico e Cadastros
window.switchTab = function (tabName) {
    const modalPreview = document.getElementById('modal-preview');
    if (modalPreview) modalPreview.style.display = 'none';
    fecharMenuNovo();

    document.querySelectorAll('.tab-content').forEach(tab => { tab.style.display = 'none'; });
    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));

    const selectedTab = document.getElementById(tabName);
    if (selectedTab) selectedTab.style.display = 'block';
    // Destacar botão da aba (funciona também quando chamado via código)
    document.querySelector(`.nav-tab[data-tab="${tabName}"]`)?.classList.add('active');

    if (tabName === 'tab-pedidos') carregarViewKanban();
    else if (tabName === 'tab-painel') iniciarPainel();
    else if (tabName === 'tab-historico') loadHistoricoView();
    else if (tabName === 'tab-dados') switchSubTab('sub-destinatarios'); // abre nos Destinatários
};


window.editDestinatario = function (idx) {
    const dests = window.__destinatariosSupabase || [];
    const d = dests[idx];
    if (!d) return;

    // Preenche os campos do MODAL com os dados existentes
    $('modal_dest_name').value = d.nome || '';
    $('modal_dest_doc').value = d.cpf_cnpj || '';
    $('modal_dest_addr1').value = d.endereco_linha1 || '';
    $('modal_dest_addr2').value = d.endereco_linha2 || '';
    $('modal_dest_phone').value = d.contato || '';

    // Guarda o ID para saber que é uma edição e não uma inserção
    window.__editingDestId = d.id;

    // Exibe o modal
    const modal = document.getElementById('modal-edit-dest');
    modal.style.display = 'flex';
};

window.fecharModalEdit = function () {
    document.getElementById('modal-edit-dest').style.display = 'none';
    window.__editingDestId = null;
};

window.salvarModalEdit = async function () {
    const nome = $('modal_dest_name').value.trim();
    const doc = $('modal_dest_doc').value.trim();
    const addr1 = $('modal_dest_addr1').value.trim();
    const addr2 = $('modal_dest_addr2').value.trim();
    const phone = $('modal_dest_phone').value.trim();

    if (!nome || !addr1) {
        toast('Preencha pelo menos o Nome e o Endereço (Linha 1).', 'warning');
        return;
    }

    const id = window.__editingDestId;
    if (!id) return;

    // Usa o cliente Supabase configurado (não a biblioteca global)
    const { supabaseClient } = await import('./config.js');
    const { error } = await supabaseClient
        .from('destinatarios')
        .update({ nome, cpf_cnpj: doc, endereco_linha1: addr1, endereco_linha2: addr2, contato: phone })
        .eq('id', id);

    if (error) {
        toast('Erro ao atualizar: ' + error.message, 'error');
        return;
    }

    fecharModalEdit();

    // Recarrega a lista e o seletor do formulário do pedido
    const { carregarDestinatarios } = await import('./db.js');
    await carregarDestinatarios();
    loadDestinatariosList();
    toast('Destinatário atualizado.');
};

// Botão "Salvar Novo Destinatário" da aba Cadastros
window.saveNewDestinatario = async function () {
    const nome = $('new_dest_name').value.trim();
    if (!nome) { toast('Preencha pelo menos o Nome.', 'warning'); return; }

    const ok = await salvarOuAtualizarDestinatario({
        nome,
        cpf_cnpj: $('new_dest_doc').value.trim(),
        endereco_linha1: $('new_dest_addr1').value.trim(),
        endereco_linha2: $('new_dest_addr2').value.trim(),
        contato: $('new_dest_phone').value.trim()
    });
    if (ok) {
        ['new_dest_name', 'new_dest_doc', 'new_dest_phone', 'new_dest_cep', 'new_dest_addr1', 'new_dest_addr2']
            .forEach(id => { if ($(id)) $(id).value = ''; });
        loadDestinatariosList();
    }
};

// Pesquisa em tempo real na lista de destinatários
window.filtrarDestinatarios = function (termo) {
    const todos = window.__destinatariosSupabase || [];
    const lower = termo.toLowerCase();
    const filtrados = todos.filter(d =>
        (d.nome || '').toLowerCase().includes(lower) ||
        (d.cpf_cnpj || '').toLowerCase().includes(lower) ||
        (d.endereco_linha1 || '').toLowerCase().includes(lower)
    );
    renderListaDestinatarios(filtrados);
};

// Rende a lista de destinatários (aceita array filtrado ou completo)
function renderListaDestinatarios(arr) {
    const container = document.getElementById('destinatarios_list');
    if (!arr || arr.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum destinatário encontrado.</div>';
        return;
    }
    let html = '';
    arr.forEach((dest) => {
        const idx = (window.__destinatariosSupabase || []).indexOf(dest);
        html += `
            <div class="list-row">
                <div>
                    <div class="list-title">${escapeHtml(dest.nome)}</div>
                    <div class="list-meta">
                        ${dest.cpf_cnpj ? `${escapeHtml(dest.cpf_cnpj)}<br>` : ''}
                        ${dest.contato ? `<span class="contato">${escapeHtml(dest.contato)}</span><br>` : ''}
                        ${escapeHtml(dest.endereco_linha1)} ${dest.endereco_linha2 ? '&mdash; ' + escapeHtml(dest.endereco_linha2) : ''}
                    </div>
                </div>
                <div class="btn-group">
                    <button class="btn-sm btn-neutral" onclick="editDestinatario(${idx})">Editar</button>
                    <button class="btn-sm btn-danger" onclick="deleteDestinatario(${idx})">Deletar</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.loadHistoricoView = async function () {
    const container = document.getElementById('historico_list');
    container.innerHTML = '<div class="empty-state">Carregando...</div>';

    const pagina = await carregarHistorico(0);
    window.__historicoCache = pagina; // Cache para uso no modal e no filtro
    window.__historicoPagina = 0;
    window.__historicoTemMais = pagina.length === HISTORICO_POR_PAGINA;
    renderHistoricoLista();
};

// Busca os próximos 50 envios e acrescenta à lista
window.carregarMaisHistorico = async function (btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando...'; }
    const proxima = (window.__historicoPagina || 0) + 1;
    const pagina = await carregarHistorico(proxima);
    window.__historicoCache = (window.__historicoCache || []).concat(pagina);
    window.__historicoPagina = proxima;
    window.__historicoTemMais = pagina.length === HISTORICO_POR_PAGINA;
    renderHistoricoLista();
};

// Desenha a tabela do histórico aplicando o filtro digitado
window.renderHistoricoLista = function () {
    const container = document.getElementById('historico_list');
    const historico = window.__historicoCache || [];
    const termo = ($('historico_search')?.value || '').trim().toLowerCase();

    if (historico.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum envio encontrado no histórico.</div>';
        return;
    }

    const filtrados = termo
        ? historico.filter(r => [r.destinatario, r.unidade, r.referencia].join(' ').toLowerCase().includes(termo))
        : historico;

    if (filtrados.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum envio corresponde ao filtro.</div>';
        return;
    }

    const selo = (feito, label) => `<span class="status-badge${feito ? ' done' : ''}">${label}</span>`;

    let html = '<table class="data-table"><thead><tr>';
    html += '<th>Data</th><th>Destinatário / Unidade</th><th>Ref.</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    filtrados.forEach(reg => {
        const data = new Date(reg.created_at).toLocaleString('pt-BR');
        const st = reg.status || {};

        html += `<tr class="clickable" onclick="abrirDetalheHistorico('${reg.id}')">
            <td class="col-date">${data}</td>
            <td>
                <strong>${escapeHtml(reg.destinatario)}</strong>
                ${reg.unidade && reg.unidade !== reg.destinatario ? `<br><small>${escapeHtml(reg.unidade)}</small>` : ''}
            </td>
            <td class="col-ref">${escapeHtml(reg.referencia) || '—'}</td>
            <td>
                <div class="status-badges">
                    <span class="fase-badge fase-${escapeHtml(reg.fase)}">${escapeHtml(rotuloFase(reg.fase))}</span>
                    ${selo(st.email, 'E-mail')}${selo(st.romaneio, 'Romaneio')}${selo(st.etiqueta, 'Etiqueta')}
                </div>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    html += `<div class="empty-state" style="padding:14px;">
        ${termo ? `${filtrados.length} de ${historico.length} envios carregados &middot; ` : ''}
        ${window.__historicoTemMais
            ? '<button class="btn-sm btn-neutral" onclick="carregarMaisHistorico(this)">Carregar mais antigos</button>'
            : `${historico.length} envio(s) no total`}
    </div>`;
    container.innerHTML = html;
};

// --- PEDIDO ABERTO: passos e situação (coluna ao lado do formulário) ---

// Pedido despachado ou entregue já saiu: os itens não mudam mais
const FASES_ENVIADO = ['despachado', 'entregue'];
const podeEditarItens = reg => !!reg?.dados_completos && reg.fase !== 'cancelado' && !FASES_ENVIADO.includes(reg.fase);

// Registro do quadro do pedido aberto (null enquanto é pedido novo ou rascunho)
function pedidoAberto() {
    const id = AppState.currentHistoricoId;
    if (!id) return null;
    return acharPedido(id) || (String(AppState.regAberto?.id) === String(id) ? AppState.regAberto : null);
}

// Já saiu, foi cancelado ou é registro antigo sem os dados do formulário: abre só para leitura
const somenteLeitura = () => { const reg = pedidoAberto(); return !!reg && !podeEditarItens(reg); };

// Aplica campos no pedido em todas as listas (quadro, histórico, painel) e no pedido aberto
function aplicarNoPedido(id, campos) {
    atualizarCaches(id, campos);
    if (String(AppState.regAberto?.id) === String(id)) Object.assign(AppState.regAberto, campos);
}

// Relê o pedido aberto do banco (depois de salvar ou registrar uma etapa)
async function recarregarPedidoAberto() {
    const id = AppState.currentHistoricoId;
    if (!id) return null;
    const reg = await carregarPedido(id);
    if (!reg) return null;
    atualizarCaches(id, reg);
    AppState.regAberto = acharPedido(id) || reg;
    return reg;
}

const tituloLateral = t => `<div class="lateral-titulo">${t}</div>`;

// Só troca o HTML da coluna quando ele muda: redesenhar a cada tecla (ou no "change" de quando um
// campo perde o foco) trocaria o botão debaixo do mouse no meio do clique, e o clique se perderia
function pintar(el, html) {
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
}

// Passos na ordem do quadro: pedir NF, imprimir, planilhas, despachar
function renderPassos() {
    const el = $('editor_passos');
    if (!el) return;
    const d = collectData();
    const reg = pedidoAberto();
    const st = reg?.status || {};
    const leitura = somenteLeitura();
    const sem = semEnvio(d);
    const id = reg?.id;

    // O ✓ de cada etapa: marca ou desmarca à mão (só depois que o pedido está no quadro)
    const marca = (campo, feito, rotulo) => id && !leitura
        ? `<button type="button" class="passo-marca${feito ? ' feito' : ''}" onclick="alternarEtapa('${campo}')" title="Clique para marcar ou desmarcar à mão">${feito ? '✓' : '○'} ${rotulo}</button>`
        : `<span class="passo-marca${feito ? ' feito' : ''}">${feito ? '✓' : '○'} ${rotulo}</span>`;
    const passo = (n, nome, feito, corpo) => `
        <div class="passo${feito ? ' feito' : ''}">
            <div class="passo-topo"><span class="passo-num">${feito ? '✓' : n}</span>${nome}</div>
            ${corpo}
        </div>`;

    const nf = sem
        ? passo(1, 'Pedir NF ao financeiro', false, `<div class="passo-nota">Não precisa: ${escapeHtml(rotuloEntrega(entregaDe(d)))}.</div>`)
        : passo(1, 'Pedir NF ao financeiro', !!st.email, `
            <div class="passo-marcas">${marca('email', !!st.email, 'E-mail enviado')}</div>
            ${leitura ? '' : `<div class="passo-acoes">
                <button type="button" onclick="enviarEmailViaMailtoUsingData()">Enviar e-mail</button>
                <button type="button" class="btn-neutral" onclick="copyEmailBody()" title="Só copia o texto do e-mail, sem registrar o envio">Copiar texto</button>
            </div>`}`);

    const impresso = sem ? !!st.romaneio : !!(st.romaneio && st.etiqueta);
    const imprimir = passo(2, 'Imprimir', impresso, `
        <div class="passo-marcas">${marca('romaneio', !!st.romaneio, 'Romaneio')}${sem ? '' : marca('etiqueta', !!st.etiqueta, 'Etiqueta')}</div>
        <div class="passo-acoes">
            <button type="button" onclick="imprimir('romaneio')">Romaneio</button>
            ${sem ? '' : `<button type="button" onclick="imprimir('etiqueta')">Etiqueta</button>
            <button type="button" class="btn-neutral" onclick="imprimir('ambos')">Os dois</button>`}
        </div>
        ${leitura ? '' : '<button type="button" class="link-btn" onclick="preVisualizar()">Pré-visualizar sem registrar</button>'}`);

    const planilhas = passo(3, 'Planilhas', false, `
        <div class="passo-acoes">
            <button type="button" class="btn-neutral" onclick="copiarParaPlanilha()" title="Linhas no padrão da planilha de controle, para conferir, editar e copiar">Linhas p/ Planilha</button>
            <button type="button" class="btn-neutral" onclick="copiarParaVeiculos()" title="Um veículo por rastreador, no padrão da planilha de importação de veículos da plataforma">Linhas p/ Veículos</button>
        </div>`);

    const saiu = !!reg && FASES_ENVIADO.includes(reg.fase);
    const dataSaida = reg?.despachado_em ? ` em ${new Date(reg.despachado_em).toLocaleDateString('pt-BR')}` : '';
    const despachar = passo(4, sem ? 'Entregar' : 'Despachar', saiu, saiu
        ? `<div class="passo-nota">${reg.fase === 'entregue' ? 'Entregue' : 'Despachado'}${dataSaida}.</div>`
        : reg?.fase === 'cancelado' ? '<div class="passo-nota">Pedido cancelado.</div>'
        : id ? `<div class="passo-acoes"><button type="button" onclick="mudarFaseDoPedido('despachado')">${sem ? 'Marcar entregue' : 'Despachar'}</button></div>`
        : '<div class="passo-nota">Fica disponível depois do e-mail ou da impressão.</div>');

    pintar(el, `${tituloLateral('Próximos passos')}
        <div class="small">${leitura ? 'Só leitura: dá para imprimir de novo e copiar as linhas.' : 'O e-mail e a impressão salvam o pedido antes.'}</div>
        ${nf}${imprimir}${planilhas}${despachar}`);
}

function seletorPreparo(chave, dados) {
    return `<div class="situacao-linha"><span class="situacao-rotulo">Configuração</span>
        <select onchange="mudarPreparoDoPedido('${chave}', this.value)">
            ${ETAPAS_PREPARO.map(e => `<option value="${e.chave}"${e.chave === preparoDe(dados) ? ' selected' : ''}>${e.rotulo}</option>`).join('')}
        </select></div>`;
}

// Faz a próxima pintura da coluna Situação redesenhar mesmo com o mesmo HTML (os seletores voltam ao gravado)
function esquecerSituacao() {
    const el = $('editor_situacao');
    if (el) el._html = null;
}

// Fase, configuração, rastreio/frete, junção e cancelar
function renderSituacao() {
    const el = $('editor_situacao');
    if (!el) return;
    const reg = pedidoAberto();
    const draftId = AppState.currentDraftId;

    if (!reg) {
        if (!draftId) {
            pintar(el, `${tituloLateral('Situação')}<div class="small">Pedido novo, ainda não salvo. Ao salvar, ele vira um card na coluna Rascunho do quadro.</div>`);
            return;
        }
        const r = (window.__rascunhosCache || []).find(x => String(x.id) === String(draftId));
        pintar(el, `${tituloLateral('Situação')}
            <div class="situacao-linha"><span class="situacao-rotulo">Fase</span><span class="fase-badge">Rascunho</span></div>
            ${seletorPreparo('r:' + draftId, { preparo: AppState.extrasEnvio?.preparo || r?.dados_completos?.preparo })}
            ${r ? `<div class="small">Criado em ${new Date(r.created_at).toLocaleString('pt-BR')}</div>` : ''}
            <div class="situacao-acoes"><button type="button" class="btn-sm btn-danger" onclick="excluirRascunhoAberto()">Excluir rascunho</button></div>`);
        return;
    }

    const id = reg.id;
    const cancelado = reg.fase === 'cancelado';
    const sem = semEnvio(reg.dados_completos);

    // Junção de pedidos: este foi absorvido por outro envio, ou absorveu outros
    const mesclados = reg.dados_completos?.mesclados || [];
    let juncaoInfo = '';
    if (reg.mesclado_em) {
        const destino = acharPedido(reg.mesclado_em);
        juncaoInfo = `<div class="detalhe-juncao">🔗 Juntado ao envio
            <a href="#" onclick="event.preventDefault(); abrirPedido('h:${reg.mesclado_em}')">${escapeHtml(destino ? (destino.referencia || destino.destinatario) : '#' + reg.mesclado_em)}</a>
            — os itens seguiram nele.</div>`;
    } else if (mesclados.length) {
        const separavel = podeEditarItens(reg);
        juncaoInfo = `<div class="detalhe-juncao">🔗 Inclui os pedidos:
            ${mesclados.map((m, i) => `<div class="detalhe-juncao-item">
                <span>${escapeHtml(m.referencia || m.unidade || 'sem referência')}${m.itens ? ` &middot; ${m.itens.length} item(ns)` : ''}</span>
                ${separavel && podeSeparar(m)
                    ? `<button class="btn-sm btn-neutral" onclick="separarPedidoAberto(${i})" title="Tira os itens deste pedido e devolve um card próprio a ele">Separar</button>`
                    : ''}
            </div>`).join('')}
        </div>`;
    }

    pintar(el, `${tituloLateral('Situação')}
        <div class="situacao-linha"><span class="situacao-rotulo">Fase</span>
            ${cancelado
                ? '<span class="fase-badge fase-cancelado">Cancelado</span>'
                : `<select onchange="mudarFaseDoPedido(this.value)">
                    ${FASES.map(f => `<option value="${f.chave}"${f.chave === reg.fase ? ' selected' : ''}>${f.rotulo}</option>`).join('')}
                   </select>`}
        </div>
        ${seletorPreparo('h:' + id, reg.dados_completos)}
        ${sem
            ? `<div class="situacao-linha"><span class="situacao-rotulo">Saída</span><span>${escapeHtml(rotuloEntrega(entregaDe(reg.dados_completos)))}</span></div>`
            : `<div class="situacao-linha"><span class="situacao-rotulo">Rastreio</span><span>${escapeHtml(reg.rastreio) || '—'}</span></div>
               <div class="situacao-linha"><span class="situacao-rotulo">Frete</span><span>${reg.frete != null ? 'R$ ' + formatarFrete(reg.frete) : '—'}</span></div>
               <div class="situacao-acoes">
                   <button type="button" class="btn-sm btn-neutral" onclick="editarRastreioDoPedido()">Editar rastreio e frete</button>
                   ${FASES_ENVIADO.includes(reg.fase) ? `<button type="button" class="btn-sm btn-neutral" onclick="pedirPixFrete('${id}')">Pedir PIX do frete</button>` : ''}
               </div>`}
        ${juncaoInfo}
        <div class="small" style="margin-top:12px;">Criado em ${new Date(reg.created_at).toLocaleString('pt-BR')}${reg.dados_completos ? '' : ' · registro antigo, só com os dados básicos'}</div>
        <div class="situacao-acoes">
            ${cancelado
                ? '<button type="button" class="btn-sm btn-neutral" onclick="reativarPedidoAberto()">Reativar pedido</button>'
                : '<button type="button" class="btn-sm btn-danger" onclick="cancelarPedidoAberto()">Cancelar pedido</button>'}
        </div>`);
}

// Marca ou desmarca à mão uma etapa (e-mail, romaneio, etiqueta) do pedido aberto
window.alternarEtapa = async function (campo) {
    const reg = pedidoAberto();
    if (!reg) return;
    const novoStatus = { email: false, etiqueta: false, romaneio: false, ...(reg.status || {}) };
    novoStatus[campo] = !novoStatus[campo];
    const resultado = await atualizarStatusHistorico(reg, novoStatus);
    if (!resultado) { toast('Não foi possível gravar. Verifique a conexão.', 'error'); return; }
    aplicarNoPedido(reg.id, { status: novoStatus, fase: resultado.fase, fase_em: resultado.fase_em });
    atualizarEditor();
    await avisarProntoSemNF(reg.id, resultado, semEnvio(reg.dados_completos));
    atualizarEditor();
};

window.mudarFaseDoPedido = async function (fase) {
    const reg = pedidoAberto();
    if (!reg) return;
    esquecerSituacao(); // o seletor precisa voltar à fase gravada se a mudança for cancelada
    // Despachar trava os itens: o que foi digitado precisa ser gravado antes
    if (fase !== reg.fase && !somenteLeitura() && formularioAlterado()) {
        const salvar = await confirmar({
            titulo: 'Salvar antes de mudar a fase?',
            mensagem: 'O pedido tem alterações que ainda não foram salvas.',
            sim: 'Salvar e continuar',
            nao: 'Voltar'
        });
        if (!salvar || !(await salvarPedido())) { atualizarEditor(); return; }
    }
    await moverPedidoPara(reg.id, fase);
    if (String(AppState.regAberto?.id) === String(reg.id) && AppState.regAberto !== acharPedido(reg.id)) {
        await recarregarPedidoAberto();
    }
    atualizarEditor(); // mostra a fase gravada (ou a anterior, se cancelou/falhou)
};

window.mudarPreparoDoPedido = async function (chave, preparo) {
    esquecerSituacao();
    await definirPreparo(chave, preparo);
    renderSituacao(); // mostra a etapa gravada (ou a anterior, se falhou)
};

window.editarRastreioDoPedido = async function () {
    const reg = pedidoAberto();
    if (!reg) return;
    const despacho = await pedirDadosDespacho(reg);
    if (!despacho) return;
    if (await atualizarDespacho(reg.id, despacho)) {
        aplicarNoPedido(reg.id, despacho);
        renderSituacao();
    } else {
        toast('Não foi possível salvar o rastreio e o frete.', 'error');
    }
};

window.pedirPixFrete = id => abrirPixFrete(acharPedido(id) || pedidoAberto());

window.cancelarPedidoAberto = async function () {
    const reg = pedidoAberto();
    if (!reg) return;
    const alterado = !somenteLeitura() && formularioAlterado();
    const ok = await confirmar({
        titulo: 'Cancelar este pedido?',
        mensagem: `"${reg.destinatario}" sai do quadro de Pedidos, mas continua no Histórico e pode ser reativado depois.`,
        detalhe: alterado ? 'As alterações não salvas no formulário serão descartadas.' : '',
        tipo: 'perigo',
        sim: 'Cancelar pedido',
        nao: 'Manter pedido'
    });
    if (!ok) return;
    if (await cancelarPedido(reg.id)) {
        aplicarNoPedido(reg.id, { fase: 'cancelado', fase_em: new Date().toISOString() });
        toast('Pedido cancelado.');
        // Volta o formulário ao que está gravado (agora só leitura)
        abrirPedidoGravado(reg);
    } else {
        toast('Não foi possível cancelar o pedido.', 'error');
    }
};

// Volta para a fase que as ações já feitas indicam
window.reativarPedidoAberto = async function () {
    const reg = pedidoAberto();
    if (!reg) return;
    if (await moverPedidoPara(reg.id, faseSugerida(reg.status, semEnvio(reg.dados_completos)), { mesclado_em: null })) {
        toast(`Pedido reativado em "${rotuloFase(pedidoAberto()?.fase)}".`);
    }
    atualizarEditor();
};

// Desfaz a junção de um pedido: os itens dele saem deste e ele volta a ter card próprio
window.separarPedidoAberto = async function (idx) {
    const reg = pedidoAberto();
    const m = reg?.dados_completos?.mesclados?.[idx];
    if (!m) return;
    if (formularioAlterado()) {
        toast('Salve as alterações do pedido antes de separar.', 'warning', 6000);
        return;
    }
    const ok = await confirmar({
        titulo: `Separar ${m.referencia || 'este pedido'}?`,
        mensagem: `${m.itens.length} item(ns) saem de "${reg.referencia || reg.destinatario}" e voltam para um card próprio no quadro.`,
        detalhe: reg.status?.email ? 'O e-mail com tudo junto já foi enviado: avise o financeiro da separação.' : '',
        tipo: 'aviso',
        sim: 'Separar',
        nao: 'Cancelar'
    });
    if (!ok) return;
    if (await separarPedido(reg, idx)) toast(`${m.referencia || 'Pedido'} separado.`);
    // Recarrega o formulário com os itens que ficaram
    const novo = await carregarPedido(reg.id);
    if (novo) { atualizarCaches(novo.id, novo); abrirPedidoGravado(acharPedido(novo.id) || novo); }
};

window.excluirRascunhoAberto = async function () {
    const id = AppState.currentDraftId;
    if (!id || !(await deletarPendente(id))) return;
    limparEditor();
    window.switchTab('tab-pedidos');
    toast('Rascunho excluído.');
};

// Carregar e exibir lista de destinatários
window.loadDestinatariosList = function () {
    const destinatariosSupabase = window.__destinatariosSupabase || [];
    // Respeita o filtro de pesquisa ativo
    const termo = $('dest_search')?.value || '';
    if (termo) {
        filtrarDestinatarios(termo);
    } else {
        renderListaDestinatarios(destinatariosSupabase);
    }
};

// Deletar destinatário com confirmação e chamada ao Supabase
window.deleteDestinatario = async function (idx) {
    const dests = window.__destinatariosSupabase || [];
    const d = dests[idx];
    if (!d) return;
    const ok = await confirmar({
        titulo: 'Deletar este destinatário?',
        mensagem: `"${d.nome}" sai do cadastro. Envios já feitos não mudam.`,
        tipo: 'perigo',
        sim: 'Deletar',
        nao: 'Manter'
    });
    if (!ok) return;

    const { supabaseClient } = await import('./config.js');
    const { error } = await supabaseClient
        .from('destinatarios')
        .delete()
        .eq('id', d.id);

    if (error) {
        toast('Erro ao deletar: ' + error.message, 'error');
        return;
    }

    const { carregarDestinatarios } = await import('./db.js');
    await carregarDestinatarios();
    loadDestinatariosList();
};


// --- EDITOR DO PEDIDO ---
// Um pedido existe em um lugar só: rascunho (pedidos_pendentes) até o primeiro e-mail, impressão ou
// arrasto no quadro; depois, só no quadro (historico). "Salvar" grava sempre no lugar certo.
window.AppState = AppState;
AppState.currentDraftId = null;     // rascunho aberto no editor
AppState.currentHistoricoId = null; // pedido do quadro aberto no editor
AppState.regAberto = null;          // registro do pedido aberto (quando não está nas listas carregadas)
AppState.editorAberto = false;

// Grava o envio no quadro marcando as etapas feitas (e-mail, romaneio, etiqueta).
// O rascunho, se havia, deixa de existir: a partir daqui o pedido fica só no quadro.
// Retorna o id do pedido, ou null se falhou.
async function registrarEnvio(dados, etapas) {
    const resultado = await registrarNoHistorico(dados, AppState.currentHistoricoId, etapas);
    if (!resultado) {
        toast('Não foi possível salvar o pedido. Verifique a conexão.', 'error', 5000);
        return null;
    }
    const { id } = resultado;
    const novo = !AppState.currentHistoricoId;
    AppState.currentHistoricoId = String(id);
    if (AppState.currentDraftId) {
        await deletarPendente(AppState.currentDraftId, false);
        AppState.currentDraftId = null;
    }
    await recarregarPedidoAberto();
    marcarFormularioSalvo();
    atualizarEditor();
    toast(novo ? 'Pedido salvo e colocado no quadro.' : 'Pedido salvo.');

    // Impresso antes da NF: avança mesmo assim, mas avisa e permite voltar
    await avisarProntoSemNF(id, resultado, semEnvio(dados));
    atualizarEditor();
    return id;
}

// Barra do topo (título, fase, salvo/não salvo) e o botão do pedido aberto no menu
function atualizarBarra() {
    const nav = $('nav_pedido_aberto');
    if (!AppState.editorAberto) {
        if (nav) nav.style.display = 'none';
        return;
    }
    const d = collectData();
    const reg = pedidoAberto();
    const leitura = somenteLeitura();
    const alterado = !leitura && formularioAlterado();
    const salvoAntes = !!(reg || AppState.currentDraftId);

    const nome = d.dest_name.trim() || reg?.destinatario || '';
    const ref = d.reference_type !== 'none' && String(d.reference).trim()
        ? `${d.reference_type === 'os' ? 'OS' : 'Ticket'} ${String(d.reference).trim()}` : '';
    $('editor_titulo').textContent = [nome || 'Novo pedido', ref].filter(Boolean).join(' · ');

    const fase = reg?.fase || (AppState.currentDraftId ? 'rascunho' : '');
    const badge = $('editor_fase');
    badge.textContent = fase ? rotuloFase(fase) : 'Novo';
    badge.className = `fase-badge fase-${fase || 'novo'}`;

    const estado = $('editor_estado');
    estado.textContent = leitura
        ? (reg.fase === 'cancelado' ? '🔒 Cancelado: só leitura' : !reg.dados_completos ? '🔒 Registro antigo: só leitura' : '🔒 Já saiu: só leitura')
        : alterado ? (salvoAntes ? '● Alterações não salvas' : '● Ainda não salvo')
        : salvoAntes ? '✓ Tudo salvo' : '';
    estado.className = 'editor-estado' + (leitura ? ' leitura' : alterado ? ' alterado' : '');
    $('editor_barra').classList.toggle('alterado', alterado);
    $('btn_salvar').disabled = leitura || !alterado;
    $('btn_salvar').style.display = leitura ? 'none' : ''; // só leitura: não há o que salvar
    $('editor_campos').disabled = leitura;

    if (nav) {
        nav.style.display = '';
        const curto = nome.length > 22 ? nome.slice(0, 21) + '…' : nome;
        nav.textContent = `✎ ${curto || 'Novo pedido'}${alterado ? ' ●' : ''}`;
    }
}

function atualizarEditor() {
    atualizarBarra();
    if (!AppState.editorAberto) return;
    renderPassos();
    renderSituacao();
}
// O quadro recarregou (outra aba, junção, mudança de fase): a coluna do pedido aberto acompanha
window.aoAtualizarPedidos = () => { if (AppState.editorAberto) atualizarEditor(); };

// Antes de carregar outra coisa no editor: não perde o que foi digitado sem perguntar
async function podeTrocarFormulario(mensagem = 'O pedido aberto tem alterações que ainda não foram salvas e elas serão perdidas.') {
    if (!AppState.editorAberto || somenteLeitura() || !formularioAlterado()) return true;
    return confirmar({
        titulo: 'Descartar alterações não salvas?',
        mensagem,
        tipo: 'aviso',
        sim: 'Descartar e continuar',
        nao: 'Voltar'
    });
}

// O que muda no que já saiu para o papel ou para o financeiro
const qtdsDosItens = itens => JSON.stringify((itens || []).map(it => [it.desc, String(it.qty)]));
const numerosDosItens = itens => JSON.stringify((itens || []).map(it => (it.imeis || []).map(im => [im.imei, im.rastreador, im.teclado])));

// Depois de salvar: romaneio impresso e pedido de NF podem ter ficado com dados antigos
async function orientarDocumentosDesatualizados(reg, dados) {
    if (!reg?.dados_completos) return;
    const itensAntes = reg.dados_completos.items;
    const quantidadeMudou = qtdsDosItens(itensAntes) !== qtdsDosItens(dados.items);
    const itensMudaram = quantidadeMudou || numerosDosItens(itensAntes) !== numerosDosItens(dados.items);
    const emailDesatualizado = reg.status?.email && quantidadeMudou;
    const avisoEmail = emailDesatualizado
        ? 'O e-mail ao financeiro foi enviado com os itens antigos: avise o financeiro antes da emissão da NF.' : '';

    if (reg.status?.romaneio && itensMudaram) {
        const gerar = await confirmar({
            titulo: 'Romaneio impresso ficou desatualizado',
            mensagem: `Os itens mudaram depois da impressão. Imprima o romaneio de novo e troque a via em papel.${avisoEmail ? `\n\n${avisoEmail}` : ''}`,
            tipo: 'aviso',
            sim: 'Imprimir romaneio agora',
            nao: 'Fazer depois'
        });
        if (gerar) await window.imprimir('romaneio');
    } else if (avisoEmail) {
        toast(avisoEmail, 'warning');
    }
}

// Dados do envio que não têm campo no formulário e precisam sobreviver a "Salvar"
function extrasDoEnvio(dados) {
    const extras = {};
    if (dados?.origem) extras.origem = dados.origem;
    if (dados?.montar_kits !== undefined) extras.montar_kits = dados.montar_kits;
    if (dados?.rascunho_em) extras.rascunho_em = dados.rascunho_em;
    if (dados?.preparo) extras.preparo = dados.preparo;
    // Junção já gravada: o próximo e-mail ainda precisa citar os pedidos substituídos
    if (dados?.mesclados?.length) extras.mesclados = dados.mesclados;
    if (dados?.nf_anterior) extras.nf_anterior = dados.nf_anterior;
    if (dados?.origens_estoque?.length) extras.origens_estoque = dados.origens_estoque;
    return extras;
}

// Registro antigo, anterior ao formulário completo: monta o que dá a partir das colunas
const dadosBasicos = reg => ({
    sender_company: reg.remetente || '', dest_name: reg.destinatario || '', unit_name: reg.unidade || '',
    reference: reg.referencia || '', carrier: reg.transportadora || '', items: reg.itens || [], client_mode: 'single'
});

// Põe os dados no editor e abre a aba do pedido.
// novo: ainda não está gravado em lugar nenhum (o que veio conta como não salvo)
function carregarNoEditor(dados, { draftId = null, historicoId = null, reg = null, rascunhoEm = null, novo = false } = {}) {
    limparFormulario();
    preencherFormulario(dados);
    AppState.currentDraftId = draftId ? String(draftId) : null;
    AppState.currentHistoricoId = historicoId ? String(historicoId) : null;
    AppState.regAberto = reg;
    AppState.juncaoPendente = [];
    AppState.extrasEnvio = novo ? {} : { ...extrasDoEnvio(dados), ...(rascunhoEm ? { rascunho_em: rascunhoEm } : {}) };
    AppState.editorAberto = true;
    if (!novo) marcarFormularioSalvo();
    atualizarPendencias();
    atualizarEditor();
    window.switchTab('tab-romaneio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Pedido do quadro, como está gravado (usa o rascunho ligado a ele, de versões anteriores, se houver)
function abrirPedidoGravado(reg) {
    const draftId = rascunhoDoPedido(reg.id);
    const draft = draftId && (window.__rascunhosCache || []).find(r => String(r.id) === String(draftId));
    const dados = (podeEditarItens(reg) && draft?.dados_completos) || reg.dados_completos || dadosBasicos(reg);
    carregarNoEditor(dados, { draftId: draft && podeEditarItens(reg) ? draftId : null, historicoId: reg.id, reg, rascunhoEm: draft?.created_at });
}

// Abre um pedido no editor. chave: 'r:<id>' (rascunho) ou 'h:<id>' (pedido do quadro)
window.abrirPedido = async function (chave) {
    const id = String(chave).slice(2);
    const rascunho = String(chave).startsWith('r:');
    const jaAberto = AppState.editorAberto && (rascunho ? AppState.currentDraftId === id : AppState.currentHistoricoId === id);
    if (jaAberto) { window.switchTab('tab-romaneio'); return; }
    if (!(await podeTrocarFormulario())) return;

    if (rascunho) {
        const r = (window.__rascunhosCache || []).find(x => String(x.id) === id);
        if (!r) { toast('Rascunho não encontrado. Atualize o quadro.', 'warning'); return; }
        const hid = r.dados_completos?.historico_id;
        const reg = hid ? acharPedido(hid) : null;
        if (reg) { abrirPedidoGravado(reg); return; }
        carregarNoEditor(r.dados_completos, { draftId: id, rascunhoEm: r.created_at });
        return;
    }
    const reg = acharPedido(id) || await carregarPedido(id);
    if (!reg) { toast('Não foi possível abrir o pedido.', 'error'); return; }
    abrirPedidoGravado(reg);
};
// Nomes antigos (painel, histórico e kanban chamam por eles)
window.abrirDetalheHistorico = id => window.abrirPedido('h:' + id);
window.editarRascunho = id => window.abrirPedido('r:' + id);

// O botão Salvar: rascunho enquanto não saiu nenhum passo; depois, o próprio pedido do quadro
window.salvarPedido = async function () {
    if (!AppState.editorAberto) return false;
    if (somenteLeitura()) { toast('Pedido já enviado ou cancelado: não dá para alterar.', 'warning'); return false; }
    const dados = collectData();
    if (!dados.items.length) { toast('Adicione pelo menos um item antes de salvar.', 'warning'); return false; }

    const id = AppState.currentHistoricoId;
    if (!id) {
        const salvo = await salvarPendente(dados, AppState.currentDraftId, true);
        if (!salvo) return false;
        const novo = !AppState.currentDraftId;
        AppState.currentDraftId = String(salvo.id);
        // O pedido guarda quando o rascunho nasceu (a data de criação do registro no quadro é outra)
        AppState.extrasEnvio = { rascunho_em: salvo.created_at, ...(AppState.extrasEnvio || {}) };
        marcarFormularioSalvo();
        atualizarEditor();
        toast(novo ? 'Pedido salvo como rascunho: ele está na coluna Rascunho do quadro.' : 'Rascunho salvo.');
        return true;
    }

    // Confere no banco: o pedido pode ter sido despachado em outra aba ou aparelho
    const fase = await faseDoPedido(id);
    if (fase === null) { toast('Não foi possível conferir o pedido. Verifique a conexão.', 'error', 5000); return false; }
    if (FASES_ENVIADO.includes(fase) || fase === 'cancelado') {
        toast(`Pedido em "${rotuloFase(fase)}": os itens não podem mais ser alterados.`, 'warning', 6000);
        await recarregarPedidoAberto();
        atualizarEditor();
        return false;
    }
    const regAntes = pedidoAberto();
    const antes = regAntes ? { dados_completos: regAntes.dados_completos, status: regAntes.status } : null;
    if (!(await registrarNoHistorico(dados, id))) { toast('Não foi possível salvar o pedido.', 'error', 5000); return false; }
    // Rascunho ligado ao pedido (versões anteriores): o pedido passa a ser o único lugar
    if (AppState.currentDraftId) {
        await deletarPendente(AppState.currentDraftId, false);
        AppState.currentDraftId = null;
    }
    await recarregarPedidoAberto();
    marcarFormularioSalvo();
    atualizarEditor();
    toast('Pedido salvo.');
    await orientarDocumentosDesatualizados(antes, dados);
    return true;
};

// Campo do formulário de cada pendência (destacado até ser preenchido)
const CAMPO_DA_PENDENCIA = {
    'CPF/CNPJ': 'dest_doc', 'Endereço': 'dest_addr1', 'Contato': 'dest_phone',
    'Referência': 'reference', 'Tipo': 'planilha_tipo', 'Volumes': 'total_vol'
};

// Envio importado da planilha de estoque: faixa com o que falta preencher à mão
function atualizarPendencias() {
    const banner = $('pendencias_banner');
    if (!banner) return;
    const importado = AppState.editorAberto && AppState.extrasEnvio?.origem?.perfil === 'estoque';
    const pendencias = importado ? pendenciasEnvio(collectData()) : [];

    Object.entries(CAMPO_DA_PENDENCIA).forEach(([nome, id]) =>
        $(id)?.classList.toggle('campo-pendente', pendencias.includes(nome)));

    banner.style.display = pendencias.length ? 'flex' : 'none';
    banner.innerHTML = pendencias.length
        ? `<span>⚠ Importado da planilha de estoque. Complete à mão: <b>${pendencias.join(', ')}</b>.</span>` : '';
}

// Esvazia o editor (nenhum pedido aberto)
function limparEditor() {
    limparFormulario();
    AppState.currentDraftId = null;
    AppState.currentHistoricoId = null;
    AppState.regAberto = null;
    AppState.juncaoPendente = [];
    AppState.editorAberto = false;
    $('editor_campos').disabled = false;
    atualizarPendencias();
    atualizarEditor();
}

window.novoPedido = async function () {
    fecharMenuNovo();
    if (!(await podeTrocarFormulario('O pedido aberto tem alterações que ainda não foram salvas. Ao começar outro, elas serão perdidas.'))) return;
    limparEditor();
    AppState.editorAberto = true;
    atualizarEditor();
    window.switchTab('tab-romaneio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.novoEnvio = window.novoPedido;

window.fecharPedido = async function () {
    if (!(await podeTrocarFormulario('O pedido tem alterações que ainda não foram salvas. Ao fechar, elas serão perdidas.'))) return;
    limparEditor();
    window.switchTab('tab-pedidos');
};

// Menu "+ Novo pedido" do quadro: em branco, da planilha de estoque ou da planilha de controle
function fecharMenuNovo() {
    const m = $('menu_novo');
    if (m) m.style.display = 'none';
}
window.fecharMenuNovo = fecharMenuNovo;
window.alternarMenuNovo = function (ev) {
    ev.stopPropagation();
    const m = $('menu_novo');
    if (m) m.style.display = m.style.display === 'none' ? 'flex' : 'none';
};


// --- KIT NO FORMULÁRIO ---
// Monta kits com os itens do formulário (confere na tela "Montar kit" antes)
window.montarKitNoFormulario = async function () {
    const d = collectData();
    if (!d.items.length) { toast('Adicione os itens primeiro.', 'warning'); return; }
    const escolha = await abrirMontarKit(d.items, { rotuloRef: d.reference_type === 'ticket' ? 'Ticket' : 'OS' });
    if (!escolha) return;
    preencherFormulario({ ...d, items: montarKit(d.items, escolha) });
    toast(`${totalKits(escolha.kitsPorRef)} ${escolha.nome} montado(s). Confira os itens.`);
};

// Volta os kits montados pelo programa aos componentes
window.desmontarKitNoFormulario = async function () {
    const d = collectData();
    const kits = d.items.filter(it => it.kit?.componentes);
    if (!kits.length) { toast('Nenhum kit montado pelo programa neste envio.', 'warning'); return; }
    const ok = await confirmar({
        titulo: 'Desmontar o kit?',
        mensagem: `${kits.map(k => `${k.qty} x ${k.desc}`).join(', ')}\n\nOs componentes voltam como itens separados.`,
        sim: 'Desmontar',
        nao: 'Manter kit'
    });
    if (!ok) return;
    let items = d.items;
    for (let i = items.findIndex(it => it.kit?.componentes); i >= 0; i = items.findIndex(it => it.kit?.componentes)) {
        items = desmontarKit(items, i);
    }
    preencherFormulario({ ...d, items });
    toast('Kit desmontado. Confira os itens.');
};

// --- PLANILHA DE CONTROLE ---
// Os botões abrem um preview editável; a cópia acontece no botão "Copiar linhas" do modal
window.fecharPreviewPlanilha = () => fecharPreviewPlanilha();
window.alternarGrupoPlanilha = alternarGrupoPlanilha;
window.adicionarLinhaPlanilha = adicionarLinhaPlanilha;
window.restaurarPlanilha = restaurarPlanilha;
window.confirmarCopiaPlanilha = confirmarCopiaPlanilha;

window.alternarKitsPlanilha = alternarKitsPlanilha;

// aoMudarKits(montar): grava a escolha de "Montar kits" no envio de onde as linhas vieram
// reg: registro do histórico, para preencher datas, rastreio e frete
function abrirLinhas(dados, titulo, aoMudarKits, reg = null) {
    // Kit fica numa linha só por padrão; separado apenas se a pessoa desmarcar
    const marcado = dados.montar_kits !== false;
    const dataBR = data => data ? new Date(data).toLocaleDateString('pt-BR') : '';
    const envio = {
        // Criação do rascunho; envio sem rascunho usa a criação do registro (ou hoje, se ainda não foi salvo)
        recebimento: dataBR(dados.rascunho_em || reg?.created_at || Date.now()),
        // Só preenche depois que o pedido foi movido para "Despachado"
        dataEnvio: dataBR(reg?.despachado_em),
        rastreio: reg?.rastreio,
        frete: reg?.frete,
        recebido: reg?.fase === 'entregue' ? dataBR(reg.fase_em) : ''
    };
    const gerar = montar => gerarLinhasPlanilha(dados, { montarKits: montar, envio });
    const linhas = gerar(marcado);
    if (linhas.length === 0) { toast('Adicione pelo menos um item.', 'warning'); return; }
    const info = contarKits(dados);
    abrirPreviewPlanilha(linhas, titulo, info.kits ? { info, marcado, gerar, aoMudar: aoMudarKits } : null);
}

// Botão "Linhas p/ Planilha" do formulário
window.copiarParaPlanilha = function () {
    const d = collectData();
    const ref = d.reference_type !== 'none' && d.reference ? ` · ${d.reference_type === 'os' ? 'OS' : 'Ticket'} ${d.reference}` : '';
    abrirLinhas(d, `Linhas para a planilha${ref}`, async montar => {
        AppState.extrasEnvio = { ...(AppState.extrasEnvio || {}), montar_kits: montar };
        // Pedido já gravado guarda a escolha na hora; rascunho, se não houver outra alteração pendente;
        // senão ela vai junto no próximo Salvar
        if (AppState.currentHistoricoId) await gravarEscolhaKits(AppState.currentHistoricoId, montar);
        else if (AppState.currentDraftId && !formularioAlterado()) {
            if (await salvarPendente(collectData(), AppState.currentDraftId, true)) marcarFormularioSalvo();
        }
    }, pedidoAberto());
};

// Botão no detalhe do histórico
window.copiarPlanilhaDoHistorico = function (id) {
    const reg = acharPedido(id);
    if (!reg || !reg.dados_completos) {
        toast('Este registro antigo não tem os dados completos para gerar as linhas.', 'warning');
        return;
    }
    abrirLinhas(reg.dados_completos,
        `Linhas para a planilha · ${reg.destinatario || ''}`, async montar => {
            if (await gravarEscolhaKits(id, montar)) atualizarCaches(id, { dados_completos: { ...reg.dados_completos, montar_kits: montar } });
        }, reg);
};

// --- PLANILHA DE IMPORTAÇÃO DE VEÍCULOS (um veículo por rastreador) ---
window.copiarParaVeiculos = function () {
    const d = collectData();
    const ref = d.reference_type !== 'none' && d.reference ? ` · ${d.reference_type === 'os' ? 'OS' : 'Ticket'} ${d.reference}` : '';
    abrirLinhasVeiculos(d, `Linhas para a planilha de veículos${ref}`);
};

window.copiarVeiculosDoHistorico = function (id) {
    const reg = acharPedido(id);
    if (!reg || !reg.dados_completos) {
        toast('Este registro antigo não tem os dados completos para gerar as linhas.', 'warning');
        return;
    }
    abrirLinhasVeiculos(reg.dados_completos, `Linhas para a planilha de veículos · ${reg.destinatario || ''}`);
};

// --- IMPORTAR DA PLANILHA (processo inverso) ---
window.fecharImportarPlanilha = fecharImportarPlanilha;
window.novaBaseImportada = novaBaseImportada;
window.limparBaseImportada = limparBaseImportada;
window.escolherArquivoImportar = escolherArquivoImportar;
window.usarEnvioImportado = usarEnvioImportado;

const normNome = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Abre um pedido novo com um envio da planilha de controle. Retorna false se o usuário cancelar.
async function preencherComEnvioImportado(grupo) {
    if (!(await podeTrocarFormulario())) return false;

    // Remetente, transportadora etc. vêm do padrão de um pedido novo
    limparFormulario();
    const dados = grupoParaFormulario(grupo, collectData());

    // A planilha não tem CPF/CNPJ: busca no cadastro pelo nome do destinatário
    const cad = (window.__destinatariosSupabase || []).find(d => normNome(d.nome) === normNome(dados.dest_name));
    dados.dest_doc = cad?.cpf_cnpj || '';
    if (cad && !dados.dest_phone) dados.dest_phone = cad.contato || '';

    carregarNoEditor(dados, { novo: true });
    const ref = grupo.os ? `OS/Ticket ${grupo.os}` : 'o envio';
    toast(`Pedido aberto com ${ref}${cad ? ' (CPF/CNPJ do cadastro)' : ' (destinatário fora do cadastro: confira o CPF/CNPJ)'}. Confira e clique em Salvar.`,
        cad ? 'success' : 'warning', 7000);
    return true;
}

window.abrirImportarPlanilha = () => abrirImportarPlanilha(preencherComEnvioImportado);

// Confere os dados mínimos antes de gerar documentos ou e-mail.
// Erros bloqueiam; avisos perguntam se quer continuar.
async function validarAntesDeGerar(d) {
    if (d.items.length === 0) { toast('Adicione pelo menos um item.', 'warning'); return false; }
    // Retirada / instalação na Ranor não vai pelo correio: basta o nome, sem endereço nem volumes
    const sem = semEnvio(d);
    if (sem && !d.dest_name.trim()) {
        toast('Preencha o Nome do destinatário.', 'warning');
        return false;
    }
    if (!sem && (!d.dest_name.trim() || !d.dest_addr1.trim())) {
        toast('Preencha o Nome e o Endereço (linha 1) do destinatário.', 'warning');
        return false;
    }
    if (!sem && d.total_vol === '') {
        toast('Preencha o número de volumes.', 'warning');
        $('total_vol')?.focus();
        return false;
    }
    const avisos = [];
    if (!validarDoc(d.dest_doc)) avisos.push('- O CPF/CNPJ do destinatário parece inválido');
    if (d.reference_type !== 'none' && !d.reference.trim()) avisos.push('- O número da referência (Ticket/OS) está vazio');
    if (avisos.length) {
        return confirmar({
            titulo: 'Confira antes de continuar',
            mensagem: avisos.join('\n'),
            tipo: 'aviso',
            sim: 'Continuar mesmo assim',
            nao: 'Voltar e corrigir'
        });
    }
    return true;
}

// Documentos: um botão por documento (romaneio, etiqueta, os dois)
const TIPOS_DOC = { romaneio: 'romaneio', etiqueta: 'labels', ambos: 'both' };
const etapasDoDocumento = docType => ({
    ...(docType === 'labels' || docType === 'both' ? { etiqueta: true } : {}),
    ...(docType === 'romaneio' || docType === 'both' ? { romaneio: true } : {})
});

// Abre os documentos numa aba pronta para imprimir. false se o navegador bloqueou.
function abrirAbaImpressao(elementos) {
    const documentsHtml = elementos.map(el => el.outerHTML).join('');
    const linksHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href).filter(Boolean)
        .map(h => `<link rel="stylesheet" href="${h}">`).join('\n');
    const baseHref = location.origin + location.pathname;
    const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <base href="${baseHref}">
    <title>Documentos para Impressão</title>
    ${linksHtml}
    <style>
        body { margin: 0; padding: 0; background: #f3f3f3; }
        .page { page-break-before: always; break-before: page; }
        .page:first-child { page-break-before: avoid; break-before: avoid; }
        @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; page-break-after: always; } }
    </style>
</head>
<body><div style="padding: 16px;">${documentsHtml}</div></body>
</html>`;

    const win = window.open('', '_blank');
    if (!win) { toast('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo.', 'warning'); return false; }
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
    try { win.focus(); } catch (e) { }
    return true;
}

// Imprime e registra a etapa no pedido (salvando o que está no formulário)
window.imprimir = async function (tipo) {
    if (somenteLeitura()) { await imprimirDoRegistro(pedidoAberto(), tipo); return; }
    const dados = collectData();
    if (semEnvio(dados) && tipo !== 'romaneio') {
        toast('Retirada / instalação na Ranor não tem etiqueta. Imprima o romaneio.', 'warning');
        return;
    }
    if (!(await validarAntesDeGerar(dados))) return;
    const docType = TIPOS_DOC[tipo];
    dados.doc_type = docType;
    if (!abrirAbaImpressao(composeDocuments(dados, docType))) return;
    // Registra depois de abrir a aba (abrir precisa ser imediato para não cair no bloqueador)
    await registrarEnvio(dados, etapasDoDocumento(docType));
};

// Pedido já enviado: imprime de novo a partir do que está gravado
async function imprimirDoRegistro(reg, tipo) {
    if (!reg?.dados_completos) {
        toast('Este registro antigo não guardou os dados do envio: não dá para gerar o documento.', 'warning');
        return;
    }
    const docType = TIPOS_DOC[tipo];
    if (!abrirAbaImpressao(composeDocuments(reg.dados_completos, docType))) return;
    const etapas = etapasDoDocumento(docType);
    if (Object.keys(etapas).every(k => reg.status?.[k])) return;
    const novoStatus = { email: false, etiqueta: false, romaneio: false, ...(reg.status || {}), ...etapas };
    const resultado = await atualizarStatusHistorico(reg, novoStatus);
    if (resultado) {
        aplicarNoPedido(reg.id, { status: novoStatus, fase: resultado.fase, fase_em: resultado.fase_em });
        atualizarEditor();
    }
}

// Mostra os documentos e o e-mail numa janela, sem registrar nada
window.preVisualizar = async function () {
    const dados = collectData();
    if (!(await validarAntesDeGerar(dados))) return;
    const docType = semEnvio(dados) ? 'romaneio' : 'both';
    AppState.formData = dados;

    const previewDocuments = $('preview-documents');
    previewDocuments.innerHTML = '';
    composeDocuments(dados, docType).forEach(el => previewDocuments.appendChild(el));
    const previewEmail = $('preview-email');
    previewEmail.innerHTML = '';
    if (!semEnvio(dados)) previewEmail.appendChild(renderEmailPreview(dados));

    abrirModalPreview();
};

function copyEmailBody() {
    // Sempre gera a partir do formulário atual (não do último preview)
    const body = buildEmailBody(collectData());
    navigator.clipboard.writeText(body)
        .then(() => toast('Corpo do e-mail copiado.'))
        .catch(err => toast('Não foi possível copiar: ' + err, 'error'));
}

async function enviarEmailViaMailtoUsingData() {
    if (somenteLeitura()) return;
    const d = collectData();
    if (semEnvio(d)) {
        const pedir = await confirmar({
            titulo: 'Este pedido não precisa de NF',
            mensagem: `A forma de saída é "${rotuloEntrega(entregaDe(d))}": não pede nota fiscal ao financeiro.\n\nSe precisar de NF, mude a forma de saída para Transportadora.`,
            tipo: 'aviso',
            sim: 'Pedir NF mesmo assim',
            nao: 'Voltar'
        });
        if (!pedir) return;
    }
    if (!(await validarAntesDeGerar(d))) return;

    // Outro pedido do mesmo técnico sem NF? Oferece juntar antes de pedir a nota
    if (!(await verificarJuncao(d))) return;
    if (AppState.juncaoPendente.length) {
        d.mesclados = [...(d.mesclados || []), ...AppState.juncaoPendente];
        // Este pedido já tinha pedido NF: o e-mail avisa que ele também foi substituído
        const atual = AppState.currentHistoricoId ? acharPedido(AppState.currentHistoricoId) : null;
        if (atual?.status?.email && !d.nf_anterior) d.nf_anterior = { referencia: atual.referencia, unidade: atual.unidade };
    }

    // Confere (e edita, se precisar) o e-mail antes de abrir
    const conferido = await conferirEmail({ assunto: buildEmailSubject(d), corpo: buildEmailBody(d), avisos: avisosEmail(d) });
    if (!conferido) return;
    // E-mails do financeiro que recebem o pedido de nota fiscal (Cadastros > Configurações)
    const emails = config('financeiro_emails').join(';');
    const { assunto, corpo: body } = conferido;
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;
    const id = await registrarEnvio(d, { email: true });
    if (id) await finalizarJuncao(id);
}

function toggleReferenceInput() {
    const refType = $('reference_type')?.value || 'ticket';
    const refInput = $('reference');
    if (refType === 'none') {
        refInput.disabled = true;
        refInput.value = 'N/A';
        refInput.style.backgroundColor = '#f0f0f0';
    } else {
        refInput.disabled = false;
        if (refInput.value === 'N/A') refInput.value = '';
        refInput.style.backgroundColor = '';
    }
}

function toggleClientMode() {
    const items = document.querySelectorAll('.item-card');
    const isMulti = document.querySelector('input[name="client_mode"]:checked')?.value === 'multi';

    // Mostrar/ocultar campo de Cliente/Unidade (só no modo simples)
    const unitWrapper = document.getElementById('unit_field_wrapper');
    if (unitWrapper) {
        unitWrapper.style.display = isMulti ? 'none' : 'block';
    }

    items.forEach(card => {
        let clientInput = card.querySelector('.it-client');

        if (isMulti && !clientInput) {
            // Adicionar campo de cliente no item
            const descDiv = card.querySelector('div:first-child');
            const clientFieldHTML = `
                <div class="item-client">
                    <label>Cliente:</label>
                    <input class="it-client" type="text" placeholder="Ex: Martin Brower">
                </div>
            `;
            descDiv.insertAdjacentHTML('afterend', clientFieldHTML);
        } else if (!isMulti && clientInput) {
            // Remover campo de cliente do item
            clientInput.parentElement.remove();
        }
    });
}

function toggleIMEISection(btn) {
    const section = btn.closest('.item-card').querySelector('.it-imei-section');
    const isVisible = section.style.display !== 'none';
    section.style.display = isVisible ? 'none' : 'block';
}

// Função para selecionar item do autocomplete
window.selectItemSuggestion = function (element) {
    const card = element.closest('.item-card');
    const input = card.querySelector('.it-desc');
    const suggestionsDiv = card.querySelector('.autocomplete-suggestions');

    input.value = element.textContent.trim();
    suggestionsDiv.style.display = 'none';
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.copyEmailBody = copyEmailBody;
window.enviarEmailViaMailtoUsingData = enviarEmailViaMailtoUsingData;
window.toggleReferenceInput = toggleReferenceInput;
window.toggleClientMode = toggleClientMode;
window.toggleIMEISection = toggleIMEISection;

document.addEventListener('DOMContentLoaded', () => {
    // Escutando selectores iniciais
    $('sender_select').addEventListener('change', onSenderChange);
    $('client_select').addEventListener('change', onClientSelect);
    $('reference_type').addEventListener('change', toggleReferenceInput);

    // Inicialização Visual
    // Remetentes padrão até o login carregar as configurações (auth.js popula de novo)
    popularSelectRemetentes();
    onSenderChange();
    toggleReferenceInput();
    addItem(); // Adicionar um item padrão

    // Máscara + validação de CPF/CNPJ nos três formulários de destinatário
    ['dest_doc', 'new_dest_doc', 'modal_dest_doc'].forEach(id => ligarMascaraDoc($(id)));

    // Barra do pedido (salvo / não salvo), passos e pendências acompanham o que é digitado.
    // Só os campos do formulário: os seletores da coluna Situação redesenham a coluna sozinhos.
    ['input', 'change'].forEach(ev => $('editor_campos')?.addEventListener(ev, () => {
        atualizarPendencias();
        atualizarBarra();
        if (ev === 'change') renderPassos();
    }));

    // Ctrl+S salva o pedido aberto
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('tab-romaneio')?.style.display === 'block') {
            e.preventDefault();
            window.salvarPedido();
        }
    });

    // Fechar a página com alterações não salvas: o navegador pergunta antes
    window.addEventListener('beforeunload', e => {
        if (AppState.editorAberto && !somenteLeitura() && formularioAlterado()) { e.preventDefault(); e.returnValue = ''; }
    });

    // Clique fora do menu "+ Novo pedido" fecha o menu
    document.addEventListener('click', e => { if (!e.target.closest('.menu-novo')) fecharMenuNovo(); });

    // Auth pipeline init (Dispara checagem do Supabase e carrega BD se logado)
    checkSession();

    // Esc fecha qualquer modal aberto
    const aberto = (id) => $(id)?.style.display === 'flex';
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Fecha só o modal de cima (o da planilha pode estar aberto sobre o do histórico)
        if (juncaoAberta()) { fecharJuncao(); return; }
        if (importarEstoqueAberto()) { fecharImportarEstoque(); return; }
        if (previewPlanilhaAberto()) { fecharPreviewPlanilha(); return; }
        if (importarPlanilhaAberto()) { fecharImportarPlanilha(); return; }
        if (aberto('modal-preview')) fecharModalPreview();
        if (aberto('modal-edit-dest')) fecharModalEdit();
        fecharMenuNovo();
    });

    // Clique fora do card fecha o modal (não no de edição, para não perder o que foi digitado)
    [['modal-preview', () => fecharModalPreview()]]
        .forEach(([id, fechar]) => $(id)?.addEventListener('click', function (e) {
            if (e.target === this) fechar();
        }));
});


window.switchSubTab = function(subTabName) {
    // 1. Esconder TODAS as sub-abas conhecidas
    const idsToHide = ['sub-destinatarios', 'sub-itens', 'sub-depara', 'sub-config'];
    idsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 2. Localizar o container da aba atual para desmarcar APENAS os botoes irmãos
    // Para não remover o active das sub-abas que não estamos vendo
    const targetEl = document.getElementById(subTabName);
    if(targetEl) {
        // Obter o pai ".tab-content"
        const parentTab = targetEl.closest('.tab-content');
        if (parentTab) {
            parentTab.querySelectorAll('.sub-tab').forEach(btn => btn.classList.remove('active'));
        }
    }

    // 3. Mostrar a aba certa e ativar botão
    if (targetEl) targetEl.style.display = 'block';
    const atvBtn = document.getElementById('btn-' + subTabName);
    if(atvBtn) atvBtn.classList.add('active');

    // 4. Carregar seus dados
    if (subTabName === 'sub-destinatarios') {
        window.loadDestinatariosList();
    } else if (subTabName === 'sub-itens') {
        window.switchTabToItens();
    } else if (subTabName === 'sub-depara') {
        renderDeParaCRUD();
    } else if (subTabName === 'sub-config') {
        renderConfiguracoes();
    }
};

window.switchTabToItens = function() {
    renderItemsCRUD('items_list');
};




window.abrirModalPreview = function() {
    const modal = document.getElementById('modal-preview');
    if (modal) modal.style.display = 'flex';
};

window.fecharModalPreview = function() {
    const modal = document.getElementById('modal-preview');
    if (modal) modal.style.display = 'none';
};
