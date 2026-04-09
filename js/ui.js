import { $, escapeHtml, SENDERS } from './config.js';
import { searchItems, addItem as addItemToDB } from './items.js';

export function onSenderChange() {
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

export function onClientSelect() {
    const idx = $('client_select').value;
    if (idx === '') return;
    const arr = window.__destinatariosSupabase || [];
    const rec = arr[parseInt(idx)];
    if (!rec) return;

    $('dest_name').value = rec.nome || '';
    $('dest_doc').value = rec.cpf_cnpj || '';
    $('dest_addr1').value = rec.endereco_linha1 || '';
    $('dest_addr2').value = rec.endereco_linha2 || '';
    $('dest_phone').value = rec.contato || '';
}

export function addItem() {
    const container = $('items_container');
    const itemIdx = container.children.length;
    
    const itemCard = document.createElement('div');
    itemCard.className = 'item-card';
    itemCard.style.cssText = 'border: 1px solid #ddd; padding: 12px; border-radius: 4px; background: #fafafa;';
    itemCard.dataset.itemIdx = itemIdx;
    
    const multiMode = document.querySelector('input[name="client_mode"]:checked')?.value === 'multi';
    
    let clientFieldHTML = '';
    if (multiMode) {
        clientFieldHTML = `
            <div style="margin-bottom: 8px;">
                <label style="font-size: 12px;">Cliente:</label>
                <input class="it-client" type="text" placeholder="Ex: Martin Brower" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:2px; font-size:12px;">
            </div>
        `;
    }
    
    const descInputId = `desc-input-${itemIdx}`;
    const suggestionsId = `suggestions-${itemIdx}`;
    
    itemCard.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:8px;align-items:flex-start;">
            <div style="flex:1;position:relative;">
                <label style="font-size:12px;">Descrição:</label>
                <input class="it-desc" id="${descInputId}" type="text" value="" placeholder="Começe a digitar..." style="width:100%; padding:4px; border:1px solid #ccc; border-radius:2px; font-size:12px;">
                <div id="${suggestionsId}" class="autocomplete-suggestions" style="position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:0;border-radius:0 0 2px 2px;display:none;z-index:100;max-height:200px;overflow-y:auto;box-shadow:0 4px 6px rgba(0,0,0,0.1);"></div>
            </div>
            <div style="width:70px;">
                <label style="font-size:12px;">Qtd:</label>
                <input class="it-qty" type="number" value="1" min="1" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:2px;">
            </div>
            <button type="button" class="it-remove" onclick="removeItem(this)" style="align-self:flex-end; padding:4px 8px; background:#f44; color:#fff; border:0; border-radius:2px; cursor:pointer;">✕</button>
        </div>
        ${clientFieldHTML}
        <div style="cursor:pointer;padding:6px;background:#007bff;color:#fff;border-radius:2px;font-size:12px;text-align:center;" onclick="toggleIMEISection(this)">
            + Adicionar IMEIs
        </div>
        <div class="it-imei-section" style="display:none;margin-top:8px;padding:8px;background:#fff;border:1px solid #007bff;border-radius:2px;">
            <div style="margin-bottom:8px;">
                <label style="font-size:12px;font-weight:bold;">IMEIs/Números Identificadores:</label>
                <div class="small" style="font-size:11px;color:#666;margin-bottom:6px;">Cole em massa (um por linha ou TAB para kits):</div>
                <textarea class="it-imei-input" placeholder="Cole aqui..." style="width:100%;height:80px;padding:6px;font-family:monospace;font-size:11px;border:1px solid #ccc;border-radius:2px;"></textarea>
            </div>
            <button type="button" onclick="procesarIMEIs(this)" style="width:100%;padding:6px;background:#28a745;color:#fff;border:0;border-radius:2px;cursor:pointer;font-size:12px;">Processar IMEIs</button>
            <div class="it-imei-list" style="margin-top:8px;"></div>
        </div>
    `;
    
    container.appendChild(itemCard);
    
    // Adicionar event listeners para autocomplete
    const descInput = document.getElementById(descInputId);
    const suggestionsDiv = document.getElementById(suggestionsId);
    
    descInput.addEventListener('input', function() {
        const query = this.value.trim();
        if (query.length === 0) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        const results = searchItems(query);
        if (results.length === 0) {
            suggestionsDiv.innerHTML = '<div style="padding:8px;color:#999;font-size:12px;">Sem resultados. <strong>ENTER</strong> para criar novo.</div>';
            suggestionsDiv.style.display = 'block';
            return;
        }
        
        suggestionsDiv.innerHTML = results.slice(0, 8).map(item => 
            `<div onclick="selectItemSuggestion(this)" style="padding:8px;cursor:pointer;border-bottom:1px solid #eee;font-size:12px;">${escapeHtml(item)}</div>`
        ).join('');
        suggestionsDiv.style.display = 'block';
    });
    
    descInput.addEventListener('keydown', async function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = this.value.trim();
            if (value && value.length > 0) {
                // Tentar adicionar como novo item
                await addItemToDB(value);
                suggestionsDiv.style.display = 'none';
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    descInput.addEventListener('blur', function() {
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 100);
    });
}

export function removeItem(btn) {
    btn.closest('.item-card').remove();
}

export function clearItems() {
    $('items_container').innerHTML = '';
}

export function collectData() {
    const isMultiMode = document.querySelector('input[name="client_mode"]:checked')?.value === 'multi';
    
    const items = Array.from(document.querySelectorAll('.item-card'))
        .map(card => {
            const desc = card.querySelector('.it-desc')?.value || '';
            const qty = card.querySelector('.it-qty')?.value || '1';
            // Se modo multi, usar client declarado se existir, senão usar unit_name
            const client = isMultiMode ? (card.querySelector('.it-client')?.value || '') : '';
            
            // Coletar IMEIs da seção
            const imeiList = card.querySelector('.it-imei-list');
            const imeis = [];
            
            if (imeiList) {
                imeiList.querySelectorAll('.imei-item').forEach(item => {
                    const imeiValue = item.dataset.imei;
                    if (imeiValue) {
                        // Verificar se é kit (contém |)
                        if (imeiValue.includes('|')) {
                            const [rastreador, teclado] = imeiValue.split('|');
                            imeis.push({ tipo: 'kit', rastreador, teclado });
                        } else {
                            imeis.push({ tipo: 'simples', imei: imeiValue });
                        }
                    }
                });
            }
            
            return { desc, qty, client, imeis };
        })
        .filter(it => it.desc.trim() !== '');
    
    return {
        sender_company: $('sender_company').value || '',
        sender_cnpj: $('sender_cnpj').value || '',
        sender_address: $('sender_address').value || '',
        unit_name: $('unit_name').value || '',
        dest_name: $('dest_name').value || '',
        dest_doc: $('dest_doc').value || '',
        dest_addr1: $('dest_addr1').value || '',
        dest_addr2: $('dest_addr2').value || '',
        total_vol: Math.max(1, parseInt($('total_vol').value || 1)),
        reference: $('reference').value || '',
        reference_type: $('reference_type')?.value || 'ticket',
        carrier: $('carrier').value || '',
        receiver: $('receiver').value || '',
        client_mode: isMultiMode ? 'multi' : 'single',
        items: items
    };
}
