import { $, escapeHtml, SENDERS } from './config.js';

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
    const desc = '';
    const qty = 1;
    const tbody = $('items_body');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="it-desc" value="${escapeHtml(desc)}" style="width:100%;border:0;outline:none"></td>
                    <td><input class="it-qty" type="number" value="${qty}" min="1" style="width:100%;border:0;outline:none"></td>
                    <td class="center"><button type="button" onclick="removeItem(this)">✕</button></td>`;
    tbody.appendChild(tr);
}

export function removeItem(btn) {
    btn.closest('tr').remove();
}

export function clearItems() {
    $('items_body').innerHTML = '';
}

export function collectData() {
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
