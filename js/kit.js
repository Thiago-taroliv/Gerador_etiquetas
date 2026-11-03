// Montagem de kit (ex. KIT RA24) a partir dos itens de um envio, sempre confirmada pelo usuário:
// sugerirKit propõe qual item é cada componente da receita e quantos kits dá por OS/ticket,
// montarKit aplica a escolha confirmada e desmontarKit volta aos componentes.
// Os itens estão no formato do formulário: { desc, qty, papel, imeis: [{ tipo, imei, chip, iccid, ref }], por_ref }.
// Não depende do navegador.

// Receita usada enquanto não houver nenhuma salva no Supabase (nomes no padrão do de-para)
export const RECEITA_PADRAO = {
    nome: 'KIT RA24',
    componentes: [
        { nome: 'RASTREADOR RA24', qtd: 1 },
        { nome: 'TECLADO RA24', qtd: 1 },
        { nome: 'SENSOR DE COLISÃO RA24', qtd: 1 },
        { nome: 'CHICOTE C1', qtd: 1 },
        { nome: 'CHICOTE C2', qtd: 1 },
        { nome: 'CHICOTE C3', qtd: 1 },
        { nome: 'CHICOTE C4', qtd: 1 },
        { nome: 'LACRE', qtd: 1 },
        { nome: 'LACRE -ADESIVO', qtd: 2 },
        { nome: 'SUPORTE FERRO TECLADO', qtd: 1 }
    ]
};

const palavras = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(Boolean);
const norm = s => palavras(s).join(' ');
const qtdDe = it => parseInt(it.qty) || 0;

function papelDe(it) {
    if (it.papel) return it.papel;
    if (/TECLADO/.test(norm(it.desc))) return 'teclado';
    if (/RASTREADOR|EQUIPAMENTO/.test(norm(it.desc))) return 'rastreador';
    return 'acessorio';
}
const simples = it => (it.imeis || []).filter(im => im.tipo !== 'kit' && im.imei);
// Rastreador/teclado com IMEI: entra no kit pelo IMEI (o kit sai com o par rastreador|teclado)
const porImei = it => ['rastreador', 'teclado'].includes(papelDe(it)) && simples(it).length > 0;

// O item sabe de qual OS/ticket veio cada unidade?
function temRefs(it) {
    if (porImei(it)) return simples(it).every(im => im.ref);
    const pr = it.por_ref || {};
    return Object.keys(pr).length > 0 && Object.values(pr).reduce((s, q) => s + q, 0) === qtdDe(it);
}
const refsDo = it => porImei(it) ? simples(it).map(im => im.ref) : Object.keys(it.por_ref || {});
// Unidades do item disponíveis para o kit numa OS/ticket (ref null = sem separar por OS)
function unidades(it, ref) {
    if (porImei(it)) return simples(it).filter(im => ref === null || im.ref === ref).length;
    return ref === null ? qtdDe(it) : (it.por_ref?.[ref] || 0);
}

export const acharItem = (itens, desc) => desc ? itens.find(it => papelDe(it) !== 'kit' && it.desc === desc) || null : null;

// Item mais parecido com o nome do componente (mesmo nome; senão o que tiver mais palavras em comum)
function itemParecido(itens, nome, usados) {
    const alvo = norm(nome);
    let idx = itens.findIndex((it, i) => !usados.has(i) && papelDe(it) !== 'kit' && norm(it.desc) === alvo);
    if (idx >= 0) return idx;
    const pal = palavras(nome);
    let melhor = 0.6;
    itens.forEach((it, i) => {
        if (usados.has(i) || papelDe(it) === 'kit') return;
        const deles = new Set(palavras(it.desc));
        const nota = pal.filter(p => deles.has(p)).length / Math.max(pal.length, deles.size);
        if (nota > melhor) { melhor = nota; idx = i; }
    });
    return idx;
}

// Quantos kits dá por OS/ticket com a escolha: { ref: kits } (ref '' quando os itens não separam por OS)
export function maxKits(itens, componentes) {
    const comps = componentes.map(c => ({ ...c, it: acharItem(itens, c.desc) }));
    if (!comps.length || comps.some(c => !c.it || !(c.qtd > 0))) return {};
    if (new Set(comps.map(c => c.it)).size < comps.length) return {}; // mesmo item em dois componentes
    const separa = comps.every(c => temRefs(c.it));
    const refs = separa ? [...new Set(comps.flatMap(c => refsDo(c.it)))] : [''];
    const max = {};
    refs.forEach(ref => {
        const n = Math.min(...comps.map(c => Math.floor(unidades(c.it, separa ? ref : null) / c.qtd)));
        if (n > 0) max[ref] = n;
    });
    return max;
}

// Sugestão: { nome, componentes: [{ nome, qtd, desc }], max, kitsPorRef } (desc '' = componente sem item)
export function sugerirKit(itens, receita) {
    const usados = new Set();
    const componentes = receita.componentes.map(c => {
        const idx = itemParecido(itens, c.nome, usados);
        if (idx >= 0) usados.add(idx);
        return { nome: c.nome, qtd: c.qtd, desc: idx >= 0 ? itens[idx].desc : '' };
    });
    const max = maxKits(itens, componentes);
    return { nome: receita.nome, componentes, max, kitsPorRef: { ...max } };
}

export const totalKits = kitsPorRef => Object.values(kitsPorRef || {}).reduce((s, n) => s + (parseInt(n) || 0), 0);

const clonar = it => ({ ...it, imeis: [...(it.imeis || [])], ...(it.por_ref ? { por_ref: { ...it.por_ref } } : {}) });

function tirar(it, ref, q) {
    it.qty = String(qtdDe(it) - q);
    if (ref && it.por_ref) {
        it.por_ref[ref] = (it.por_ref[ref] || 0) - q;
        if (it.por_ref[ref] <= 0) delete it.por_ref[ref];
    }
}
function tirarImeis(it, ref, n) {
    if (!it) return [];
    const tirados = simples(it).filter(im => !ref || im.ref === ref).slice(0, n);
    it.imeis = it.imeis.filter(im => !tirados.includes(im));
    tirar(it, ref, tirados.length);
    return tirados;
}

// Aplica a escolha confirmada: { nome, componentes: [{ desc, qtd }], kitsPorRef }. Devolve os itens novos:
// os componentes saem dos itens (a sobra continua avulsa) e entra um item kit com os pares de IMEI.
export function montarKit(itens, escolha) {
    const lista = itens.map(clonar);
    const max = maxKits(lista, escolha.componentes);
    const comps = escolha.componentes.map(c => ({ ...c, it: acharItem(lista, c.desc) }));
    if (comps.some(c => !c.it)) return lista;
    const separa = comps.every(c => temRefs(c.it));
    const rast = comps.find(c => papelDe(c.it) === 'rastreador' && porImei(c.it));
    const tecl = comps.find(c => papelDe(c.it) === 'teclado' && porImei(c.it));

    const imeis = [];
    const porRef = {};
    let total = 0;
    Object.entries(escolha.kitsPorRef || {}).forEach(([ref, pedido]) => {
        const n = Math.min(parseInt(pedido) || 0, max[ref] || 0);
        if (n <= 0) return;
        const r = separa ? ref : '';
        comps.filter(c => c !== rast && c !== tecl).forEach(c => tirar(c.it, r, n * c.qtd));
        const rs = tirarImeis(rast?.it, r, n * (rast?.qtd || 0));
        const ts = tirarImeis(tecl?.it, r, n * (tecl?.qtd || 0));
        for (let i = 0; i < n; i++) {
            const a = rs[i], b = ts[i];
            const extra = { ...(a?.chip ? { chip: a.chip } : {}), ...(a?.iccid ? { iccid: a.iccid } : {}), ...(r ? { ref: r } : {}) };
            if (a && b) imeis.push({ tipo: 'kit', rastreador: a.imei, teclado: b.imei, ...extra });
            else if (a || b) imeis.push({ tipo: 'simples', imei: (a || b).imei, ...extra });
        }
        if (r) porRef[r] = (porRef[r] || 0) + n;
        total += n;
    });
    if (!total) return lista;

    // Mesmo kit já montado antes no envio: soma nele
    let kit = lista.find(it => papelDe(it) === 'kit' && it.desc === escolha.nome);
    if (!kit) {
        kit = { desc: escolha.nome, qty: '0', client: comps[0].it.client || '', papel: 'kit', imeis: [] };
        lista.unshift(kit);
    }
    kit.qty = String(qtdDe(kit) + total);
    kit.imeis = [...(kit.imeis || []), ...imeis];
    if (separa) {
        kit.por_ref = { ...(kit.por_ref || {}) };
        Object.entries(porRef).forEach(([r, n]) => { kit.por_ref[r] = (kit.por_ref[r] || 0) + n; });
    }
    kit.kit = { componentes: comps.map(c => ({ desc: c.desc, qtd: c.qtd, papel: c === rast ? 'rastreador' : c === tecl ? 'teclado' : papelDe(c.it) })) };

    return lista.filter(it => it === kit || qtdDe(it) > 0 || (it.imeis || []).length);
}

// Desfaz o kit da posição idx (só kits montados pelo programa, que guardam os componentes)
export function desmontarKit(itens, idx) {
    const kit = itens[idx];
    if (!kit?.kit?.componentes) return null;
    const lista = itens.filter((_, i) => i !== idx).map(clonar);
    const n = qtdDe(kit);
    const pares = kit.imeis || [];

    kit.kit.componentes.forEach(c => {
        let alvo = lista.find(it => papelDe(it) !== 'kit' && it.desc === c.desc);
        if (!alvo) {
            alvo = { desc: c.desc, qty: '0', client: kit.client || '', papel: c.papel, imeis: [], ...(kit.por_ref ? { por_ref: {} } : {}) };
            lista.push(alvo);
        }
        const doPar = c.papel === 'rastreador' ? 'rastreador' : c.papel === 'teclado' ? 'teclado' : null;
        const voltam = doPar ? pares.map(p => {
            const imei = p.tipo === 'kit' ? p[doPar] : (doPar === 'rastreador' ? p.imei : '');
            if (!imei) return null;
            const chip = doPar === 'rastreador' ? { ...(p.chip ? { chip: p.chip } : {}), ...(p.iccid ? { iccid: p.iccid } : {}) } : {};
            return { tipo: 'simples', imei, ...chip, ...(p.ref ? { ref: p.ref } : {}) };
        }).filter(Boolean) : [];

        if (voltam.length) {
            alvo.imeis = [...alvo.imeis, ...voltam];
            alvo.qty = String(qtdDe(alvo) + voltam.length);
        } else {
            alvo.qty = String(qtdDe(alvo) + n * c.qtd);
        }
        if (kit.por_ref && alvo.por_ref) {
            Object.entries(kit.por_ref).forEach(([r, k]) => { alvo.por_ref[r] = (alvo.por_ref[r] || 0) + k * c.qtd; });
        }
    });
    return lista;
}
