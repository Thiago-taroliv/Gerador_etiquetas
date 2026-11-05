// Pedido de PIX do frete ao financeiro, para envios pagos por PIX (oferecido ao despachar).
// O formulário vem preenchido com os dados do pedido; o que o sistema não sabe (chave, etapa) é digitado na hora.
import { config } from './configuracoes.js';
import { conferirEmail } from './conferencia.js';
import { formatarFrete, lerValor, separarEnderecoLinha2 } from './planilha.js';
import { toast } from './toast.js';

const MOTIVO_POR_TIPO = { INS: 'Instalação', COR: 'Correção', MAN: 'Manutenção', FOR: 'Fornecedor' };
const CAMPOS = ['valor', 'etapa', 'transportadora', 'projeto', 'referencia', 'motivo', 'destino', 'chave'];

const campo = nome => document.getElementById(`pix_frete_${nome}`);
const modal = () => document.getElementById('modal-pix-frete');

let rotuloRef = 'OS'; // OS ou Ticket, conforme o pedido aberto

// "Votorantim - Itajaí": cliente da planilha + unidade (no modo multi, os clientes dos itens)
function projetoDoPedido(reg) {
    const d = reg.dados_completos || {};
    if (d.client_mode === 'multi') {
        const clientes = [...new Set((d.items || []).map(it => it.client).filter(Boolean))];
        if (clientes.length) return clientes.join(', ');
    }
    const cliente = String(d.planilha_cliente || '').trim();
    const unidade = String(d.unit_name || '').trim();
    if (!cliente && !unidade) return reg.unidade || reg.destinatario || '';
    if (!cliente || !unidade) return cliente || unidade;
    return unidade.toLowerCase().includes(cliente.toLowerCase()) ? unidade : `${cliente} - ${unidade}`;
}

// Valores iniciais do formulário, a partir do registro do histórico
export function camposPixFrete(reg) {
    const d = reg.dados_completos || {};
    const semReferencia = d.reference_type === 'none';
    return {
        rotuloRef: d.reference_type === 'ticket' ? 'Ticket' : 'OS',
        valor: formatarFrete(reg.frete),
        etapa: '',
        transportadora: reg.transportadora || d.carrier || '',
        projeto: projetoDoPedido(reg),
        referencia: semReferencia ? '' : String(d.reference || reg.referencia || '').trim(),
        motivo: MOTIVO_POR_TIPO[d.planilha_tipo] || '',
        destino: separarEnderecoLinha2(d.dest_addr2).cidade,
        chave: ''
    };
}

function saudacaoDoHorario(hora) {
    if (hora < 12) return 'Bom dia';
    return hora < 18 ? 'Boa tarde' : 'Boa noite';
}

// valor: número. Retorna { assunto, corpo }
export function montarEmailPixFrete(c, hora = new Date().getHours()) {
    const etapa = c.etapa ? ` (${c.etapa} etapa)` : '';
    const rotulo = c.rotuloRef || 'OS';
    return {
        assunto: `Solicitação de pix frete${c.referencia ? ` - ${rotulo} ${c.referencia}` : ''}`,
        corpo: [
            `${saudacaoDoHorario(hora)} Financeiro, tudo bem?`,
            '',
            `Solicitação de pix frete${etapa}:`,
            '',
            `Valor: R$ ${formatarFrete(c.valor)}`,
            `Meio de transporte/Transportadora: ${c.transportadora}`,
            `Projeto: ${c.projeto}`,
            `${rotulo}: ${c.referencia}`,
            `Motivo: ${c.motivo}`,
            `Destino: ${c.destino}${etapa}`,
            'Chave pix:',
            c.chave
        ].join('\n')
    };
}

function garantirModal() {
    if (modal()) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="modal-pix-frete" class="modal-overlay">
            <div class="modal-card">
                <div class="modal-header">
                    <strong>Pedir PIX do frete</strong>
                    <button class="modal-close" onclick="fecharPixFrete()" title="Cancelar">&times;</button>
                </div>
                <div class="pix-frete-grid">
                    <div>
                        <label for="pix_frete_valor">Valor (R$)</label>
                        <input id="pix_frete_valor" type="text" placeholder="620,00">
                    </div>
                    <div>
                        <label for="pix_frete_etapa">Etapa</label>
                        <select id="pix_frete_etapa">
                            <option value="">Sem etapa</option>
                            <option value="1ª">1ª etapa</option>
                            <option value="2ª">2ª etapa</option>
                            <option value="3ª">3ª etapa</option>
                        </select>
                    </div>
                </div>
                <label for="pix_frete_transportadora">Meio de transporte/Transportadora</label>
                <input id="pix_frete_transportadora" type="text">
                <label for="pix_frete_projeto">Projeto</label>
                <input id="pix_frete_projeto" type="text">
                <div class="pix-frete-grid">
                    <div>
                        <label id="pix_frete_referencia_rotulo" for="pix_frete_referencia">OS</label>
                        <input id="pix_frete_referencia" type="text">
                    </div>
                    <div>
                        <label for="pix_frete_destino">Destino</label>
                        <input id="pix_frete_destino" type="text">
                    </div>
                </div>
                <label for="pix_frete_motivo">Motivo</label>
                <input id="pix_frete_motivo" type="text" placeholder="Instalação emergencial">
                <label for="pix_frete_chave">Chave pix</label>
                <input id="pix_frete_chave" type="text">
                <div class="modal-actions">
                    <button class="btn-neutral" onclick="fecharPixFrete()">Cancelar</button>
                    <button onclick="enviarPixFrete()">Conferir e-mail</button>
                </div>
            </div>
        </div>`);
}

export function abrirPixFrete(reg) {
    if (!reg) return;
    garantirModal();
    const inicial = camposPixFrete(reg);
    rotuloRef = inicial.rotuloRef;
    CAMPOS.forEach(nome => { campo(nome).value = inicial[nome]; });
    document.getElementById('pix_frete_referencia_rotulo').textContent = rotuloRef;
    modal().style.display = 'flex';
    campo(inicial.valor ? 'chave' : 'valor').focus();
}

// Logo depois de despachar: a opção fica num aviso, e continua no detalhe do pedido
export function oferecerPixFrete(reg) {
    if (!reg) return;
    toast('Pedido despachado.', 'success', 15000, { label: 'Pedir PIX do frete', onClick: () => abrirPixFrete(reg) });
}

window.fecharPixFrete = () => { modal().style.display = 'none'; };

window.enviarPixFrete = async function () {
    const c = { rotuloRef };
    CAMPOS.forEach(nome => { c[nome] = campo(nome).value.trim(); });
    c.valor = lerValor(c.valor);
    if (!c.valor) { toast('Informe o valor do frete, por exemplo 620,00.', 'warning'); campo('valor').focus(); return; }
    if (!c.chave) { toast('Informe a chave pix.', 'warning'); campo('chave').focus(); return; }

    modal().style.display = 'none';
    const conferido = await conferirEmail(montarEmailPixFrete(c));
    if (!conferido) { modal().style.display = 'flex'; return; } // volta ao formulário sem perder o digitado

    const emails = config('financeiro_emails').join(';');
    window.location.href = `mailto:${emails}?subject=${encodeURIComponent(conferido.assunto)}&body=${encodeURIComponent(conferido.corpo)}`;
};
