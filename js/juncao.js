// Junção de pedidos: ao pedir a NF, avisa se há outro pedido para o mesmo técnico
// ainda sem nota e permite juntar tudo num envio só.
import { AppState, $, escapeHtml } from './config.js';
import { carregarCandidatosJuncao, cancelarPedido, deletarPendente, FASES } from './db.js';
import { preencherFormulario } from './ui.js';
import { toast } from './toast.js';

// Só procura pedidos criados ou mexidos nestes últimos dias
export const JANELA_JUNCAO_DIAS = 7;
// Fases em que a NF ainda não foi emitida
export const FASES_SEM_NF = ['rascunho', 'aguardando_nf'];

AppState.juncaoPendente = []; // pedidos já juntados no formulário, fechados ao enviar o e-mail

const normDoc = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

// { doc, nome } de um registro do histórico ou rascunho
export const pessoaDoRegistro = reg => ({ doc: reg.dados_completos?.dest_doc, nome: reg.destinatario });

// Mesmo CPF/CNPJ; se algum dos dois não tiver documento, compara o nome
export function mesmoTecnico(a, b) {
    const docA = normDoc(a.doc), docB = normDoc(b.doc);
    if (docA && docB) return docA === docB;
    const nomeA = normNome(a.nome);
    return !!nomeA && nomeA === normNome(b.nome);
}

export const inicioJanelaJuncao = () => new Date(Date.now() - JANELA_JUNCAO_DIAS * 864e5).toISOString();

const diasDesde = data => Math.floor((Date.now() - new Date(data)) / 864e5);
const rotuloFase = chave => FASES.find(f => f.chave === chave)?.rotulo || chave;

// Pedidos do mesmo técnico, sem NF, que ainda não estão neste envio
async function buscarPedidosMesmoTecnico(dados) {
    const base = await carregarCandidatosJuncao(inicioJanelaJuncao());
    if (!base) return [];

    const pessoa = { doc: dados.dest_doc, nome: dados.dest_name };
    const jaJuntado = (origem, id) => AppState.juncaoPendente.some(p => p.origem === origem && String(p.id) === String(id));

    const doHistorico = base.historico
        .filter(r => String(r.id) !== String(AppState.currentHistoricoId) && !jaJuntado('historico', r.id))
        .filter(r => mesmoTecnico(pessoa, pessoaDoRegistro(r)))
        .map(r => ({
            origem: 'historico', id: r.id, referencia: r.referencia, unidade: r.unidade,
            dados: r.dados_completos, itens: r.itens, fase: r.fase, fase_em: r.fase_em,
            pediuNF: !!r.status?.email
        }));

    const dosRascunhos = base.rascunhos
        .filter(r => String(r.id) !== String(AppState.currentDraftId) && !jaJuntado('rascunho', r.id))
        .filter(r => mesmoTecnico(pessoa, pessoaDoRegistro(r)))
        .map(r => ({
            origem: 'rascunho', id: r.id, referencia: r.referencia, unidade: r.unidade,
            dados: r.dados_completos, itens: r.dados_completos?.items, fase: 'rascunho', fase_em: r.created_at,
            pediuNF: false
        }));

    return [...doHistorico, ...dosRascunhos];
}

// --- MODAL ---
let responder = null;

export const juncaoAberta = () => $('modal-juncao')?.style.display === 'flex';
export const fecharJuncao = () => window.responderJuncao('voltar');

function perguntarJuncao(nome, candidatos) {
    const linhas = candidatos.map((c, idx) => {
        const qtd = (c.dados?.items || c.itens || []).length;
        const situacao = c.pediuNF
            ? `${rotuloFase(c.fase)} (e-mail enviado há ${diasDesde(c.fase_em)} dia(s))`
            : c.origem === 'rascunho' ? 'Rascunho' : rotuloFase(c.fase);
        return `
            <label class="juncao-item">
                <input type="checkbox" data-idx="${idx}" checked>
                <span>
                    <strong>${escapeHtml(c.referencia || 'Sem referência')}</strong>
                    ${c.unidade ? ` &middot; ${escapeHtml(c.unidade)}` : ''} &middot; ${qtd} item(ns)
                    <br><small>${escapeHtml(situacao)}</small>
                </span>
            </label>`;
    }).join('');

    $('modal-juncao-body').innerHTML = `
        <p class="juncao-aviso">⚠ Há ${candidatos.length} outro(s) pedido(s) para
            <strong>${escapeHtml(nome)}</strong> sem NF emitida. Juntar faz tudo sair num envio só.</p>
        ${linhas}`;
    $('modal-juncao').style.display = 'flex';

    return new Promise(resolve => {
        responder = acao => {
            const escolhidos = [...$('modal-juncao-body').querySelectorAll('input:checked')]
                .map(el => candidatos[el.dataset.idx]);
            if (acao === 'juntar' && escolhidos.length === 0) {
                toast('Marque ao menos um pedido para juntar.', 'warning');
                return;
            }
            $('modal-juncao').style.display = 'none';
            responder = null;
            resolve({ acao, escolhidos });
        };
    });
}

window.responderJuncao = acao => responder?.(acao);

// Leva os itens dos pedidos escolhidos para o formulário, em modo multi-cliente
function aplicarJuncaoNoFormulario(dados, escolhidos) {
    const unidadeDe = (d, fallback = '') => d?.unit_name || fallback || d?.dest_name || '';
    const comCliente = (d, fallback) => it => ({
        ...it,
        client: (d?.client_mode === 'multi' && it.client) || unidadeDe(d, fallback)
    });

    const items = dados.items.map(comCliente(dados));
    escolhidos.forEach(p => (p.dados?.items || p.itens || []).forEach(it => items.push(comCliente(p.dados, p.unidade)(it))));

    const refs = [dados.reference, ...escolhidos.map(p => p.referencia)]
        .map(r => String(r || '').trim())
        .filter((r, i, arr) => r && r !== 'N/A' && arr.indexOf(r) === i);

    preencherFormulario({
        ...dados,
        client_mode: 'multi',
        items,
        reference: refs.join(' / ') || dados.reference,
        reference_type: refs.length && dados.reference_type === 'none' ? 'ticket' : dados.reference_type,
        total_vol: escolhidos.reduce((soma, p) => soma + (parseInt(p.dados?.total_vol) || 1), dados.total_vol || 1)
    });

    AppState.juncaoPendente.push(...escolhidos.map(({ origem, id, referencia, unidade, pediuNF }) =>
        ({ origem, id, referencia, unidade, pediuNF })));
}

// Chamado antes de enviar o e-mail ao financeiro. Retorna true para seguir com o envio.
export async function verificarJuncao(dados) {
    const candidatos = await buscarPedidosMesmoTecnico(dados);
    if (candidatos.length === 0) return true;

    const { acao, escolhidos } = await perguntarJuncao(dados.dest_name, candidatos);
    if (acao === 'so_este') return true;
    if (acao === 'juntar') {
        aplicarJuncaoNoFormulario(dados, escolhidos);
        toast('Itens juntados no formulário. Confira os volumes e envie o e-mail de novo.', 'success', 7000);
    }
    return false;
}

// Depois do e-mail registrado: cancela os pedidos juntados, apontando para o novo envio
export async function finalizarJuncao(novoHistoricoId) {
    const pendentes = AppState.juncaoPendente;
    if (!pendentes.length) return;

    const resultados = await Promise.all(pendentes.map(p => p.origem === 'historico'
        ? cancelarPedido(p.id, novoHistoricoId)
        : deletarPendente(p.id, false)));

    const falhas = pendentes.filter((_, i) => !resultados[i]);
    AppState.juncaoPendente = falhas;
    if (falhas.length) {
        toast(`Não foi possível fechar ${falhas.length} pedido(s) juntado(s): ${falhas.map(f => f.referencia || f.id).join(', ')}.`, 'error', 8000);
    } else {
        toast(`${pendentes.length} pedido(s) juntado(s) a este envio.`);
    }
}
