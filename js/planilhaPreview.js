// Modal de preview/edição das linhas da planilha antes de copiar para o Excel.
// Tabela editável com as cores dos grupos da planilha (Dados / Configuração / Envio).
import { $, escapeHtml } from './config.js';
import { COLUNAS, GRUPOS, TIPOS, COL, copiarLinhasPlanilha } from './planilha.js';
import { toast } from './toast.js';

// Largura de cada coluna (px), na ordem de COLUNAS
const LARGURAS = [70, 90, 190, 64, 150, 100, 120, 150, 100, 180, 70, 80, 70, 70, 76, 80, 160, 200, 240, 90, 150, 130, 50, 150, 96];

let linhas = [];      // estado atual (editado)
let original = [];    // como foi gerado, para "Restaurar"
let editado = false;
const ocultos = new Set();

const clonar = arr => arr.map(l => [...l]);
const grupoDa = c => GRUPOS.find(g => c >= g.de && c <= g.ate).id;

// --- Validação: IMEI com 15 dígitos, ICCID com 19-20 dígitos, IMEIs repetidos ---
function problemas() {
    const erros = new Map(); // "r,c" -> mensagem
    const vistos = { [COL.IMEI_EQUIP]: new Map(), [COL.IMEI_TECLADO]: new Map() };

    linhas.forEach((l, r) => {
        const imei = l[COL.IMEI_EQUIP].trim();
        if (imei && !/^\d{15}$/.test(imei)) erros.set(`${r},${COL.IMEI_EQUIP}`, 'IMEI deve ter 15 dígitos');
        const iccid = l[COL.ICCID].trim();
        if (iccid && !/^\d{19,20}F?$/i.test(iccid)) erros.set(`${r},${COL.ICCID}`, 'ICCID deve ter 19 ou 20 dígitos');

        [COL.IMEI_EQUIP, COL.IMEI_TECLADO].forEach(c => {
            const v = l[c].trim();
            if (!v) return;
            if (vistos[c].has(v)) {
                erros.set(`${r},${c}`, 'Repetido em outra linha');
                erros.set(`${vistos[c].get(v)},${c}`, 'Repetido em outra linha');
            } else vistos[c].set(v, r);
        });
    });
    return erros;
}

function atualizarResumo() {
    const erros = problemas();
    // marca/desmarca as células com problema sem redesenhar a tabela (mantém o foco)
    document.querySelectorAll('#planilha_tabela td[data-c]').forEach(td => {
        const msg = erros.get(`${td.dataset.r},${td.dataset.c}`);
        td.classList.toggle('cell-erro', !!msg);
        td.title = msg || '';
    });
    const comImei = linhas.filter(l => l[COL.IMEI_EQUIP].trim() || l[COL.IMEI_TECLADO].trim()).length;
    const celulasErro = new Set([...erros.keys()]).size;
    $('planilha_resumo').innerHTML =
        `${linhas.length} linha(s) &middot; ${comImei} com IMEI` +
        (celulasErro ? ` &middot; <span style="color:#b26a00;font-weight:700;">${celulasErro} célula(s) para conferir</span>` : '') +
        (editado ? ' &middot; <em>editado</em>' : '');
}

function render() {
    const tabela = $('planilha_tabela');
    const cls = c => `g-${grupoDa(c)}`;

    let html = '<colgroup><col style="width:64px">' +
        LARGURAS.map((w, c) => `<col class="${cls(c)}" style="width:${w}px">`).join('') + '</colgroup>';

    // Cabeçalho: grupos + nomes das colunas (com botão de repetir o valor da 1ª linha)
    html += '<thead><tr class="grupos"><th class="col-acoes"></th>' +
        GRUPOS.map(g => `<th class="g-${g.id}" colspan="${g.ate - g.de + 1}">${g.nome}</th>`).join('') + '</tr><tr class="nomes"><th class="col-acoes">#</th>' +
        COLUNAS.map((nome, c) => `<th class="${cls(c)}">
            <div class="th-inner"><span>${escapeHtml(nome)}</span>
            <button type="button" class="th-fill" data-fill="${c}" title="Repetir o valor da 1ª linha em todas">⇣</button></div>
        </th>`).join('') + '</tr></thead><tbody>';

    linhas.forEach((l, r) => {
        html += `<tr><td class="col-acoes">
            <span class="num">${r + 1}</span>
            <button type="button" class="row-btn" data-dup="${r}" title="Duplicar linha">⧉</button>
            <button type="button" class="row-btn del" data-del="${r}" title="Remover linha">✕</button>
        </td>` +
            l.map((v, c) => `<td class="${cls(c)}" data-r="${r}" data-c="${c}"><input type="text" value="${escapeHtml(v)}"
                ${c === 3 ? 'list="planilha_tipos"' : ''} data-r="${r}" data-c="${c}" spellcheck="false"></td>`).join('') +
            '</tr>';
    });
    html += '</tbody>';
    tabela.innerHTML = html;
    tabela.className = 'planilha-table ' + [...ocultos].map(g => 'hide-' + g).join(' ');
    atualizarResumo();
}

function focar(r, c) {
    const el = document.querySelector(`#planilha_tabela input[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); el.select(); }
}

// --- Eventos da tabela (delegados) ---
function ligarEventos() {
    const tabela = $('planilha_tabela');
    if (tabela.dataset.ligado) return;
    tabela.dataset.ligado = '1';

    tabela.addEventListener('input', e => {
        const { r, c } = e.target.dataset;
        if (r === undefined) return;
        linhas[r][c] = e.target.value;
        editado = true;
        atualizarResumo();
    });

    // Enter/↓ desce, ↑ sobe na mesma coluna (Tab continua indo para a direita)
    tabela.addEventListener('keydown', e => {
        const { r, c } = e.target.dataset;
        if (r === undefined) return;
        const ri = Number(r);
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focar(ri + 1, c); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focar(ri - 1, c); }
    });

    // Colar uma lista (vários valores) preenche para baixo; com TAB, também para a direita
    tabela.addEventListener('paste', e => {
        const { r, c } = e.target.dataset;
        if (r === undefined) return;
        const texto = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\n\t]/.test(texto.replace(/\r?\n$/, ''))) return; // valor simples: colagem normal
        e.preventDefault();

        const grade = texto.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
        const r0 = Number(r), c0 = Number(c);
        let novas = 0;
        grade.forEach((vals, i) => {
            const ri = r0 + i;
            if (ri >= linhas.length) { linhas.push([...linhas[linhas.length - 1]]); novas++; } // cópia da última
            vals.forEach((v, j) => { if (c0 + j < COLUNAS.length) linhas[ri][c0 + j] = v.trim(); });
        });
        editado = true;
        render();
        focar(r0, c0);
        toast(`${grade.length} linha(s) preenchida(s)${novas ? `, ${novas} nova(s) criada(s)` : ''}.`);
    });

    tabela.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.fill !== undefined) {
            const c = Number(btn.dataset.fill);
            const valor = linhas[0]?.[c] ?? '';
            if (!valor) { toast('Preencha a 1ª linha dessa coluna primeiro.', 'warning'); focar(0, c); return; }
            linhas.forEach(l => { l[c] = valor; });
            editado = true;
            render();
            toast(`"${valor}" aplicado em ${linhas.length} linha(s).`);
        } else if (btn.dataset.dup !== undefined) {
            const r = Number(btn.dataset.dup);
            linhas.splice(r + 1, 0, [...linhas[r]]);
            editado = true;
            render();
            focar(r + 1, 4);
        } else if (btn.dataset.del !== undefined) {
            if (linhas.length === 1) { toast('Precisa ter pelo menos uma linha.', 'warning'); return; }
            linhas.splice(Number(btn.dataset.del), 1);
            editado = true;
            render();
        }
    });
}

// --- API usada pelo app ---

export function abrirPreviewPlanilha(novasLinhas, titulo = '') {
    linhas = clonar(novasLinhas);
    original = clonar(novasLinhas);
    editado = false;
    $('planilha_titulo').textContent = titulo || 'Linhas para a planilha';
    $('planilha_tipos').innerHTML = TIPOS.map(t => `<option value="${t}">`).join('');
    ligarEventos();
    render();
    $('modal-planilha').style.display = 'flex';
}

export function fecharPreviewPlanilha(forcar = false) {
    if (!forcar && editado && !confirm('Descartar as alterações feitas nas linhas?')) return;
    $('modal-planilha').style.display = 'none';
}

export function alternarGrupoPlanilha(grupo, visivel) {
    if (visivel) ocultos.delete(grupo); else ocultos.add(grupo);
    $('planilha_tabela').className = 'planilha-table ' + [...ocultos].map(g => 'hide-' + g).join(' ');
}

export function adicionarLinhaPlanilha() {
    // Nova linha herda Dados e Envio da última (o mais comum é repetir) e vem com Configuração vazia
    const base = linhas.length ? [...linhas[linhas.length - 1]] : new Array(COLUNAS.length).fill('');
    for (let c = 4; c <= 16; c++) base[c] = '';
    linhas.push(base);
    editado = true;
    render();
    focar(linhas.length - 1, 4);
}

export function restaurarPlanilha() {
    if (editado && !confirm('Voltar para as linhas como foram geradas? As edições serão perdidas.')) return;
    linhas = clonar(original);
    editado = false;
    render();
}

export async function confirmarCopiaPlanilha() {
    const erros = problemas();
    if (erros.size && !confirm(`Há ${erros.size} célula(s) marcada(s) para conferir (IMEI/ICCID fora do padrão ou repetido).\n\nCopiar mesmo assim?`)) return;
    try {
        await copiarLinhasPlanilha(linhas);
    } catch (e) {
        alert('Não foi possível copiar: ' + e.message);
        return;
    }
    fecharPreviewPlanilha(true);
    toast(`${linhas.length} linha(s) copiada(s). Na planilha, clique na coluna OS/Ticket da 1ª linha vazia e cole (Ctrl+V).`, 'success', 7000);
}

export function previewPlanilhaAberto() {
    return $('modal-planilha')?.style.display === 'flex';
}
