// Leitor da planilha de ESTOQUE (saída de estoque Ranor): 1 linha = 1 equipamento/acessório,
// com até N itens de saída por linha (Saída 1, Complementar 1, Complementar 2...).
// Agrupa as linhas por envio e monta os itens no formato do formulário.
// Não depende do navegador (exceto lerArquivoEstoque): o de-para entra pelo parâmetro resolverItem.
import { parseTSV, parseCSV, carregarSheetJS } from './importarPlanilha.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Campos fixos: nome do cabeçalho normalizado -> campo (aceita variações e erros como "MOTIIVO")
const CAMPOS = [
    ['data', n => n === 'data'],
    ['ticket', n => n.startsWith('ticket')],
    ['os', n => n === 'os' || n === 'nf' || n.startsWith('osnf')],
    ['produto', n => n.startsWith('produto')],
    ['clienteInicial', n => n.startsWith('clienteinicial')],
    ['clienteFinal', n => n.startsWith('clientefinal')],
    ['motivo', n => /^mot+i+vo/.test(n)],
    ['destinatario', n => n.startsWith('destinat')]
];
const ehDescSaida = n => /^descri\w*saida/.test(n);
const ehImei = n => /^[ei]mei/.test(n);
const ehCod = n => n.startsWith('cod');
const ehQtd = n => n.startsWith('qt');

// Motivo -> Tipo da planilha de envio
const TIPOS = [
    ['MAN', n => n.startsWith('manut')],
    ['INS', n => n.startsWith('instal')],
    ['COR', n => n.startsWith('correc') || n.startsWith('corret')],
    ['FOR', n => n.startsWith('fornec')]
];
export function motivoParaTipo(motivo) {
    const n = norm(motivo);
    return n ? (TIPOS.find(([, teste]) => teste(n))?.[0] || '') : '';
}

// "-------" e afins contam como vazio
function limpar(v) {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return /^[-–_.\s]*$/.test(s) ? '' : s;
}

// Ticket/OS que o Excel formatou com separador de milhar ("2.456" ou "2,456" -> "2456")
const limparReferencia = v => {
    const s = limpar(v);
    return /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s;
};

const limparImei = v => limpar(v).replace(/\s/g, '');
const imeiCorrompido = v => /e\+?\d+$/i.test(v); // notação científica: dígitos perdidos

function lerQtd(v) {
    const s = limpar(v).replace(',', '.');
    const n = Math.round(parseFloat(s));
    return Number.isFinite(n) && n > 0 ? n : 1;
}

// Ordem padrão da planilha de estoque, usada quando as linhas são coladas sem o cabeçalho:
// DATA | OS/NF | TICKET | PRODUTO | CLIENTE INICIAL | CLIENTE FINAL | MOTIVO | DESTINATÁRIO |
// Cod | Emei Entrada | Descritivo Entrada | QTE | depois 3 blocos de saída (Cod | Emei | Descrição | Qtd)
const PADRAO = {
    campos: { data: 0, os: 1, ticket: 2, produto: 3, clienteInicial: 4, clienteFinal: 5, motivo: 6, destinatario: 7 },
    blocos: [12, 16, 20].map(i => ({ cod: i, imei: i + 1, desc: i + 2, qtd: i + 3 }))
};
const pareceData = v => /^\d{1,2}[-/.]/.test(String(v ?? '').trim());

// Linhas sem cabeçalho no layout padrão: data na 1ª coluna e destinatário + descrição de saída preenchidos
function pareceLayoutPadrao(grade) {
    return grade.some(l => l && pareceData(l[0]) && limpar(l[PADRAO.campos.destinatario]) && limpar(l[PADRAO.blocos[0].desc]));
}

// Descobre a linha de cabeçalho, os campos fixos e os blocos de saída (cod, IMEI, descrição, qtd).
// Sem cabeçalho, usa a ordem padrão (semCabecalho: true) se as linhas tiverem cara de planilha de estoque.
export function mapearColunasEstoque(grade) {
    const comCabecalho = mapearPorCabecalho(grade);
    if (comCabecalho) return comCabecalho;
    return pareceLayoutPadrao(grade) ? { linhaCabecalho: -1, ...PADRAO, semCabecalho: true } : null;
}

function mapearPorCabecalho(grade) {
    for (let r = 0; r < Math.min(grade.length, 15); r++) {
        const nomes = (grade[r] || []).map(norm);
        const descs = nomes.map((n, i) => ehDescSaida(n) ? i : -1).filter(i => i >= 0);
        if (!descs.length || !nomes.some(n => n.startsWith('destinat'))) continue;

        const campos = {};
        CAMPOS.forEach(([campo, teste]) => {
            const idx = nomes.findIndex(teste);
            if (idx >= 0) campos[campo] = idx;
        });

        // Cada "Descrição Saída…" puxa o Cod e o IMEI que vêm logo antes e a quantidade logo depois
        const anterior = (d, teste) => {
            for (let i = d - 1; i >= Math.max(0, d - 3); i--) if (teste(nomes[i])) return i;
            return -1;
        };
        const blocos = descs.map(d => ({
            desc: d,
            imei: anterior(d, ehImei),
            cod: anterior(d, ehCod),
            qtd: ehQtd(nomes[d + 1] || '') ? d + 1 : -1
        }));
        return { linhaCabecalho: r, campos, blocos };
    }
    return null;
}

// Lê as linhas de dados. grade: textos como aparecem na planilha; bruta (opcional): valores brutos,
// usados nas colunas de IMEI (no .xlsx o texto formatado pode vir em notação científica).
export function lerLinhasEstoque(grade, bruta = grade) {
    const mapa = mapearColunasEstoque(grade);
    if (!mapa) return null;
    const { linhaCabecalho, campos, blocos, semCabecalho = false } = mapa;

    const registros = [];
    const ignoradas = [];
    for (let r = linhaCabecalho + 1; r < grade.length; r++) {
        const g = grade[r] || [];
        const b = bruta[r] || g;
        const campo = c => campos[c] === undefined ? '' : limpar(g[campos[c]]);
        const numLinha = r + 1; // como no Excel

        const saidas = blocos.map(bl => ({
            cod: bl.cod >= 0 ? limpar(g[bl.cod]) : '',
            imei: bl.imei >= 0 ? limparImei(b[bl.imei]) : '',
            desc: limpar(g[bl.desc]),
            qtd: bl.qtd >= 0 ? lerQtd(g[bl.qtd]) : 1
        })).filter(s => s.desc || s.imei);

        const reg = {
            linha: numLinha,
            data: campo('data'),
            ticket: limparReferencia(campo('ticket')),
            os: limparReferencia(campo('os')),
            produto: campo('produto'),
            clienteInicial: campo('clienteInicial'),
            clienteFinal: campo('clienteFinal'),
            motivo: campo('motivo'),
            destinatarioOriginal: campo('destinatario'),
            saidas
        };

        if (!saidas.length) {
            // Linha vazia não conta; linha só com entrada (ex. Retorno de Teste) é informada
            if (reg.destinatarioOriginal || reg.clienteInicial) ignoradas.push({ linha: numLinha, motivo: 'sem itens de saída' });
            continue;
        }
        const dest = norm(reg.destinatarioOriginal);
        if (dest === 'ranor') { ignoradas.push({ linha: numLinha, motivo: 'destinatário RANOR (retorno interno)' }); continue; }

        // "CLIENTE FINAL" no destinatário: o envio vai para o cliente da coluna CLIENTE FINAL
        reg.paraClienteFinal = dest === 'clientefinal';
        reg.destinatario = reg.paraClienteFinal ? reg.clienteFinal : reg.destinatarioOriginal;
        registros.push(reg);
    }
    return { registros, ignoradas, blocos: blocos.length, semCabecalho };
}

// Impressão digital curta (FNV-1a) para reconhecer o mesmo envio numa reimportação
function hash(texto) {
    let h = 0x811c9dc5;
    for (let i = 0; i < texto.length; i++) {
        h ^= texto.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// resolverItem(cod, descEstoque) -> { desc, papel, novo }: nome no romaneio e papel (do de-para ou sugerido)
export function agruparEnviosEstoque(registros, resolverItem) {
    const grupos = new Map();
    registros.forEach(reg => {
        const chave = [reg.data, reg.ticket || reg.os, norm(reg.destinatario), norm(reg.clienteFinal)].join('|');
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(reg);
    });

    return [...grupos.entries()].map(([chaveBase, linhas]) => {
        const p = linhas[0];
        const avisos = [];
        const motivos = [...new Set(linhas.map(l => l.motivo).filter(Boolean))];
        if (motivos.length > 1) avisos.push(`Motivos diferentes no mesmo envio (${motivos.join(', ')}): usado "${motivos[0]}".`);
        const tipo = motivoParaTipo(motivos[0]);
        if (motivos[0] && !tipo) avisos.push(`Motivo "${motivos[0]}" sem Tipo correspondente: preencha o Tipo à mão.`);

        const { itens, novos, avisosItens } = montarItensEstoque(linhas, resolverItem);
        avisos.push(...avisosItens);

        // versao muda quando os itens mudam (linha acrescentada na planilha, quantidade corrigida...)
        const versao = hash(itens.map(it => [it.desc, it.papel, it.qty, ...it.imeis.map(i => i.imei)].join(',')).sort().join(';'));
        const rastreadores = itens.filter(it => it.papel === 'rastreador').reduce((s, it) => s + it.imeis.length, 0);
        const teclados = itens.filter(it => it.papel === 'teclado').reduce((s, it) => s + it.imeis.length, 0);

        return {
            chave: hash(chaveBase), // identifica o envio numa reimportação
            versao,
            data: p.data,
            ticket: p.ticket,
            os: p.os,
            produto: p.produto,
            clienteInicial: p.clienteInicial,
            clienteFinal: p.clienteFinal,
            motivo: motivos[0] || '',
            tipo,
            destinatario: p.destinatario,
            paraClienteFinal: p.paraClienteFinal,
            linhas: linhas.map(l => l.linha),
            itens,
            novos,            // itens sem de-para (precisam ser mapeados antes de criar o rascunho)
            kitsPossiveis: Math.min(rastreadores, teclados),
            rastreadores,
            teclados,
            avisos
        };
    });
}

// Itens do formulário: mesmo nome + papel vira um item; rastreador/teclado levam os IMEIs;
// o chip não vira item: fica preso ao rastreador da mesma linha (para a planilha de envio)
export function montarItensEstoque(linhas, resolverItem) {
    const itens = new Map();
    const novos = new Map();
    const avisosItens = [];

    linhas.forEach(l => {
        // desc passa a ser o nome no romaneio; descEstoque guarda o texto original da planilha
        const resolvidas = l.saidas.map(s => ({ ...s, descEstoque: s.desc, ...resolverItem(s.cod, s.desc) }));
        resolvidas.filter(s => s.novo).forEach(s => {
            const k = s.cod || norm(s.descEstoque);
            if (!novos.has(k)) novos.set(k, { cod: s.cod, descEstoque: s.descEstoque, papelSugerido: s.papel });
        });

        const imeiRastreadorDaLinha = [];
        resolvidas.forEach(s => {
            if (s.papel === 'ignorar' || s.papel === 'chip') return;
            const chave = s.desc + '|' + s.papel;
            if (!itens.has(chave)) itens.set(chave, { desc: s.desc, papel: s.papel, novo: !!s.novo, imeis: [], semImei: 0 });
            const it = itens.get(chave);

            const comImei = (s.papel === 'rastreador' || s.papel === 'teclado') && s.imei;
            if (comImei) {
                if (imeiCorrompido(s.imei)) avisosItens.push(`Linha ${l.linha}: IMEI "${s.imei}" em notação científica (dígitos perdidos). Corrija na planilha.`);
                const entrada = { tipo: 'simples', imei: s.imei };
                it.imeis.push(entrada);
                if (s.papel === 'rastreador') imeiRastreadorDaLinha.push(entrada);
            } else {
                it.semImei += s.qtd;
            }
        });

        resolvidas.filter(s => s.papel === 'chip').forEach(chip => {
            const alvo = imeiRastreadorDaLinha.find(e => !e.chip);
            if (alvo) {
                alvo.chip = chip.descEstoque;
                if (chip.imei) alvo.iccid = chip.imei;
            } else {
                avisosItens.push(`Linha ${l.linha}: chip sem rastreador com IMEI na mesma linha (não vai para o romaneio).`);
            }
        });
    });

    return {
        itens: [...itens.values()].map(it => ({
            desc: it.desc,
            qty: String(it.imeis.length + it.semImei),
            client: '',
            papel: it.papel,
            novo: it.novo,
            imeis: it.imeis
        })),
        novos: [...novos.values()],
        avisosItens
    };
}

// Lê o arquivo e devolve { grade, bruta, aba }, ou null se nenhuma aba tiver o cabeçalho do estoque.
// No .xlsx lê duas versões: o texto exibido (Cod "8.10" continua "8.10") e o valor bruto (IMEI sem notação científica).
export async function lerArquivoEstoque(arquivo) {
    const nome = arquivo.name.toLowerCase();
    if (/\.(csv|tsv|txt)$/.test(nome)) {
        const texto = await arquivo.text();
        const grade = nome.endsWith('.csv') ? parseCSV(texto) : parseTSV(texto);
        return mapearColunasEstoque(grade) ? { grade, bruta: grade, aba: '' } : null;
    }

    await carregarSheetJS();
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
    for (const aba of wb.SheetNames) {
        const ws = wb.Sheets[aba];
        const exibido = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        if (!mapearColunasEstoque(exibido)) continue;

        const bruto = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        const grade = exibido.map((linha, r) => linha.map((v, c) => {
            const b = bruto[r]?.[c];
            // Datas no formato brasileiro, qualquer que seja o formato da célula
            return b instanceof Date ? b.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : String(v ?? '');
        }));
        const bruta = bruto.map(linha => linha.map(v =>
            typeof v === 'number' && Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v ?? '')));
        return { grade, bruta, aba };
    }
    return null;
}

// Dados no formato do formulário. Os campos que a planilha não tem ficam com o valor de base.
export function grupoEstoqueParaFormulario(grupo, base = {}) {
    const referencia = grupo.ticket || grupo.os;
    return {
        ...base,
        dest_name: grupo.destinatario,
        unit_name: grupo.clienteFinal,
        reference: referencia,
        reference_type: grupo.ticket ? 'ticket' : grupo.os ? 'os' : (base.reference_type || 'ticket'),
        planilha_cliente: grupo.clienteInicial,
        planilha_tipo: grupo.tipo,
        client_mode: 'single',
        items: grupo.itens.map(({ desc, qty, client, papel, imeis }) => ({ desc, qty, client, papel, imeis })),
        origem: { perfil: 'estoque', chave: grupo.chave, versao: grupo.versao, linhas: grupo.linhas }
    };
}

// O que o envio ainda precisa que a planilha de estoque não traz (aviso no formulário e no kanban)
export function pendenciasEnvio(d) {
    const p = [];
    if (!String(d.dest_doc || '').trim()) p.push('CPF/CNPJ');
    if (!String(d.dest_addr1 || '').trim()) p.push('Endereço');
    if (!String(d.dest_phone || '').trim()) p.push('Contato');
    if (d.reference_type !== 'none' && !String(d.reference || '').trim()) p.push('Referência');
    if (!d.planilha_tipo) p.push('Tipo');
    if (!d.total_vol) p.push('Volumes');
    return p;
}
