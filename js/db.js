import { supabaseClient, $ } from './config.js';

export async function carregarDestinatarios() {
    const { data, error } = await supabaseClient.from('destinatarios').select('*').order('nome', { ascending: true });
    if (error) {
        console.error('Erro ao buscar dados no Supabase:', error.message);
        popularSelectDestinatarios([]);
        return;
    }
    window.__destinatariosSupabase = data || [];
    popularSelectDestinatarios(window.__destinatariosSupabase);
}

export function popularSelectDestinatarios(arr) {
    const sel = $('client_select');
    sel.innerHTML = '<option value="">— nenhum —</option>';
    arr.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = c.nome || ('Sem nome');
        sel.appendChild(opt);
    });
}

export async function salvarDestinatarioAtual() {
    const nome = $('dest_name').value.trim();
    if (!nome) {
        alert("Preencha pelo menos o Nome para poder salvar no Banco.");
        return;
    }
    const novoRegistro = {
        nome,
        cpf_cnpj: $('dest_doc').value.trim(),
        endereco_linha1: $('dest_addr1').value.trim(),
        endereco_linha2: $('dest_addr2').value.trim(),
        contato: $('dest_phone').value.trim()
    };
    const { error } = await supabaseClient.from('destinatarios').insert([novoRegistro]);

    if (error) alert("Erro ao salvar: " + error.message);
    else {
        alert("Cliente salvo com sucesso na nuvem!");
        carregarDestinatarios();
    }
}

export async function loadJsonFile() {
    const f = $('file_input').files[0];
    if (!f) { alert('Selecione um arquivo .json primeiro.'); return; }
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
            }));

            const { error } = await supabaseClient.from('destinatarios').insert(registrosParaBanco);
            if (error) alert('Erro do Supabase ao importar: ' + error.message);
            else {
                alert(`Sucesso! ${registrosParaBanco.length} contatos foram importados.`);
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
        alert("O banco de dados está vazio. Nada para exportar.");
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

export async function clearBase() {
    if (!confirm('CUIDADO EXTREMO: Tem certeza que deseja APAGAR TODOS os registros de destinatários? Não esqueça de gerar um backup antes (Exportar JSON)!')) return;

    const { error } = await supabaseClient.from('destinatarios').delete().neq('id', 0);

    if (error) alert('Erro ao apagar: ' + error.message);
    else {
        alert('Todos os dados fictícios (ou antigos) foram apagados.');
        carregarDestinatarios();
    }
}
// --- FUNÇÕES DO HISTÓRICO ---

export async function salvarNoHistorico(dados) {
    const registro = {
        remetente: dados.sender_company,
        destinatario: dados.dest_name,
        unidade: dados.unit_name || dados.dest_name,
        referencia: dados.reference,
        tipo_doc: dados.docType || 'não informado',
        itens: dados.items,
        transportadora: dados.carrier,
        // Snapshot completo para regeração futura
        dados_completos: dados,
        // Status inicial: nada foi feito ainda
        status: { email: false, etiqueta: false, romaneio: false }
    };

    const { error } = await supabaseClient.from('historico').insert([registro]);

    if (error) {
        console.error('Erro ao salvar no histórico:', error.message);
    } else {
        console.log('✅ Registro salvo no histórico com sucesso.');
    }
}

export async function carregarHistorico() {
    const { data, error } = await supabaseClient
        .from('historico')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Erro ao buscar histórico:', error.message);
        return [];
    }
    return data || [];
}

export async function atualizarStatusHistorico(id, novoStatus) {
    const { error } = await supabaseClient
        .from('historico')
        .update({ status: novoStatus })
        .eq('id', id);

    if (error) {
        console.error('Erro ao atualizar status:', error.message);
        return false;
    }
    return true;
}

// --- FUNÇÕES DE PEDIDOS EM ANDAMENTO (RASCUNHOS) ---

export async function salvarPendente(dados, draftId = null) {
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
        alert('Rascunho salvo com sucesso!');
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

export async function deletarPendente(id) {
    if (!confirm('Você tem certeza que deseja excluir ESTE RASCUNHO?')) return false;

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

    // 2. Salva no histórico
    const dadosFormulario = rascunho.dados_completos;
    await salvarNoHistorico(dadosFormulario);

    // 3. Deleta o rascunho
    const { error: errDel } = await supabaseClient.from('pedidos_pendentes').delete().eq('id', id);
    if(errDel) console.error("Erro ao remover rascunho concluido: ", errDel);

    alert('Pedido concluído e enviado para o Histórico!');
    return true;
}
