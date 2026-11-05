// Prévia editável das linhas da planilha de importação de veículos (um por rastreador) e cópia para o Excel.
// O nome do cliente na plataforma é lembrado por unidade (configuração plataforma_clientes).
import { escapeHtml } from './config.js';
import { COLUNAS_VEICULOS, VC, gerarLinhasVeiculos, normUnidade } from './veiculos.js';
import { config, salvarConfiguracao } from './configuracoes.js';
import { toast } from './toast.js';
import { confirmar } from './dialogo.js';

let linhas = [];
let unidades = []; // [{ unidade, cliente }] dos rastreadores deste envio

function garantirModal() {
    if (document.getElementById('modal-veiculos')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="modal-veiculos" class="modal-overlay">
            <div class="modal-card planilha-card">
                <div class="modal-header">
                    <strong id="veiculos_titulo">Linhas para a planilha de veículos</strong>
                    <button class="modal-close" onclick="fecharVeiculos()" title="Fechar">&times;</button>
                </div>
                <div id="veiculos_clientes"></div>
                <div class="planilha-wrap"><table class="planilha-table veiculos-table" id="veiculos_tabela"></table></div>
                <div id="veiculos_resumo" class="small" style="margin-top:8px"></div>
                <div class="modal-actions">
                    <label class="cfg-check" style="margin-right:auto"><input type="checkbox" id="veiculos_cabecalho"> Copiar com o cabeçalho</label>
                    <button class="btn-neutral" onclick="fecharVeiculos()">Fechar</button>
                    <button onclick="copiarVeiculos()">Copiar linhas</button>
                </div>
            </div>
        </div>`);
}

export function abrirLinhasVeiculos(dados, titulo = '') {
    const clientes = config('plataforma_clientes') || [];
    linhas = gerarLinhasVeiculos(dados, { clientes, telefone: config('veiculos_telefone') || '' });
    if (!linhas.length) {
        toast('Nenhum rastreador com IMEI neste envio.', 'warning');
        return;
    }
    // Uma linha "unidade -> cliente na plataforma" por unidade (o nome sugerido é o que está nas linhas)
    const vistas = new Map();
    linhas.forEach(l => {
        const un = l.unidadeOrigem;
        if (!vistas.has(normUnidade(un))) vistas.set(normUnidade(un), { unidade: un, cliente: l[VC.CLIENTE] });
    });
    unidades = [...vistas.values()];

    garantirModal();
    document.getElementById('veiculos_titulo').textContent = titulo || 'Linhas para a planilha de veículos';
    render();
    document.getElementById('modal-veiculos').style.display = 'flex';
}

window.fecharVeiculos = () => { document.getElementById('modal-veiculos').style.display = 'none'; };

// Mesmos limites da planilha de envio: IMEI com 15 dígitos, ICCID com 19-20, IMEI sem repetir, obrigatórios preenchidos
function problemas() {
    const erros = new Map();
    const vistos = new Map();
    linhas.forEach((l, r) => {
        COLUNAS_VEICULOS.forEach((_, c) => { if (!String(l[c]).trim()) erros.set(`${r},${c}`, 'Obrigatório'); });
        const imei = String(l[VC.IMEI]).trim();
        if (imei && !/^\d{15}$/.test(imei)) erros.set(`${r},${VC.IMEI}`, 'IMEI deve ter 15 dígitos');
        const iccid = String(l[VC.ICCID]).trim();
        if (iccid && !/^\d{19,20}F?$/i.test(iccid)) erros.set(`${r},${VC.ICCID}`, 'ICCID deve ter 19 ou 20 dígitos');
        if (imei && vistos.has(imei)) {
            erros.set(`${r},${VC.IMEI}`, 'Repetido em outra linha');
            erros.set(`${vistos.get(imei)},${VC.IMEI}`, 'Repetido em outra linha');
        } else if (imei) vistos.set(imei, r);
    });
    return erros;
}

function render() {
    document.getElementById('veiculos_clientes').innerHTML = `
        <div class="small">Nome do cliente como está na plataforma. O programa lembra para a próxima vez.</div>
        ${unidades.map((u, i) => `
            <div class="cfg-linha" style="margin:4px 0">
                <span class="cfg-rotulo">${escapeHtml(u.unidade || '(sem unidade)')}</span>
                <input type="text" value="${escapeHtml(u.cliente)}" oninput="veiculosCliente(${i}, this.value)">
            </div>`).join('')}`;

    document.getElementById('veiculos_tabela').innerHTML =
        `<thead><tr class="nomes"><th class="col-acoes">#</th>${COLUNAS_VEICULOS.map(n => `<th>${escapeHtml(n)}</th>`).join('')}</tr></thead>
        <tbody>${linhas.map((l, r) => `<tr><td class="col-acoes">${r + 1}</td>${COLUNAS_VEICULOS.map((_, c) =>
            `<td data-r="${r}" data-c="${c}"><input type="text" value="${escapeHtml(l[c])}" oninput="veiculosCelula(${r}, ${c}, this.value)"></td>`).join('')}</tr>`).join('')}
        </tbody>`;
    atualizarResumo();
}

function atualizarResumo() {
    const erros = problemas();
    document.querySelectorAll('#veiculos_tabela td[data-c]').forEach(td => {
        const msg = erros.get(`${td.dataset.r},${td.dataset.c}`);
        td.classList.toggle('cell-erro', !!msg);
        td.title = msg || '';
    });
    const n = new Set([...erros.keys()]).size;
    document.getElementById('veiculos_resumo').innerHTML = `${linhas.length} veículo(s)` +
        (n ? ` &middot; <span style="color:#b26a00;font-weight:700;">${n} célula(s) para conferir</span>` : '');
}

window.veiculosCelula = (r, c, v) => { linhas[r][c] = v; atualizarResumo(); };

// Muda o cliente de todas as linhas daquela unidade
window.veiculosCliente = (i, v) => {
    const u = unidades[i];
    u.cliente = v;
    linhas.forEach((l, r) => {
        if (normUnidade(l.unidadeOrigem) !== normUnidade(u.unidade)) return;
        l[VC.CLIENTE] = v;
        const input = document.querySelector(`#veiculos_tabela td[data-r="${r}"][data-c="${VC.CLIENTE}"] input`);
        if (input) input.value = v;
    });
    atualizarResumo();
};

// Guarda o nome na plataforma das unidades em que ele é diferente do nome da unidade
async function lembrarClientes() {
    const salvos = [...(config('plataforma_clientes') || [])];
    let mudou = false;
    unidades.forEach(({ unidade, cliente }) => {
        const nome = String(cliente || '').trim();
        if (!unidade || !nome) return;
        const i = salvos.findIndex(c => normUnidade(c.unidade) === normUnidade(unidade));
        if (i >= 0 && salvos[i].cliente === nome) return;
        if (i < 0 && nome === unidade) return;
        if (i >= 0) salvos[i] = { unidade, cliente: nome }; else salvos.push({ unidade, cliente: nome });
        mudou = true;
    });
    if (mudou && !(await salvarConfiguracao('plataforma_clientes', salvos))) {
        toast('Linhas copiadas, mas não foi possível lembrar o nome do cliente (rode o sql/configuracoes.sql).', 'warning', 6000);
    }
}

window.copiarVeiculos = async function () {
    const erros = problemas();
    if (erros.size) {
        const copiar = await confirmar({
            titulo: 'Há células para conferir',
            mensagem: `${new Set([...erros.keys()]).size} célula(s) estão marcadas em laranja.`,
            tipo: 'aviso',
            sim: 'Copiar mesmo assim',
            nao: 'Voltar e conferir'
        });
        if (!copiar) return;
    }
    const todas = [...(document.getElementById('veiculos_cabecalho').checked ? [COLUNAS_VEICULOS] : []), ...linhas];
    const limpo = todas.map(l => COLUNAS_VEICULOS.map((_, c) => String(l[c] ?? '').replace(/[\t\n\r]+/g, ' ').trim()));
    const tsv = limpo.map(l => l.join('\t')).join('\n');
    // Todas as células como texto no Excel: o ICCID de 20 dígitos não vira notação científica
    const html = '<table>' + limpo.map(l => '<tr>' + l.map(v =>
        `<td style="mso-number-format:'\\@'">${escapeHtml(v)}</td>`).join('') + '</tr>').join('') + '</table>';
    try {
        if (window.ClipboardItem && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([tsv], { type: 'text/plain' })
            })]);
        } else {
            await navigator.clipboard.writeText(tsv);
        }
    } catch (e) {
        toast('Não foi possível copiar: ' + e.message, 'error');
        return;
    }
    toast(`${linhas.length} linha(s) copiada(s). Cole na planilha de importação de veículos.`);
    await lembrarClientes();
};
