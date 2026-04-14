import { AppState, $ } from './config.js';
import { checkSession, handleLogin, handleLogout } from './auth.js';
import { loadJsonFile, clearBase, salvarDestinatarioAtual, exportToJSON, salvarNoHistorico, carregarHistorico, atualizarStatusHistorico } from './db.js';
import { onSenderChange, onClientSelect, addItem, removeItem, collectData, clearItems } from './ui.js';
import { composeDocuments, renderEmailPreview } from './render.js';
import { initializeItems, getItems, renderItemsCRUD, addItem as addItemToDB } from './items.js';

// Anexa todas as funções engatilhadas pelo HTML ao escopo Global (window)
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.loadJsonFile = loadJsonFile;
window.clearBase = clearBase;
window.exportToJSON = exportToJSON;
window.salvarDestinatarioAtual = salvarDestinatarioAtual;
window.onSenderChange = onSenderChange;
window.onClientSelect = onClientSelect;
window.addItem = addItem;
window.removeItem = removeItem;
window.clearItems = clearItems;

// Funções de abas
window.switchTab = function (tabName) {
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

    // Destacar botão ativo (se o evento existir)
    if (window.event && window.event.target) {
        window.event.target.classList.add('active');
    }

    // Carregar dados específicos da aba (ESCALÁVEL: Fácil adicionar novas abas aqui)
    if (tabName === 'tab-destinatarios') {
        loadDestinatariosList();
    } else if (tabName === 'tab-itens') {
        renderItemsCRUD('items_list');
    } else if (tabName === 'tab-historico') {
        loadHistoricoView();
    }
};


// Carregar lista de destinatários
window.loadDestinatariosList = function () {
    const destinatariosSupabase = window.__destinatariosSupabase || [];
    const container = document.getElementById('destinatarios_list');

    if (destinatariosSupabase.length === 0) {
        container.innerHTML = '<div style="padding:16px;text-align:center;color:#999;">Nenhum destinatário cadastrado</div>';
        return;
    }

    let html = '';
    destinatariosSupabase.forEach((dest, idx) => {
        html += `
            <div style="padding:12px;border-bottom:1px solid #eee;">
                <strong>${dest.nome}</strong><br>
                <small>${dest.cpf_cnpj}</small><br>
                <small>${dest.endereco_linha1}</small><br>
                <small>${dest.endereco_linha2}</small><br>
                <div style="margin-top:8px;">
                    <button onclick="editDestinatario(${idx})" style="padding:4px 8px;background:#007bff;color:#fff;border:0;border-radius:2px;cursor:pointer;font-size:11px;margin-right:4px;">Editar</button>
                    <button onclick="deleteDestinatario(${idx})" style="padding:4px 8px;background:#f44;color:#fff;border:0;border-radius:2px;cursor:pointer;font-size:11px;">Deletar</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
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
        alert('Preencha pelo menos o Nome e o Endereço (Linha 1).');
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
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">Nenhum destinatário encontrado.</div>';
        return;
    }
    let html = '';
    arr.forEach((dest) => {
        const idx = (window.__destinatariosSupabase || []).indexOf(dest);
        html += `
            <div style="padding:14px 16px; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong style="font-size:14px;">${dest.nome}</strong><br>
                    ${dest.cpf_cnpj ? `<span style="font-size:12px;color:#666;">📄 ${dest.cpf_cnpj}</span><br>` : ''}
                    ${dest.contato ? `<span style="font-size:12px;color:#2a7ae2;">📞 ${dest.contato}</span><br>` : ''}
                    <span style="font-size:12px;color:#888;">${dest.endereco_linha1 || ''} ${dest.endereco_linha2 ? '&mdash; ' + dest.endereco_linha2 : ''}</span>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0; margin-left:12px;">
                    <button onclick="editDestinatario(${idx})" style="padding:6px 12px; background:#1a73e8; color:#fff; border:0; border-radius:6px; cursor:pointer; font-size:12px; margin:0; box-shadow:none;">Editar</button>
                    <button onclick="deleteDestinatario(${idx})" style="padding:6px 12px; background:#e53935; color:#fff; border:0; border-radius:6px; cursor:pointer; font-size:12px; margin:0; box-shadow:none;">Deletar</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.loadHistoricoView = async function () {
    const container = document.getElementById('historico_list');
    container.innerHTML = '<div style="padding:20px;text-align:center;">↻ Carregando...</div>';

    const historico = await carregarHistorico();
    window.__historicoCache = historico; // Cache para uso no modal

    if (historico.length === 0) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;">Nenhum envio encontrado no histórico.</div>';
        return;
    }

    let html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
    html += '<thead style="background:#f5f5f5; border-bottom:2px solid #ddd;"><tr>';
    html += '<th style="padding:10px; text-align:left;">Data</th>';
    html += '<th style="padding:10px; text-align:left;">Destinatário / Unidade</th>';
    html += '<th style="padding:10px; text-align:left;">Ref.</th>';
    html += '<th style="padding:10px; text-align:center; width:110px;">Status</th>';
    html += '</tr></thead><tbody>';

    historico.forEach(reg => {
        const data = new Date(reg.created_at).toLocaleString('pt-BR');
        const st = reg.status || {};
        const emailIcon    = st.email    ? '📧' : '<span style="opacity:0.2;">📧</span>';
        const romaneioIcon = st.romaneio ? '📋' : '<span style="opacity:0.2;">📋</span>';
        const etiquetaIcon = st.etiqueta ? '🏷️' : '<span style="opacity:0.2;">🏷️</span>';

        html += `<tr
            onclick="abrirDetalheHistorico('${reg.id}')"
            style="border-bottom:1px solid #eee; cursor:pointer; transition:background 0.15s;"
            onmouseover="this.style.background='#fdf5f5'"
            onmouseout="this.style.background=''">
            <td style="padding:10px; white-space:nowrap; font-size:12px; color:#666;">${data}</td>
            <td style="padding:10px;">
                <strong>${reg.destinatario || ''}</strong>
                ${reg.unidade && reg.unidade !== reg.destinatario ? `<br><small style="color:#888;">${reg.unidade}</small>` : ''}
            </td>
            <td style="padding:10px; color:#b70f0f; font-weight:600;">${reg.referencia || '—'}</td>
            <td style="padding:10px; text-align:center; font-size:16px; letter-spacing:2px;">${emailIcon} ${romaneioIcon} ${etiquetaIcon}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
};

window.abrirDetalheHistorico = function (id) {
    const historico = window.__historicoCache || [];
    const reg = historico.find(r => String(r.id) === String(id));
    if (!reg) return;

    window.__detalheHistoricoAtual = reg;
    const st = reg.status || { email: false, etiqueta: false, romaneio: false };
    const itens = (reg.itens || []).map(it => `<li style="margin-bottom:4px;">${it.qty} × ${it.desc}</li>`).join('');
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
                        ${feito ? '✓' : ''}
                    </div>
                    <span style="font-size:13px; color:#333; ${riscado}">${label}</span>
                </div>
                ${btnHtml}
            </div>`;
    }

    document.getElementById('modal-historico-body').innerHTML = `
        <div style="margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid #f0f0f0;">
            <div style="font-size:12px; color:#999; margin-bottom:6px;">${dataFormatada}</div>
            <div style="font-size:18px; font-weight:700; color:#222;">${reg.destinatario || ''}</div>
            ${reg.unidade && reg.unidade !== reg.destinatario ? `<div style="font-size:13px; color:#555; margin-top:2px;">📍 ${reg.unidade}</div>` : ''}
            ${reg.referencia ? `<div style="font-size:13px; color:#b70f0f; margin-top:4px; font-weight:600;">Ref: ${reg.referencia}</div>` : ''}
            ${reg.transportadora ? `<div style="font-size:12px; color:#888; margin-top:2px;">Transportadora: ${reg.transportadora}</div>` : ''}
        </div>

        <div style="margin-bottom:20px;">
            <div style="font-weight:700; font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Itens</div>
            <ul style="margin:0; padding-left:18px; font-size:13px; color:#555; line-height:1.8;">${itens || '<li style="color:#bbb;">Sem itens registrados</li>'}</ul>
        </div>

        <div>
            <div style="font-weight:700; font-size:12px; color:#888; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">Status das Ações</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${statusItem('email',    '📧 E-mail enviado',       st.email,    'email')}
                ${statusItem('romaneio', '📋 Romaneio impresso',    st.romaneio, 'romaneio')}
                ${statusItem('etiqueta', '🏷️ Etiqueta impressa',    st.etiqueta, 'etiqueta')}
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
    if (!win) { alert('Bloqueador de popups ativo — permita e tente novamente.'); return; }
    win.document.open(); win.document.write(fullHtml); win.document.close(); win.focus();
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

// Inicializar ao carregar
(async function init() {
    await initializeItems();
    // Renderizar items na aba
    renderItemsCRUD('items_list');
})();

function generatePreview() {
    const docType = $('doc-selector').value;
    if (!docType) { alert('Selecione um tipo de documento.'); return; }

    AppState.formData = collectData();
    if (AppState.formData.items.length === 0) { alert('Adicione pelo menos um item antes de gerar.'); return; }

    const documentElements = composeDocuments(AppState.formData, docType);
    const emailElement = renderEmailPreview(AppState.formData);

    const previewDocuments = $('preview-documents');
    previewDocuments.innerHTML = '';
    documentElements.forEach(el => previewDocuments.appendChild(el));

    const previewEmail = $('preview-email');
    previewEmail.innerHTML = '';
    previewEmail.appendChild(emailElement);

    $('preview-container').style.display = 'grid';
}

function generateNewTab() {
    const docType = $('doc-selector').value;
    if (!docType) { alert('Selecione um tipo de documento.'); return; }

    AppState.formData = collectData();
    if (AppState.formData.items.length === 0) { alert('Adicione pelo menos um item antes de gerar.'); return; }

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
    if (!win) { alert('Não foi possível abrir nova aba — verifique o bloqueador de popups.'); return; }
    const doc = win.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
    try { win.focus(); } catch (e) { }

    salvarNoHistorico({
        ...AppState.formData,
        docType: $('doc-selector').value
    });
}

function copyEmailBody() {
    if (!window.__lastEmailBody) { alert('Gere um preview primeiro.'); return; }
    navigator.clipboard.writeText(window.__lastEmailBody)
        .then(() => alert('Corpo do e-mail copiado para a área de transferência!'))
        .catch(err => alert('Erro ao copiar: ' + err));
}

function buildEmailBodyFromData(d) {
    const isMultiMode = d.client_mode === 'multi';
    let unitDisplay;
    if (isMultiMode) {
        // Multi: lista todos os clientes únicos dos itens
        const clientes = [...new Set((d.items || []).map(it => it.client).filter(Boolean))];
        unitDisplay = clientes.length > 0 ? clientes.join(', ') : '[clientes não preenchidos]';
    } else {
        // Simples: usa o campo Cliente/Unidade
        unitDisplay = d.unit_name?.trim() || d.dest_name?.trim() || '[destinatário não preenchido]';
    }
    const refType = d.reference_type || 'ticket';
    const refTypeLabel = refType === 'os' ? 'OS' : refType === 'ticket' ? 'Ticket' : 'Fornecedor';
    const ref = d.reference && d.reference.trim() ? d.reference.trim() : (refType === 'none' ? 'N/A' : '[preencha a referência]');
    const itemsLines = (Array.isArray(d.items) && d.items.length) ? d.items.map(it => `${it.qty} x ${it.desc}`).join('\n') : '- (sem itens informados) -';

    let emailText = `Olá financeiro,\n\n`;
    if (refType === 'none') {
        emailText += `Preciso de uma nota fiscal de envio para ${unitDisplay} (envio para fornecedor).\n\n`;
    } else {
        emailText += `Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) ${refTypeLabel} ${ref}.\n\n`;
    }

    const lines = [
        emailText,
        'Serão:', `${itemsLines}`, '',
        'Segue os dados para emissão:',
        `CNPJ: ${d.dest_doc || ''}`,
        `Nome/Razão Social: ${d.dest_name || ''}`,
        `Endereço: ${[d.dest_addr1, d.dest_addr2].filter(Boolean).join(' / ')}`,
        `Provável envio por: ${d.carrier || ''}`, ''
    ];
    return lines.join('\n');
}

function enviarEmailViaMailtoUsingData() {
    const emails = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';
    let d = {};
    try { d = collectData(); } catch (e) {
        d = {
            reference: $('reference')?.value || '', reference_type: 'ticket', items: [],
            dest_doc: $('dest_doc')?.value || '', dest_name: $('dest_name')?.value || '',
            dest_addr1: $('dest_addr1')?.value || '', dest_addr2: $('dest_addr2')?.value || '',
            carrier: $('carrier')?.value || ''
        };
    }
    const refType = d.reference_type || 'ticket';
    const refTypeLabel = refType === 'os' ? 'OS' : refType === 'ticket' ? 'Ticket' : 'Fornecedor';
    const ref = d.reference && d.reference.trim() ? d.reference.trim() : (refType === 'none' ? 'N/A' : '[preencha a referência]');
    const assuntoBase = 'Nota fiscal para envio';
    let assunto = assuntoBase;
    if (refType !== 'none' && d.reference && d.reference.trim()) {
        assunto = `${assuntoBase} - ${refTypeLabel} ${ref}`;
    }
    const body = buildEmailBodyFromData(d);
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;
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
        refInput.value = '';
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
                <div style="margin-bottom: 8px;">
                    <label style="font-size: 12px;">Cliente:</label>
                    <input class="it-client" type="text" placeholder="Ex: Martin Brower" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:2px; font-size:12px;">
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
        alert('Cole os números/IMEIs primeiro.');
        return;
    }

    const lines = imeiText.split('\n').map(l => l.trim()).filter(l => l);
    const imeis = [];

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

    if (imeis.length === 0) {
        alert('Nenhum número válido encontrado.');
        return;
    }

    // Atualizar qtd para quantidade de IMEIs processados
    qtdInput.value = imeis.length;
    qtdInput.readOnly = true;
    qtdInput.style.backgroundColor = '#e8f4f8';

    // Renderizar lista de IMEIs SEM status e SEM emojis
    imeiList.innerHTML = '';
    imeis.forEach((item, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'imei-item';
        itemDiv.dataset.imei = item.tipo === 'kit' ? `${item.rastreador}|${item.teclado}` : item.imei;
        itemDiv.style.cssText = 'padding:4px;margin:2px 0;background:#f5f5f5;border-left:2px solid #333;font-size:13px;font-family:monospace;';

        if (item.tipo === 'kit') {
            itemDiv.innerHTML = `<div>Rastreador: <strong>${escapeHtml(item.rastreador)}</strong> | Teclado: <strong>${escapeHtml(item.teclado)}</strong></div>`;
        } else {
            itemDiv.innerHTML = `<div>IMEI: <strong>${escapeHtml(item.imei)}</strong></div>`;
        }
        imeiList.appendChild(itemDiv);
    });

    // Limpar textarea
    textarea.value = '';

    alert(`${imeis.length} número(s) processado(s)!`);
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

    // Auth pipeline init (Dispara checagem do Supabase e carrega BD se logado)
    checkSession();
});
window.loadJsonFile = loadJsonFile;
window.clearBase = clearBase;
window.exportToJSON = exportToJSON;
window.salvarDestinatarioAtual = salvarDestinatarioAtual;
window.loadHistoricoView = loadHistoricoView;
