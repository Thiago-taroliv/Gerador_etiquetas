// ============ CAMADA 1: CONSTANTES E CONFIGURAÇÃO ============

const SENDERS = {
    ranor: { company: 'Ranor Rastreamento', cnpj: '10.980.591/0001-64', address: 'Coronel João de Barros, 427B \n 37900-049 - Centro, Passos-MG' },
    nortrack: { company: 'NORTRACK OPERAÇÕES LTDA', cnpj: '58.231.979/0001-99', address: 'R JULIETA FILIPINI,47, SALA 01 \n 06030-510 – UMUARAMA, OSASCO – SP' }
};

const STORAGE_KEY = 'base_envio_local_v1';

// ============ CAMADA 1: ESTADO GLOBAL ============

const AppState = {
    formData: null,
    selectedDocType: null,
    emailBody: null
};

// ============ CAMADA 1: FUNÇÕES AUXILIARES ============

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ INICIALIZAÇÃO ============

document.addEventListener('DOMContentLoaded', () => {
    // Listeners do formulário
    $('sender_select').addEventListener('change', onSenderChange);
    $('client_select').addEventListener('change', onClientSelect);

    // Listener do botão de enviar email
    const botaoEnviar = document.getElementById('btnEnviar');
    if (botaoEnviar) {
        botaoEnviar.addEventListener('click', (ev) => {
            ev.preventDefault();
            enviarEmailViaMailtoUsingData();
        });
    }

    // Inicializar
    $('sender_select').value = 'ranor';
    onSenderChange();
    loadBaseFromStorage();
});

// ============ CAMADA 2: GERENCIAMENTO DE REMETENTE ============

function onSenderChange() {
    const v = $('sender_select').value;
    if (v === 'custom') {
        $('sender_company').readOnly = false;
        $('sender_cnpj').readOnly = false;
        $('sender_address').readOnly = false;
        $('sender_company').value = '';
        $('sender_cnpj').value = '';
        $('sender_address').value = '';
    } else {
        const s = SENDERS[v];
        $('sender_company').value = s.company;
        $('sender_cnpj').value = s.cnpj;
        $('sender_address').value = s.address;
        $('sender_company').readOnly = true;
        $('sender_cnpj').readOnly = true;
        $('sender_address').readOnly = true;
    }
}

// ============ CAMADA 2: GERENCIAMENTO DE BASE DE DADOS ============

function loadJsonFile() {
    const f = document.getElementById('file_input').files[0];
    if (!f) { alert('Selecione um arquivo .json primeiro.'); return; }
    const r = new FileReader();
    r.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) { alert('JSON deve ser um array de objetos.'); return; }
            const normalized = data.map(normalizeRecord);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
            populateClientSelect(normalized);
            alert('Base carregada: ' + normalized.length + ' registros.');
        } catch (err) { alert('Erro ao ler JSON: ' + err.message); }
    };
    r.readAsText(f, 'utf-8');
}

function normalizeRecord(r) {
    return {
        destinatario: r.destinatario || r.nome_cliente || r.name || '',
        cpf_cnpj: r.cpf_cnpj || r.cpf || r.cnpj || '',
        endereco_linha1: r.endereco_linha1 || r.addr1 || r.endereco1 || '',
        endereco_linha2: r.endereco_linha2 || r.addr2 || r.endereco2 || '',
        contato: r.contato || r.telefone || r.contact || ''
    };
}

function loadBaseFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { populateClientSelect([]); return; }
    try { const arr = JSON.parse(raw); populateClientSelect(arr); } catch (e) { populateClientSelect([]); }
}

function populateClientSelect(arr) {
    const sel = $('client_select');
    sel.innerHTML = '<option value="">— nenhum —</option>';
    arr.forEach((c, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = c.destinatario || ('Registro ' + (i + 1));
        sel.appendChild(opt);
    });
}

function clearBase() {
    localStorage.removeItem(STORAGE_KEY);
    populateClientSelect([]);
    alert('Base limpa.');
}

function onClientSelect() {
    const idx = $('client_select').value;
    if (idx === '') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    const rec = arr[parseInt(idx)];
    if (!rec) return;
    $('dest_name').value = rec.destinatario || '';
    $('dest_doc').value = rec.cpf_cnpj || '';
    $('dest_addr1').value = rec.endereco_linha1 || '';
    $('dest_addr2').value = rec.endereco_linha2 || '';
    $('dest_phone').value = rec.contato || '';
}

// ============ CAMADA 2: GERENCIAMENTO DE ITENS ============

function addItem(desc = '', qty = 1) {
    const tbody = $('items_body');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input class="it-desc" value="' + escapeHtml(desc) + '" style="width:100%;border:0;outline:none"></td><td><input class="it-qty" type="number" value="' + qty + '" min="1" style="width:100%;border:0;outline:none"></td><td class="center"><button type="button" onclick="removeItem(this)">✕</button></td>';
    tbody.appendChild(tr);
}

function removeItem(btn) {
    btn.closest('tr').remove();
}

function clearItems() {
    $('items_body').innerHTML = '';
}

// ============ CAMADA 2: COLETA DE DADOS ============

function collectData() {
    return {
        sender_company: $('sender_company').value || '',
        sender_cnpj: $('sender_cnpj').value || '',
        sender_address: $('sender_address').value || '',
        unit_name: $('unit_name').value || '',
        obs: $('obs').value || '',
        dest_name: $('dest_name').value || '',
        dest_doc: $('dest_doc').value || '',
        dest_addr1: $('dest_addr1').value || '',
        dest_addr2: $('dest_addr2').value || '',
        total_vol: Math.max(1, parseInt($('total_vol').value || 1)),
        reference: $('reference').value || '',
        carrier: $('carrier').value || '',
        receiver: $('receiver').value || '',
        items: Array.from(document.querySelectorAll('#items_body tr'))
            .map(tr => {
                const d = tr.querySelector('.it-desc')?.value || '';
                const q = tr.querySelector('.it-qty')?.value || '1';
                return { desc: d, qty: q };
            })
            .filter(it => it.desc.trim() !== '')
    };
}

// ============ CAMADA 3: RENDERIZAÇÃO - ETIQUETA ============

function renderLabels(data) {
    const sheet = document.createElement('div');
    sheet.className = 'page labels-sheet';

    const grid = document.createElement('div');
    grid.className = 'labels-grid';

    for (let i = 0; i < data.total_vol; i++) {
        const box = document.createElement('div');
        box.className = 'label-box';
        box.innerHTML = `
            <div style="font-weight:700;color:#c00;font-size:13px;">${escapeHtml(data.sender_company.toUpperCase())}</div>
            <div style="margin-top:6px;"><strong>DESTINATÁRIO</strong><br>
                ${escapeHtml(data.dest_name)}<br>
                ${escapeHtml(data.dest_doc)}<br>
                ${escapeHtml(data.dest_addr1)}<br>
                ${escapeHtml(data.dest_addr2)}
            </div>
            <hr style="margin:6px 0;">
            <div style="font-size:12px;"><strong>REMETENTE:</strong><br>
                ${escapeHtml(data.sender_company)}<br>
                ${escapeHtml(data.sender_address)}<br>
                CNPJ: ${escapeHtml(data.sender_cnpj)}
            </div>
            ${data.obs ? '<div style="margin-top:6px;font-size:12px;"><strong>OBS:</strong> ' + escapeHtml(data.obs) + '</div>' : ''}
            <div style="margin-top:6px;font-size:12px;"><strong>Etiqueta:</strong> ${i + 1} / ${data.total_vol}</div>
        `;
        grid.appendChild(box);
    }

    sheet.appendChild(grid);
    return sheet;
}

// ============ CAMADA 3: RENDERIZAÇÃO - ROMANEIO ============

function renderRomaneio(data) {
    const rom = document.createElement('div');
    rom.className = 'page';

    let rows = '';
    for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        rows += `<tr>
            <td style="width:6%;text-align:center">${i + 1}</td>
            <td>${escapeHtml(it.desc)}</td>
            <td style="width:12%;text-align:center">${escapeHtml(it.qty)}</td>
        </tr>`;
    }

    if (data.items.length < 6) {
        for (let i = data.items.length; i < 6; i++) {
            rows += '<tr><td></td><td></td><td></td></tr>';
        }
    }

    rom.innerHTML = `
        <div>
            <div style="font-size:20px;color:var(--brand);font-weight:700;margin-bottom:6px">Romaneio de Entrega</div>
            <div style="margin-bottom:8px;">
                <strong>Empresa:</strong> ${escapeHtml(data.sender_company)} &nbsp;&nbsp;
                <strong>CNPJ:</strong> ${escapeHtml(data.sender_cnpj)}<br>
                <strong>endereço:</strong> ${escapeHtml(data.sender_address)}
            </div>
            <div style="display:flex;gap:12px;">
                <div style="flex:1;">
                    <strong>Cliente/Destinatário:</strong><br>
                    <span style="text-decoration:underline;">${escapeHtml(data.dest_name)}</span><br>
                    ${escapeHtml(data.dest_doc)}
                </div>
                <div style="flex:1;">
                    <strong>Endereço de entrega:</strong><br>
                    ${escapeHtml(data.dest_addr1)}<br>
                    ${escapeHtml(data.dest_addr2)}
                </div>
            </div>
            <div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:4px">Descrição das Mercadorias</div>
            <table class="romaneio-table" style="margin-top:8px;width:100%;border-collapse:collapse;">
                <thead style="background:#f6f6f6;">
                    <tr>
                        <th style="width:6%;">Item</th>
                        <th>Descrição do Produto</th>
                        <th style="width:12%;">Qtd.</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:8px;"><strong>Total de Volumes:</strong> ${escapeHtml(String(data.total_vol))}</div>
            <div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:4px">Recebimento</div>
            <div style="margin-top:8px;">
                <strong>Data (chegada/assinatura):</strong> _______________<br>
                <strong>Recebedor/Responsável:</strong> ${escapeHtml(data.receiver)}<br>
                <div style="margin-top:8px;border-top:1px dashed #aaa;width:60%;padding-top:6px">Assinatura</div>
            </div>
        </div>
    `;

    return rom;
}

// ============ CAMADA 3: RENDERIZAÇÃO - EMAIL PREVIEW ============

function renderEmailPreview(data) {
    const emailBox = document.createElement('div');
    emailBox.className = 'page';

    const itemLines = data.items.map(it => `${it.qty} x ${it.desc}`).join('\n');
    const unitDisplay = data.unit_name || '[unidade não preenchida]';
    const ref = data.reference ? data.reference : '[preencha Ticket/OS]';

    const bodyText = `Olá financeiro,

Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) Ticket/OS ${ref}.

Serão:
${itemLines}

Segue os dados para emissão:
CNPJ: ${data.dest_doc}
Nome/Razão Social: ${data.dest_name}
Endereço: ${data.dest_addr1} / ${data.dest_addr2}
Provável envio por: ${data.carrier}${data.obs ? '\n\nObservações:\n' + data.obs : ''}
`;

    emailBox.innerHTML = `
        <div>
            <div style="font-size:18px;color:var(--brand);font-weight:700;margin-bottom:6px">Pré-visualização do e-mail</div>
            <div style="font-weight:700">Assunto:</div>
            <div style="margin-bottom:8px;font-size:12px;">Nota fiscal para envio - Ticket/OS ${escapeHtml(ref)}</div>
            <div style="font-weight:700;margin-top:8px;">Corpo:</div>
            <pre class="email-box" id="email_preview">${escapeHtml(bodyText)}</pre>
        </div>
    `;

    window.__lastEmailBody = bodyText;
    AppState.emailBody = bodyText;

    return emailBox;
}

// ============ CAMADA 3: COMPOSIÇÃO DE DOCUMENTOS ============

function composeDocuments(data, docType) {
    const elements = [];

    if (docType === 'labels' || docType === 'both') {
        elements.push(renderLabels(data));
    }

    if (docType === 'romaneio' || docType === 'both') {
        elements.push(renderRomaneio(data));
    }

    return elements;
}

// ============ CAMADA 4: PREVIEW (PÁGINA ATUAL) ============

function generatePreview() {
    const docType = $('doc-selector').value;

    if (!docType) {
        alert('Selecione um tipo de documento.');
        return;
    }

    AppState.formData = collectData();

    if (AppState.formData.items.length === 0) {
        alert('Adicione pelo menos um item antes de gerar.');
        return;
    }

    // Compor documentos e email
    const documentElements = composeDocuments(AppState.formData, docType);
    const emailElement = renderEmailPreview(AppState.formData);

    // Atualizar preview-documents
    const previewDocuments = $('preview-documents');
    previewDocuments.innerHTML = '';
    documentElements.forEach(el => previewDocuments.appendChild(el));

    // Atualizar preview-email
    const previewEmail = $('preview-email');
    previewEmail.innerHTML = '';
    previewEmail.appendChild(emailElement);

    // Mostrar container
    $('preview-container').style.display = 'grid';
}

// ============ CAMADA 5: IMPRESSÃO (NOVA ABA) ============

function generateNewTab() {
    const docType = $('doc-selector').value;

    if (!docType) {
        alert('Selecione um tipo de documento.');
        return;
    }

    AppState.formData = collectData();

    if (AppState.formData.items.length === 0) {
        alert('Adicione pelo menos um item antes de gerar.');
        return;
    }

    // Compor documentos (SEM email)
    const documentElements = composeDocuments(AppState.formData, docType);

    // Montar HTML para nova aba
    let documentsHtml = '';
    documentElements.forEach(el => {
        documentsHtml += el.outerHTML;
    });

    // Pegar CSS da página atual
    const linkHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(l => l.href)
        .filter(Boolean);

    const linksHtml = linkHrefs.map(h => `<link rel="stylesheet" href="${h}">`).join('\n');
    const baseHref = location.origin + location.pathname;

    // Criar HTML para nova aba
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
        @media print {
            body { background: #fff; }
            .page { margin: 0; box-shadow: none; page-break-after: always; }
        }
    </style>
</head>
<body>
    <div style="padding: 16px;">
        ${documentsHtml}
    </div>
</body>
</html>`;

    // Abrir nova aba
    const win = window.open('', '_blank');
    if (!win) {
        alert('Não foi possível abrir nova aba — verifique o bloqueador de popups.');
        return;
    }

    const doc = win.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();

    // Focar na aba
    try { win.focus(); } catch(e) {}
}

// ============ CAMADA 6: EMAIL - CÓPIA E ENVIO ============

function copyEmailBody() {
    if (!window.__lastEmailBody) {
        alert('Gere um preview primeiro.');
        return;
    }
    navigator.clipboard.writeText(window.__lastEmailBody)
        .then(() => alert('Corpo do e-mail copiado para a área de transferência!'))
        .catch(err => alert('Erro ao copiar: ' + err));
}

function buildEmailBodyFromData(d) {
    const unitDisplay = d.unit_name && d.unit_name.trim()
        ? d.unit_name.trim()
        : (d.dest_name && d.dest_name.trim() ? d.dest_name.trim() : '[unidade não preenchida]');
    const ref = d.reference && d.reference.trim() ? d.reference.trim() : '[preencha Ticket/OS]';

    const itemsLines = (Array.isArray(d.items) && d.items.length)
        ? d.items.map(it => `${it.qty} x ${it.desc}`).join('\n')
        : '- (sem itens informados) -';

    const cnpjCpf = d.dest_doc || '';
    const nome = d.dest_name || '';
    const endereco = [d.dest_addr1, d.dest_addr2].filter(Boolean).join(' / ');
    const carrier = d.carrier || '';

    const lines = [
        'Olá financeiro,',
        '',
        `Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) Ticket/OS ${ref}.`,
        '',
        'Serão:',
        `${itemsLines}`,
        '',
        'Segue os dados para emissão:',
        `CNPJ: ${cnpjCpf}`,
        `Nome/Razão Social: ${nome}`,
        `Endereço: ${endereco}`,
        `Provável envio por: ${carrier}`,
        ...(d.obs ? ['', 'Observações:', d.obs] : []),
        ''
    ];

    return lines.join('\n');
}

function enviarEmailViaMailtoUsingData() {
    const emails = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';

    let d = {};
    try {
        d = collectData();
    } catch (e) {
        d = {
            unit_name: document.getElementById('unit_name')?.value || '',
            reference: document.getElementById('reference')?.value || '',
            items: [],
            dest_doc: document.getElementById('dest_doc')?.value || '',
            dest_name: document.getElementById('dest_name')?.value || '',
            dest_addr1: document.getElementById('dest_addr1')?.value || '',
            dest_addr2: document.getElementById('dest_addr2')?.value || '',
            carrier: document.getElementById('carrier')?.value || '',
            obs: document.getElementById('obs')?.value || ''
        };
    }

    const assuntoBase = 'Nota fiscal para envio';
    const assunto = d.reference && d.reference.trim()
        ? `${assuntoBase} - Ticket/OS ${d.reference.trim()}`
        : assuntoBase;

    const body = buildEmailBodyFromData(d);

    const href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;

    window.location.href = href;
}
