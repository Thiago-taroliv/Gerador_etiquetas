// Processo inverso da planilha de controle: lê linhas coladas do Excel (ou um .xlsx/.csv),
// agrupa por envio e devolve os dados no formato do formulário.

// Campo interno -> nomes de cabeçalho aceitos (sem acento, minúsculo, só letras/números)
const CABECALHOS = {
    os: ['osticket', 'os', 'ticket'],
    cliente: ['cliente'],
    unidade: ['unidade'],
    tipo: ['tipo'],
    equip: ['equip', 'equipamento'],
    imeiEquip: ['imeiequipamento', 'imeiequip', 'imeirastreador'],
    imeiTeclado: ['imeiteclado', 'imeitcl'],
    destinatario: ['destinatario', 'nome', 'razaosocial'],
    endereco: ['endereco'],
    cep: ['cep'],
    bairro: ['bairro'],
    cidade: ['cidade'],
    uf: ['uf', 'estado'],
    contato: ['contato'],
    dataEnvio: ['dataenvio']
};
// Ordem padrão (mesma do "Linhas p/ Planilha") quando não há cabeçalho
const PADRAO = { os: 0, cliente: 1, unidade: 2, tipo: 3, equip: 4, imeiEquip: 7, imeiTeclado: 8,
    destinatario: 17, endereco: 18, cep: 19, bairro: 20, cidade: 21, uf: 22, contato: 23, dataEnvio: 24 };

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "-------", "---" e afins contam como vazio
function limpar(v) {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return /^[-–_.\s]*$/.test(s) ? '' : s;
}

// Parser de TSV no formato que o Excel copia (células com quebra de linha vêm entre aspas)
export function parseTSV(texto) {
    const linhas = [];
    let linha = [], cel = '', aspas = false;
    const t = String(texto || '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (aspas) {
            if (ch === '"' && t[i + 1] === '"') { cel += '"'; i++; }
            else if (ch === '"') aspas = false;
            else cel += ch;
        } else if (ch === '"' && cel === '') aspas = true;
        else if (ch === '\t') { linha.push(cel); cel = ''; }
        else if (ch === '\n') { linha.push(cel); linhas.push(linha); linha = []; cel = ''; }
        else cel += ch;
    }
    if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
    return linhas;
}

// CSV (separado por ; ou ,) — usado no upload de .csv
export function parseCSV(texto) {
    const t = String(texto || '');
    const sep = (t.split('\n')[0].match(/;/g) || []).length >= (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return parseTSV(t.split('\n').map(l => {
        // troca o separador por TAB fora de aspas
        let out = '', aspas = false;
        for (const ch of l) {
            if (ch === '"') aspas = !aspas;
            out += (!aspas && ch === sep) ? '\t' : ch;
        }
        return out;
    }).join('\n'));
}

// Descobre a linha de cabeçalho e o índice de cada campo
function mapearColunas(grade) {
    for (let r = 0; r < Math.min(grade.length, 15); r++) {
        const nomes = grade[r].map(norm);
        if (!nomes.some(n => n.startsWith('imei')) || !nomes.some(n => n === 'osticket' || n === 'equip')) continue;

        const mapa = {};
        Object.entries(CABECALHOS).forEach(([campo, aceitos]) => {
            const idx = nomes.findIndex(n => aceitos.includes(n));
            if (idx >= 0) mapa[campo] = idx;
        });
        // Na planilha original a coluna do destinatário não tem título: é a que vem antes de "Endereço"
        if (mapa.destinatario === undefined && mapa.endereco > 0) mapa.destinatario = mapa.endereco - 1;
        return { inicio: r + 1, mapa };
    }
    return { inicio: 0, mapa: PADRAO };
}

// Converte a grade (array de arrays) em registros com os campos que importam
export function lerLinhas(grade) {
    const { inicio, mapa } = mapearColunas(grade);
    const registros = [];
    for (let r = inicio; r < grade.length; r++) {
        const g = grade[r];
        const reg = {};
        Object.entries(mapa).forEach(([campo, idx]) => { reg[campo] = limpar(g[idx]); });
        // ignora linhas vazias e as de título de grupo (DADOS / CONFIGURAÇÃO / ENVIO)
        if (!reg.equip && !reg.destinatario && !reg.imeiEquip && !reg.imeiTeclado) continue;
        if (norm(reg.os) === 'dados' || norm(reg.os) === 'osticket') continue;
        registros.push(reg);
    }
    return registros;
}

function dataOrdenavel(d) {
    const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return '';
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`;
}

// Agrupa as linhas por envio: mesma OS + destinatário + endereço + data de envio
export function agruparEnvios(registros) {
    const grupos = new Map();
    registros.forEach(reg => {
        const chave = [reg.os, norm(reg.destinatario), norm(reg.endereco), reg.dataEnvio].join('|');
        if (!grupos.has(chave)) grupos.set(chave, { chave, linhas: [] });
        grupos.get(chave).linhas.push(reg);
    });

    return [...grupos.values()].map(g => {
        const p = g.linhas[0];
        const unidades = [...new Set(g.linhas.map(l => l.unidade).filter(Boolean))];
        return {
            ...g,
            os: p.os, cliente: p.cliente, tipo: p.tipo, destinatario: p.destinatario,
            cidade: p.cidade, uf: p.uf, dataEnvio: p.dataEnvio, unidades,
            itens: montarItens(g.linhas, unidades.length > 1),
            busca: norm([p.os, p.cliente, p.destinatario, unidades.join(' '), p.cidade, p.uf, p.dataEnvio].join(' '))
        };
    }).sort((a, b) => dataOrdenavel(b.dataEnvio).localeCompare(dataOrdenavel(a.dataEnvio)) || String(b.os).localeCompare(String(a.os), 'pt-BR', { numeric: true }));
}

// Junta as linhas em itens do formulário: mesma descrição (e unidade, se forem várias) vira um item,
// com os IMEIs de cada linha (rastreador + teclado = kit)
export function montarItens(linhas, multi = false) {
    const itens = new Map();
    linhas.forEach(l => {
        const m = l.equip.match(/^(\d+)\s*x?\s+(.+)$/i);
        const qtd = m ? parseInt(m[1], 10) : 1;
        const desc = (m ? m[2] : l.equip || 'ITEM').trim().toUpperCase();
        const client = multi ? l.unidade : '';
        const chave = desc + '|' + client;
        if (!itens.has(chave)) itens.set(chave, { desc, qty: 0, client, imeis: [], semImei: 0 });
        const it = itens.get(chave);

        if (l.imeiEquip && l.imeiTeclado) it.imeis.push({ tipo: 'kit', rastreador: l.imeiEquip, teclado: l.imeiTeclado });
        else if (l.imeiEquip || l.imeiTeclado) it.imeis.push({ tipo: 'simples', imei: l.imeiEquip || l.imeiTeclado });
        else it.semImei += qtd;
    });

    return [...itens.values()].map(it => ({
        desc: it.desc,
        qty: String(it.imeis.length + it.semImei),
        client: it.client,
        imeis: it.imeis
    }));
}

// Resumo curto para a lista: "5× KIT RA24 (5 IMEIs), 3× CONVERSORES"
export function resumoItens(itens) {
    return itens.map(it => `${it.qty}× ${it.desc}${it.imeis.length ? ` (${it.imeis.length} IMEI${it.imeis.length > 1 ? 's' : ''})` : ''}`).join(', ');
}

// Dados no formato do formulário (os campos que a planilha não tem ficam com o valor atual do form)
export function grupoParaFormulario(grupo, base = {}) {
    const p = grupo.linhas[0];
    const multi = grupo.unidades.length > 1;
    const cidadeUf = [p.cidade, p.uf].filter(Boolean).join('/');
    const cep = p.cep ? `CEP ${p.cep}` : '';
    return {
        ...base,
        dest_name: p.destinatario,
        dest_addr1: p.endereco,
        dest_addr2: [p.bairro, cidadeUf, cep].filter(Boolean).join(' - '),
        dest_phone: p.contato,
        reference: p.os,
        reference_type: base.reference_type && base.reference_type !== 'none' ? base.reference_type : 'ticket',
        planilha_cliente: p.cliente,
        planilha_tipo: p.tipo,
        client_mode: multi ? 'multi' : 'single',
        unit_name: multi ? '' : (grupo.unidades[0] || ''),
        items: grupo.itens
    };
}

// Lê .xlsx/.xls (via SheetJS, carregado sob demanda) ou .csv/.tsv/.txt e devolve a grade
export async function lerArquivo(arquivo) {
    const nome = arquivo.name.toLowerCase();
    if (/\.(csv)$/.test(nome)) return parseCSV(await arquivo.text());
    if (/\.(tsv|txt)$/.test(nome)) return parseTSV(await arquivo.text());

    await carregarSheetJS();
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
    // Usa a aba que tiver o cabeçalho da planilha de controle; senão a primeira
    let grade = null;
    for (const nomeAba of wb.SheetNames) {
        const g = window.XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: '' });
        if (g.slice(0, 15).some(l => l.map(norm).some(n => n.startsWith('imei')))) { grade = g; break; }
        if (!grade) grade = g;
    }
    return (grade || []).map(l => l.map(v => {
        if (v instanceof Date) return v.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        if (typeof v === 'number' && Number.isInteger(v)) return BigInt(Math.round(v)).toString(); // IMEI sem notação científica
        return String(v ?? '');
    }));
}

function carregarSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, erro) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = ok;
        s.onerror = () => erro(new Error('Não foi possível carregar o leitor de Excel (sem internet?).'));
        document.head.appendChild(s);
    });
}
