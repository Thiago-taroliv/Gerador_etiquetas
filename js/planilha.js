// Gera linhas no padrão da planilha de controle (DADOS | CONFIGURAÇÃO | ENVIO)
// para colar no Excel/Google Sheets. A parte de CONFIGURAÇÃO fica em branco para preencher.
import { escapeHtml } from './config.js';

const NA = '-------';
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// Colunas da planilha, na ordem
export const COLUNAS = [
    'OS/Ticket', 'Cliente', 'Unidade', 'Tipo', 'Equip', 'Data Recebimento', 'Nome Config',
    'IMEI Equipamento', 'IMEI Teclado', 'ICCID Chip', 'Cartões', 'Bloqueio (S/N)', 'FW Equip', 'FW Tcl',
    'FW Sensor', 'Checklist', 'Observação Configuração',
    'Destinatário', 'Endereço', 'CEP', 'Bairro', 'Cidade', 'UF', 'Contato', 'Data Envio'
];
// Colunas que o Excel deve tratar como texto (números longos perdem dígitos ou viram 8,68E+14)
const COLUNAS_TEXTO = new Set([7, 8, 9]);

// Separa "Bairro - Cidade/UF - CEP 00000-000" (formato da busca de CEP) ou variações com vírgula
export function separarEnderecoLinha2(texto) {
    const res = { bairro: '', cidade: '', uf: '', cep: '' };
    let s = String(texto || '');

    const cepMatch = s.match(/(\d{2})\.?(\d{3})-?(\d{3})/);
    if (cepMatch) {
        res.cep = `${cepMatch[1]}${cepMatch[2]}-${cepMatch[3]}`;
        s = s.replace(cepMatch[0], '');
    }
    s = s.replace(/\bCEP\b:?/i, '');

    const partes = s.split(/\s+[-–]\s+|,|\s+[-–]$|^[-–]\s+/).map(p => p.trim()).filter(Boolean);
    const usadas = new Set();

    // "Cidade/UF" ou "Cidade - UF"
    partes.forEach((p, i) => {
        if (res.uf) return;
        const m = p.match(/^(.*?)\s*\/\s*([A-Za-z]{2})$/);
        if (m && UFS.includes(m[2].toUpperCase())) {
            res.cidade = m[1].trim();
            res.uf = m[2].toUpperCase();
            usadas.add(i);
        } else if (UFS.includes(p.toUpperCase()) && p.length === 2) {
            res.uf = p.toUpperCase();
            usadas.add(i);
            if (i > 0 && !usadas.has(i - 1)) { res.cidade = partes[i - 1]; usadas.add(i - 1); }
        }
    });

    const restantes = partes.filter((_, i) => !usadas.has(i));
    if (restantes.length) res.bairro = restantes[0];
    if (!res.cidade && restantes.length > 1) res.cidade = restantes[1];
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

    const linha = (unidade, equip, campos) => {
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

    // Colunas de configuração que não se aplicam a um teclado avulso
    const naTeclado = { 6: NA, 7: NA, 9: NA, 10: NA, 12: NA, 14: NA, 16: 'Somente teclado' };
    // Acessório (conversor, chicote...): nada de configuração
    const naAcessorio = {};
    for (let i = 5; i <= 16; i++) naAcessorio[i] = NA;

    (dados.items || []).forEach(it => {
        const desc = String(it.desc || '').trim().toUpperCase();
        if (!desc) return;
        const unidade = (multi ? it.client : '') || dados.unit_name || dados.dest_name || '';
        const ehKit = /\bKIT\b/.test(desc);
        const ehTeclado = /TECLADO/.test(desc) && !ehKit;
        const ehEquipamento = ehKit || ehTeclado || /RASTREADOR|ST\d{3}/.test(desc);
        const qtd = Math.max(1, parseInt(it.qty, 10) || 1);

        if (it.imeis && it.imeis.length) {
            // Uma linha por equipamento identificado
            it.imeis.forEach(im => {
                if (im.tipo === 'kit') {
                    linhas.push(linha(unidade, `1 ${desc}`, { 7: im.rastreador || '', 8: im.teclado || '' }));
                } else if (ehTeclado) {
                    linhas.push(linha(unidade, `1 ${desc}`, { ...naTeclado, 8: im.imei }));
                } else {
                    linhas.push(linha(unidade, `1 ${desc}`, { 7: im.imei, 8: ehKit ? '' : NA }));
                }
            });
        } else if (ehEquipamento) {
            // Equipamento sem IMEI informado: uma linha por unidade para preencher
            for (let i = 0; i < qtd; i++) {
                linhas.push(linha(unidade, `1 ${desc}`, ehTeclado ? { ...naTeclado } : (ehKit ? {} : { 8: NA })));
            }
        } else {
            linhas.push(linha(unidade, `${qtd} ${desc}`, naAcessorio));
        }
    });
    return linhas;
}

// Copia as linhas para a área de transferência em dois formatos:
// HTML (Excel respeita as colunas de texto) e texto com TAB (fallback)
export async function copiarLinhasPlanilha(linhas) {
    const tsv = linhas.map(l => l.map(v => String(v).replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');
    const html = '<table>' + linhas.map(l => '<tr>' + l.map((v, i) =>
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
