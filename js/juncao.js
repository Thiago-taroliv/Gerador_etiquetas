// Junção de pedidos do mesmo técnico ainda sem NF, para tudo sair num envio só.
// Caminhos: alerta ao pedir a NF (no formulário), botão "Juntar" e arrastar card sobre card (kanban),
// e "Adicionar a pedido existente" na importação do estoque. "Separar" desfaz pelo detalhe do pedido.
import { AppState, $, escapeHtml } from './config.js';
import { carregarCandidatosJuncao, cancelarPedido, deletarPendente, registrarNoHistorico, salvarPendente, moverFase, FASES } from './db.js';
import { preencherFormulario } from './ui.js';
import { toast } from './toast.js';
import { config } from './configuracoes.js';
import { confirmar } from './dialogo.js';
import { rascunhoDoPedido } from './kanban.js';
import { semEnvio } from './entrega.js';

// Fases em que a NF ainda não foi emitida
export const FASES_SEM_NF = ['rascunho', 'aguardando_nf'];

AppState.juncaoPendente = []; // pedidos já juntados no formulário, fechados ao enviar o e-mail

const normDoc = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

// { doc, nome } de um registro do histórico ou rascunho
export const pessoaDoRegistro = reg => ({ doc: reg.dados_completos?.dest_doc, nome: reg.destinatario });

// Mesmo CPF/CNPJ ou mesmo nome. O nome vale mesmo com documentos diferentes
// (ex. um pedido com o CPF do técnico e outro com o CNPJ da unidade).
export function mesmoTecnico(a, b) {
    const docA = normDoc(a.doc), docB = normDoc(b.doc);
    if (docA && docA === docB) return true;
    const nomeA = normNome(a.nome);
    return !!nomeA && nomeA === normNome(b.nome);
}

// Só procura pedidos criados ou mexidos nestes últimos dias (Gerenciar Dados > Configurações)
export const inicioJanelaJuncao = () => new Date(Date.now() - (Number(config('juncao_dias')) || 7) * 864e5).toISOString();

const diasDesde = data => Math.floor((Date.now() - new Date(data)) / 864e5);
const rotuloFase = chave => FASES.find(f => f.chave === chave)?.rotulo || chave;

// Pedido candidato, no formato usado pela junção
export function pedidoDoHistorico(r) {
    return {
        origem: 'historico', id: r.id, referencia: r.referencia, unidade: r.unidade,
        dados: r.dados_completos, itens: r.itens, fase: r.fase, fase_em: r.fase_em,
        pediuNF: !!r.status?.email, created_at: r.created_at
    };
}
export function pedidoDoRascunho(r) {
    return {
        origem: 'rascunho', id: r.id, referencia: r.referencia, unidade: r.unidade,
        dados: r.dados_completos, itens: r.dados_completos?.items, fase: 'rascunho', fase_em: r.created_at,
        pediuNF: false, created_at: r.created_at
    };
}

// Pedidos sem NF (da janela da junção) do técnico informado. base: retorno de carregarCandidatosJuncao.
// pessoa.semEnvio: retirada / instalação na Ranor só junta com outro pedido sem envio (e vice-versa)
export function pedidosAbertosDoTecnico(base, pessoa) {
    return [
        ...base.historico.filter(r => r.dados_completos).map(pedidoDoHistorico),
        ...base.rascunhos.map(pedidoDoRascunho)
    ].filter(p => mesmoTecnico(pessoa, { doc: p.dados?.dest_doc, nome: p.dados?.dest_name })
        && semEnvio(p.dados) === !!pessoa.semEnvio);
}

// Pedidos do mesmo técnico, sem NF, que ainda não estão neste envio (o que está no formulário)
async function buscarPedidosMesmoTecnico(dados) {
    const base = await carregarCandidatosJuncao(inicioJanelaJuncao());
    if (!base) return [];
    const jaJuntado = p => AppState.juncaoPendente.some(j => j.origem === p.origem && String(j.id) === String(p.id));
    const esteEnvio = p => String(p.id) === String(p.origem === 'historico' ? AppState.currentHistoricoId : AppState.currentDraftId);
    return pedidosAbertosDoTecnico(base, { doc: dados.dest_doc, nome: dados.dest_name, semEnvio: semEnvio(dados) })
        .filter(p => !esteEnvio(p) && !jaJuntado(p));
}

// --- JUNTAR OS DADOS ---

const unidadeDe = (d, fallback = '') => d?.unit_name || fallback || d?.dest_name || '';
// No modo multi-cliente cada item diz de que unidade é (o romaneio separa por ela)
const comCliente = (d, fallback) => it => ({
    ...it,
    client: (d?.client_mode === 'multi' && it.client) || unidadeDe(d, fallback)
});
const volumes = d => parseInt(d?.total_vol) || 1;
const limparRef = r => String(r || '').trim();
// Envios da planilha de estoque que estão dentro deste pedido (a reimportação não os cria de novo)
const chavesEstoque = d => [d?.origem?.chave, ...(d?.origens_estoque || [])].filter(Boolean);

// Junta os itens de outros pedidos nos dados de um. outros: pedidos no formato de pedidoDoHistorico/pedidoDoRascunho
// (para um envio da importação, origem 'rascunho' sem id).
// Retorna { dados, entradas }; cada entrada vai para dados.mesclados e guarda o que for preciso para separar depois.
export function juntarDados(dados, outros) {
    const items = (dados.items || []).map(comCliente(dados));
    const refs = [limparRef(dados.reference)].filter(r => r && r !== 'N/A');

    const entradas = outros.map(p => {
        const itens = (p.dados?.items || p.itens || []).map(comCliente(p.dados, p.unidade));
        items.push(...itens);
        const referencia = limparRef(p.referencia ?? p.dados?.reference);
        const refNova = !!referencia && referencia !== 'N/A' && !refs.includes(referencia);
        if (refNova) refs.push(referencia);
        return {
            origem: p.origem, id: p.id ?? null, referencia, unidade: p.unidade || p.dados?.unit_name || '',
            // Sem volumes informados (ex. envio recém-importado) não soma nada: a conferência é à mão
            pediuNF: !!p.pediuNF, itens, vol: parseInt(p.dados?.total_vol) || 0, ref_adicionada: refNova,
            chaves_estoque: chavesEstoque(p.dados),
            // O rascunho é apagado ao juntar: guarda os dados para recriá-lo ao separar
            ...(p.origem === 'rascunho' ? { dados: { ...p.dados, historico_id: undefined } } : {})
        };
    });

    const chaves = [...new Set([...(dados.origens_estoque || []), ...entradas.flatMap(e => e.chaves_estoque)])];
    return {
        dados: {
            ...dados,
            client_mode: 'multi',
            items,
            reference: refs.join(' / ') || dados.reference,
            reference_type: refs.length && dados.reference_type === 'none' ? 'ticket' : dados.reference_type,
            total_vol: entradas.reduce((s, e) => s + e.vol, volumes(dados)),
            ...(chaves.length ? { origens_estoque: chaves } : {})
        },
        entradas
    };
}

// Fecha os pedidos absorvidos: o do histórico vira "cancelado" apontando para o que ficou; o rascunho é apagado.
// Retorna os que falharam.
async function fecharJuntados(entradas, historicoId) {
    const resultados = await Promise.all(entradas.map(async p => {
        if (p.origem !== 'historico') return deletarPendente(p.id, false);
        const ok = await cancelarPedido(p.id, historicoId);
        // Rascunho aberto do pedido fechado não serve mais (os itens foram para o outro pedido)
        const draftId = ok && rascunhoDoPedido(p.id);
        if (draftId) await deletarPendente(draftId, false);
        return ok;
    }));
    return entradas.filter((_, i) => !resultados[i]);
}

// Grava os dados no pedido do histórico e no rascunho aberto dele, se houver
async function gravarPedido(dados, historicoId, draftId = null) {
    const salvo = await registrarNoHistorico(dados, historicoId);
    if (!salvo) return null;
    const rascunho = draftId || rascunhoDoPedido(salvo.id);
    if (rascunho) await salvarPendente({ ...dados, historico_id: salvo.id }, rascunho, true);
    return salvo.id;
}

// Junta direto no banco, sem passar pelo formulário: o alvo fica com tudo e os outros são fechados.
// Rascunho como alvo ganha registro no histórico (o fechado precisa apontar para ele).
// Retorna o id do pedido que ficou, ou null se falhou.
export async function juntarPedidos(alvo, outros) {
    const { dados, entradas } = juntarDados(alvo.dados, outros);
    dados.mesclados = [...(alvo.dados.mesclados || []), ...entradas];
    // O financeiro já recebeu o pedido de NF deste: o próximo e-mail avisa que ele foi substituído
    if (alvo.pediuNF && !dados.nf_anterior) dados.nf_anterior = { referencia: alvo.referencia, unidade: alvo.unidade };

    const id = alvo.origem === 'historico'
        ? await gravarPedido(dados, alvo.id)
        : await gravarPedido({ ...dados, rascunho_em: dados.rascunho_em || alvo.created_at }, null, alvo.id);
    if (!id) {
        toast('Não foi possível juntar os pedidos. Verifique a conexão.', 'error', 6000);
        return null;
    }

    const falhas = await fecharJuntados(entradas.filter(e => e.id != null), id);
    if (falhas.length) {
        toast(`Os itens foram juntados, mas não foi possível fechar: ${falhas.map(f => f.referencia || f.id).join(', ')}. Cancele à mão.`, 'error', 9000);
    }
    return id;
}

// Precisa de um novo e-mail ao financeiro depois da junção?
export const precisaNovoEmail = (alvo, outros) => !!alvo.pediuNF || outros.some(o => o.pediuNF);

// --- SEPARAR (desfaz uma junção) ---

// Identifica o item pelo que não muda ao salvar: descrição, quantidade, unidade e números (IMEI/rastreador)
const idImei = x => x && typeof x === 'object'
    ? String(x.imei || x.rastreador || JSON.stringify(Object.keys(x).sort().map(k => [k, x[k]])))
    : String(x);
const chaveItem = it => JSON.stringify([String(it.desc || '').trim(), String(it.qty), it.client || '', (it.imeis || []).map(idImei)]);

// Dá para separar este pedido juntado? (junções antigas não guardaram os itens)
export const podeSeparar = m => Array.isArray(m?.itens) && (m.origem === 'rascunho' ? !!m.dados : m.id != null);

// Tira os itens de um pedido juntado (dados.mesclados[idx]) e devolve um card próprio a ele.
// Retorna true se separou.
export async function separarPedido(reg, idx) {
    const dados = reg.dados_completos;
    const m = dados?.mesclados?.[idx];
    if (!podeSeparar(m)) return false;

    const restantes = [...(dados.items || [])];
    let naoAchados = 0;
    m.itens.forEach(it => {
        const i = restantes.findIndex(x => chaveItem(x) === chaveItem(it));
        if (i >= 0) restantes.splice(i, 1); else naoAchados++;
    });

    const refs = String(dados.reference || '').split(' / ').map(limparRef);
    const novo = {
        ...dados,
        items: restantes,
        total_vol: Math.max(1, volumes(dados) - (m.vol || 0)),
        reference: m.ref_adicionada ? refs.filter(r => r !== m.referencia).join(' / ') : dados.reference,
        mesclados: dados.mesclados.filter((_, i) => i !== idx),
        origens_estoque: (dados.origens_estoque || []).filter(c => !(m.chaves_estoque || []).includes(c))
    };

    if (!(await gravarPedido(novo, reg.id))) {
        toast('Não foi possível separar. Verifique a conexão.', 'error', 6000);
        return false;
    }
    // Devolve o card: pedido do histórico volta da fase cancelada; rascunho é recriado
    const ok = m.origem === 'historico'
        ? await moverFase(m.id, m.pediuNF ? 'aguardando_nf' : 'rascunho', { mesclado_em: null })
        : !!(await salvarPendente(m.dados, null, true));
    if (!ok) toast(`Itens retirados, mas não foi possível recriar o card de ${m.referencia || 'o pedido'}.`, 'error', 9000);
    if (naoAchados) toast(`${naoAchados} item(ns) de ${m.referencia || 'o pedido'} foram alterados depois da junção e ficaram neste pedido: confira.`, 'warning', 9000);
    return ok;
}

// --- MODAL ---
let responder = null;

export const juncaoAberta = () => $('modal-juncao')?.style.display === 'flex';
export const fecharJuncao = () => window.responderJuncao('voltar');

// manual: aberto pelo kanban, sem e-mail em andamento (não há "Enviar só este")
function perguntarJuncao(nome, candidatos, manual = false) {
    $('btn-juncao-so-este').style.display = manual ? 'none' : '';
    $('btn-juncao-juntar').textContent = manual ? 'Juntar' : 'Juntar neste envio';
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

// Lista para o botão "Juntar" do kanban. Retorna os escolhidos, ou null se voltou.
export async function escolherParaJuntar(nome, candidatos) {
    const { acao, escolhidos } = await perguntarJuncao(nome, candidatos, true);
    return acao === 'juntar' ? escolhidos : null;
}

// --- JUNÇÃO NO FORMULÁRIO (ao pedir a NF) ---

// Leva os itens dos pedidos escolhidos para o formulário; eles são fechados ao enviar o e-mail
function aplicarJuncaoNoFormulario(dados, escolhidos) {
    const { dados: novo, entradas } = juntarDados(dados, escolhidos);
    preencherFormulario(novo);
    if (novo.origens_estoque) AppState.extrasEnvio = { ...(AppState.extrasEnvio || {}), origens_estoque: novo.origens_estoque };
    AppState.juncaoPendente.push(...entradas);
}

// Chamado antes de enviar o e-mail ao financeiro. Retorna true para seguir com o envio.
export async function verificarJuncao(dados) {
    const candidatos = await buscarPedidosMesmoTecnico(dados);
    if (candidatos.length === 0) return true;

    while (true) {
        const { acao, escolhidos } = await perguntarJuncao(dados.dest_name, candidatos);
        if (acao === 'so_este') {
            const n = candidatos.length + 1;
            const certeza = await confirmar({
                titulo: 'Pedir NFs separadas?',
                mensagem: `Vão ser ${n} notas fiscais separadas para ${dados.dest_name || 'o mesmo técnico'}, que podem sair num envio só.`,
                detalhe: 'Use "Juntar neste envio" para pedir uma nota só com todos os itens.',
                tipo: 'aviso',
                sim: 'Enviar só este mesmo assim',
                nao: 'Voltar'
            });
            if (certeza) return true;
            continue; // reabre a lista de pedidos
        }
        if (acao === 'juntar') {
            aplicarJuncaoNoFormulario(dados, escolhidos);
            toast('Itens juntados no formulário. Confira os volumes e envie o e-mail de novo.', 'success', 7000);
        }
        return false;
    }
}

// Depois do e-mail registrado: fecha os pedidos juntados no formulário, apontando para o novo envio
export async function finalizarJuncao(novoHistoricoId) {
    const pendentes = AppState.juncaoPendente;
    if (!pendentes.length) return;

    const falhas = await fecharJuntados(pendentes, novoHistoricoId);
    AppState.juncaoPendente = falhas;
    if (falhas.length) {
        toast(`Não foi possível fechar ${falhas.length} pedido(s) juntado(s): ${falhas.map(f => f.referencia || f.id).join(', ')}.`, 'error', 8000);
    } else {
        toast(`${pendentes.length} pedido(s) juntado(s) a este envio.`);
    }
}
