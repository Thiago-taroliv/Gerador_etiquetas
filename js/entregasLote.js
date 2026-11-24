// Marcar entregas em lote. Duas abas:
//  - Em trânsito: os despachados; marcar a caixa e informar a data da entrega (a do rastreio) move para "Entregue".
//  - Confirmar datas: entregues com data de despacho ou entrega não confirmada; confere as duas e confirma.
// As datas salvas aqui ficam confirmadas (contam nos prazos do painel), como no modal de entrega de um pedido só.
// Abre pelo botão da coluna "Despachado" do kanban e pelas pendências do Painel.
import { escapeHtml } from './config.js';
import { carregarEmTransito, carregarEntreguesNaoConfirmados, moverFase, atualizarDespacho } from './db.js';
import { abrirModal, abrirVisualizacaoEnvio } from './envioView.js';
import { sitesRastreio, siteRastreio, urlRastreio, salvarConfiguracao } from './configuracoes.js';
import { hojeInput, paraInput, deInput, problemaData, dataBR } from './datas.js';
import { confirmar } from './dialogo.js';
import { toast } from './toast.js';

const DIA = 864e5;
const ANTIGO = 7; // dias em trânsito para o filtro "só os antigos"
const SEM_ENVIO = ['retirada', 'instalacao'];

let modal = null;
let aba = 'transito';            // 'transito' | 'confirmar'
let linhas = { transito: null, confirmar: null }; // [{ reg, marcado, entrega, despacho }] (null = não carregado)
let semColunas = false;          // sql/datas_retornos.sql não rodado (aba confirmar indisponível)
let filtro = { busca: '', transp: '', antigos: false };
let salvando = false;
let aoSalvar = null;

const dias = iso => iso ? Math.floor((Date.now() - new Date(iso)) / DIA) : null;
const entregaGravada = r => r.entregue_em || r.fase_em;

// opcoes: { aba: 'transito' | 'confirmar', antigos: true (só há 7+ dias), aoSalvar() }
export async function abrirEntregasLote(opcoes = {}) {
    aba = opcoes.aba || 'transito';
    filtro = { busca: '', transp: '', antigos: !!opcoes.antigos };
    linhas = { transito: null, confirmar: null };
    aoSalvar = opcoes.aoSalvar || null;
    modal?.fechar();
    modal = abrirModal('<div class="lote-corpo"><div class="empty-state">Carregando...</div></div>', 'visao-card lote-card');
    ligarEventos();
    await carregarAba();
}

async function carregarAba() {
    if (linhas[aba]) { render(); return; }
    render();
    if (aba === 'transito') {
        const lista = await carregarEmTransito();
        linhas.transito = lista ? lista.filter(r => !SEM_ENVIO.includes(r.entrega)).map(reg => ({ reg, marcado: false, entrega: '' })) : [];
        if (!lista) toast('Erro ao carregar os pedidos em trânsito.', 'error');
    } else {
        const r = await carregarEntreguesNaoConfirmados();
        semColunas = !!r?.semColunas;
        linhas.confirmar = (r?.pedidos || []).filter(p => !SEM_ENVIO.includes(p.entrega))
            .map(reg => ({ reg, marcado: false, despacho: paraInput(reg.despachado_em), entrega: paraInput(entregaGravada(reg)) }));
        if (!r) toast('Erro ao carregar os entregues.', 'error');
    }
    render();
}

// --- Filtros ---
function visiveis() {
    const termo = filtro.busca.trim().toLowerCase();
    return (linhas[aba] || []).filter(l => {
        const r = l.reg;
        if (filtro.transp && (r.transportadora || '').trim() !== filtro.transp) return false;
        if (aba === 'transito' && filtro.antigos && (dias(r.despachado_em) ?? 0) < ANTIGO) return false;
        return !termo || [r.destinatario, r.unidade, r.referencia, r.rastreio].join(' ').toLowerCase().includes(termo);
    });
}

// Problema da linha marcada, ou null
function problema(l) {
    if (!l.marcado) return null;
    if (aba === 'confirmar') {
        const p = problemaData(l.despacho, { rotulo: 'A data do despacho' });
        if (p) return p;
    }
    const minimo = aba === 'confirmar' ? l.despacho : paraInput(l.reg.despachado_em);
    return problemaData(l.entrega, { rotulo: 'A data da entrega', minimo, rotuloMinimo: `do despacho (${dataBR(minimo)})` });
}

// --- Render ---
function celulaRastreio(r) {
    if (!r.rastreio) return `${escapeHtml(r.transportadora) || '—'}<div class="painel-lista-sub">sem rastreio</div>`;
    const site = siteRastreio(r.transportadora);
    return `${escapeHtml(r.transportadora) || '—'}
        <div class="lote-rastreio">
            <span class="mono">${escapeHtml(r.rastreio)}</span>
            <button type="button" class="lote-mini" data-copiar="${escapeHtml(r.rastreio)}" title="Copiar o código">⧉</button>
            ${site
                ? `<button type="button" class="lote-mini" data-abrir-site="${escapeHtml(r.id)}" title="Abre o site da ${escapeHtml(site.nome)}${site.url.includes('{codigo}') ? '' : ' e copia o código para colar'}">Rastrear ↗</button>`
                : `<button type="button" class="lote-mini fraco" data-novo-site="${escapeHtml(r.transportadora || '')}" title="Cadastrar o site desta transportadora">+ site</button>`}
        </div>`;
}

function linhaHtml(l) {
    const r = l.reg;
    const d = dias(r.despachado_em);
    const erro = problema(l);
    const dataInput = (campo, valor, max) => `<input type="date" data-campo="${campo}" value="${valor}" max="${max}" ${l.marcado ? '' : 'disabled'}>`;
    return `<tr data-id="${escapeHtml(r.id)}" class="${l.marcado ? 'marcado' : ''}${erro ? ' com-erro' : ''}">
        <td class="lote-check"><input type="checkbox" data-marcar ${l.marcado ? 'checked' : ''} aria-label="Selecionar"></td>
        <td><a href="#" data-ver="${escapeHtml(r.id)}"><strong>${escapeHtml(r.destinatario || 'Sem destinatário')}</strong></a>
            <div class="painel-lista-sub">${escapeHtml([r.referencia, r.unidade !== r.destinatario ? r.unidade : ''].filter(Boolean).join(' · '))}</div></td>
        <td>${celulaRastreio(r)}</td>
        ${aba === 'transito'
            ? `<td class="col-date">${dataBR(r.despachado_em) || '—'}${d != null ? `<div class="painel-lista-sub ${d >= ANTIGO ? 'texto-alerta' : ''}">há ${d} dia${d === 1 ? '' : 's'}</div>` : ''}</td>
               <td>${dataInput('entrega', l.entrega, hojeInput())}</td>`
            : `<td>${dataInput('despacho', l.despacho, hojeInput())}${r.despacho_confirmado ? '<div class="painel-lista-sub">já confirmada</div>' : ''}</td>
               <td>${dataInput('entrega', l.entrega, hojeInput())}${r.entrega_confirmada ? '<div class="painel-lista-sub">já confirmada</div>' : ''}</td>`}
        <td class="lote-erro">${erro ? escapeHtml(erro) : ''}</td>
    </tr>`;
}

function render() {
    if (!modal) return;
    const carregadas = linhas[aba];
    const lista = carregadas ? visiveis() : [];
    const transportadoras = [...new Set((carregadas || []).map(l => (l.reg.transportadora || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const todasMarcadas = lista.length && lista.every(l => l.marcado);
    const nTransito = linhas.transito?.length;
    const nConfirmar = linhas.confirmar?.length;

    let corpo;
    if (!carregadas) corpo = '<div class="empty-state">Carregando...</div>';
    else if (aba === 'confirmar' && semColunas) corpo = '<div class="painel-alerta">⚠ Rode o <code>sql/datas_retornos.sql</code> no SQL Editor do Supabase para confirmar datas.</div>';
    else if (!lista.length) corpo = `<div class="empty-state">${carregadas.length ? 'Nenhum pedido com estes filtros.' : aba === 'transito' ? 'Nenhum pedido em trânsito. ✓' : 'Todas as entregas têm as datas confirmadas. ✓'}</div>`;
    else corpo = `<div class="table-wrap lote-tabela-wrap"><table class="data-table lote-tabela"><thead><tr>
            <th class="lote-check"><input type="checkbox" data-marcar-todos ${todasMarcadas ? 'checked' : ''} title="Marcar / desmarcar todos os da lista"></th>
            <th>Destinatário</th><th>Transportadora / rastreio</th>
            ${aba === 'transito' ? '<th>Despachado</th><th>Entregue em</th>' : '<th>Despacho</th><th>Entrega</th>'}
            <th></th>
        </tr></thead><tbody>${lista.map(linhaHtml).join('')}</tbody></table></div>`;

    modal.card.innerHTML = `
        <div class="modal-header">
            <div><strong>Marcar entregas</strong>
                <div class="small" style="margin-top:2px;">${aba === 'transito'
                    ? 'Confira no rastreio o dia em que cada pedido chegou, marque e informe a data. Eles vão para "Entregue" com a data confirmada.'
                    : 'Entregues com data só estimada (o momento em que o card foi movido). Confira o despacho e a entrega e confirme: passam a contar nos prazos do painel.'}</div></div>
            <button class="modal-close" data-fechar title="Fechar (Esc)">&times;</button>
        </div>
        <div class="lote-abas" role="tablist">
            <button type="button" class="painel-visao${aba === 'transito' ? ' ativo' : ''}" data-aba="transito">Em trânsito${nTransito != null ? ` (${nTransito})` : ''}</button>
            <button type="button" class="painel-visao${aba === 'confirmar' ? ' ativo' : ''}" data-aba="confirmar">Confirmar datas de entregues${nConfirmar != null ? ` (${nConfirmar})` : ''}</button>
        </div>
        <div class="painel-filtros lote-filtros">
            <input type="text" class="lote-busca" placeholder="Buscar destinatário, OS, rastreio..." value="${escapeHtml(filtro.busca)}" data-filtro="busca">
            <select class="kanban-filtro" data-filtro="transp">
                <option value="">Todas as transportadoras</option>
                ${transportadoras.map(t => `<option value="${escapeHtml(t)}"${t === filtro.transp ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
            ${aba === 'transito' ? `<label class="painel-check"><input type="checkbox" data-filtro="antigos" ${filtro.antigos ? 'checked' : ''}> Só há ${ANTIGO}+ dias</label>` : ''}
            <span class="lote-data-todos">
                ${aba === 'transito' ? 'Entregue em' : 'Entrega'} para os marcados:
                <input type="date" data-data-todos max="${hojeInput()}" value="${hojeInput()}">
                <button type="button" class="btn-sm btn-neutral" data-aplicar>Aplicar</button>
            </span>
        </div>
        <div class="lote-corpo">${corpo}</div>
        ${sitesHtml()}
        <div class="modal-actions">${rodapeHtml()}</div>`;
}

function rodapeHtml() {
    const marcadas = (linhas[aba] || []).filter(l => l.marcado);
    const erros = marcadas.filter(problema).length;
    const n = marcadas.length;
    const texto = aba === 'transito' ? `Marcar ${n || ''} como entregue${n === 1 ? '' : 's'}` : `Confirmar ${n || ''} pedido${n === 1 ? '' : 's'}`;
    return `<span class="small lote-resumo">${n} selecionado(s)${erros ? ` · <span class="texto-alerta">${erros} com data para corrigir</span>` : ''}</span>
        <span style="flex:1"></span>
        <button class="btn-neutral" data-fechar>Fechar</button>
        <button data-salvar ${!n || erros || salvando ? 'disabled' : ''}>${salvando ? 'Salvando...' : texto}</button>`;
}

// Data digitada numa linha: atualiza só a linha e o rodapé (redesenhar tudo tiraria o foco do campo)
function atualizarLinha(l, tr) {
    const erro = problema(l);
    tr.classList.toggle('com-erro', !!erro);
    tr.querySelector('.lote-erro').textContent = erro || '';
    modal.card.querySelector('.modal-actions').innerHTML = rodapeHtml();
}

// Sites de rastreio: lista e cadastro rápido (o mesmo de Cadastros > Configurações)
let sitesAberto = false;
let novoSite = { nome: '', url: '' };
function sitesHtml() {
    const sites = sitesRastreio();
    return `<details class="lote-sites"${sitesAberto ? ' open' : ''} data-sites>
        <summary>Sites de rastreio (${sites.length})</summary>
        <div class="small">O botão "Rastrear" abre o site da transportadora do pedido. Se a URL tiver <code>{codigo}</code>, ele é trocado pelo código; senão, o código é copiado para você colar. Também dá para editar em Cadastros &gt; Configurações.</div>
        ${sites.map((s, i) => `<div class="lote-site"><b>${escapeHtml(s.nome)}</b> <span class="mono">${escapeHtml(s.url)}</span>
            <button type="button" class="lote-mini fraco" data-remover-site="${i}" title="Remover">✕</button></div>`).join('')}
        <div class="cfg-linha lote-site-novo">
            <input type="text" placeholder="Transportadora (ex: Braspress)" value="${escapeHtml(novoSite.nome)}" data-site="nome">
            <input type="text" placeholder="https://... (pode usar {codigo})" value="${escapeHtml(novoSite.url)}" data-site="url">
            <button type="button" class="btn-sm" data-adicionar-site>+ Adicionar</button>
        </div>
    </details>`;
}

async function gravarSites(lista, mensagem) {
    if (!(await salvarConfiguracao('rastreio_links', lista))) {
        toast('Não foi possível salvar. Confira se o sql/configuracoes.sql foi rodado.', 'error');
        return false;
    }
    toast(mensagem);
    return true;
}

// --- Eventos (delegados no card; o HTML é redesenhado) ---
function acharLinha(el) {
    const id = el.closest('tr[data-id]')?.dataset.id;
    return (linhas[aba] || []).find(l => String(l.reg.id) === id);
}

function ligarEventos() {
    const card = modal.card;
    card.addEventListener('click', async e => {
        const alvo = e.target;
        const abaBtn = alvo.closest('[data-aba]');
        if (abaBtn && abaBtn.dataset.aba !== aba) { aba = abaBtn.dataset.aba; filtro.transp = ''; await carregarAba(); return; }
        const ver = alvo.closest('[data-ver]');
        if (ver) { e.preventDefault(); abrirVisualizacaoEnvio(ver.dataset.ver); return; }
        const copiar = alvo.closest('[data-copiar]');
        if (copiar) { await copiarTexto(copiar.dataset.copiar); toast('Código copiado.'); return; }
        const abrirSite = alvo.closest('[data-abrir-site]');
        if (abrirSite) {
            const r = acharLinha(abrirSite)?.reg;
            const site = r && siteRastreio(r.transportadora);
            if (!site) return;
            if (!site.url.includes('{codigo}')) { await copiarTexto(r.rastreio); toast('Código copiado: cole no site.'); }
            window.open(urlRastreio(site, r.rastreio), '_blank', 'noopener');
            return;
        }
        const novo = alvo.closest('[data-novo-site]');
        if (novo) { sitesAberto = true; novoSite = { nome: novo.dataset.novoSite, url: '' }; render(); modal.card.querySelector('[data-site="url"]')?.focus(); return; }
        if (alvo.closest('[data-adicionar-site]')) {
            const nome = novoSite.nome.trim(), url = novoSite.url.trim();
            if (!nome || !/^https?:\/\//i.test(url)) { toast('Informe o nome e uma URL começando com http:// ou https://', 'warning'); return; }
            if (await gravarSites([...sitesRastreio(), { nome, url }], `Site da ${nome} adicionado.`)) { novoSite = { nome: '', url: '' }; render(); }
            return;
        }
        const remover = alvo.closest('[data-remover-site]');
        if (remover) {
            const lista = sitesRastreio();
            const s = lista[Number(remover.dataset.removerSite)];
            if (!s || !(await confirmar({ titulo: `Remover o site da ${s.nome}?`, mensagem: s.url, tipo: 'aviso', sim: 'Remover', nao: 'Manter' }))) return;
            if (await gravarSites(lista.filter(x => x !== s), 'Site removido.')) render();
            return;
        }
        if (alvo.closest('[data-aplicar]')) {
            const valor = card.querySelector('[data-data-todos]')?.value;
            const marcadas = (linhas[aba] || []).filter(l => l.marcado);
            if (!marcadas.length) { toast('Marque os pedidos primeiro.', 'warning'); return; }
            marcadas.forEach(l => { l.entrega = valor; });
            render();
            return;
        }
        if (alvo.closest('[data-salvar]')) salvar();
    });

    card.addEventListener('change', e => {
        const alvo = e.target;
        if (alvo.matches('[data-marcar-todos]')) {
            visiveis().forEach(l => marcar(l, alvo.checked));
            render();
        } else if (alvo.matches('[data-marcar]')) {
            const l = acharLinha(alvo);
            if (l) { marcar(l, alvo.checked); render(); }
        } else if (alvo.matches('[data-campo]')) {
            const l = acharLinha(alvo);
            if (l) { l[alvo.dataset.campo] = alvo.value; atualizarLinha(l, alvo.closest('tr')); }
        } else if (alvo.matches('[data-filtro="transp"]')) { filtro.transp = alvo.value; render(); }
        else if (alvo.matches('[data-filtro="antigos"]')) { filtro.antigos = alvo.checked; render(); }
    });

    card.addEventListener('input', e => {
        const alvo = e.target;
        if (alvo.matches('[data-filtro="busca"]')) {
            filtro.busca = alvo.value;
            const pos = alvo.selectionStart;
            render();
            const novo = modal.card.querySelector('[data-filtro="busca"]');
            novo?.focus();
            novo?.setSelectionRange(pos, pos);
        } else if (alvo.matches('[data-site]')) novoSite[alvo.dataset.site] = alvo.value;
    });

    card.addEventListener('toggle', e => { if (e.target.matches?.('[data-sites]')) sitesAberto = e.target.open; }, true);
}

// Marcar em trânsito preenche a entrega com hoje (a pessoa troca pelo dia do rastreio)
function marcar(l, sim) {
    l.marcado = sim;
    if (sim && aba === 'transito' && !l.entrega) l.entrega = hojeInput();
}

async function copiarTexto(texto) {
    try { await navigator.clipboard.writeText(texto || ''); } catch { /* sem permissão: segue sem copiar */ }
}

// --- Salvar: um pedido por vez (poucos por lote); os que falham continuam marcados na lista ---
async function salvar() {
    const marcadas = (linhas[aba] || []).filter(l => l.marcado);
    if (!marcadas.length || marcadas.some(problema) || salvando) return;
    salvando = true;
    render();
    let ok = 0;
    const falhas = [];
    // Mantém a hora gravada quando o dia não mudou
    const quando = (iso, input) => iso && paraInput(iso) === input ? iso : deInput(input);
    for (const l of marcadas) {
        const r = l.reg;
        let certo;
        if (aba === 'transito') {
            const entrega = deInput(l.entrega);
            certo = await moverFase(r.id, 'entregue', { fase_em: entrega, entregue_em: entrega, entrega_confirmada: true });
        } else {
            const despacho = quando(r.despachado_em, l.despacho);
            const entrega = quando(entregaGravada(r), l.entrega);
            certo = await atualizarDespacho(r.id, {
                despachado_em: despacho, despacho_confirmado: true,
                entregue_em: entrega, entrega_confirmada: true, fase_em: entrega,
                fases_em: { ...(r.fases_em || {}), despachado: despacho, entregue: entrega }
            });
        }
        if (certo) ok++; else falhas.push(l);
    }
    salvando = false;
    const feitos = new Set(marcadas.filter(l => !falhas.includes(l)));
    linhas[aba] = linhas[aba].filter(l => !feitos.has(l));
    // Mudou o que aparece na outra aba
    if (aba === 'transito') linhas.confirmar = null;
    render();
    if (ok) toast(aba === 'transito' ? `${ok} pedido(s) marcado(s) como entregue(s).` : `Datas de ${ok} pedido(s) confirmadas.`);
    if (falhas.length) toast(`${falhas.length} pedido(s) não foram salvos. Verifique a conexão e tente de novo.`, 'error', 6000);
    if (ok) aoSalvar?.();
}

window.abrirEntregasLote = abrirEntregasLote;
