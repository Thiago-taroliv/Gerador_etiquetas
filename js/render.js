import { escapeHtml, AppState } from './config.js';
import { collectData } from './ui.js';

export function renderLabels(data) {
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

export function renderRomaneio(data) {
    const rom = document.createElement('div');
    rom.className = 'page';

    let rows = '';
    for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        rows += `<tr>
            <td>${escapeHtml(it.desc)}</td>
            <td style="width:12%;text-align:center">${escapeHtml(it.qty)}</td>
        </tr>`;
    }

    if (data.items.length < 6) {
        for (let i = data.items.length; i < 6; i++) {
            rows += '<tr><td></td><td></td></tr>';
        }
    }

    rom.innerHTML = `
        <div>
            <div style="font-size:30px;color:var(--brand);font-weight:700;margin-bottom:6px">Romaneio de Entrega</div>
            <div style="margin-bottom:8px;">
                <strong>Empresa:</strong> ${escapeHtml(data.sender_company)} &nbsp;&nbsp;
                <strong>CNPJ:</strong> ${escapeHtml(data.sender_cnpj)}<br>
                <strong>Endereço:</strong> ${escapeHtml(data.sender_address)}
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
            <br><hr><br>
            <div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:2px">Descrição das Mercadorias</div>
            <table class="romaneio-table" style="margin-top:8px;width:100%;border-collapse:collapse;">
                <thead style="background:#f6f6f6;">
                    <tr>
                        <th>Descrição do Produto</th>
                        <th style="width:12%;">Qtd.</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:8px;"><strong>Total de Volumes (CAIXAS):</strong> ${escapeHtml(String(data.total_vol))}</div>
            <footer style="margin-top:12px;">
            <div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:2px">Recebimento</div>
            <div style="margin-top:8px;">
                <strong>Data (chegada/assinatura):</strong> _____/_____/_______<br>
                <strong>Recebedor/Responsável:</strong> ${escapeHtml(data.receiver)}<br><br>
                <div style="margin-top:20px;border-top:1px;width:60%;padding-top:6px"><strong>Assinatura: ______________________________________________</strong></div>
            </div>
            </footer>
        </div>
    `;
    return rom;
}

export function renderEmailPreview(data) {
    const emailBox = document.createElement('div');
    emailBox.className = 'page';
    const itemLines = data.items.map(it => `${it.qty} x ${it.desc}`).join('\n');
    const unitDisplay = data.unit_name || '[unidade não preenchida]';
    const ref = data.reference ? data.reference : '[preencha Ticket/OS]';

    const bodyText = `Olá financeiro,\n\nPreciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) Ticket/OS ${ref}.\n\nSerão:\n${itemLines}\n\nSegue os dados para emissão:\nCNPJ: ${data.dest_doc}\nNome/Razão Social: ${data.dest_name}\nEndereço: ${data.dest_addr1} / ${data.dest_addr2}\nProvável envio por: ${data.carrier}${data.obs ? '\n\nObservações:\n' + data.obs : ''}\n`;

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

export function composeDocuments(data, docType) {
    const elements = [];
    if (docType === 'labels' || docType === 'both') elements.push(renderLabels(data));
    if (docType === 'romaneio' || docType === 'both') elements.push(renderRomaneio(data));
    return elements;
}
