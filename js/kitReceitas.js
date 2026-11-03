// Receitas de kit no Supabase (tabela kit_receitas, ver sql/kit.sql)
import { supabaseClient } from './config.js';
import { RECEITA_PADRAO } from './kit.js';

let receitas = null;
let tabelaOk = true;

// Lista das receitas; sem nenhuma salva (ou sem a tabela), a receita padrão
export async function carregarReceitas(forcar = false) {
    if (receitas && !forcar) return receitas;
    const { data, error } = await supabaseClient.from('kit_receitas').select('*').order('nome', { ascending: true });
    if (error) console.error('Erro ao buscar receitas de kit:', error.message);
    tabelaOk = !error;
    receitas = data?.length ? data.map(r => ({ id: r.id, nome: r.nome, componentes: r.componentes || [] })) : [{ ...RECEITA_PADRAO }];
    return receitas;
}

export const receitasSalvasNoBanco = () => tabelaOk;

// Cria ou atualiza pelo nome. Retorna true se gravou.
export async function salvarReceita({ nome, componentes }) {
    const { data: sessao } = await supabaseClient.auth.getSession();
    const registro = {
        nome: String(nome || '').trim().toUpperCase(),
        componentes: componentes
            .map(c => ({ nome: String(c.nome || '').trim().toUpperCase(), qtd: Math.max(1, parseInt(c.qtd) || 1) }))
            .filter(c => c.nome),
        atualizado_por: sessao?.session?.user?.email || null,
        atualizado_em: new Date().toISOString()
    };
    const { error } = await supabaseClient.from('kit_receitas').upsert([registro], { onConflict: 'nome' });
    if (error) {
        console.error('Erro ao salvar receita de kit:', error.message);
        return false;
    }
    await carregarReceitas(true);
    return true;
}

export async function excluirReceita(nome) {
    const { error } = await supabaseClient.from('kit_receitas').delete().eq('nome', nome);
    if (error) {
        console.error('Erro ao excluir receita de kit:', error.message);
        return false;
    }
    await carregarReceitas(true);
    return true;
}
