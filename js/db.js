import { supabaseClient, $ } from './config.js';
import { toast } from './toast.js';

export async function carregarDestinatarios() {
    const { data, error } = await supabaseClient.from('destinatarios').select('*').order('nome', { ascending: true });
    if (error) {
        console.error('Erro ao buscar dados no Supabase:', error.message);
        popularSelectDestinatarios([]);
        return;
    }
    window.__destinatariosSupabase = data || [];
    popularSelectDestinatarios(window.__destinatariosSupabase, $('client_search')?.value || '');
}

// Preenche o seletor; com filtro, mostra só os que batem com nome/documento/endereço
// (o value continua sendo o índice no array completo)
export function popularSelectDestinatarios(arr, filtro = '') {
    const sel = $('client_select');
    const termo = filtro.trim().toLowerCase();
    const termoDoc = termo.replace(/[^0-9a-z]/g, '');
    let encontrados = 0;

    sel.innerHTML = '';
    arr.forEach((c, idx) => {
        if (termo) {
            const texto = [c.nome, c.endereco_linha1, c.endereco_linha2].join(' ').toLowerCase();
            const doc = (c.cpf_cnpj || '').toLowerCase().replace(/[^0-9a-z]/g, '');
            if (!texto.includes(termo) && !(termoDoc && doc.includes(termoDoc))) return;
        }
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = c.nome || ('Sem nome');
        sel.appendChild(opt);
        encontrados++;
    });

    const primeira = document.createElement('option');
    primeira.value = '';
    primeira.textContent = termo ? `— ${encontrados} encontrado(s) —` : '— nenhum —';
    sel.insertBefore(primeira, sel.firstChild);
    sel.value = '';
}

// Procura cadastro existente com mesmo documento ou mesmo nome
function encontrarDuplicado(registro, ignorarId = null) {
    const norm = s => (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const doc = norm(registro.cpf_cnpj);
    const nome = (registro.nome || '').trim().toLowerCase();
    return (window.__destinatariosSupabase || []).find(d =>
        d.id !== ignorarId &&
        ((doc && norm(d.cpf_cnpj) === doc) || (d.nome || '').trim().toLowerCase() === nome)
    );
}

// Insere um destinatário; se já existir (mesmo CPF/CNPJ ou nome), oferece atualizar o existente
export async function salvarOuAtualizarDestinatario(registro) {
    const existente = encontrarDuplicado(registro);
    let error;

    if (existente) {
        if (!confirm(`Já existe um cadastro para "${existente.nome}" (${existente.cpf_cnpj || 'sem documento'}).\n\nDeseja ATUALIZAR esse cadastro com os dados atuais?`)) return false;
        ({ error } = await supabaseClient.from('destinatarios').update(registro).eq('id', existente.id));
    } else {
        ({ error } = await supabaseClient.from('destinatarios').insert([registro]));
    }

    if (error) {
        alert('Erro ao salvar: ' + error.message);
        return false;
    }
    toast(existente ? 'Cadastro atualizado na nuvem.' : 'Destinatário salvo na nuvem.');
    await carregarDestinatarios();
    return true;
}

export async function salvarDestinatarioAtual() {
    const nome = $('dest_name').value.trim();
    if (!nome) {
        toast('Preencha pelo menos o Nome para salvar no cadastro.', 'warning');
        return;
    }
    await salvarOuAtualizarDestinatario({
        nome,
        cpf_cnpj: $('dest_doc').value.trim(),
        endereco_linha1: $('dest_addr1').value.trim(),
        endereco_linha2: $('dest_addr2').value.trim(),
        contato: $('dest_phone').value.trim()
    });
}

export async function loadJsonFile() {
    const f = $('file_input').files[0];
    if (!f) { toast('Selecione um arquivo .json primeiro.', 'warning'); return; }
    const r = new FileReader();
    r.onload = async function (e) {
        try {
            const jsonCarregado = JSON.parse(e.target.result);
            if (!Array.isArray(jsonCarregado)) { alert('O JSON importado deve ser um Array de objetos.'); return; }

            const registrosParaBanco = jsonCarregado.map(r => ({
                nome: r.destinatario || r.nome_cliente || r.name || r.nome || '',
                cpf_cnpj: r.cpf_cnpj || r.cpf || r.cnpj || '',
                endereco_linha1: r.endereco_linha1 || r.addr1 || r.endereco1 || '',
                endereco_linha2: r.endereco_linha2 || r.addr2 || r.endereco2 || '',
                contato: r.contato || r.telefone || r.contact || ''
            })).filter(r => r.nome);

            // Pula quem já está cadastrado (mesmo documento ou nome), inclusive repetidos no próprio arquivo
            const novos = [];
            registrosParaBanco.forEach(reg => {
                const jaExiste = encontrarDuplicado(reg) || novos.some(n =>
                    n.nome.trim().toLowerCase() === reg.nome.trim().toLowerCase());
                if (!jaExiste) novos.push(reg);
            });
            const ignorados = registrosParaBanco.length - novos.length;

            if (novos.length === 0) {
                toast(`Nada a importar: todos os ${ignorados} registro(s) já estão cadastrados.`, 'warning', 5000);
                return;
            }

            const { error } = await supabaseClient.from('destinatarios').insert(novos);
            if (error) alert('Erro do Supabase ao importar: ' + error.message);
            else {
                toast(`${novos.length} contato(s) importado(s)${ignorados ? `, ${ignorados} já existente(s) ignorado(s)` : ''}.`, 'success', 5000);
                carregarDestinatarios();
            }
        } catch (err) { alert('Erro ao processar JSON: ' + err.message); }
    };
    r.readAsText(f, 'utf-8');
}

export async function exportToJSON() {
    const { data, error } = await supabaseClient.from('destinatarios').select('*');
    if (error) {
        alert("Erro ao ler banco para exportação: " + error.message);
        return;
    }
    if (!data || data.length === 0) {
        toast('O cadastro está vazio. Nada para exportar.', 'warning');
        return;
    }
    // Remove id e created_at para que a reimportação não gere conflitos
    const limpo = data.map(({ id, created_at, ...rest }) => rest);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(limpo, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "backup_base_envio.json");
    dlAnchorElem.click();
}

// --- FUNÇÕES DO HISTÓRICO ---

// Campos da tabela historico montados a partir dos dados do formulário
function montarRegistroHistorico(dados) {
    return {
        remetente: dados.sender_company,
        destinatario: dados.dest_name,
        unidade: dados.unit_name || dados.dest_name,
        referencia: dados.reference,
        tipo_doc: dados.doc_type || dados.docType || 'não informado',
        itens: dados.items,
        transportadora: dados.carrier,
        // Snapshot completo para regeração futura (sem o vínculo interno)
        dados_completos: { ...dados, historico_id: undefined }
    };
}

// --- FASES DO PEDIDO (KANBAN) ---

// Colunas do kanban, na ordem do fluxo. 'cancelado' é uma fase válida, mas fica fora das colunas.
export const FASES = [
    { chave: 'rascunho',      rotulo: 'Rascunho' },
    { chave: 'aguardando_nf', rotulo: 'Aguardando NF' },
    { chave: 'nf_emitida',    rotulo: 'NF emitida' },
    { chave: 'pronto',        rotulo: 'Pronto p/ envio' },
    { chave: 'despachado',    rotulo: 'Despachado' },
    { chave: 'entregue',      rotulo: 'Entregue' }
];

export const ordemFase = chave => FASES.findIndex(f => f.chave === chave);
export const rotuloFase = chave => chave === 'cancelado' ? 'Cancelado' : (FASES.find(f => f.chave === chave)?.rotulo || chave);

// Fase que as ações já feitas (e-mail, etiqueta, romaneio) indicam
export function faseSugerida(status = {}) {
    if (status.etiqueta && status.romaneio) return 'pronto';
    if (status.email) return 'aguardando_nf';
    return 'rascunho';
}

// Só avança: reimprimir algo de um pedido já despachado não o faz voltar. Cancelado não muda.
export function proximaFase(faseAtual, status) {
    if (faseAtual === 'cancelado') return faseAtual;
    const sugerida = faseSugerida(status);
    return ordemFase(sugerida) > ordemFase(faseAtual) ? sugerida : faseAtual;
}

// Move o pedido para outra fase. extras: outros campos a gravar junto, ex. { rastreio }
export async function moverFase(id, fase, extras = {}) {
    const { error } = await supabaseClient
        .from('historico')
        .update({ fase, fase_em: new Date().toISOString(), ...extras })
        .eq('id', id);

    if (error) {
        console.error('Erro ao mover fase:', error.message);
        return false;
    }
    return true;
}

export async function atualizarRastreio(id, rastreio) {
    const { error } = await supabaseClient.from('historico').update({ rastreio }).eq('id', id);
    if (error) {
        console.error('Erro ao salvar rastreio:', error.message);
        return false;
    }
    return true;
}

// Cancela o pedido. mescladoEm: id do envio que absorveu este (junção de pedidos)
export async function cancelarPedido(id, mescladoEm = null) {
    return moverFase(id, 'cancelado', mescladoEm ? { mesclado_em: mescladoEm } : {});
}

// Pedidos do kanban: tudo que não foi entregue nem cancelado, mais os entregues dos últimos 30 dias
export async function carregarKanban() {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await supabaseClient
        .from('historico')
        .select('*')
        .neq('fase', 'cancelado')
        .or(`fase.neq.entregue,fase_em.gte."${desde}"`)
        .order('fase_em', { ascending: false });

    if (error) {
        console.error('Erro ao buscar kanban:', error.message);
        return null;
    }
    return data || [];
}

// Pedidos sem NF emitida mexidos desde a data informada (candidatos a junção)
export async function carregarCandidatosJuncao(desde) {
    const [hist, rasc] = await Promise.all([
        supabaseClient.from('historico').select('*')
            .in('fase', ['rascunho', 'aguardando_nf'])
            .is('mesclado_em', null)
            .or(`created_at.gte."${desde}",fase_em.gte."${desde}"`),
        supabaseClient.from('pedidos_pendentes').select('*').gte('created_at', desde)
    ]);
    if (hist.error || rasc.error) {
        console.error('Erro ao buscar pedidos para junção:', (hist.error || rasc.error).message);
        return null;
    }
    // Rascunho já gerado aparece pelo registro do histórico
    return {
        historico: hist.data || [],
        rascunhos: (rasc.data || []).filter(r => !r.dados_completos?.historico_id)
    };
}

// Cria ou atualiza o registro do envio no histórico.
// historicoId: registro já criado para este envio (evita duplicar ao gerar de novo).
// etapas: o que acabou de ser feito, ex. { etiqueta: true } — soma ao status existente.
// Retorna { id, fase, faseAnterior, faseEmAnterior }, ou null em caso de erro.
export async function registrarNoHistorico(dados, historicoId = null, etapas = {}) {
    const registro = montarRegistroHistorico(dados);

    if (historicoId) {
        const { data: atual } = await supabaseClient
            .from('historico').select('status, fase, fase_em, dados_completos').eq('id', historicoId).single();

        if (atual) {
            // Reimprimir depois de uma junção não pode apagar o registro dos pedidos juntados
            const mesclados = atual.dados_completos?.mesclados;
            if (mesclados && !registro.dados_completos.mesclados) registro.dados_completos.mesclados = mesclados;

            const status = { email: false, etiqueta: false, romaneio: false, ...(atual.status || {}), ...etapas };
            const faseAnterior = atual.fase || 'rascunho';
            const fase = proximaFase(faseAnterior, status);
            const update = { ...registro, status, fase };
            if (fase !== faseAnterior) update.fase_em = new Date().toISOString();

            const { error } = await supabaseClient
                .from('historico').update(update).eq('id', historicoId);
            if (error) {
                console.error('Erro ao atualizar histórico:', error.message);
                return null;
            }
            return { id: historicoId, fase, faseAnterior, faseEmAnterior: atual.fase_em };
        }
        // Registro foi apagado: cai para criar um novo
    }

    const status = { email: false, etiqueta: false, romaneio: false, ...etapas };
    const fase = faseSugerida(status);
    const { data, error } = await supabaseClient
        .from('historico').insert([{ ...registro, status, fase }]).select();

    if (error) {
        console.error('Erro ao salvar no histórico:', error.message);
        return null;
    }
    return { id: data[0].id, fase, faseAnterior: 'rascunho', faseEmAnterior: null };
}

export const HISTORICO_POR_PAGINA = 50;

// pagina 0 = 50 mais recentes, pagina 1 = os 50 seguintes, ...
export async function carregarHistorico(pagina = 0) {
    const inicio = pagina * HISTORICO_POR_PAGINA;
    const { data, error } = await supabaseClient
        .from('historico')
        .select('*')
        .order('created_at', { ascending: false })
        .range(inicio, inicio + HISTORICO_POR_PAGINA - 1);

    if (error) {
        console.error('Erro ao buscar histórico:', error.message);
        return [];
    }
    return data || [];
}

// Grava os checkboxes de status e avança a fase se for o caso (desmarcar não faz voltar).
// Retorna { fase, faseAnterior, faseEmAnterior, fase_em } ou null em caso de erro.
export async function atualizarStatusHistorico(reg, novoStatus) {
    const faseAnterior = reg.fase || 'rascunho';
    const fase = proximaFase(faseAnterior, novoStatus);
    const update = { status: novoStatus, fase };
    if (fase !== faseAnterior) update.fase_em = new Date().toISOString();

    const { error } = await supabaseClient
        .from('historico')
        .update(update)
        .eq('id', reg.id);

    if (error) {
        console.error('Erro ao atualizar status:', error.message);
        return null;
    }
    return { fase, faseAnterior, faseEmAnterior: reg.fase_em, fase_em: update.fase_em || reg.fase_em };
}

// --- FUNÇÕES DE PEDIDOS EM ANDAMENTO (RASCUNHOS) ---

export async function salvarPendente(dados, draftId = null, silencioso = false) {
    const registro = {
        destinatario: dados.dest_name || 'Sem Destinatário',
        unidade: dados.unit_name || dados.dest_name || '',
        referencia: dados.reference || '',
        dados_completos: dados
    };

    let result;
    if (draftId) {
        // Atualiza rascunho existente
        result = await supabaseClient.from('pedidos_pendentes').update(registro).eq('id', draftId).select();
    } else {
        // Cria um novo rascunho
        result = await supabaseClient.from('pedidos_pendentes').insert([registro]).select();
    }

    const { data, error } = result;

    if (error) {
        console.error('Erro ao salvar rascunho:', error.message);
        alert('Erro ao salvar rascunho: ' + error.message);
        return null;
    } else {
        if (!silencioso) toast('Rascunho salvo.');
        return data[0]; // Retorna o registro salvo (com ID)
    }
}

export async function carregarPendentes() {
    const { data, error } = await supabaseClient
        .from('pedidos_pendentes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Erro ao buscar rascunhos:', error.message);
        return [];
    }
    return data || [];
}

export async function deletarPendente(id, confirmar = true) {
    if (confirmar && !confirm('Você tem certeza que deseja excluir ESTE RASCUNHO?')) return false;

    const { error } = await supabaseClient.from('pedidos_pendentes').delete().eq('id', id);

    if (error) {
        console.error('Erro ao deletar rascunho:', error.message);
        alert('Erro ao deletar rascunho: ' + error.message);
        return false;
    }
    return true;
}

export async function concluirPendente(id) {
    // 1. Busca os dados do rascunho
    const { data: rascunho, error: errBusca } = await supabaseClient
        .from('pedidos_pendentes')
        .select('*')
        .eq('id', id)
        .single();

    if (errBusca || !rascunho) {
        alert('Erro ao encontrar o rascunho para concluir.');
        return false;
    }

    // 2. Salva no histórico (se já foi gerado antes, atualiza o mesmo registro em vez de duplicar)
    const dadosFormulario = rascunho.dados_completos;
    const salvo = await registrarNoHistorico(dadosFormulario, dadosFormulario.historico_id || null);
    if (!salvo) {
        // Não apaga o rascunho se o histórico falhou, para não perder dados
        alert('Erro ao salvar no Histórico. O rascunho foi mantido.');
        return false;
    }

    // 3. Deleta o rascunho
    const { error: errDel } = await supabaseClient.from('pedidos_pendentes').delete().eq('id', id);
    if(errDel) console.error("Erro ao remover rascunho concluido: ", errDel);

    toast('Pedido concluído e enviado para o Histórico.');
    return true;
}
