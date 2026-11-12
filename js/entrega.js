// Forma de saída do pedido: por transportadora (padrão) ou sem envio (retirada / instalação na Ranor).
// Sem envio: não pede NF, não tem etiqueta, rastreio nem frete, e sai direto para "Entregue".
// Fica em dados_completos.entrega. Não depende do navegador.

export const FORMAS_ENTREGA = [
    { chave: 'transportadora', rotulo: 'Transportadora', icone: '' },
    { chave: 'retirada',       rotulo: 'Retirada na Ranor', icone: '🏢' },
    { chave: 'instalacao',     rotulo: 'Instalação na Ranor', icone: '🔧' }
];

const forma = chave => FORMAS_ENTREGA.find(f => f.chave === chave);

// Pedido sem forma gravada (os anteriores a esta opção) vai por transportadora
export const entregaDe = dados => forma(dados?.entrega) ? dados.entrega : 'transportadora';
export const semEnvio = dados => entregaDe(dados) !== 'transportadora';
export const rotuloEntrega = chave => forma(chave)?.rotulo || chave;
export const iconeEntrega = chave => forma(chave)?.icone || '';

// --- Planilha de estoque: forma de saída pelo PRODUTO, CLIENTE INICIAL ou MOTIVO ---
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Regras de Cadastros > Configurações (definirRegrasEntrega); esta é a padrão
let regras = [{ contem: 'rfleet', entrega: 'retirada' }];
export function definirRegrasEntrega(r) {
    if (Array.isArray(r)) regras = r;
}

// textos: valores das colunas de todas as linhas do envio. Vale a primeira regra que aparecer em algum deles.
export function entregaDoEnvio(textos) {
    const ns = textos.map(norm).filter(Boolean);
    const regra = regras.find(r => norm(r.contem) && ns.some(n => n.includes(norm(r.contem))));
    return regra && forma(regra.entrega) ? regra.entrega : 'transportadora';
}
