const SENDERS = {
    ranor: { company: 'Ranor Rastreamento', cnpj: '10.980.591/0001-64', address: 'Coronel João de Barros, 427B \n 37900-049 - Centro, Passos-MG' },
    nortrack: { company: 'NORTRACK OPERAÇÕES LTDA', cnpj: '58.231.979/0001-99', address: 'R JULIETA FILIPINI,47, SALA 01 \n 06030-510 – UMUARAMA, OSASCO – SP' }
};

const STORAGE_KEY = 'base_envio_local_v1';

function $(id) { return document.getElementById(id); }

// init
$('sender_select').addEventListener('change', onSenderChange);
$('client_select').addEventListener('change', onClientSelect);
document.getElementById('file_input').addEventListener('change', () => {/* handled by loadJsonFile */ });

function onSenderChange() {
    const v = $('sender_select').value;
    if (v === 'custom') { $('sender_company').readOnly = false; $('sender_cnpj').readOnly = false; $('sender_address').readOnly = false; $('sender_company').value = ''; $('sender_cnpj').value = ''; $('sender_address').value = ''; }
    else { const s = SENDERS[v]; $('sender_company').value = s.company; $('sender_cnpj').value = s.cnpj; $('sender_address').value = s.address; $('sender_company').readOnly = true; $('sender_cnpj').readOnly = true; $('sender_address').readOnly = true; }
    generateAll();
}

(function init() {
    $('sender_select').value = 'ranor'; onSenderChange();
    loadBaseFromStorage();
    document.querySelectorAll('input, textarea, select').forEach(el => { el.addEventListener('change', generateAll); el.addEventListener('input', generateAll); });
    generateAll();
})();

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
            generateAll();
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
    const sel = $('client_select'); sel.innerHTML = '<option value="">— nenhum —</option>';
    arr.forEach((c, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = c.destinatario || ('Registro ' + (i + 1)); sel.appendChild(opt); });
}

function clearBase() { localStorage.removeItem(STORAGE_KEY); populateClientSelect([]); alert('Base limpa.'); }

function onClientSelect() {
    const idx = $('client_select').value; if (idx === '') return;
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return;
    const arr = JSON.parse(raw); const rec = arr[parseInt(idx)];
    if (!rec) return;
    $('dest_name').value = rec.destinatario || '';
    $('dest_doc').value = rec.cpf_cnpj || '';
    $('dest_addr1').value = rec.endereco_linha1 || '';
    $('dest_addr2').value = rec.endereco_linha2 || '';
    $('dest_phone').value = rec.contato || '';
    generateAll();
}

// items
function addItem(desc = '', qty = 1) { const tbody = $('items_body'); const tr = document.createElement('tr'); tr.innerHTML = '<td><input class="it-desc" value="' + escapeHtml(desc) + '" style="width:100%;border:0;outline:none"></td><td><input class="it-qty" type="number" value="' + qty + '" min="1" style="width:100%;border:0;outline:none"></td><td class="center"><button type="button" onclick="removeItem(this)">✕</button></td>'; tbody.appendChild(tr); }
function removeItem(btn) { btn.closest('tr').remove(); generateAll(); }
function clearItems() { $('items_body').innerHTML = ''; generateAll(); }

function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
        date: $('send_date').value || '', // blank by default
        total_vol: Math.max(1, parseInt($('total_vol').value || 1)),
        reference: $('reference').value || '',
        carrier: $('carrier').value || '',
        receiver: $('receiver').value || '',
        items: Array.from(document.querySelectorAll('#items_body tr')).map(tr => { const d = tr.querySelector('.it-desc')?.value || ''; const q = tr.querySelector('.it-qty')?.value || '1'; return { desc: d, qty: q }; }).filter(it => it.desc.trim() !== '')
    };
}

function generateAll() { const d = collectData(); if (d.items.length === 0) return; renderPreview(d); }

function enviarEmail() {

    const destinatario = "financeiro@empresa.com";
    const assunto = encodeURIComponent("Nota Fiscal de Envio");
    const corpo = encodeURIComponent(
        "Olá Financeiro,\n\n" +
        "Segue envio para a unidade: VAMOS - Ponta Grossa.\n\n" +
        "Qualquer dúvida fico à disposição."
    );

    window.location.href =
        `mailto:${destinatario}?subject=${assunto}&body=${corpo}`;
}

function renderPreview(d) {
    const preview = $('preview'); preview.innerHTML = '';

    // labels sheet (A4 grid)
    const sheet = document.createElement('div'); sheet.className = 'page labels-sheet'; const grid = document.createElement('div'); grid.className = 'labels-grid';
    for (let i = 0; i < d.total_vol; i++) { const box = document.createElement('div'); box.className = 'label-box'; box.innerHTML = `<div style="font-weight:700;color:#c00;font-size:13px;">${escapeHtml(d.sender_company.toUpperCase())}</div><div style="margin-top:6px;"><strong>DESTINATÁRIO</strong><br>${escapeHtml(d.dest_name)}<br>${escapeHtml(d.dest_doc)}<br>${escapeHtml(d.dest_addr1)}<br>${escapeHtml(d.dest_addr2)}</div><hr style="margin:6px 0;"><div style="font-size:12px;"><strong>REMETENTE:</strong><br>${escapeHtml(d.sender_company)}<br>${escapeHtml(d.sender_address)}<br>CNPJ: ${escapeHtml(d.sender_cnpj)}</div>${d.obs ? '<div style="margin-top:6px;font-size:12px;"><strong>OBS:</strong> ' + escapeHtml(d.obs) + '</div>' : ''}<div style="margin-top:6px;font-size:12px;"><strong>Etiqueta:</strong> ${i + 1} / ${d.total_vol}</div>`; grid.appendChild(box); }
    sheet.appendChild(grid); preview.appendChild(sheet);

    // romaneio (single)
    const rom = document.createElement('div'); rom.className = 'page'; let rows = ''; for (let i = 0; i < d.items.length; i++) { const it = d.items[i]; rows += `<tr><td style="width:6%;text-align:center">${i + 1}</td><td>${escapeHtml(it.desc)}</td><td style="width:12%;text-align:center">${escapeHtml(it.qty)}</td></tr>`; }
    rom.innerHTML = `<div><div style="font-size:20px;color:var(--brand);font-weight:700;margin-bottom:6px">Romaneio de Entrega</div><div style="margin-bottom:8px;"><strong>Empresa:</strong> ${escapeHtml(d.sender_company)} &nbsp;&nbsp; <strong>CNPJ:</strong> ${escapeHtml(d.sender_cnpj)}<br><strong>endereço:</strong> ${escapeHtml(d.sender_address)}</div><div style="display:flex;gap:12px;"><div style="flex:1;"><strong>Cliente/Destinatário:</strong><br><span style="text-decoration:underline;">${escapeHtml(d.dest_name)}</span><br>${escapeHtml(d.dest_doc)}</div><div style="flex:1;"><strong>Endereço de entrega:</strong><br>${escapeHtml(d.dest_addr1)}<br>${escapeHtml(d.dest_addr2)}</div></div><div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:4px">Descrição das Mercadorias</div><table class="romaneio-table" style="margin-top:8px;width:100%;border-collapse:collapse;"><thead style="background:#f6f6f6;"><tr><th style="width:6%;">Item</th><th>Descrição do Produto</th><th style="width:12%;">Qtd.</th></tr></thead><tbody>${rows}${d.items.length < 6 ? Array.from({ length: 6 - d.items.length }).map(() => '<tr><td></td><td></td><td></td></tr>').join('') : ''}</tbody></table><div style="margin-top:8px;"><strong>Total de Volumes:</strong> ${escapeHtml(String(d.total_vol))}</div><div style="margin-top:12px;background:var(--brand);color:#fff;display:inline-block;padding:6px 8px;border-radius:4px">Recebimento</div><div style="margin-top:8px;"><strong>Data (chegada/assinatura):</strong> ${escapeHtml(d.date)}<br><strong>Recebedor/Responsável:</strong> ${escapeHtml(d.receiver)}<br><div style="margin-top:8px;border-top:1px dashed #aaa;width:60%;padding-top:6px">Assinatura</div></div></div>`;
    preview.appendChild(rom);

    // email preview - use a template literal (multi-line) so new lines render correctly
    const emailBox = document.createElement('div'); emailBox.className = 'page';
    const itemLines = d.items.map(it => `${it.qty} x ${it.desc}`).join('\n');
    const unitDisplay = d.unit_name || '[unidade não preenchida]';
    const ref = d.reference ? d.reference : '[preencha Ticket/OS]';

    const bodyText = `Olá financeiro,

Preciso de uma nota fiscal de envio para ${unitDisplay} referente a(o) Ticket/OS ${ref}.

Serão:
${itemLines}

Segue os dados para emissão:
CNPJ: ${d.dest_doc}
Nome/Razão Social: ${d.dest_name}
Endereço: ${d.dest_addr1} / ${d.dest_addr2}
Provável envio por: ${d.carrier}
`;

    emailBox.innerHTML = `<div>
      <div style="font-size:18px;color:var(--brand);font-weight:700;margin-bottom:6px">Pré-visualização do e-mail para financeiro</div>
      <div style="font-weight:700">Assunto sugerido:</div>
      <div style="margin-bottom:8px">Nota fiscal para envio - Ticket/OS ${escapeHtml(ref)}</div>
      <div style="font-weight:700">Corpo do e-mail sugerido:</div>
      <pre class="email-box" id="email_preview">${escapeHtml(bodyText)}</pre>
      <div class="small" style="margin-top:8px;color:var(--muted)">Copie o texto e cole no e-mail do financeiro.</div>
    </div>`;

    preview.appendChild(emailBox);
    window.__lastEmailBody = bodyText;
}

function openPreviewNewTab() {
     const content = document.getElementById('preview').innerHTML; const style = Array.from(document.querySelectorAll('style')).map(s => s.innerHTML).join('\n'); const win = window.open('', '_blank'); const doc = win.document; doc.open(); doc.write(`<!doctype html><meta charset="utf-8"><title>Preview Impressão</title><style>${style}</style><body>${content}</body>`); doc.close(); setTimeout(() => win.focus(), 200);
     }

function copyEmailBody() { 
    if (!window.__lastEmailBody) { alert('Gere os documentos primeiro.'); return; } navigator.clipboard.writeText(window.__lastEmailBody).then(() => alert('Corpo do e-mail copiado.')).catch(err => alert('Erro ao copiar: ' + err));
 }
// ===== substituir / adicionar: envio via mailto com corpo completo (igual preview) =====

function buildEmailBodyFromData(d) {
  const unitDisplay = d.unit_name && d.unit_name.trim() ? d.unit_name.trim() : (d.dest_name && d.dest_name.trim() ? d.dest_name.trim() : '[unidade não preenchida]');
  const ref = d.reference && d.reference.trim() ? d.reference.trim() : '[preencha Ticket/OS]';

  // items -> linhas "7 x RASTREADOR RA24"
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
    ''
  ];

  return lines.join('\n');
}

function enviarEmailViaMailtoUsingData() {
  // destinatárias fixas
  const emails = 'michele.miranda@ranor.com.br;jaqueline.cristiane@ranor.com.br';

  // pega dados do formulário via sua função collectData()
  let d = { };
  try {
    d = collectData();
  } catch (e) {
    // fallback mínimo se collectData não existir
    d = {
      unit_name: document.getElementById('unit_name')?.value || '',
      reference: document.getElementById('reference')?.value || '',
      items: [],
      dest_doc: document.getElementById('dest_doc')?.value || '',
      dest_name: document.getElementById('dest_name')?.value || '',
      dest_addr1: document.getElementById('dest_addr1')?.value || '',
      dest_addr2: document.getElementById('dest_addr2')?.value || '',
      carrier: document.getElementById('carrier')?.value || ''
    };
  }

  // assunto (mesmo padrão do preview)
  const assuntoBase = 'Nota fiscal para envio';
  const assunto = d.reference && d.reference.trim()
    ? `${assuntoBase} - Ticket/OS ${d.reference.trim()}`
    : assuntoBase;

  // corpo (construído igual ao preview)
  const body = buildEmailBodyFromData(d);

  // monta mailto e abre
  const href = `mailto:${emails}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(body)}`;

  // Abre cliente padrão (Outlook desktop quando configurado)
  window.location.href = href;
}

// liga o botão (sem script inline)
document.addEventListener('DOMContentLoaded', () => {
  const botao = document.getElementById('btnEnviar');
  if (!botao) {
    console.warn('Botão #btnEnviar não encontrado.');
    return;
  }
  botao.addEventListener('click', (ev) => {
    ev.preventDefault();
    // Gera preview atualizado (opcional) e abre o mailto com corpo completo
    try { generateAll(); } catch(e) { /* ignore */ }
    enviarEmailViaMailtoUsingData();
  });
});