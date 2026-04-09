import { AppState, $ } from './config.js';
import { checkSession, handleLogin, handleLogout } from './auth.js';
import { loadJsonFile, clearBase, salvarDestinatarioAtual, exportToJSON } from './db.js';
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
window.switchTab = function(tabName) {
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
    
    // Destacar botão ativo
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    // Carregar dados específicos da aba
    if (tabName === 'tab-destinatarios') {
        loadDestinatariosList();
    } else if (tabName === 'tab-itens') {
        renderItemsCRUD('items_list');
    }
};

// Carregar lista de destinatários
window.loadDestinatariosList = function() {
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

// Salvar novo destinatário
window.saveNewDestinatario = async function() {
    const nome = $('new_dest_name')?.value?.trim();
    const doc = $('new_dest_doc')?.value?.trim();
    const addr1 = $('new_dest_addr1')?.value?.trim();
    const addr2 = $('new_dest_addr2')?.value?.trim();
    const phone = $('new_dest_phone')?.value?.trim();
    
    if (!nome || !addr1) {
        alert('Preencha pelo menos nome e endereço');
        return;
    }
    
    try {
        const supabase = window.__supabase;
        if (supabase) {
            const { data, error } = await supabase
                .from('destinatarios')
                .insert([{
                    nome,
                    cpf_cnpj: doc,
                    endereco_linha1: addr1,
                    endereco_linha2: addr2,
                    contato: phone
                }])
                .select();
            
            if (error) {
                alert('Erro ao salvar: ' + error.message);
                return;
            }
        }
        
        alert('Destinatário salvo com sucesso!');
        // Limpar campos
        $('new_dest_name').value = '';
        $('new_dest_doc').value = '';
        $('new_dest_addr1').value = '';
        $('new_dest_addr2').value = '';
        $('new_dest_phone').value = '';
        
        // Recarregar lista
        loadDestinatariosList();
    } catch (e) {
        alert('Erro: ' + e.message);
    }
};

// Deletar destinatário (placeholder - implementar conforme necessário)
window.deleteDestinatario = function(idx) {
    if (!confirm('Deletar este destinatário?')) return;
    // Implementar deleção via Supabase
    alert('Função não completamente implementada');
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
    try { win.focus(); } catch(e) {}
}

function copyEmailBody() {
    if (!window.__lastEmailBody) { alert('Gere um preview primeiro.'); return; }
    navigator.clipboard.writeText(window.__lastEmailBody)
        .then(() => alert('Corpo do e-mail copiado para a área de transferência!'))
        .catch(err => alert('Erro ao copiar: ' + err));
}

function buildEmailBodyFromData(d) {
    const unitDisplay = d.unit_name && d.unit_name.trim() ? d.unit_name.trim() : (d.dest_name && d.dest_name.trim() ? d.dest_name.trim() : '[unidade não preenchida]');
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
        'Serão:',`${itemsLines}`,'',
        'Segue os dados para emissão:',
        `CNPJ: ${d.dest_doc || ''}`,
        `Nome/Razão Social: ${d.dest_name || ''}`,
        `Endereço: ${[d.dest_addr1, d.dest_addr2].filter(Boolean).join(' / ')}`,
        `Provável envio por: ${d.carrier || ''}`,''
    ];
    return lines.join('\n');
}

function enviarEmailViaMailtoUsingData() {
    const emails = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';
    let d = {};
    try { d = collectData(); } catch (e) {
        d = {
            unit_name: $('unit_name')?.value || '', reference: $('reference')?.value || '', reference_type: 'ticket', items: [],
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
    
    items.forEach(card => {
        let clientInput = card.querySelector('.it-client');
        
        if (isMulti && !clientInput) {
            // Adicionar campo de cliente
            const descDiv = card.querySelector('div:first-child');
            const clientFieldHTML = `
                <div style="margin-bottom: 8px;">
                    <label style="font-size: 12px;">Cliente:</label>
                    <input class="it-client" type="text" placeholder="Ex: Martin Brower" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:2px; font-size:12px;">
                </div>
            `;
            descDiv.insertAdjacentHTML('afterend', clientFieldHTML);
        } else if (!isMulti && clientInput) {
            // Remover campo de cliente
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
window.selectItemSuggestion = function(element) {
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
