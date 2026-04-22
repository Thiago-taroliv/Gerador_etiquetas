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
                    <div style="font-size:28px;color:var(--brand);font-weight:700;margin-bottom:12px;">Romaneio de Entrega</div>
                    <div style="margin-bottom:12px;padding:8px;background:#f9f9f9;border-bottom:2px solid var(--brand);">
                        <strong>Empresa:</strong> ${escapeHtml(data.sender_company)} | <strong>CNPJ:</strong> ${escapeHtml(data.sender_cnpj)}<br>
                        <strong>Endereço:</strong> ${escapeHtml(data.sender_address)}
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
                    <div style="position:absolute;top:16px;right:16px;background:#fff3cd;border:1px solid #ffc107;padding:8px;border-radius:3px;max-width:280px;font-size:11px;line-height:1.4;z-index:10;">
                        <strong>IMPORTANTE:</strong> Assinar documento e enviar foto para WhatsApp Ranor.
                    </div>
                    <div style="margin-bottom:8px;margin-top:16px;background:var(--brand);color:#fff;display:inline-block;padding:6px 10px;border-radius:2px;font-weight:bold;font-size:13px;">
                        Descrição das Mercadorias
                    </div>
                `;
                showGlobalHeader = false;
            }
            
            // Cabeçalho do cliente aparece só na primeira página do grupo
            const clientHeaderHTML = isFirstPageOfThisClient ? `
                <div style="margin-bottom:8px;padding:6px 10px;background:#f5f5f5;border-left:3px solid var(--brand);">
                    <strong>Cliente:</strong> ${escapeHtml(clientName)}
                </div>
            ` : '';
            
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
        
        items.forEach((item, itemIdx) => {
            // Se a página atual já está cheia, fechar e abrir nova
            if (currentPage !== null && itemsInCurrentPage >= MAX_ITEMS_PER_PAGE) {
                flushClientPage(false);
                pages.push(currentPage);
                currentPage = null;
                itemsInCurrentPage = 0;
                // Não é mais a primeira página deste cliente, mas mostra cabeçalho de continuação
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

export function renderEmailPreview(data) {
    const emailBox = document.createElement('div');
    emailBox.className = 'page';
    const itemLines = data.items.map(it => `${it.qty} x ${it.desc}`).join('\n');
    const isMultiMode = data.client_mode === 'multi';
    let unitDisplay;
    if (isMultiMode) {
        // Multi: extrai lista única de clientes dos itens
        const clientes = [...new Set((data.items || []).map(it => it.client).filter(Boolean))];
        unitDisplay = clientes.length > 0 ? clientes.join(', ') : '[clientes não preenchidos]';
    } else {
        // Simples: usa o campo Cliente/Unidade
        unitDisplay = data.unit_name || data.dest_name || '[destinatário não preenchido]';
    }
    const refType = data.reference_type || 'ticket';
    const refTypeLabel = refType === 'os' ? 'OS' : refType === 'ticket' ? 'Ticket' : 'Fornecedor';
    const ref = data.reference ? data.reference : (refType === 'none' ? 'N/A' : '[preencha a referência]');

    let emailBodyText = `Olá financeiro,\n\n`;
    if (refType === 'none') {
        emailBodyText += `Preciso de uma nota fiscal de envio para ${unitDisplay} (envio para fornecedor).\n\n`;
    } else {
        emailBodyText += `Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) ${refTypeLabel} ${ref}.\n\n`;
    }
    emailBodyText += `Serão:\n${itemLines}\n\nSegue os dados para emissão:\nCNPJ: ${data.dest_doc}\nNome/Razão Social: ${data.dest_name}\nEndereço: ${data.dest_addr1} / ${data.dest_addr2}\nProvável envio por: ${data.carrier}\n`;

    emailBox.innerHTML = `
        <div>
            <div style="font-size:18px;color:var(--brand);font-weight:700;margin-bottom:6px">Pré-visualização do e-mail</div>
            <div style="font-weight:700">Assunto:</div>
            <div style="margin-bottom:8px;font-size:12px;">Nota fiscal para envio${refType !== 'none' ? ` - ${refTypeLabel} ${escapeHtml(ref)}` : ''}</div>
            <div style="font-weight:700;margin-top:8px;">Corpo:</div>
            <pre class="email-box" id="email_preview">${escapeHtml(emailBodyText)}</pre>
        </div>
    `;
    window.__lastEmailBody = emailBodyText;
    AppState.emailBody = emailBodyText;
    return emailBox;
}

export function composeDocuments(data, docType) {
    const elements = [];
    if (docType === 'labels' || docType === 'both') elements.push(renderLabels(data));
    if (docType === 'romaneio' || docType === 'both') elements.push(renderRomaneio(data));
    return elements;
}
