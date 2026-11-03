// Configurações editáveis (tabela configuracoes, ver sql/configuracoes.sql).
// Sem linha no banco (ou sem a tabela) vale o padrão daqui, então o programa funciona igual.
// carregarConfiguracoes roda uma vez depois do login; config(chave) é síncrona.
import { supabaseClient } from './config.js';

export const PADROES = {
    // E-mails do financeiro que recebem o pedido de nota fiscal
    financeiro_emails: ['michele.miranda@ranor.com.br', 'jaqueline.cristiane@ranor.com.br'],
    // Remetentes do select "Selecionar remetente"; o "padrao" é o dos envios importados e do "Novo envio"
    remetentes: [
        { id: 'ranor', company: 'Ranor Rastreamento', cnpj: '10.980.591/0001-64',
          address: 'Coronel João de Barros, 427B \n 37900-049 - Centro, Passos-MG', padrao: true },
        { id: 'nortrack', company: 'NORTRACK OPERAÇÕES LTDA', cnpj: '58.231.979/0001-99',
          address: 'R JULIETA FILIPINI,47, SALA 01 \n 06030-510 – UMUARAMA, OSASCO – SP' }
    ],
    // Motivo da planilha de estoque -> Tipo da planilha de envio (o motivo "começa com", sem acento)
    motivo_tipo: [
        { comeca: 'manut', tipo: 'MAN' },
        { comeca: 'instal', tipo: 'INS' },
        { comeca: 'correc', tipo: 'COR' },
        { comeca: 'corret', tipo: 'COR' },
        { comeca: 'fornec', tipo: 'FOR' }
    ],
    // Dias na fase até o card ficar amarelo / vermelho no kanban
    kanban_atraso: { aguardando_nf: [2, 5], nf_emitida: [2, 5], pronto: [1, 3] },
    // Pedidos do mesmo técnico nos últimos N dias são oferecidos para juntar
    juncao_dias: 7,
    transportadora_padrao: 'Jadlog',
    // Textos fixos do e-mail ao financeiro
    email_textos: { assunto: 'Nota fiscal para envio', saudacao: 'Olá financeiro,' }
};

let salvas = new Map(); // chave -> { valor, atualizado_por, atualizado_em }
let tabelaOk = true;

export async function carregarConfiguracoes() {
    const { data, error } = await supabaseClient.from('configuracoes').select('*');
    tabelaOk = !error;
    if (error) {
        console.error('Erro ao buscar configurações (usando os padrões):', error.message);
        return false;
    }
    salvas = new Map((data || []).map(r => [r.chave, r]));
    return true;
}

export const configuracoesNoBanco = () => tabelaOk;
export const config = chave => salvas.has(chave) ? salvas.get(chave).valor : PADROES[chave];
export const infoConfiguracao = chave => salvas.get(chave) || null;

async function emailAtual() {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session?.user?.email || null;
}

export async function salvarConfiguracao(chave, valor) {
    const registro = { chave, valor, atualizado_por: await emailAtual(), atualizado_em: new Date().toISOString() };
    const { error } = await supabaseClient.from('configuracoes').upsert([registro], { onConflict: 'chave' });
    if (error) {
        console.error('Erro ao salvar configuração:', error.message);
        return false;
    }
    salvas.set(chave, registro);
    return true;
}

// Apaga a linha: volta ao padrão do código
export async function restaurarPadrao(chave) {
    const { error } = await supabaseClient.from('configuracoes').delete().eq('chave', chave);
    if (error) {
        console.error('Erro ao restaurar configuração:', error.message);
        return false;
    }
    salvas.delete(chave);
    return true;
}

// --- Remetentes ---
export const remetentes = () => config('remetentes') || [];
export const remetentePadrao = () => remetentes().find(r => r.padrao) || remetentes()[0] || null;
export const remetentePorId = id => remetentes().find(r => r.id === id) || null;
const soDigitos = s => String(s || '').replace(/\D/g, '');
export const remetentePorCnpj = cnpj => soDigitos(cnpj) ? remetentes().find(r => soDigitos(r.cnpj) === soDigitos(cnpj)) || null : null;
