// Linhas da planilha de importação de veículos da plataforma: um veículo por rastreador do envio.
// A placa ainda não é conhecida no envio: vai "MODELO OS-NN" (ex. RA24 52-01), igual na descrição.
// Não depende do navegador.
import { papelDoItem } from './planilha.js';

export const COLUNAS_VEICULOS = ['Cliente*:', 'Placa*:', 'Descricao*:', 'Chip_ICCID*:', 'Chip_Telefone*:',
    'Chip_Operadora*:', 'Equip_Tipo*:', 'Equip_Imei*:'];
export const VC = { CLIENTE: 0, PLACA: 1, DESCRICAO: 2, ICCID: 3, TELEFONE: 4, OPERADORA: 5, TIPO: 6, IMEI: 7 };

const semAcento = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
export const normUnidade = s => semAcento(s).replace(/[^A-Z0-9]/g, '');

// "RASTREADOR RA24" / "KIT RA24" -> "RA24"; "ST340UR" -> "ST340UR"; senão o nome sem RASTREADOR/KIT
export function modeloDoItem(desc) {
    const d = semAcento(desc);
    const ra = d.match(/\bRA\s?(\d{2})\b/);
    if (ra) return `RA${ra[1]}`;
    const st = d.match(/\bST\s?\d{3}[A-Z]*\b/);
    if (st) return st[0].replace(/\s/g, '');
    return d.replace(/\b(RASTREADOR|EQUIPAMENTO|KIT)\b/g, '').replace(/\s+/g, ' ').trim();
}

// "Chip Vivo -Virtueyes" -> "VIVO"
const OPERADORAS = ['VIVO', 'CLARO', 'TIM', 'OI', 'ALGAR', 'ARQIA', 'SURF', 'EMNIFY', 'TRANSATEL'];
export function operadoraDoChip(chip) {
    const palavras = semAcento(chip).split(/[^A-Z0-9]+/);
    return OPERADORAS.find(o => palavras.includes(o)) || '';
}

// Rastreadores do envio, na ordem do formulário: { unidade, modelo, imei, iccid, operadora, ref }
export function rastreadoresDoEnvio(dados) {
    const lista = [];
    (dados.items || []).forEach(it => {
        const papel = papelDoItem(it);
        if (papel !== 'rastreador' && papel !== 'kit') return;
        const unidade = (dados.client_mode === 'multi' ? it.client : '') || dados.unit_name || dados.dest_name || '';
        const modelo = modeloDoItem(it.desc);
        (it.imeis || []).forEach(im => {
            const imei = im.tipo === 'kit' ? im.rastreador : im.imei;
            if (!imei) return;
            lista.push({ unidade, modelo, imei: String(imei).trim(), iccid: String(im.iccid || '').trim(),
                operadora: operadoraDoChip(im.chip), ref: im.ref || '' });
        });
    });
    return lista;
}

// clientes: [{ unidade, cliente }] (nome na plataforma lembrado por unidade); telefone: Chip_Telefone fixo
export function gerarLinhasVeiculos(dados, { clientes = [], telefone = '' } = {}) {
    // Referência única do pedido vale para os rastreadores sem OS própria
    const refPedido = dados.reference_type !== 'none' && !String(dados.reference || '').includes('/')
        ? String(dados.reference || '').trim() : '';
    const seq = new Map();
    return rastreadoresDoEnvio(dados).map(r => {
        const ref = r.ref || refPedido;
        const chave = `${r.modelo}|${ref}`;
        seq.set(chave, (seq.get(chave) || 0) + 1);
        const placa = `${r.modelo} ${ref ? `${ref}-` : ''}${String(seq.get(chave)).padStart(2, '0')}`;
        const cliente = clientes.find(c => normUnidade(c.unidade) === normUnidade(r.unidade))?.cliente || r.unidade;
        const linha = [cliente, placa, placa, r.iccid, telefone, r.operadora, r.modelo, r.imei];
        linha.unidadeOrigem = r.unidade; // a prévia troca o cliente de todas as linhas da mesma unidade
        return linha;
    });
}
