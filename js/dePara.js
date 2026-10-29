// De-para da planilha de estoque: código/descrição do estoque -> nome no romaneio + papel do item.
// O papel decide como o item é tratado (rastreador/teclado com IMEI, chip preso ao rastreador, acessório...).
import { supabaseClient, $, escapeHtml } from './config.js';
import { getItems } from './items.js';
import { toast } from './toast.js';

export const PAPEIS = [
    { chave: 'rastreador', rotulo: 'Rastreador' },
    { chave: 'teclado',    rotulo: 'Teclado' },
    { chave: 'chip',       rotulo: 'Chip (fora do romaneio)' },
    { chave: 'acessorio',  rotulo: 'Acessório' },
    { chave: 'ignorar',    rotulo: 'Ignorar' }
];

export const normDesc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

// Papel provável pela descrição, para pré-selecionar quando o item ainda não tem de-para
export function sugerirPapel(desc) {
    const d = normDesc(desc);
    // Acessório antes de tudo: "Suporte Ferro Teclado" e "Chicote ... RA24" não são teclado/rastreador
    if (/suporte|lacre|chicote|cartao|sensor|cabo|parafuso|abracadeira|fusivel|ancora/.test(d)) return 'acessorio';
    if (/chip|simcard/.test(d)) return 'chip';
    if (/teclado/.test(d)) return 'teclado';
    if (/equipamento|rastreador|st\d{3}/.test(d)) return 'rastreador';
    return 'acessorio';
}

let mapeamentos = [];
let carregado = false;

export async function carregarDePara() {
    const { data, error } = await supabaseClient
        .from('de_para_itens')
        .select('*')
        .order('descricao_estoque', { ascending: true });
    if (error) {
        console.error('Erro ao buscar de-para:', error.message);
        return false;
    }
    mapeamentos = data || [];
    carregado = true;
    return true;
}

export async function garantirDePara() {
    return carregado || carregarDePara();
}

// Procura pelo código; sem código (ou código sem mapeamento), pela descrição
export function acharDePara(codigo, descricao) {
    const cod = String(codigo ?? '').trim();
    if (cod) {
        const porCodigo = mapeamentos.find(m => m.codigo_estoque === cod);
        if (porCodigo) return porCodigo;
    }
    const norm = normDesc(descricao);
    return norm ? mapeamentos.find(m => m.descricao_norm === norm) || null : null;
}

async function emailAtual() {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session?.user?.email || null;
}

// Cria ou atualiza o mapeamento (mesmo código, ou mesma descrição sem código). Retorna o registro ou null.
export async function salvarDePara({ codigo_estoque, descricao_estoque, descricao_romaneio, papel }) {
    const registro = {
        codigo_estoque: String(codigo_estoque ?? '').trim() || null,
        descricao_estoque: String(descricao_estoque ?? '').trim(),
        descricao_norm: normDesc(descricao_estoque),
        descricao_romaneio: String(descricao_romaneio ?? '').trim().toUpperCase(),
        papel,
        atualizado_por: await emailAtual(),
        atualizado_em: new Date().toISOString()
    };
    if (!registro.descricao_estoque || !registro.descricao_romaneio || !PAPEIS.some(p => p.chave === papel)) return null;

    const existente = registro.codigo_estoque
        ? mapeamentos.find(m => m.codigo_estoque === registro.codigo_estoque)
        : mapeamentos.find(m => !m.codigo_estoque && m.descricao_norm === registro.descricao_norm);

    const { data, error } = existente
        ? await supabaseClient.from('de_para_itens').update(registro).eq('id', existente.id).select()
        : await supabaseClient.from('de_para_itens').insert([registro]).select();

    if (error) {
        console.error('Erro ao salvar de-para:', error.message);
        return null;
    }
    const salvo = data[0];
    mapeamentos = mapeamentos.filter(m => m.id !== salvo.id).concat(salvo)
        .sort((a, b) => a.descricao_estoque.localeCompare(b.descricao_estoque, 'pt-BR'));
    return salvo;
}

export async function deletarDePara(id) {
    const { error } = await supabaseClient.from('de_para_itens').delete().eq('id', id);
    if (error) {
        console.error('Erro ao deletar de-para:', error.message);
        return false;
    }
    mapeamentos = mapeamentos.filter(m => m.id !== id);
    return true;
}

// --- Tela de manutenção (Gerenciar Dados -> De-para estoque) ---

// <datalist> com o cadastro de itens, para sugerir o nome no romaneio
export function datalistItensHtml(id = 'depara_itens_catalogo') {
    return `<datalist id="${id}">${getItems().map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`;
}

export function selectPapelHtml(selecionado, atributos = '') {
    return `<select ${atributos}>${PAPEIS.map(p =>
        `<option value="${p.chave}"${p.chave === selecionado ? ' selected' : ''}>${p.rotulo}</option>`).join('')}</select>`;
}

function linhaHtml(m) {
    const quando = m.atualizado_em ? new Date(m.atualizado_em).toLocaleDateString('pt-BR') : '';
    return `
        <div class="depara-row" data-id="${m.id}">
            <div class="depara-origem">
                ${m.codigo_estoque ? `<span class="depara-cod">${escapeHtml(m.codigo_estoque)}</span>` : ''}
                <span>${escapeHtml(m.descricao_estoque)}</span>
            </div>
            <input type="text" class="depara-nome" list="depara_itens_catalogo" value="${escapeHtml(m.descricao_romaneio)}">
            ${selectPapelHtml(m.papel, 'class="depara-papel"')}
            <div class="btn-group">
                <button class="btn-sm btn-neutral" onclick="salvarLinhaDePara(${m.id})">Salvar</button>
                <button class="btn-sm btn-danger" onclick="deletarLinhaDePara(${m.id})">Deletar</button>
            </div>
            <div class="depara-autor">${escapeHtml(m.atualizado_por || '')}${quando ? ` &middot; ${quando}` : ''}</div>
        </div>`;
}

export async function renderDeParaCRUD() {
    const container = $('depara_list');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">Carregando...</div>';
    if (!(await carregarDePara())) {
        container.innerHTML = '<div class="empty-state">Erro ao carregar o de-para. Rode o sql/estoque.sql no Supabase.</div>';
        return;
    }
    renderListaDePara();
}

window.renderListaDePara = function () {
    const container = $('depara_list');
    const termo = normDesc($('depara_search')?.value);
    const filtrados = termo
        ? mapeamentos.filter(m => normDesc([m.codigo_estoque, m.descricao_estoque, m.descricao_romaneio].join(' ')).includes(termo))
        : mapeamentos;

    container.innerHTML = datalistItensHtml() + `
        <div class="small">${mapeamentos.length} mapeamento(s)${termo ? ` &middot; ${filtrados.length} no filtro` : ''}</div>
        <div class="list-box">
            ${filtrados.map(linhaHtml).join('') || '<div class="empty-state">Nenhum mapeamento encontrado.</div>'}
        </div>`;
};

window.novoDePara = async function () {
    const campos = {
        codigo_estoque: $('depara_new_cod').value,
        descricao_estoque: $('depara_new_desc').value,
        descricao_romaneio: $('depara_new_nome').value,
        papel: $('depara_new_papel').value
    };
    if (!campos.descricao_estoque.trim() || !campos.descricao_romaneio.trim()) {
        toast('Preencha a descrição do estoque e o nome no romaneio.', 'warning');
        return;
    }
    if (await salvarDePara(campos)) {
        ['depara_new_cod', 'depara_new_desc', 'depara_new_nome'].forEach(id => { $(id).value = ''; });
        toast('Mapeamento salvo.');
        renderListaDePara();
    } else {
        toast('Não foi possível salvar o mapeamento.', 'error');
    }
};

// Sugere o papel enquanto digita a descrição do estoque
window.sugerirPapelNovoDePara = function () {
    $('depara_new_papel').value = sugerirPapel($('depara_new_desc').value);
};

window.salvarLinhaDePara = async function (id) {
    const m = mapeamentos.find(x => x.id === id);
    const row = document.querySelector(`.depara-row[data-id="${id}"]`);
    if (!m || !row) return;
    const nome = row.querySelector('.depara-nome').value;
    if (!nome.trim()) { toast('O nome no romaneio não pode ficar vazio.', 'warning'); return; }
    const ok = await salvarDePara({ ...m, descricao_romaneio: nome, papel: row.querySelector('.depara-papel').value });
    toast(ok ? 'Mapeamento atualizado.' : 'Não foi possível salvar.', ok ? 'success' : 'error');
    if (ok) renderListaDePara();
};

window.deletarLinhaDePara = async function (id) {
    const m = mapeamentos.find(x => x.id === id);
    if (!m || !confirm(`Apagar o mapeamento de "${m.descricao_estoque}"?\n\nNa próxima importação ele aparece como item novo.`)) return;
    if (await deletarDePara(id)) {
        toast('Mapeamento apagado.');
        renderListaDePara();
    } else {
        toast('Não foi possível apagar.', 'error');
    }
};

window.renderDeParaCRUD = renderDeParaCRUD;
