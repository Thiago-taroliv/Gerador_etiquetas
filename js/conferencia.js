// Confirmações antes dos passos que saem do sistema: conferir/editar o e-mail ao financeiro
// e o resumo do pedido antes de concluir.
import { escapeHtml } from './config.js';
import { linhasItensEmail } from './render.js';
import { pendenciasEnvio } from './importarEstoque.js';

let responder = null;

function garantirModal() {
    if (document.getElementById('modal-conferir-email')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="modal-conferir-email" class="modal-overlay">
            <div class="modal-card importar-card">
                <div class="modal-header">
                    <strong>Conferir e-mail ao financeiro</strong>
                    <button class="modal-close" onclick="responderConferenciaEmail(false)" title="Cancelar">&times;</button>
                </div>
                <div id="conferir_email_avisos"></div>
                <label>Assunto</label>
                <input id="conferir_email_assunto" type="text">
                <label style="margin-top:10px">Corpo <span style="font-weight:400;color:#888;font-size:12px;">(pode editar)</span></label>
                <textarea id="conferir_email_corpo" class="conferir-email-corpo" rows="18"></textarea>
                <div class="modal-actions">
                    <button class="btn-neutral" onclick="responderConferenciaEmail(false)">Cancelar</button>
                    <button onclick="responderConferenciaEmail(true)">Abrir e-mail</button>
                </div>
            </div>
        </div>`);
}

// Resolve com { assunto, corpo } (como ficou depois de editar) ou null se cancelou
export function conferirEmail({ assunto, corpo, avisos = [] }) {
    garantirModal();
    document.getElementById('conferir_email_avisos').innerHTML =
        avisos.map(a => `<div class="estoque-aviso">⚠ ${escapeHtml(a)}</div>`).join('');
    document.getElementById('conferir_email_assunto').value = assunto;
    document.getElementById('conferir_email_corpo').value = corpo;
    document.getElementById('modal-conferir-email').style.display = 'flex';
    return new Promise(resolve => { responder = resolve; });
}

window.responderConferenciaEmail = function (ok) {
    document.getElementById('modal-conferir-email').style.display = 'none';
    const r = responder;
    responder = null;
    r?.(ok ? {
        assunto: document.getElementById('conferir_email_assunto').value,
        corpo: document.getElementById('conferir_email_corpo').value
    } : null);
};

// Texto do resumo mostrado antes de concluir o pedido (vai para o Histórico)
export function resumoDoPedido(d) {
    const refTipo = d.reference_type === 'os' ? 'OS' : d.reference_type === 'ticket' ? 'Ticket' : 'Referência';
    const ref = d.reference_type !== 'none' && String(d.reference || '').trim() ? `${refTipo} ${d.reference}` : 'sem referência';
    const kits = (d.items || []).filter(it => it.papel === 'kit' || it.kit);
    const linhas = [
        `Destinatário: ${d.dest_name || '(vazio)'}${d.unit_name ? ` · Unidade: ${d.unit_name}` : ''}`,
        `Referência: ${ref} · Volumes: ${d.total_vol || '(vazio)'} · Transportadora: ${d.carrier || '(vazio)'}`,
        kits.length ? `Kits: ${kits.map(k => `${k.qty} x ${k.desc}`).join(', ')}` : 'Kits: nenhum',
        '',
        'Itens:',
        (d.items || []).length ? linhasItensEmail(d.items, refTipo) : '(nenhum item)'
    ];
    // Pendências só para envios importados da planilha de estoque (os digitados não têm Tipo etc.)
    const pend = d.origem ? pendenciasEnvio(d) : [];
    if (pend.length) linhas.push('', `⚠ Falta preencher: ${pend.join(', ')}`);
    return linhas.join('\n');
}
