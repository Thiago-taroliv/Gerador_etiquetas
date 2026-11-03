// Modal "Importar planilha de estoque": lê o arquivo (ou linhas coladas), mostra a prévia dos envios,
// pede o de-para dos itens novos e cria um rascunho por envio (aparecem na coluna Rascunho do kanban).
import { $, escapeHtml, SENDERS } from './config.js';
import { parseTSV } from './importarPlanilha.js';
import { lerLinhasEstoque, agruparEnviosEstoque, grupoEstoqueParaFormulario, lerArquivoEstoque, chaveDeAgrupamento } from './importarEstoque.js';
import { sugerirKit, montarKit, totalKits } from './kit.js';
import { abrirMontarKit } from './kitModal.js';
import { carregarReceitas } from './kitReceitas.js';
import { garantirDePara, acharDePara, salvarDePara, sugerirPapel, sugerirNome, normDesc, datalistItensHtml, selectPapelHtml } from './dePara.js';
import { carregarOrigensEstoque, salvarPendente } from './db.js';
import { toast } from './toast.js';

let registros = [];    // linhas lidas da planilha (reagrupadas quando um de-para muda)
let ignoradas = [];
let grupos = [];
let nomeArquivo = '';
let semCabecalho = false; // linhas coladas sem cabeçalho: colunas na ordem padrão da planilha
let existentes = { rascunhos: new Map(), historico: new Set(), historicoIds: new Set() }; // chave do envio -> rascunho / já gerado
let marcados = new Set();
let descartes = new Map(); // chave do envio -> origens (código/descrição do estoque) dos itens descartados
let aoConcluir = null;
let kits = new Map();      // chave do envio -> kit confirmado na tela "Montar kit"
let separados = new Set(); // agrupamentos separados por OS/ticket
let juntar = new Map();    // agrupamento -> agrupamento com que foi juntado
let receitaSugestao = null;

const descartado = (g, it) => it.origens.every(o => descartes.get(g.chave)?.has(o));
// Com kit confirmado, os componentes viram o item kit (g.itensKit); a sobra continua avulsa
const itensDoEnvio = g => g.itensKit || g.itens;
const itensMantidos = g => itensDoEnvio(g).filter(it => !descartado(g, it));
// O kit faz parte da versão: montar/alterar o kit atualiza o rascunho já importado
const versaoDoEnvio = g => g.versao + (kits.has(g.chave) ? '+kit' + JSON.stringify(kits.get(g.chave).kitsPorRef) : '');

function aplicarKit(g) {
    const escolha = kits.get(g.chave);
    g.itensKit = escolha
        ? montarKit(g.itens, escolha).map(it => ({ ...it, origens: it.origens || [`kit:${it.desc}`], novo: !!it.novo }))
        : null;
}

// Agrupamento da linha com as separações/junções feitas na prévia
function chaveDoReg(reg) {
    let k = chaveDeAgrupamento(reg);
    if (separados.has(k)) k += '|' + (reg.ticket || reg.os || '');
    for (let i = 0; i < 20 && juntar.has(k); i++) k = juntar.get(k);
    return k;
}

// Campos que você preenche à mão no rascunho: reimportar não apaga o que já foi digitado
const CAMPOS_MANUAIS = ['dest_doc', 'dest_addr1', 'dest_addr2', 'dest_phone', 'total_vol', 'carrier', 'receiver',
    'sender_company', 'sender_cnpj', 'sender_address', 'doc_type'];

// Nome do estoque -> item do sistema, pelo de-para; sem de-para, o item fica "novo" com papel sugerido
function resolverItem(cod, desc) {
    const m = acharDePara(cod, desc);
    return m
        ? { desc: m.descricao_romaneio, papel: m.papel, novo: false }
        : { desc: String(desc || '').toUpperCase(), papel: sugerirPapel(desc), novo: true };
}

// Destinatário no cadastro: nome igual; senão, um único cadastro que contenha todas as palavras
function acharCadastro(nome) {
    const lista = window.__destinatariosSupabase || [];
    const alvo = normDesc(nome);
    if (!alvo) return { cad: null };
    const igual = lista.find(d => normDesc(d.nome) === alvo);
    if (igual) return { cad: igual };

    const palavras = String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(p => p.length > 1);
    const parecidos = lista.filter(d => {
        const n = String(d.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return palavras.every(p => n.includes(p));
    });
    return parecidos.length === 1 ? { cad: parecidos[0] } : { cad: null, parecidos: parecidos.length };
}

function statusDoGrupo(g) {
    if (existentes.historico.has(g.chave)) return 'gerado';
    const r = existentes.rascunhos.get(g.chave);
    if (!r) return 'novo';
    const histId = r.dados_completos?.historico_id;
    if (histId && existentes.historicoIds.has(String(histId))) return 'gerado';
    // Rascunho ligado a um registro do histórico que foi apagado ou cancelado: some do kanban;
    // reimportar regrava o rascunho sem o vínculo e ele volta a aparecer
    if (histId) return 'atualizar';
    return r.dados_completos?.origem?.versao === versaoDoEnvio(g) ? 'igual' : 'atualizar';
}

const ROTULO_STATUS = {
    novo: ['Novo', 'novo'],
    atualizar: ['Atualizar rascunho', 'atualizar'],
    igual: ['Já importado, sem mudanças', 'igual'],
    gerado: ['Já gerado (no histórico)', 'gerado']
};

function reagrupar() {
    grupos = agruparEnviosEstoque(registros, resolverItem, chaveDoReg).map(g => ({ ...g, ...acharCadastro(g.destinatario), status: null }));
    grupos.forEach(g => { aplicarKit(g); g.status = statusDoGrupo(g); });
    marcados = new Set(grupos.filter(g => g.status === 'novo' || g.status === 'atualizar').map(g => g.chave));
}

// Itens sem de-para nos envios marcados (um por código, ou por descrição quando não há código).
// Item descartado não precisa de de-para.
function itensNovos() {
    const mapa = new Map();
    grupos.filter(g => marcados.has(g.chave)).forEach(g => {
        const usadas = new Set(itensMantidos(g).filter(it => it.novo).flatMap(it => it.origens));
        g.novos.forEach(n => {
            const k = n.cod || normDesc(n.descEstoque);
            if (usadas.has(k) && !mapa.has(k)) mapa.set(k, n);
        });
    });
    return [...mapa.values()];
}

async function receber(grade, bruta, origem) {
    const lido = lerLinhasEstoque(grade, bruta);
    if (!lido) {
        toast('As linhas não parecem da planilha de estoque. Copie a partir da coluna DATA (com ou sem o cabeçalho).', 'error', 7000);
        return;
    }
    if (!lido.registros.length) {
        toast('Nenhuma linha com itens de saída encontrada.', 'warning', 6000);
        return;
    }
    $('estoque_status').textContent = 'Carregando de-para e envios já importados...';
    const [okDePara, origens] = await Promise.all([garantirDePara(), carregarOrigensEstoque()]);
    $('estoque_status').textContent = '';
    if (!okDePara) {
        toast('Não foi possível carregar o de-para. Rode o sql/estoque.sql no Supabase.', 'error', 7000);
        return;
    }
    if (!origens) toast('Não foi possível conferir os envios já importados: todos aparecem como novos.', 'warning', 7000);

    // Pedido cancelado no histórico não bloqueia: o envio pode ser importado de novo
    const historicoAtivo = (origens?.historico || []).filter(h => h.fase !== 'cancelado');
    existentes = {
        rascunhos: new Map((origens?.rascunhos || []).map(r => [r.dados_completos?.origem?.chave, r])),
        historico: new Set(historicoAtivo.map(h => h.origem?.chave)),
        historicoIds: new Set(historicoAtivo.map(h => String(h.id)))
    };
    // Reimportação: os itens descartados e o kit confirmado da última vez continuam valendo
    descartes = new Map();
    kits = new Map();
    separados = new Set();
    juntar = new Map();
    existentes.rascunhos.forEach((r, chave) => {
        const d = r.dados_completos?.origem?.descartados;
        if (chave && d?.length) descartes.set(chave, new Set(d));
        const kit = r.dados_completos?.origem?.kit;
        if (chave && kit?.componentes) kits.set(chave, kit);
    });
    receitaSugestao = (await carregarReceitas())[0];
    registros = lido.registros;
    ignoradas = lido.ignoradas;
    nomeArquivo = origem;
    semCabecalho = lido.semCabecalho;
    reagrupar();
    mostrarEtapa();
}

function mostrarEtapa() {
    const temDados = grupos.length > 0;
    $('estoque_entrada').style.display = temDados ? 'none' : 'flex';
    $('estoque_previa').style.display = temDados ? 'flex' : 'none';
    if (temDados) render();
    else {
        $('estoque_info').textContent = '';
        setTimeout(() => $('estoque_colar').focus(), 50);
    }
}

// Itens do envio, cada um com ✕ para descartar (não vai para o rascunho) ou ↺ para trazer de volta
function itensHtml(g, i) {
    return `<div class="estoque-itens">${itensDoEnvio(g).map((it, j) => {
        const fora = descartado(g, it);
        const texto = `${it.qty}× ${it.desc}${it.imeis.length ? ` (${it.imeis.length} IMEI${it.imeis.length > 1 ? 's' : ''})` : ''}`
            + (it.imeis.some(x => x.chip) ? ' + chip' : '');
        return `<span class="estoque-item${fora ? ' descartado' : ''}${it.novo ? ' novo' : ''}">
            ${escapeHtml(texto)}
            <button type="button" class="estoque-item-btn" title="${fora ? 'Trazer de volta' : 'Descartar: não vai para o rascunho'}"
                    onclick="event.preventDefault(); event.stopPropagation(); alternarItemEstoque(${i}, ${j})">${fora ? '↺' : '✕'}</button>
        </span>`;
    }).join('')}</div>`;
}

window.alternarItemEstoque = function (i, j) {
    const g = grupos[i];
    const it = g && itensDoEnvio(g)[j];
    if (!it) return;
    if (!descartes.has(g.chave)) descartes.set(g.chave, new Set());
    const set = descartes.get(g.chave);
    const fora = descartado(g, it);
    it.origens.forEach(o => fora ? set.delete(o) : set.add(o));
    render();
};

function render() {
    const novos = itensNovos();
    const qtdMarcados = grupos.filter(g => marcados.has(g.chave) && itensMantidos(g).length).length;
    const linhasLidas = registros.length;

    $('estoque_info').innerHTML = `${escapeHtml(nomeArquivo)} &middot; ${linhasLidas} linha(s) &middot; ${grupos.length} envio(s)` +
        (ignoradas.length ? ` &middot; ${ignoradas.length} linha(s) ignorada(s)` : '') +
        (semCabecalho ? ' &middot; sem cabeçalho: colunas na ordem padrão da planilha' : '');

    const ignoradasHtml = ignoradas.length ? `
        <details class="estoque-ignoradas">
            <summary>${ignoradas.length} linha(s) ignorada(s)</summary>
            ${[...new Set(ignoradas.map(i => i.motivo))].map(m => {
                const linhas = ignoradas.filter(i => i.motivo === m).map(i => i.linha);
                return `<div>${escapeHtml(m)}: linhas ${linhas.join(', ')}</div>`;
            }).join('')}
        </details>` : '';

    const novosHtml = novos.length ? `
        <div class="estoque-novos">
            <div class="estoque-novos-titulo">⚠ ${novos.length} item(ns) sem de-para — defina o nome no romaneio e o papel antes de criar os rascunhos</div>
            ${datalistItensHtml('estoque_itens_catalogo')}
            ${novos.map((n, i) => `
                <div class="estoque-novo-row" data-idx="${i}">
                    <div class="depara-origem">
                        ${n.cod ? `<span class="depara-cod">${escapeHtml(n.cod)}</span>` : ''}
                        <span>${escapeHtml(n.descEstoque)}</span>
                    </div>
                    <input type="text" class="novo-nome" list="estoque_itens_catalogo" value="${escapeHtml(sugerirNome(n.descEstoque))}">
                    ${selectPapelHtml(n.papelSugerido, 'class="novo-papel"')}
                </div>`).join('')}
            <div class="estoque-novos-acoes">
                <button class="btn-sm" onclick="salvarNovosEstoque(this)">Salvar de-para e atualizar prévia</button>
            </div>
        </div>` : '';

    const enviosHtml = grupos.map((g, i) => {
        const [rotulo, classe] = ROTULO_STATUS[g.status];
        const ref = g.referencia ? `${g.ticket ? 'Ticket' : 'OS'} ${g.referencia}` : 'Sem referência';
        const cadastro = g.cad
            ? `<span class="estoque-tag ok" title="${escapeHtml(g.cad.nome)}">✓ cadastro</span>`
            : `<span class="estoque-tag falta">${g.parecidos > 1 ? `${g.parecidos} cadastros parecidos` : 'fora do cadastro'}: preencher à mão</span>`;
        const meta = [g.clienteFinal && `Unidade: ${g.clienteFinal}`, g.clienteInicial && `Cliente: ${g.clienteInicial}`,
            g.tipo || g.motivo, g.data, `linhas ${g.linhas[0]}–${g.linhas[g.linhas.length - 1]}`].filter(Boolean);
        const bloqueado = g.status === 'gerado';
        return `
            <label class="imp-item estoque-envio${bloqueado ? ' bloqueado' : ''}">
                <input type="checkbox" ${marcados.has(g.chave) ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}
                       onchange="marcarEnvioEstoque(${i}, this.checked)">
                <div class="imp-main">
                    <div class="imp-titulo">
                        <span class="imp-os">${escapeHtml(ref)}</span>
                        <span>${escapeHtml(g.destinatario || 'Sem destinatário')}</span>
                        ${cadastro}
                        <span class="estoque-status ${classe}">${rotulo}</span>
                    </div>
                    <div class="imp-meta">${meta.map(escapeHtml).join(' &middot; ')}</div>
                    ${itensHtml(g, i)}
                    ${marcados.has(g.chave) && !itensMantidos(g).length ? '<div class="estoque-aviso">⚠ Todos os itens descartados: este envio não vira rascunho.</div>' : ''}
                    ${kitHtml(g, i)}
                    ${agrupamentoHtml(g, i)}
                    ${g.avisos.map(a => `<div class="estoque-aviso">⚠ ${escapeHtml(a)}</div>`).join('')}
                </div>
            </label>`;
    }).join('');

    $('estoque_lista').innerHTML = ignoradasHtml + novosHtml + enviosHtml;

    const btn = $('estoque_criar');
    btn.disabled = novos.length > 0 || qtdMarcados === 0;
    btn.textContent = `Criar ${qtdMarcados} rascunho(s)`;
    btn.title = novos.length ? 'Defina o de-para dos itens novos primeiro' : '';
}

// Botões dentro do <label> do envio: o clique não pode marcar/desmarcar o envio
const botao = (texto, acao, titulo = '') =>
    `<button type="button" class="btn-sm btn-neutral" title="${escapeHtml(titulo)}"
             onclick="event.preventDefault(); event.stopPropagation(); ${acao}">${texto}</button>`;

const rotuloRef = g => g.ticket ? 'Ticket' : 'OS';
const detalheKits = (g, porRef) => {
    const refs = Object.keys(porRef).filter(Boolean);
    return refs.length > 1 ? ` (${refs.map(r => `${porRef[r]} da ${rotuloRef(g)} ${r}`).join(', ')})` : '';
};

// Kit: confirmado (alterar/desfazer) ou sugerido pela receita (abre a tela para conferir)
function kitHtml(g, i) {
    const escolha = kits.get(g.chave);
    if (escolha) {
        return `<div class="estoque-aviso kit estoque-acoes">✓ ${totalKits(escolha.kitsPorRef)} ${escapeHtml(escolha.nome)} montado(s)${escapeHtml(detalheKits(g, escolha.kitsPorRef))}
            ${botao('Alterar', `montarKitEstoque(${i})`)} ${botao('Desfazer kit', `desfazerKitEstoque(${i})`)}</div>`;
    }
    const temRastreador = g.itens.some(it => it.papel === 'rastreador');
    if (!receitaSugestao || !temRastreador) return '';
    const s = sugerirKit(g.itens, receitaSugestao);
    const total = totalKits(s.max);
    return `<div class="estoque-aviso kit estoque-acoes">🔧 ${total
        ? `Dá para montar até ${total} ${escapeHtml(s.nome)}${escapeHtml(detalheKits(g, s.max))}`
        : 'Rastreadores sem kit completo pela receita'}
        ${botao('Montar kit…', `montarKitEstoque(${i})`, 'Conferir os componentes e quantos kits montar')}</div>`;
}

window.montarKitEstoque = async function (i) {
    const g = grupos[i];
    if (!g) return;
    const escolha = await abrirMontarKit(g.itens, { rotuloRef: rotuloRef(g), escolhaAnterior: kits.get(g.chave) || null });
    if (!escolha) return;
    kits.set(g.chave, escolha);
    atualizarGrupo(g);
};

window.desfazerKitEstoque = function (i) {
    const g = grupos[i];
    if (!g) return;
    kits.delete(g.chave);
    atualizarGrupo(g);
};

// Depois de mudar o kit: refaz os itens e o status (rascunho já importado passa a "Atualizar")
function atualizarGrupo(g) {
    aplicarKit(g);
    const antes = g.status;
    g.status = statusDoGrupo(g);
    if (g.status !== antes) {
        if (g.status === 'novo' || g.status === 'atualizar') marcados.add(g.chave);
        else if (g.status === 'igual') marcados.delete(g.chave);
    }
    render();
}

// Separar um envio por OS/ticket, juntar com outro envio, e desfazer
function agrupamentoHtml(g, i) {
    if (g.status === 'gerado') return '';
    const base = [...separados].find(b => g.agrupamento.startsWith(b + '|'));
    const juntados = [...juntar.values()].includes(g.agrupamento);
    const outros = grupos.map((o, j) => ({ o, j })).filter(({ o }) => o !== g && o.status !== 'gerado');
    const acoes = [
        g.refs.length > 1 ? botao(`Separar por ${rotuloRef(g)}`, `separarEnvioEstoque(${i})`, 'Um envio para cada OS/ticket') : '',
        base ? botao(`Juntar as ${rotuloRef(g)} de novo`, `reunirEnvioEstoque(${i})`) : '',
        juntados ? botao('Desfazer junção', `desfazerJuncaoEstoque(${i})`) : '',
        outros.length ? `<select class="estoque-juntar" onclick="event.stopPropagation()" onchange="juntarEnvioEstoque(${i}, this.value)">
            <option value="">Juntar com outro envio…</option>
            ${outros.map(({ o, j }) => `<option value="${j}">${escapeHtml(o.referencia || 'Sem referência')} · ${escapeHtml(o.destinatario || '')} · ${escapeHtml(o.data || '')}</option>`).join('')}
        </select>` : ''
    ].filter(Boolean);
    return acoes.length ? `<div class="estoque-acoes">${acoes.join(' ')}</div>` : '';
}

window.separarEnvioEstoque = function (i) {
    const g = grupos[i];
    if (!g) return;
    separados.add(g.agrupamento);
    reagrupar();
    render();
};

window.reunirEnvioEstoque = function (i) {
    const g = grupos[i];
    const base = g && [...separados].find(b => g.agrupamento.startsWith(b + '|'));
    if (!base) return;
    separados.delete(base);
    reagrupar();
    render();
};

window.juntarEnvioEstoque = function (i, j) {
    const g = grupos[i], alvo = grupos[parseInt(j)];
    if (!g || !alvo) return;
    // Não deixa formar ciclo (A -> B -> A)
    let destino = alvo.agrupamento;
    for (let n = 0; n < 20 && juntar.has(destino); n++) destino = juntar.get(destino);
    if (destino === g.agrupamento) return;
    juntar.set(g.agrupamento, alvo.agrupamento);
    reagrupar();
    render();
};

window.desfazerJuncaoEstoque = function (i) {
    const g = grupos[i];
    if (!g) return;
    [...juntar.entries()].filter(([, alvo]) => alvo === g.agrupamento).forEach(([origem]) => juntar.delete(origem));
    reagrupar();
    render();
};

window.marcarEnvioEstoque = function (i, marcado) {
    const g = grupos[i];
    if (!g) return;
    if (marcado) marcados.add(g.chave); else marcados.delete(g.chave);
    render();
};

window.salvarNovosEstoque = async function (btn) {
    const novos = itensNovos();
    const linhas = [...document.querySelectorAll('.estoque-novo-row')];
    const faltando = linhas.filter(l => !l.querySelector('.novo-nome').value.trim());
    if (faltando.length) { toast('Preencha o nome no romaneio de todos os itens novos.', 'warning'); return; }

    btn.disabled = true;
    btn.textContent = 'Salvando...';
    const resultados = await Promise.all(linhas.map(l => {
        const n = novos[l.dataset.idx];
        return salvarDePara({
            codigo_estoque: n.cod,
            descricao_estoque: n.descEstoque,
            descricao_romaneio: l.querySelector('.novo-nome').value,
            papel: l.querySelector('.novo-papel').value
        });
    }));
    const falhas = resultados.filter(r => !r).length;
    if (falhas) toast(`${falhas} mapeamento(s) não foram salvos. Tente de novo.`, 'error');
    else toast(`${resultados.length} mapeamento(s) salvos.`);

    // Reagrupa com o de-para novo, mantendo o que estava marcado
    const antes = new Set(marcados);
    reagrupar();
    marcados = new Set([...marcados].filter(c => antes.has(c)));
    render();
};

// Dados de um rascunho a partir do envio; numa atualização, mantém o que já foi digitado à mão
function montarDados(g) {
    const ranor = SENDERS.ranor;
    const base = {
        sender_company: ranor.company, sender_cnpj: ranor.cnpj, sender_address: ranor.address,
        dest_doc: g.cad?.cpf_cnpj || '',
        dest_addr1: g.cad?.endereco_linha1 || '',
        dest_addr2: g.cad?.endereco_linha2 || '',
        dest_phone: g.cad?.contato || '',
        total_vol: '', carrier: '', receiver: '', doc_type: ''
    };
    // Só os itens mantidos vão para o rascunho; os descartados ficam anotados para a próxima reimportação
    const dados = grupoEstoqueParaFormulario({ ...g, itens: itensMantidos(g), versao: versaoDoEnvio(g) }, base);
    dados.origem = {
        ...dados.origem, kit: kits.get(g.chave) || null, arquivo: nomeArquivo, importado_em: new Date().toISOString(),
        descartados: [...(descartes.get(g.chave) || [])]
    };

    const existente = existentes.rascunhos.get(g.chave)?.dados_completos;
    if (existente) {
        CAMPOS_MANUAIS.forEach(c => {
            if (String(existente[c] ?? '').trim()) dados[c] = existente[c];
        });
        if (existente.montar_kits !== undefined) dados.montar_kits = existente.montar_kits;
    }
    return dados;
}

window.criarRascunhosEstoque = async function () {
    const escolhidos = grupos.filter(g => marcados.has(g.chave) && g.status !== 'gerado' && itensMantidos(g).length);
    if (!escolhidos.length || itensNovos().length) return;

    const atualizacoes = escolhidos.filter(g => g.status !== 'novo').length;
    if (atualizacoes && !confirm(`${atualizacoes} rascunho(s) já existem e serão atualizados com os itens da planilha.\n\n` +
        'CPF/CNPJ, endereço, contato, volumes e transportadora já preenchidos são mantidos.')) return;

    const btn = $('estoque_criar');
    btn.disabled = true;
    btn.textContent = 'Criando...';
    const resultados = [];
    for (const g of escolhidos) {
        const draftId = existentes.rascunhos.get(g.chave)?.id || null;
        resultados.push(await salvarPendente(montarDados(g), draftId, true));
    }
    const criados = resultados.filter(Boolean).length;
    const falhas = resultados.length - criados;
    toast(`${criados} rascunho(s) criado(s)/atualizado(s) a partir da planilha de estoque.` + (falhas ? ` ${falhas} falharam.` : ''),
        falhas ? 'warning' : 'success', 6000);

    if (!falhas) {
        fecharImportarEstoque();
        grupos = [];
    } else {
        render();
    }
    aoConcluir?.();
};

async function receberArquivo(arquivo) {
    if (!arquivo) return;
    $('estoque_status').textContent = `Lendo ${arquivo.name}...`;
    try {
        const lido = await lerArquivoEstoque(arquivo);
        if (!lido) {
            toast(`Nenhuma aba de ${arquivo.name} tem o cabeçalho da planilha de estoque.`, 'error', 7000);
            return;
        }
        await receber(lido.grade, lido.bruta, arquivo.name + (lido.aba ? ` (aba ${lido.aba})` : ''));
    } catch (e) {
        alert('Não foi possível ler o arquivo: ' + e.message);
    } finally {
        $('estoque_status').textContent = '';
        $('estoque_arquivo').value = '';
    }
}

function ligarEventos() {
    const modal = $('modal-estoque');
    if (modal.dataset.ligado) return;
    modal.dataset.ligado = '1';

    $('estoque_colar').addEventListener('paste', e => {
        e.preventDefault();
        const texto = (e.clipboardData || window.clipboardData).getData('text');
        receber(parseTSV(texto), undefined, 'linhas coladas');
    });
    $('estoque_arquivo').addEventListener('change', e => receberArquivo(e.target.files[0]));

    const zona = $('estoque_entrada');
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('drag'); }));
    zona.addEventListener('drop', e => receberArquivo(e.dataTransfer.files[0]));
}

// --- API usada pelo app ---

// aoTerminar: chamado depois de criar os rascunhos (ex. recarregar o kanban)
export function abrirImportarEstoque(aoTerminar) {
    aoConcluir = aoTerminar;
    ligarEventos();
    mostrarEtapa();
    $('modal-estoque').style.display = 'flex';
}

export function fecharImportarEstoque() {
    $('modal-estoque').style.display = 'none';
}

export const importarEstoqueAberto = () => $('modal-estoque')?.style.display === 'flex';

window.trocarArquivoEstoque = function () {
    grupos = [];
    mostrarEtapa();
};
window.escolherArquivoEstoque = () => $('estoque_arquivo').click();
window.fecharImportarEstoque = fecharImportarEstoque;
