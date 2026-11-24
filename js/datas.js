// Datas digitadas pela pessoa (despacho, entrega, retorno): campo <input type="date"> <-> ISO do banco.
// Não depende do navegador.

const doisDigitos = n => String(n).padStart(2, '0');
const diaLocal = d => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

// 'AAAA-MM-DD' de hoje (fuso local)
export const hojeInput = () => diaLocal(new Date());

// ISO do banco -> 'AAAA-MM-DD' (fuso local); vazio se não houver data
export const paraInput = iso => iso ? diaLocal(new Date(iso)) : '';

// 'AAAA-MM-DD' -> ISO. Hoje guarda a hora atual; outro dia guarda meio-dia, para o fuso não mudar o dia.
export function deInput(texto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) return null;
    if (texto === hojeInput()) return new Date().toISOString();
    const [a, m, d] = texto.split('-').map(Number);
    return new Date(a, m - 1, d, 12).toISOString();
}

// Problema da data digitada, ou null. minimo: 'AAAA-MM-DD' (ex. a entrega não pode ser antes do despacho).
export function problemaData(texto, { rotulo = 'A data', minimo = '', rotuloMinimo = '' } = {}) {
    if (!texto) return `${rotulo} é obrigatória.`;
    if (!deInput(texto)) return `${rotulo} é inválida.`;
    if (texto > hojeInput()) return `${rotulo} não pode ser no futuro.`;
    if (minimo && texto < minimo) return `${rotulo} não pode ser antes ${rotuloMinimo || `de ${dataBR(minimo)}`}.`;
    return null;
}

// 'AAAA-MM-DD' ou ISO -> 'dd/mm/aaaa'
export function dataBR(valor) {
    if (!valor) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [a, m, d] = valor.split('-');
        return `${d}/${m}/${a}`;
    }
    return new Date(valor).toLocaleDateString('pt-BR');
}
