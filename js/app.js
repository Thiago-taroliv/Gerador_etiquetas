import { AppState, $ } from './config.js';
import { checkSession, handleLogin, handleLogout } from './auth.js';
import { loadJsonFile, clearBase, salvarDestinatarioAtual, exportToJSON } from './db.js';
import { onSenderChange, onClientSelect, addItem, removeItem, collectData, clearItems } from './ui.js';
import { composeDocuments, renderEmailPreview } from './render.js';

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
    const ref = d.reference && d.reference.trim() ? d.reference.trim() : '[preencha Ticket/OS]';
    const itemsLines = (Array.isArray(d.items) && d.items.length) ? d.items.map(it => `${it.qty} x ${it.desc}`).join('\n') : '- (sem itens informados) -';
    const lines = [
        'Olá financeiro,','',
        `Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) Ticket/OS ${ref}.`,'',
        'Serão:',`${itemsLines}`,'',
        'Segue os dados para emissão:',
        `CNPJ: ${d.dest_doc || ''}`,
        `Nome/Razão Social: ${d.dest_name || ''}`,
        `Endereço: ${[d.dest_addr1, d.dest_addr2].filter(Boolean).join(' / ')}`,
        `Provável envio por: ${d.carrier || ''}`,
        ...(d.obs ? ['', 'Observações:', d.obs] : []),''
    ];
    return lines.join('\n');
}

function enviarEmailViaMailtoUsingData() {
    const emails = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';
    let d = {};
    try { d = collectData(); } catch (e) {
        d = {
            unit_name: $('unit_name')?.value || '', reference: $('reference')?.value || '', items: [],
            dest_doc: $('dest_doc')?.value || '', dest_name: $('dest_name')?.value || '',
            dest_addr1: $('dest_addr1')?.value || '', dest_addr2: $('dest_addr2')?.value || '',
            carrier: $('carrier')?.value || '', obs: $('obs')?.value || ''
        };
    }
    const assuntoBase = 'Nota fiscal para envio';
    const assunto = d.reference && d.reference.trim() ? `${assuntoBase} - Ticket/OS ${d.reference.trim()}` : assuntoBase;
    const body = buildEmailBodyFromData(d);
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;
}

window.generatePreview = generatePreview;
window.generateNewTab = generateNewTab;
window.copyEmailBody = copyEmailBody;
window.enviarEmailViaMailtoUsingData = enviarEmailViaMailtoUsingData;

document.addEventListener('DOMContentLoaded', () => {
    // Escutando selectores iniciais
    $('sender_select').addEventListener('change', onSenderChange);
    $('client_select').addEventListener('change', onClientSelect);
    
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
    
    // Auth pipeline init (Dispara checagem do Supabase e carrega BD se logado)
    checkSession();
});
