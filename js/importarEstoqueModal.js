// Modal "Importar planilha de estoque": lê o arquivo (ou linhas coladas), mostra a prévia dos envios,
// pede o de-para dos itens novos e cria um rascunho por envio (aparecem na coluna Rascunho do kanban).
import { $, escapeHtml, SENDERS } from './config.js';
import { parseTSV } from './importarPlanilha.js';
import { lerLinhasEstoque, agruparEnviosEstoque, grupoEstoqueParaFormulario, lerArquivoEstoque } from './importarEstoque.js';
import { garantirDePara, acharDePara, salvarDePara, sugerirPapel, normDesc, datalistItensHtml, selectPapelHtml } from './dePara.js';
import { carregarOrigensEstoque, salvarPendente } from './db.js';
import { toast } from './toast.js';

let registros = [];    // linhas lidas da planilha (reagrupadas quando um de-para muda)
let ignoradas = [];
let grupos = [];
let nomeArquivo = '';
let semCabecalho = false; // linhas coladas sem cabeçalho: colunas na ordem padrão da planilha
let existentes = { rascunhos: new Map(), historico: new Set() }; // chave do envio -> rascunho / já gerado
let marcados = new Set();
let aoConcluir = null;

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
    if (r.dados_completos?.historico_id) return 'gerado';
    return r.dados_completos?.origem?.versao === g.versao ? 'igual' : 'atualizar';
}

const ROTULO_STATUS = {
    novo: ['Novo', 'novo'],
    atualizar: ['Atualizar rascunho', 'atualizar'],
    igual: ['Já importado, sem mudanças', 'igual'],
    gerado: ['Já gerado (no histórico)', 'gerado']
};

function reagrupar() {
    grupos = agruparEnviosEstoque(registros, resolverItem).map(g => ({ ...g, ...acharCadastro(g.destinatario), status: null }));
    grupos.forEach(g => { g.status = statusDoGrupo(g); });
    marcados = new Set(grupos.filter(g => g.status === 'novo' || g.status === 'atualizar').map(g => g.chave));
}

// Itens sem de-para em qualquer envio (um por código, ou por descrição quando não há código)
function itensNovos() {
    const mapa = new Map();
    grupos.forEach(g => g.novos.forEach(n => {
        const k = n.cod || normDesc(n.descEstoque);
        if (!mapa.has(k)) mapa.set(k, n);
    }));
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

    existentes = {
        rascunhos: new Map((origens?.rascunhos || []).map(r => [r.dados_completos?.origem?.chave, r])),
        historico: new Set((origens?.historico || []).map(h => h.origem?.chave))
    };
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

function resumoItens(itens) {
    return itens.map(it => `${it.qty}× ${it.desc}${it.imeis.length ? ` (${it.imeis.length} IMEI${it.imeis.length > 1 ? 's' : ''})` : ''}`
        + (it.imeis.some(i => i.chip) ? ' + chip' : '')).join(', ');
}

function render() {
    const novos = itensNovos();
    const qtdMarcados = grupos.filter(g => marcados.has(g.chave)).length;
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
                    <input type="text" class="novo-nome" list="estoque_itens_catalogo" value="${escapeHtml(n.descEstoque.toUpperCase())}">
                    ${selectPapelHtml(n.papelSugerido, 'class="novo-papel"')}
                </div>`).join('')}
            <div class="estoque-novos-acoes">
                <button class="btn-sm" onclick="salvarNovosEstoque(this)">Salvar de-para e atualizar prévia</button>
            </div>
        </div>` : '';

    const enviosHtml = grupos.map((g, i) => {
        const [rotulo, classe] = ROTULO_STATUS[g.status];
        const ref = g.ticket ? `Ticket ${g.ticket}` : g.os ? `OS ${g.os}` : 'Sem referência';
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
                    <div class="imp-itens">${escapeHtml(resumoItens(g.itens))}</div>
                    ${g.kitsPossiveis ? `<div class="estoque-aviso kit">🔧 ${g.rastreadores} rastreador(es) e ${g.teclados} teclado(s): podem formar até ${g.kitsPossiveis} kit(s) na planilha de envio</div>` : ''}
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
    const dados = grupoEstoqueParaFormulario(g, base);
    dados.origem = { ...dados.origem, arquivo: nomeArquivo, importado_em: new Date().toISOString() };

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
    const escolhidos = grupos.filter(g => marcados.has(g.chave) && g.status !== 'gerado');
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
