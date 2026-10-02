// Gera linhas no padrão da planilha de controle (DADOS | CONFIGURAÇÃO | ENVIO)
// para colar no Excel/Google Sheets. A parte de CONFIGURAÇÃO fica em branco para preencher.
import { escapeHtml } from './config.js';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
// Nome do estado por extenso (sem acento, minúsculo) -> sigla
const ESTADOS = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE',
    'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT',
    'mato grosso do sul': 'MS', 'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

// Colunas da planilha, na ordem, com o grupo (cor) de cada uma
export const COLUNAS = [
    'OS/Ticket', 'Cliente', 'Unidade', 'Tipo', 'Equip', 'Data Recebimento', 'Nome Config',
    'IMEI Equipamento', 'IMEI Teclado', 'ICCID Chip', 'Cartões', 'Bloqueio (S/N)', 'FW Equip', 'FW Tcl',
    'FW Sensor', 'Checklist', 'Observação Configuração',
    'Destinatário', 'Endereço', 'CEP', 'Bairro', 'Cidade', 'UF', 'Contato', 'Data Envio'
];
export const GRUPOS = [
    { id: 'dados', nome: 'Dados', de: 0, ate: 3 },
    { id: 'config', nome: 'Configuração', de: 4, ate: 16 },
    { id: 'envio', nome: 'Envio', de: 17, ate: 24 }
];
export const TIPOS = ['INS', 'COR', 'MAN', 'FOR'];
export const COL = { IMEI_EQUIP: 7, IMEI_TECLADO: 8, ICCID: 9 };

// Colunas que o Excel deve tratar como texto (números longos perdem dígitos ou viram 8,68E+14)
const COLUNAS_TEXTO = new Set([COL.IMEI_EQUIP, COL.IMEI_TECLADO, COL.ICCID]);

const semAcento = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Sigla da UF se o texto for uma UF ("SP") ou um estado por extenso ("Paraná"); senão ''
function comoUF(texto) {
    const t = texto.trim();
    if (t.length === 2 && UFS.includes(t.toUpperCase())) return t.toUpperCase();
    return ESTADOS[semAcento(t)] || '';
}

// Separa a linha 2 do endereço em Bairro / Cidade / UF / CEP.
// Aceita separadores " - ", "/", "," e ";" em qualquer combinação, ex.:
//   "Centro - Passos/MG - CEP 37900-049"
//   "São Miguel Paulista / São Paulo - SP / 08021-290"
//   "GUARAITUBA, Colombo, Paraná"
export function separarEnderecoLinha2(texto) {
    const res = { bairro: '', cidade: '', uf: '', cep: '' };
    let s = String(texto || '');

    const cepMatch = s.match(/(\d{2})\.?(\d{3})-?(\d{3})/);
    if (cepMatch) {
        res.cep = `${cepMatch[1]}${cepMatch[2]}-${cepMatch[3]}`;
        s = s.replace(cepMatch[0], ' ');
    }
    s = s.replace(/\bCEP\b:?/gi, ' ');

    const partes = s.split(/\s[-–]\s|[\/,;]|^\s*[-–]|[-–]\s*$/)
        .map(p => p.replace(/^[\s\-–.:]+|[\s\-–.:]+$/g, ''))
        .filter(Boolean);

    // UF: a última parte que for uma sigla/estado; a cidade é a parte anterior
    let idxUF = -1;
    for (let i = partes.length - 1; i >= 0; i--) {
        if (comoUF(partes[i])) { idxUF = i; break; }
    }
    if (idxUF >= 0) {
        res.uf = comoUF(partes[idxUF]);
        const antes = partes.slice(0, idxUF);
        if (antes.length >= 2) {
            res.cidade = antes[antes.length - 1];
            res.bairro = antes.slice(0, -1).join(' - ');
        } else if (antes.length === 1) {
            res.cidade = antes[0];
        }
    } else if (partes.length >= 2) {
        res.cidade = partes[partes.length - 1];
        res.bairro = partes.slice(0, -1).join(' - ');
    } else if (partes.length === 1) {
        res.bairro = partes[0];
    }
    return res;
}

function hoje() {
    return new Date().toLocaleDateString('pt-BR');
}

// Monta as linhas (array de arrays, 25 colunas) a partir dos dados do formulário/rascunho/histórico
export function gerarLinhasPlanilha(dados, dataEnvio = hoje()) {
    const end = separarEnderecoLinha2(dados.dest_addr2);
    const os = dados.reference_type === 'none' ? '' : String(dados.reference || '').trim();
    const multi = dados.client_mode === 'multi';
    const linhas = [];

    const linha = (unidade, equip, campos = {}) => {
        const l = new Array(COLUNAS.length).fill('');
        l[0] = os;
        l[1] = dados.planilha_cliente || '';
        l[2] = unidade;
        l[3] = dados.planilha_tipo || '';
        l[4] = equip;
        Object.entries(campos).forEach(([i, v]) => { l[i] = v; });
        l[17] = (dados.dest_name || '').trim();
        l[18] = (dados.dest_addr1 || '').trim();
        l[19] = end.cep;
        l[20] = end.bairro;
        l[21] = end.cidade;
        l[22] = end.uf;
        l[23] = (dados.dest_phone || '').trim();
        l[24] = dataEnvio;
        return l;
    };

    (dados.items || []).forEach(it => {
        const desc = String(it.desc || '').trim().toUpperCase();
        if (!desc) return;
        const unidade = (multi ? it.client : '') || dados.unit_name || dados.dest_name || '';
        const ehKit = /\bKIT\b/.test(desc);
        const ehTeclado = /TECLADO/.test(desc) && !ehKit;
        const ehEquipamento = ehKit || ehTeclado || /RASTREADOR|ST\d{3}/.test(desc);
        const qtd = Math.max(1, parseInt(it.qty, 10) || 1);
        const obs = ehTeclado ? { 16: 'Somente teclado' } : {};

        if (it.imeis && it.imeis.length) {
            // Uma linha por equipamento identificado
            it.imeis.forEach(im => {
                if (im.tipo === 'kit') {
                    linhas.push(linha(unidade, `1 ${desc}`, { 7: im.rastreador || '', 8: im.teclado || '' }));
                } else if (ehTeclado) {
                    linhas.push(linha(unidade, `1 ${desc}`, { ...obs, 8: im.imei }));
                } else {
                    linhas.push(linha(unidade, `1 ${desc}`, { 7: im.imei }));
                }
            });
        } else if (ehEquipamento) {
            // Equipamento sem IMEI informado: uma linha por unidade para preencher
            for (let i = 0; i < qtd; i++) linhas.push(linha(unidade, `1 ${desc}`, obs));
        } else {
            // Acessório (conversor, chicote...): uma linha com a quantidade
            linhas.push(linha(unidade, `${qtd} ${desc}`));
        }
    });
    return linhas;
}

// Copia as linhas para a área de transferência em dois formatos:
// HTML (Excel respeita as colunas de texto) e texto com TAB (fallback)
export async function copiarLinhasPlanilha(linhas) {
    const limpo = linhas.map(l => l.map(v => String(v ?? '').replace(/[\t\n\r]+/g, ' ').trim()));
    const tsv = limpo.map(l => l.join('\t')).join('\n');
    const html = '<table>' + limpo.map(l => '<tr>' + l.map((v, i) =>
        COLUNAS_TEXTO.has(i)
            ? `<td style="mso-number-format:'\\@'">${escapeHtml(v)}</td>`
            : `<td>${escapeHtml(v)}</td>`
    ).join('') + '</tr>').join('') + '</table>';

    if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([tsv], { type: 'text/plain' })
        })]);
    } else {
        await navigator.clipboard.writeText(tsv);
    }
}
