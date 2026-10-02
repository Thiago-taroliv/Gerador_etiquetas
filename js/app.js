import { AppState, $ } from './config.js';
import { checkSession, handleLogin, handleLogout } from './auth.js';
import { loadJsonFile, salvarDestinatarioAtual, salvarOuAtualizarDestinatario, popularSelectDestinatarios, exportToJSON, carregarHistorico, HISTORICO_POR_PAGINA, atualizarStatusHistorico, registrarNoHistorico, salvarPendente, carregarPendentes, deletarPendente, concluirPendente } from './db.js';
import { onSenderChange, onClientSelect, addItem, removeItem, collectData, clearItems, preencherFormulario, limparFormulario, ligarMascaraDoc, validarDoc, buscarCep } from './ui.js';
import { composeDocuments, renderEmailPreview, buildEmailBody, buildEmailSubject } from './render.js';
import { toast } from './toast.js';
import { renderItemsCRUD } from './items.js';

// E-mails do financeiro que recebem o pedido de nota fiscal
const EMAILS_FINANCEIRO = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';

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

// Filtro do seletor "Selecionar do cadastro" na aba de romaneio
window.filtrarSeletorDestinatarios = function (termo) {
    popularSelectDestinatarios(window.__destinatariosSupabase || [], termo);
};

// Funções de abas
window.switchTab = function (tabName) {
    // Fechar modal de preview ao trocar de aba
    const modalPreview = document.getElementById('modal-preview');
    if (modalPreview) modalPreview.style.display = 'none';

    // Ocultar todas as abas
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });

    // Resetar estilos dos botões
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });

    // Mostrar aba selecionada
    const selectedTab = document.getElementById(tabName);
    if (selectedTab) selectedTab.style.display = 'block';

    // Destacar botão da aba (funciona também quando chamado via código)
    const activeBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Carregar dados específicos da aba (ESCALÁVEL: Fácil adicionar novas abas aqui)
    if (tabName === 'tab-envios') {
        // Por padrão, abre os Rascunhos.
        switchSubTab('sub-andamento');
    } else if (tabName === 'tab-dados') {
        // Por padrão, abre os Destinatários.
        switchSubTab('sub-destinatarios');
    }
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
        alert('Erro ao atualizar: ' + error.message);
        return;
    }

    fecharModalEdit();

    // Recarrega a lista e o seletor da aba de Romaneio
    const { carregarDestinatarios } = await import('./db.js');
    await carregarDestinatarios();
    loadDestinatariosList();
    toast('Destinatário atualizado.');
};

// Botão "Salvar Novo Destinatário" da aba Gerenciar Dados
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

window.abrirDetalheHistorico = function (id) {
    const historico = window.__historicoCache || [];
    const reg = historico.find(r => String(r.id) === String(id));
    if (!reg) return;

    window.__detalheHistoricoAtual = reg;
    const st = reg.status || { email: false, etiqueta: false, romaneio: false };
    const itens = (reg.itens || []).map(it => `<li style="margin-bottom:4px;">${escapeHtml(it.qty)} × ${escapeHtml(it.desc)}</li>`).join('');
    const dataFormatada = new Date(reg.created_at).toLocaleString('pt-BR');

    function statusItem(campo, label, feito, tipo) {
        const cor = feito ? '#22c55e' : '#e5e7eb';
        const textCor = feito ? '#fff' : '#aaa';
        const riscado = feito ? 'text-decoration:line-through; color:#aaa;' : '';
        const btnHtml = (tipo === 'etiqueta' || tipo === 'romaneio')
            ? `<button onclick="gerarDoHistorico('${id}', '${tipo}')" style="padding:5px 12px; font-size:12px; margin:0; background:#b70f0f; border-radius:6px; box-shadow:none; white-space:nowrap;">Gerar agora</button>`
            : '';
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#fafafa; border-radius:10px; border:1px solid #eee;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div onclick="toggleStatusHistorico('${id}', '${campo}')"
                         style="width:24px; height:24px; border-radius:50%; background:${cor}; color:${textCor}; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; font-weight:700; transition:all 0.2s; flex-shrink:0; user-select:none;">
                        ${feito ? '&#10003;' : ''}
                    </div>
                    <span style="font-size:13px; color:#333; ${riscado}">${label}</span>
                </div>
                ${btnHtml}
            </div>`;
    }

    document.getElementById('modal-historico-body').innerHTML = `
        <div style="margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid #f0f0f0;">
            <div style="font-size:12px; color:#999; margin-bottom:6px;">${dataFormatada}</div>
            <div style="font-size:18px; font-weight:700; color:#222;">${escapeHtml(reg.destinatario)}</div>
            ${reg.unidade && reg.unidade !== reg.destinatario ? `<div style="font-size:13px; color:#555; margin-top:2px;">Unidade: ${escapeHtml(reg.unidade)}</div>` : ''}
            ${reg.referencia ? `<div style="font-size:13px; color:#b70f0f; margin-top:4px; font-weight:600;">Ref: ${escapeHtml(reg.referencia)}</div>` : ''}
            ${reg.transportadora ? `<div style="font-size:12px; color:#888; margin-top:2px;">Transportadora: ${escapeHtml(reg.transportadora)}</div>` : ''}
        </div>

        <div style="margin-bottom:20px;">
            <div style="font-weight:700; font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Itens</div>
            <ul style="margin:0; padding-left:18px; font-size:13px; color:#555; line-height:1.8;">${itens || '<li style="color:#bbb;">Sem itens registrados</li>'}</ul>
        </div>

        <div>
            <div style="font-weight:700; font-size:12px; color:#888; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">Status das Ações</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${statusItem('email',    'E-mail enviado',       st.email,    'email')}
                ${statusItem('romaneio', 'Romaneio impresso',    st.romaneio, 'romaneio')}
                ${statusItem('etiqueta', 'Etiqueta impressa',    st.etiqueta, 'etiqueta')}
            </div>
        </div>
    `;

    document.getElementById('modal-historico-detalhe').style.display = 'flex';
};

window.fecharDetalheHistorico = function () {
    document.getElementById('modal-historico-detalhe').style.display = 'none';
    window.__detalheHistoricoAtual = null;
    loadHistoricoView(); // Atualiza a lista para refletir novos status
};

window.toggleStatusHistorico = async function (id, campo) {
    const reg = window.__detalheHistoricoAtual;
    if (!reg) return;
    const novoStatus = { ...(reg.status || { email: false, etiqueta: false, romaneio: false }) };
    novoStatus[campo] = !novoStatus[campo];
    const ok = await atualizarStatusHistorico(id, novoStatus);
    if (ok) {
        reg.status = novoStatus;
        const cached = (window.__historicoCache || []).find(r => String(r.id) === String(id));
        if (cached) cached.status = novoStatus;
        abrirDetalheHistorico(id); // Recarrega o modal com status atualizado
    }
};

window.gerarDoHistorico = function (id, tipo) {
    const reg = window.__detalheHistoricoAtual;
    if (!reg || !reg.dados_completos) {
        alert('Snapshot de dados não disponível para este registro antigo. Gere um novo documento pelo formulário.');
        return;
    }
    const dados = reg.dados_completos;
    const docType = tipo === 'etiqueta' ? 'labels' : 'romaneio';
    const documentElements = composeDocuments(dados, docType);
    let documentsHtml = '';
    documentElements.forEach(el => { documentsHtml += el.outerHTML; });
    const linkHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href).filter(Boolean);
    const linksHtml = linkHrefs.map(h => `<link rel="stylesheet" href="${h}">`).join('\n');
    const baseHref = location.origin + location.pathname;
    const fullHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><base href="${baseHref}"><title>Documentos para Impressão</title>${linksHtml}<style>body{margin:0;padding:0;background:#f3f3f3;}.page{page-break-before:always;break-before:page;}.page:first-child{page-break-before:avoid;break-before:avoid;}@media print{body{background:#fff;}.page{margin:0;box-shadow:none;page-break-after:always;}}</style></head><body><div style="padding:16px;">${documentsHtml}</div></body></html>`;
    const win = window.open('', '_blank');
    if (!win) { alert('Bloqueador de popups ativo – permita e tente novamente.'); return; }
    win.document.open(); win.document.write(fullHtml); win.document.close(); win.focus();

    // Marca automaticamente a etapa como feita
    if (!(reg.status || {})[tipo]) toggleStatusHistorico(id, tipo);
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
    if (!confirm(`Tem certeza que deseja deletar "${d.nome}"?`)) return;

    const { supabaseClient } = await import('./config.js');
    const { error } = await supabaseClient
        .from('destinatarios')
        .delete()
        .eq('id', d.id);

    if (error) {
        alert('Erro ao deletar: ' + error.message);
        return;
    }

    const { carregarDestinatarios } = await import('./db.js');
    await carregarDestinatarios();
    loadDestinatariosList();
};


// --- LÓGICA DE PEDIDOS EM ANDAMENTO ---
window.AppState = AppState;
AppState.currentDraftId = null;
// Registro no histórico do envio que está no formulário (gerar de novo atualiza em vez de duplicar)
AppState.currentHistoricoId = null;

// Grava/atualiza o envio atual no histórico, marcando as etapas feitas.
// Se houver rascunho aberto, guarda nele o vínculo para que "Concluir" não duplique o registro.
async function registrarEnvio(dados, etapas) {
    const id = await registrarNoHistorico(dados, AppState.currentHistoricoId, etapas);
    if (!id) {
        toast('Não foi possível registrar no histórico.', 'error', 5000);
        return;
    }
    const novo = !AppState.currentHistoricoId;
    AppState.currentHistoricoId = String(id);
    toast(novo ? 'Envio registrado no histórico.' : 'Registro do histórico atualizado.');

    if (AppState.currentDraftId) {
        await salvarPendente({ ...dados, historico_id: AppState.currentHistoricoId }, AppState.currentDraftId, true);
    }
}

// Mostra/oculta o aviso de que o formulário está editando um rascunho existente
function atualizarIndicadorRascunho() {
    const el = $('draft_indicator');
    if (el) el.style.display = AppState.currentDraftId ? 'flex' : 'none';
}

window.salvarRascunhoAtual = async function(silencioso = false) {
    // Coleta todos os dados do form
    const dados = collectData();
    if (dados.items.length === 0) { toast('Adicione pelo menos um item antes de salvar o rascunho.', 'warning'); return false; }
    if (AppState.currentHistoricoId) dados.historico_id = AppState.currentHistoricoId;

    const draftId = AppState.currentDraftId; // se existir, vai atualizar, se nao, cria novo

    // Chama o DB
    const salvo = await salvarPendente(dados, draftId, silencioso);

    if (salvo) {
        // Guarda o ID que voltou do supabase
        AppState.currentDraftId = String(salvo.id);
        atualizarIndicadorRascunho();
        return true;
    }
    return false;
};

// Limpa o formulário e desvincula do rascunho atual (evita sobrescrever rascunho antigo)
window.novoEnvio = function() {
    if (!confirm('Iniciar um novo envio? Os dados não salvos do formulário serão perdidos.')) return;
    limparFormulario();
    AppState.currentDraftId = null;
    AppState.currentHistoricoId = null;
    atualizarIndicadorRascunho();
};

window.carregarViewAndamento = async function() {
    const container = document.getElementById('andamento_list');
    container.innerHTML = '<div class="empty-state">Carregando rascunhos...</div>';

    const rascunhos = await carregarPendentes();
    window.__rascunhosCache = rascunhos;

    if (rascunhos.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhum pedido em andamento.</div>';
        return;
    }

    let html = '<table class="data-table"><thead><tr>';
    html += '<th>Data Criação</th><th>Destinatário / Unidade</th><th>Ref.</th><th style="text-align:center;">Ações</th>';
    html += '</tr></thead><tbody>';

    rascunhos.forEach(reg => {
        const data = new Date(reg.created_at).toLocaleString('pt-BR');

        let destLabel = `<strong>${escapeHtml(reg.destinatario || 'Sem Destinatário')}</strong>`;
        if (reg.unidade && reg.unidade !== reg.destinatario) {
            destLabel += '<br><small>' + escapeHtml(reg.unidade) + '</small>';
        }

        html += `<tr>
            <td class="col-date">${data}</td>
            <td>${destLabel}</td>
            <td class="col-ref">${escapeHtml(reg.referencia) || '–'}</td>
            <td>
                <div class="btn-group" style="justify-content:center;">
                    <button class="btn-sm btn-neutral" onclick="editarRascunho('${reg.id}')">Editar</button>
                    <button class="btn-sm btn-danger" onclick="excluirRascunhoUI('${reg.id}')">Excluir</button>
                    <button class="btn-sm btn-success" onclick="concluirRascunhoUI('${reg.id}')">Concluir</button>
                </div>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
};

window.editarRascunho = function(id) {
    const rascunho = (window.__rascunhosCache || []).find(r => String(r.id) === String(id));
    if(rascunho) {
        // Preenche o formulário
        preencherFormulario(rascunho.dados_completos);

        // Seta o ID atual (e o registro do histórico, se este rascunho já foi gerado antes)
        AppState.currentDraftId = String(id);
        AppState.currentHistoricoId = rascunho.dados_completos?.historico_id || null;
        atualizarIndicadorRascunho();

        // Vai para a aba do romaneio
        window.switchTab('tab-romaneio');
    }
};

window.excluirRascunhoUI = async function(id) {
    const ok = await deletarPendente(id);
    if(ok) {
        if(AppState.currentDraftId === String(id)) {
            AppState.currentDraftId = null;
            atualizarIndicadorRascunho();
        }
        carregarViewAndamento();
    }
};

window.concluirRascunhoUI = async function(id) {
    if(!confirm("Concluir Rascunho?\n\nEle será transferido para o Histórico DEFINITIVO e apagado daqui. As informações atuais do banco serão salvas.")) return;

    // Certifique-se de que se o usuário clicou Concluir, salvamos o atual se for o memo rascunho aberto na tela
    if (AppState.currentDraftId === String(id)) {
       const salvo = await salvarRascunhoAtual(true); // Força update do que ta na tela antes de fechar
       if (!salvo) return;
    }

    const ok = await concluirPendente(id);
    if(ok) {
        if(AppState.currentDraftId === String(id)) { // reseta a UI ativa se fomos nós
            AppState.currentDraftId = null;
            AppState.currentHistoricoId = null;
            atualizarIndicadorRascunho();
        }
        carregarViewAndamento();
    }
};


// Confere os dados mínimos antes de gerar documentos ou e-mail.
// Erros bloqueiam; avisos perguntam se quer continuar.
function validarAntesDeGerar(d) {
    if (d.items.length === 0) { toast('Adicione pelo menos um item.', 'warning'); return false; }
    if (!d.dest_name.trim() || !d.dest_addr1.trim()) {
        toast('Preencha o Nome e o Endereço (linha 1) do destinatário.', 'warning');
        return false;
    }
    const avisos = [];
    if (!validarDoc(d.dest_doc)) avisos.push('- O CPF/CNPJ do destinatário parece inválido');
    if (d.reference_type !== 'none' && !d.reference.trim()) avisos.push('- O número da referência (Ticket/OS) está vazio');
    if (avisos.length) return confirm('Atenção:\n' + avisos.join('\n') + '\n\nDeseja continuar mesmo assim?');
    return true;
}

function generatePreview() {
    const docType = $('doc-selector').value;
    if (!docType) { toast('Selecione quais documentos gerar.', 'warning'); $('doc-selector').focus(); return; }

    AppState.formData = collectData();
    if (!validarAntesDeGerar(AppState.formData)) return;

    const documentElements = composeDocuments(AppState.formData, docType);
    const emailElement = renderEmailPreview(AppState.formData);

    const previewDocuments = $('preview-documents');
    previewDocuments.innerHTML = '';
    documentElements.forEach(el => previewDocuments.appendChild(el));

    const previewEmail = $('preview-email');
    previewEmail.innerHTML = '';
    previewEmail.appendChild(emailElement);

    abrirModalPreview();
}

function generateNewTab() {
    const docType = $('doc-selector').value;
    if (!docType) { toast('Selecione quais documentos gerar.', 'warning'); $('doc-selector').focus(); return; }

    AppState.formData = collectData();
    if (!validarAntesDeGerar(AppState.formData)) return;

    const documentElements = composeDocuments(AppState.formData, docType);
    let documentsHtml = '';
    documentElements.forEach(el => { documentsHtml += el.outerHTML; });

    const linkHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href).filter(Boolean);
    const linksHtml = linkHrefs.map(h => `<link rel="stylesheet" href="${h}">`).join('\n');
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
    if (!win) { alert('Não foi possível abrir nova aba – verifique o bloqueador de popups.'); return; }
    const doc = win.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
    try { win.focus(); } catch (e) { }

    // Registra no histórico depois de abrir a aba (abrir precisa ser imediato para não cair no bloqueador)
    const etapas = {};
    if (docType === 'labels' || docType === 'both') etapas.etiqueta = true;
    if (docType === 'romaneio' || docType === 'both') etapas.romaneio = true;
    registrarEnvio(AppState.formData, etapas);
}

function copyEmailBody() {
    // Sempre gera a partir do formulário atual (não do último preview)
    const body = buildEmailBody(collectData());
    navigator.clipboard.writeText(body)
        .then(() => toast('Corpo do e-mail copiado.'))
        .catch(err => alert('Erro ao copiar: ' + err));
}

function enviarEmailViaMailtoUsingData() {
    const d = collectData();
    if (!validarAntesDeGerar(d)) return;
    const emails = EMAILS_FINANCEIRO;
    const assunto = buildEmailSubject(d);
    const body = buildEmailBody(d);
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;
    registrarEnvio(d, { email: true });
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

function procesarIMEIs(btn) {
    const card = btn.closest('.item-card');
    const textarea = card.querySelector('.it-imei-input');
    const imeiList = card.querySelector('.it-imei-list');
    const qtdInput = card.querySelector('.it-qty');

    const imeiText = textarea.value.trim();
    if (!imeiText) {
        toast('Cole os números/IMEIs primeiro.', 'warning');
        return;
    }

    const lines = imeiText.split('\n').map(l => l.trim()).filter(l => l);
    let imeis = [];

    // Detectar formato (com tab = kit)
    let isKit = lines.some(l => l.includes('\t'));

    if (isKit) {
        // Formato: RASTREADOR\tTECLADO
        lines.forEach(line => {
            const parts = line.split('\t').map(p => p.trim()).filter(p => p);
            if (parts.length >= 2) {
                imeis.push({ tipo: 'kit', rastreador: parts[0], teclado: parts[1] });
            } else if (parts.length === 1) {
                imeis.push({ tipo: 'kit', rastreador: parts[0], teclado: '' });
            }
        });
    } else {
        // Formato simples
        lines.forEach(line => {
            imeis.push({ tipo: 'simples', imei: line });
        });
    }

    // Remove repetidos (mesmo IMEI ou mesmo par rastreador|teclado)
    const vistos = new Set();
    const totalColado = imeis.length;
    imeis = imeis.filter(i => {
        const chave = i.tipo === 'kit' ? `${i.rastreador}|${i.teclado}` : i.imei;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    });
    const duplicados = totalColado - imeis.length;

    if (imeis.length === 0) {
        toast('Nenhum número válido encontrado.', 'warning');
        return;
    }

    // Atualizar qtd para quantidade de IMEIs processados
    qtdInput.value = imeis.length;
    qtdInput.readOnly = true;
    qtdInput.style.backgroundColor = '#e8f4f8';

    // Renderizar lista de IMEIs SEM status e SEM emojis
    imeiList.innerHTML = '';
    imeis.forEach((item) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'imei-item';
        itemDiv.dataset.imei = item.tipo === 'kit' ? `${item.rastreador}|${item.teclado}` : item.imei;

        if (item.tipo === 'kit') {
            itemDiv.innerHTML = `<div>Rastreador: <strong>${escapeHtml(item.rastreador)}</strong> | Teclado: <strong>${escapeHtml(item.teclado)}</strong></div>`;
        } else {
            itemDiv.innerHTML = `<div>IMEI: <strong>${escapeHtml(item.imei)}</strong></div>`;
        }
        imeiList.appendChild(itemDiv);
    });

    // Limpar textarea
    textarea.value = '';

    if (duplicados) toast(`${imeis.length} número(s) processado(s). ${duplicados} repetido(s) ignorado(s).`, 'warning', 5000);
    else toast(`${imeis.length} número(s) processado(s).`);
}

// Remove os IMEIs do item e libera a quantidade para edição
function limparIMEIs(btn) {
    const card = btn.closest('.item-card');
    card.querySelector('.it-imei-list').innerHTML = '';
    const qtd = card.querySelector('.it-qty');
    qtd.readOnly = false;
    qtd.style.backgroundColor = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.generatePreview = generatePreview;
window.generateNewTab = generateNewTab;
window.copyEmailBody = copyEmailBody;
window.enviarEmailViaMailtoUsingData = enviarEmailViaMailtoUsingData;
window.toggleReferenceInput = toggleReferenceInput;
window.toggleClientMode = toggleClientMode;
window.toggleIMEISection = toggleIMEISection;
window.procesarIMEIs = procesarIMEIs;
window.limparIMEIs = limparIMEIs;

document.addEventListener('DOMContentLoaded', () => {
    // Escutando selectores iniciais
    $('sender_select').addEventListener('change', onSenderChange);
    $('client_select').addEventListener('change', onClientSelect);
    $('reference_type').addEventListener('change', toggleReferenceInput);

    const botaoEnviar = $('btnEnviar');
    if (botaoEnviar) {
        botaoEnviar.addEventListener('click', (ev) => {
            ev.preventDefault();
            enviarEmailViaMailtoUsingData();
        });
    }

    // Inicialização Visual
    $('sender_select').value = 'ranor';
    onSenderChange();
    toggleReferenceInput();
    addItem(); // Adicionar um item padrão

    // Máscara + validação de CPF/CNPJ nos três formulários de destinatário
    ['dest_doc', 'new_dest_doc', 'modal_dest_doc'].forEach(id => ligarMascaraDoc($(id)));

    // Auth pipeline init (Dispara checagem do Supabase e carrega BD se logado)
    checkSession();

    // Esc fecha qualquer modal aberto
    const aberto = (id) => $(id)?.style.display === 'flex';
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (aberto('modal-preview')) fecharModalPreview();
        if (aberto('modal-edit-dest')) fecharModalEdit();
        if (aberto('modal-historico-detalhe')) fecharDetalheHistorico();
    });

    // Clique fora do card fecha o modal (não no de edição, para não perder o que foi digitado)
    [['modal-preview', () => fecharModalPreview()], ['modal-historico-detalhe', () => fecharDetalheHistorico()]]
        .forEach(([id, fechar]) => $(id)?.addEventListener('click', function (e) {
            if (e.target === this) fechar();
        }));
});


window.switchSubTab = function(subTabName) {
    // 1. Esconder TODAS as sub-abas conhecidas
    const idsToHide = ['sub-andamento', 'sub-historico', 'sub-destinatarios', 'sub-itens'];
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
    if(subTabName === 'sub-andamento') {
        carregarViewAndamento();
    } else if (subTabName === 'sub-historico') {
        loadHistoricoView();
    } else if (subTabName === 'sub-destinatarios') {
        window.loadDestinatariosList();
    } else if (subTabName === 'sub-itens') {
        window.switchTabToItens();
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
