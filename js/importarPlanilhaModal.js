// Modal "Importar da Planilha": recebe linhas coladas do Excel ou um arquivo,
// lista os envios encontrados e preenche o formulário com o escolhido.
import { $, escapeHtml } from './config.js';
import { parseTSV, lerLinhas, agruparEnvios, resumoItens, lerArquivo } from './importarPlanilha.js';
import { toast } from './toast.js';

const CHAVE_STORAGE = 'gx_planilha_importada_v1';
const MAX_LISTA = 150;

let grupos = [];
let quando = null;
let aoUsar = null;   // callback do app: recebe o grupo escolhido

// --- Base guardada no navegador (sobrevive a recarregar a página) ---
function salvarBase(registros) {
    try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify({ quando: Date.now(), registros })); }
    catch (e) { toast('A base é grande demais para ficar guardada; ela vale só até fechar a página.', 'warning', 6000); }
}
function carregarBase() {
    try {
        const salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || 'null');
        if (salvo?.registros?.length) return salvo;
    } catch (e) { /* storage indisponível */ }
    return null;
}

function aplicarRegistros(registros, origem) {
    if (!registros.length) {
        toast('Nenhuma linha de envio encontrada. Copie as linhas da planilha (pode incluir o cabeçalho).', 'warning', 6000);
        return;
    }
    grupos = agruparEnvios(registros);
    quando = Date.now();
    salvarBase(registros);
    $('importar_busca').value = '';
    mostrarEtapa();
    toast(`${registros.length} linha(s) lidas ${origem}: ${grupos.length} envio(s) encontrado(s).`);
}

function mostrarEtapa() {
    const temDados = grupos.length > 0;
    $('importar_vazio').style.display = temDados ? 'none' : 'flex';
    $('importar_dados').style.display = temDados ? 'flex' : 'none';
    if (temDados) {
        renderLista();
        setTimeout(() => $('importar_busca').focus(), 50);
    } else {
        $('importar_info').textContent = '';
        setTimeout(() => $('importar_colar').focus(), 50);
    }
}

function renderLista() {
    const termo = ($('importar_busca').value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const filtrados = termo ? grupos.filter(g => g.busca.includes(termo)) : grupos;
    const totalLinhas = grupos.reduce((s, g) => s + g.linhas.length, 0);
    const data = quando ? new Date(quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';

    $('importar_info').innerHTML = `${grupos.length} envio(s) &middot; ${totalLinhas} linha(s) &middot; base carregada em ${data}` +
        (termo ? ` &middot; <b>${filtrados.length}</b> no filtro` : '');

    if (!filtrados.length) {
        $('importar_lista').innerHTML = '<div class="empty-state">Nenhum envio corresponde ao filtro.</div>';
        return;
    }
    $('importar_lista').innerHTML = filtrados.slice(0, MAX_LISTA).map(g => {
        const i = grupos.indexOf(g);
        const meta = [g.cliente, g.unidades.join(' + '), [g.cidade, g.uf].filter(Boolean).join('/'), g.tipo].filter(Boolean);
        return `<div class="imp-item">
            <div class="imp-main">
                <div class="imp-titulo">
                    ${g.os ? `<span class="imp-os">OS/Ticket ${escapeHtml(g.os)}</span>` : ''}
                    <span>${escapeHtml(g.destinatario || 'Sem destinatário')}</span>
                    ${g.dataEnvio ? `<span class="imp-data">${escapeHtml(g.dataEnvio)}</span>` : ''}
                </div>
                <div class="imp-meta">${meta.map(escapeHtml).join(' &middot; ')}</div>
                <div class="imp-itens">${escapeHtml(resumoItens(g.itens))}</div>
            </div>
            <button type="button" class="btn-sm" onclick="usarEnvioImportado(${i})">Preencher formulário</button>
        </div>`;
    }).join('') + (filtrados.length > MAX_LISTA
        ? `<div class="empty-state" style="padding:12px;">Mostrando ${MAX_LISTA} de ${filtrados.length}. Use o filtro para achar o envio.</div>` : '');
}

async function receberArquivo(arquivo) {
    if (!arquivo) return;
    $('importar_status').textContent = `Lendo ${arquivo.name}...`;
    try {
        const grade = await lerArquivo(arquivo);
        aplicarRegistros(lerLinhas(grade), `de ${arquivo.name}`);
    } catch (e) {
        alert('Não foi possível ler o arquivo: ' + e.message);
    } finally {
        $('importar_status').textContent = '';
        $('importar_arquivo').value = '';
    }
}

function ligarEventos() {
    const modal = $('modal-importar');
    if (modal.dataset.ligado) return;
    modal.dataset.ligado = '1';

    // Colar (Ctrl+V) na área de colagem
    $('importar_colar').addEventListener('paste', e => {
        e.preventDefault();
        const texto = (e.clipboardData || window.clipboardData).getData('text');
        aplicarRegistros(lerLinhas(parseTSV(texto)), 'da área de transferência');
    });
    $('importar_arquivo').addEventListener('change', e => receberArquivo(e.target.files[0]));
    $('importar_busca').addEventListener('input', renderLista);

    // Arrastar e soltar arquivo na área
    const zona = $('importar_vazio');
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('drag'); }));
    zona.addEventListener('drop', e => receberArquivo(e.dataTransfer.files[0]));
}

// --- API usada pelo app ---

export function abrirImportarPlanilha(callbackUsar) {
    aoUsar = callbackUsar;
    ligarEventos();
    if (!grupos.length) {
        const salvo = carregarBase();
        if (salvo) { grupos = agruparEnvios(salvo.registros); quando = salvo.quando; }
    }
    mostrarEtapa();
    $('modal-importar').style.display = 'flex';
}

export function fecharImportarPlanilha() {
    $('modal-importar').style.display = 'none';
}

export function importarPlanilhaAberto() {
    return $('modal-importar')?.style.display === 'flex';
}

// Volta para a área de colagem (para trocar a base)
export function novaBaseImportada() {
    grupos = [];
    mostrarEtapa();
}

export function limparBaseImportada() {
    if (!confirm('Apagar a base importada deste navegador?')) return;
    try { localStorage.removeItem(CHAVE_STORAGE); } catch (e) { /* ignora */ }
    grupos = [];
    quando = null;
    mostrarEtapa();
}

export function escolherArquivoImportar() {
    $('importar_arquivo').click();
}

export function usarEnvioImportado(i) {
    const g = grupos[i];
    if (!g || !aoUsar) return;
    if (aoUsar(g) !== false) fecharImportarPlanilha();
}
