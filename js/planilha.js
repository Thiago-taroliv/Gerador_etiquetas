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
    'Destinatário', 'Endereço', 'CEP', 'Bairro', 'Cidade', 'UF', 'Contato', 'Data Envio',
    'Código Rastreio', 'Qtde Caixa', 'Data Recebido', 'Valor do frete'
];
export const GRUPOS = [
    { id: 'dados', nome: 'Dados', de: 0, ate: 3 },
    { id: 'config', nome: 'Configuração', de: 4, ate: 16 },
    { id: 'envio', nome: 'Envio', de: 17, ate: 28 }
];
export const TIPOS = ['INS', 'COR', 'MAN', 'FOR'];
export const COL = { IMEI_EQUIP: 7, IMEI_TECLADO: 8, ICCID: 9, RASTREIO: 25 };

// Colunas que o Excel deve tratar como texto (números longos perdem dígitos ou viram 8,68E+14)
const COLUNAS_TEXTO = new Set([COL.IMEI_EQUIP, COL.IMEI_TECLADO, COL.ICCID, COL.RASTREIO]);

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

// 25.9 -> "25,90" (vazio se não informado)
export const formatarFrete = v =>
    v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "25,90", "R$ 1.234,56" ou "25.90" -> número; '' -> null; inválido -> NaN
export function lerValor(texto) {
    let t = String(texto).replace(/[^\d,.]/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// Acessórios que podem ter "KIT" no nome sem serem kit de rastreador (ex. "SUPORTE ... KIT ÂNCORA")
const ACESSORIO = /SUPORTE|LACRE|CHICOTE|ANCORA|ÂNCORA|CABO|PARAFUSO|ABRA[CÇ]ADEIRA|FUS[IÍ]VEL|CHIP/;

// Papel do item: o do de-para (planilha de estoque) ou, em itens digitados à mão, deduzido da descrição
export function papelDoItem(it) {
    if (it.papel) return it.papel;
    const desc = String(it.desc || '').toUpperCase();
    if (/\bKIT\b/.test(desc) && !ACESSORIO.test(desc)) return 'kit';
    if (/TECLADO/.test(desc)) return 'teclado';
    if (/RASTREADOR|EQUIPAMENTO|ST\d{3}/.test(desc)) return 'rastreador';
    return 'acessorio';
}

const unidadeDoItem = (dados, it) =>
    ((dados.client_mode === 'multi' ? it.client : '') || dados.unit_name || dados.dest_name || '');

// Unidades avulsas de um item, uma por linha da planilha: os IMEIs informados
// ou, sem nenhum IMEI, uma unidade vazia por quantidade (o número é preenchido depois)
function unidadesAvulsas(it) {
    const imeis = it.imeis || [];
    if (imeis.length) return imeis.filter(im => im.tipo !== 'kit' && im.imei);
    return Array.from({ length: Math.max(1, parseInt(it.qty, 10) || 1) }, () => ({ imei: '' }));
}

// Junta rastreador + teclado avulsos da mesma unidade, na ordem do formulário (vale qualquer ordem dos itens).
// Item "KIT" já traz o teclado físico: só recebe de outro item o número de um teclado que tenha IMEI.
// Devolve { unidades: item -> unidades, pares: unidade -> teclado, emKit: teclados usados, rastreadores, teclados }.
function formarPares(dados) {
    const unidades = new Map();
    const porUnidade = new Map();
    let rastreadores = 0, teclados = 0;

    (dados.items || []).forEach(it => {
        const papel = papelDoItem(it);
        if (!['rastreador', 'teclado', 'kit'].includes(papel)) return;
        const lista = unidadesAvulsas(it);
        unidades.set(it, lista);
        const un = unidadeDoItem(dados, it);
        if (!porUnidade.has(un)) porUnidade.set(un, { lado: [], fila: [] });
        const grupo = porUnidade.get(un);
        if (papel === 'teclado') {
            grupo.fila.push(...lista);
            teclados += lista.length;
        } else {
            grupo.lado.push(...lista.map(u => ({ u, ehKit: papel === 'kit' })));
            rastreadores += lista.length;
        }
    });

    const pares = new Map();
    const emKit = new Set();
    porUnidade.forEach(({ lado, fila }) => {
        lado.forEach(({ u, ehKit }) => {
            const tecl = fila.find(t => !emKit.has(t) && (!ehKit || t.imei));
            if (!tecl) return;
            pares.set(u, tecl);
            emKit.add(tecl);
        });
    });
    return { unidades, pares, emKit, rastreadores, teclados };
}

// Quantos kits dá para montar juntando rastreador + teclado avulsos da mesma unidade
export function contarKits(dados) {
    const { pares, rastreadores, teclados } = formarPares(dados);
    return { kits: pares.size, rastreadores, teclados };
}

// "RASTREADOR RA24" -> "KIT RA24" (nome da linha do kit montado; editável no preview)
function descricaoKit(descRastreador) {
    const d = String(descRastreador || '').trim().toUpperCase();
    if (/\bKIT\b/.test(d)) return d;
    return /RASTREADOR|EQUIPAMENTO/.test(d) ? d.replace(/RASTREADOR|EQUIPAMENTO/, 'KIT').replace(/\s+/g, ' ') : `KIT ${d}`;
}

// ICCID só vai para a planilha quando há número; sem número a coluna fica vazia
const iccidDe = im => (im.iccid && /\d{6,}/.test(im.iccid) ? String(im.iccid).trim() : '');

// Monta as linhas (array de arrays, uma posição por coluna) a partir dos dados do formulário/rascunho/histórico.
// montarKits: junta rastreador + teclado avulsos da mesma unidade numa linha só (na ordem dos IMEIs).
// É o padrão: só fica separado quando a pessoa desmarca "Montar kits" (montar_kits === false).
// envio: o que o pedido já tem depois de despachado — { rastreio, frete, recebido }
export function gerarLinhasPlanilha(dados, dataEnvio = hoje(), { montarKits = dados.montar_kits !== false, envio = {} } = {}) {
    const end = separarEnderecoLinha2(dados.dest_addr2);
    const os = dados.reference_type === 'none' ? '' : String(dados.reference || '').trim();
    const linhas = [];

    // Pares rastreador -> teclado formados antes de gerar as linhas
    const juncao = formarPares(dados);
    const parDoRastreador = montarKits ? juncao.pares : new Map();
    const tecladosEmKit = montarKits ? juncao.emKit : new Set();

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
        l[25] = envio.rastreio || '';
        l[26] = String(dados.total_vol || '').trim();
        l[27] = envio.recebido || '';
        l[28] = formatarFrete(envio.frete);
        return l;
    };

    (dados.items || []).forEach(it => {
        const desc = String(it.desc || '').trim().toUpperCase();
        if (!desc) return;
        const unidade = unidadeDoItem(dados, it);
        const papel = papelDoItem(it);
        if (papel === 'chip' || papel === 'ignorar') return;
        const ehTeclado = papel === 'teclado';
        const ehEquipamento = papel === 'kit' || papel === 'rastreador' || ehTeclado;
        const qtd = Math.max(1, parseInt(it.qty, 10) || 1);
        const obs = ehTeclado ? { 16: 'Somente teclado' } : {};

        if (ehEquipamento) {
            // Pares já prontos (rastreador|teclado) saem como estão
            (it.imeis || []).filter(im => im.tipo === 'kit').forEach(im => {
                linhas.push(linha(unidade, `1 ${desc}`, { 7: im.rastreador || '', 8: im.teclado || '', 9: iccidDe(im) }));
            });
            // Uma linha por unidade, com ou sem IMEI (chip com ICCID vai na mesma linha do rastreador)
            juncao.unidades.get(it).forEach(u => {
                if (ehTeclado) {
                    if (tecladosEmKit.has(u)) return; // já saiu na linha de um kit
                    linhas.push(linha(unidade, `1 ${desc}`, { ...obs, 8: u.imei }));
                } else if (parDoRastreador.has(u)) {
                    linhas.push(linha(unidade, `1 ${descricaoKit(desc)}`, { 7: u.imei, 8: parDoRastreador.get(u).imei, 9: iccidDe(u) }));
                } else {
                    linhas.push(linha(unidade, `1 ${desc}`, { 7: u.imei, 9: iccidDe(u) }));
                }
            });
        } else if (it.imeis && it.imeis.length) {
            // Acessório com número: uma linha por número identificado
            it.imeis.forEach(im => {
                linhas.push(im.tipo === 'kit'
                    ? linha(unidade, `1 ${desc}`, { 7: im.rastreador || '', 8: im.teclado || '', 9: iccidDe(im) })
                    : linha(unidade, `1 ${desc}`, { 7: im.imei, 9: iccidDe(im) }));
            });
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
