import { escapeHtml, AppState } from './config.js';

// Escapa e preserva quebras de linha (ex: endereço do remetente)
function escapeMultiline(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
}

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
                ${data.dest_phone ? `<br>Contato: ${escapeHtml(data.dest_phone)}` : ''}
            </div>
            <hr style="margin:6px 0;">
            <div style="font-size:12px;"><strong>REMETENTE:</strong><br>
                ${escapeHtml(data.sender_company)}<br>
                ${escapeMultiline(data.sender_address)}<br>
                CNPJ: ${escapeHtml(data.sender_cnpj)}
            </div>
            <div style="margin-top:6px;font-size:12px;"><strong>Etiqueta:</strong> ${i + 1} / ${data.total_vol}</div>
        `;
        grid.appendChild(box);
    }
    sheet.appendChild(grid);
    return sheet;
}

export function renderRomaneio(data) {
    const isMultiMode = data.client_mode === 'multi';
    
    // Se modo múltiplo, agrupar por cliente (usar unit_name como fallback)
    let itemGroups = [];
    if (isMultiMode) {
        const grouped = {};
        data.items.forEach(item => {
            // Multi: agrupa por cliente do item. Simples: usa dest_name
            const client = item.client || data.dest_name || 'Sem cliente';
            if (!grouped[client]) grouped[client] = [];
            grouped[client].push(item);
        });
        itemGroups = Object.entries(grouped).map(([client, items]) => ({ client, items }));
    } else {
        // Modo único: usa o Cliente/Unidade preenchido no formulário
        const clientName = data.unit_name || data.dest_name || 'Cliente';
        itemGroups = [{ client: clientName, items: data.items }];
    }
    
    const pages = [];
    const MAX_ITEMS_PER_PAGE = 10; // itens totais por página (independente de cliente)
    let currentPage = null;
    let itemsInCurrentPage = 0;
    let showGlobalHeader = true;
    
    itemGroups.forEach((group, groupIdx) => {
        const clientName = group.client;
        const items = group.items;
        
        // Para cada item do grupo, adicionar à página atual ou criar nova
        // Mas o cabeçalho do cliente só aparece uma vez por grupo
        let isFirstPageOfThisClient = true;
        let clientPageItems = []; // buffer de itens da página atual para este cliente
        
        const flushClientPage = (isLast) => {
            if (clientPageItems.length === 0) return;
            
            // Se não tem página aberta, cria uma
            if (currentPage === null) {
                currentPage = document.createElement('div');
                currentPage.style.position = 'relative';
                itemsInCurrentPage = 0;
            }
            
            let rows = '';
            clientPageItems.forEach(it => {
                let imeiHTML = '';
                if (it.imeis && it.imeis.length > 0) {
                    imeiHTML = '<div style="margin-top:6px;border-top:1px solid #ddd;padding-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
                    it.imeis.forEach((imeiItem) => {
                        const imeiText = imeiItem.tipo === 'kit'
                            ? `Rastreador: ${escapeHtml(imeiItem.rastreador)}\nTeclado: ${escapeHtml(imeiItem.teclado)}`
                            : `IMEI: ${escapeHtml(imeiItem.imei)}`;
                        imeiHTML += `<div style="font-size:14px;font-family:monospace;padding:3px;background:#f9f9f9;border-left:2px solid #333;"><strong>${imeiText}</strong></div>`;
                    });
                    imeiHTML += '</div>';
                }
                rows += `<tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:8px;">${escapeHtml(it.desc)}${imeiHTML}</td>
                    <td style="width:12%;text-align:center;padding:8px;font-size:14px;"><strong>${escapeHtml(it.qty)}</strong></td>
                </tr>`;
            });
            
            let globalHeaderHTML = '';
            if (showGlobalHeader) {
                globalHeaderHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px;">
                        <div style="font-size:28px;color:var(--brand);font-weight:700;">Romaneio de Entrega</div>
                        <div style="background:#fff3cd;border:1px solid #ffc107;padding:8px;border-radius:3px;max-width:280px;font-size:11px;line-height:1.4;">
                            <strong>IMPORTANTE:</strong> Assinar documento e enviar foto para WhatsApp Ranor.
                        </div>
                    </div>
                    <div style="margin-bottom:12px;padding:8px;background:#f9f9f9;border-bottom:2px solid var(--brand);">
                        <strong>Empresa:</strong> ${escapeHtml(data.sender_company)} | <strong>CNPJ:</strong> ${escapeHtml(data.sender_cnpj)}<br>
                        <strong>Endereço:</strong> ${escapeMultiline(data.sender_address)}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:12px;">
                        <div>
                            <strong>Técnico/Responsável:</strong><br>
                            <span style="text-decoration:underline;">${escapeHtml(data.dest_name)}</span><br>
                            ${escapeHtml(data.dest_doc)}
                        </div>
                        <div>
                            <strong>Endereço entrega:</strong><br>
                            ${escapeHtml(data.dest_addr1)}<br>
                            ${escapeHtml(data.dest_addr2)}
                        </div>
                    </div>
                    <div style="margin-bottom:8px;margin-top:16px;background:var(--brand);color:#fff;display:inline-block;padding:6px 10px;border-radius:2px;font-weight:bold;font-size:13px;">
                        Descrição das Mercadorias
                    </div>
                `;
                showGlobalHeader = false;
            }
            
            // Cabeçalho do cliente; nas páginas seguintes do mesmo grupo indica continuação
            const clientHeaderHTML = `
                <div style="margin-bottom:8px;padding:6px 10px;background:#f5f5f5;border-left:3px solid var(--brand);">
                    <strong>Cliente:</strong> ${escapeHtml(clientName)}${isFirstPageOfThisClient ? '' : ' <em>(continuação)</em>'}
                </div>
            `;
            
            const clientSection = `
                <div style="margin-bottom:16px;${itemsInCurrentPage > 0 ? 'border-top:2px solid #ddd;padding-top:12px;' : ''}">
                    ${globalHeaderHTML}
                    ${clientHeaderHTML}
                    <table style="width:100%;border-collapse:collapse;margin-top:8px;border:1px solid #ddd;margin-bottom:12px;">
                        <thead style="background:#f6f6f6;border-bottom:2px solid var(--brand);">
                            <tr>
                                <th style="padding:8px;text-align:left;font-weight:bold;font-size:13px;">Descrição do Produto</th>
                                <th style="width:12%;text-align:center;font-weight:bold;font-size:13px;">Qtd</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
            
            currentPage.innerHTML += clientSection;
            itemsInCurrentPage += clientPageItems.length;
            isFirstPageOfThisClient = false;
            clientPageItems = [];
        };
        
        items.forEach((item) => {
            // Conta também os itens ainda no buffer, senão um único cliente nunca quebra página
            if (itemsInCurrentPage + clientPageItems.length >= MAX_ITEMS_PER_PAGE) {
                flushClientPage(false);
                pages.push(currentPage);
                currentPage = null;
                itemsInCurrentPage = 0;
            }
            clientPageItems.push(item);
        });
        
        // Flush itens restantes do cliente
        flushClientPage(true);
    });
    
    // Adicionar última página com rodapé e assinatura
    if (currentPage !== null) {
        const totalPages = pages.length + 1;
        const footer = `
            <footer style="margin-top:20px;border-top:2px solid var(--brand);padding-top:12px;">
                <div style="background:var(--brand);color:#fff;display:inline-block;padding:6px 10px;border-radius:2px;font-weight:bold;font-size:13px;">
                    Recebimento
                </div>
                <div style="margin-top:12px;font-size:12px;">
                    <div style="margin-top:8px;">
                    <strong>Total de Volumes (CAIXAS):</strong> ${escapeHtml(String(data.total_vol))}  
                    </div>
                    <strong>Data (chegada/assinatura):</strong> _____/_____/_______<br>
                    <strong>Recebedor/Responsável:</strong> ${escapeHtml(data.receiver)}<br><br>
                    <div style="margin-top:20px;border-top:2px solid #333;width:70%;padding-top:8px;">
                        <strong>Assinatura: ______________________________________________</strong>
                    </div>
                    <div style="margin-top:8px;font-size:10px;color:#666;">
                        Página ${totalPages}/${totalPages}
                    </div>
                </div>
            </footer>
            
        `;
        
        currentPage.innerHTML += footer;
        pages.push(currentPage);
    }
    
    // Adicionar assinatura em TODAS as páginas anteriores também
    const totalPages = pages.length;
    pages.forEach((p, idx) => {
        // Se não é a última página, adicionar assinatura também
        if (idx < totalPages - 1) {
            const signatureHTML = `
                <footer style="margin-top:20px;border-top:2px solid var(--brand);padding-top:12px;">
                    <div style="background:var(--brand);color:#fff;display:inline-block;padding:6px 10px;border-radius:2px;font-weight:bold;font-size:13px;">
                        Recebimento
                    </div>
                    <div style="margin-top:12px;font-size:12px;">
                        <strong>Data (chegada/assinatura):</strong> _____/_____/_______<br>
                        <strong>Recebedor/Responsável:</strong> ${escapeHtml(data.receiver)}<br><br>
                        <div style="margin-top:20px;border-top:2px solid #333;width:70%;padding-top:8px;">
                            <strong>Assinatura: ______________________________________________</strong>
                        </div>
                        <div style="margin-top:8px;font-size:10px;color:#666;">
                            Página ${idx + 1}/${totalPages}
                        </div>
                    </div>
                </footer>
            `;
            p.innerHTML += signatureHTML;
        }
    });
    
    // Retornar container com todas as páginas
    const container = document.createElement('div');
    pages.forEach((p) => {
        p.className = 'page';
        p.style.position = 'relative';
        container.appendChild(p);
    });
    return container;
}

function getRefInfo(d) {
    const refType = d.reference_type || 'ticket';
    const refTypeLabel = refType === 'os' ? 'OS' : refType === 'ticket' ? 'Ticket' : 'Fornecedor';
    const ref = d.reference && d.reference.trim() ? d.reference.trim() : (refType === 'none' ? 'N/A' : '[preencha a referência]');
    return { refType, refTypeLabel, ref };
}

// Assunto do e-mail ao financeiro (única fonte para preview, cópia e mailto)
export function buildEmailSubject(d) {
    const { refType, refTypeLabel, ref } = getRefInfo(d);
    const assuntoBase = 'Nota fiscal para envio';
    if (refType !== 'none' && d.reference && d.reference.trim()) {
        return `${assuntoBase} - ${refTypeLabel} ${ref}`;
    }
    return assuntoBase;
}

// Corpo do e-mail ao financeiro (única fonte para preview, cópia e mailto)
export function buildEmailBody(d) {
    let unitDisplay;
    if (d.client_mode === 'multi') {
        // Multi: lista todos os clientes únicos dos itens
        const clientes = [...new Set((d.items || []).map(it => it.client).filter(Boolean))];
        unitDisplay = clientes.length > 0 ? clientes.join(', ') : '[clientes não preenchidos]';
    } else {
        // Simples: usa o campo Cliente/Unidade
        unitDisplay = d.unit_name?.trim() || d.dest_name?.trim() || '[destinatário não preenchido]';
    }
    const { refType, refTypeLabel, ref } = getRefInfo(d);
    const itemsLines = (Array.isArray(d.items) && d.items.length) ? d.items.map(it => `${it.qty} x ${it.desc}`).join('\n') : '- (sem itens informados) -';

    let emailText = `Olá financeiro,\n\n`;
    if (refType === 'none') {
        emailText += `Preciso de uma nota fiscal de envio para ${unitDisplay} (envio para fornecedor).\n`;
    } else {
        emailText += `Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) ${refTypeLabel} ${ref}.\n`;
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

export function renderEmailPreview(data) {
    const emailBox = document.createElement('div');
    emailBox.className = 'page';
    const emailBodyText = buildEmailBody(data);

    emailBox.innerHTML = `
        <div>
            <div style="font-size:18px;color:var(--brand);font-weight:700;margin-bottom:6px">Pré-visualização do e-mail</div>
            <div style="font-weight:700">Assunto:</div>
            <div style="margin-bottom:8px;font-size:12px;">${escapeHtml(buildEmailSubject(data))}</div>
            <div style="font-weight:700;margin-top:8px;">Corpo:</div>
            <pre class="email-box" id="email_preview">${escapeHtml(emailBodyText)}</pre>
        </div>
    `;
    AppState.emailBody = emailBodyText;
    return emailBox;
}

export function composeDocuments(data, docType) {
    const elements = [];
    if (docType === 'labels' || docType === 'both') elements.push(renderLabels(data));
    if (docType === 'romaneio' || docType === 'both') elements.push(renderRomaneio(data));
    return elements;
}
