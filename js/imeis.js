// Números (IMEIs/identificadores) de um item do formulário: colar em massa e,
// linha a linha, substituir um equipamento com defeito ou excluí-lo.
import { escapeHtml, AppState } from './config.js';
import { confirmar, pedirCampos } from './dialogo.js';
import { toast } from './toast.js';

// Os dois formatos de dado: { tipo: 'simples', imei } e { tipo: 'kit', rastreador, teclado },
// com chip, iccid e ref opcionais (chip preso ao rastreador e OS/ticket de origem)
export function linhaImeiHtml(im) {
    const valor = im.tipo === 'kit' ? `${im.rastreador || ''}|${im.teclado || ''}` : im.imei;
    const texto = im.tipo === 'kit'
        ? `Rastreador: <strong>${escapeHtml(im.rastreador)}</strong> | Teclado: <strong>${escapeHtml(im.teclado)}</strong>`
        : `IMEI: <strong>${escapeHtml(im.imei)}</strong>`;
    const attrs = [
        im.ref ? ` data-ref="${escapeHtml(im.ref)}"` : '',
        im.chip ? ` data-chip="${escapeHtml(im.chip)}"` : '',
        im.iccid ? ` data-iccid="${escapeHtml(im.iccid)}"` : ''
    ].join('');
    const chip = im.chip
        ? `<span class="imei-chip" title="${escapeHtml(im.chip + (im.iccid ? ` — ICCID ${im.iccid}` : ''))}">+ chip</span>` : '';
    return `<div class="imei-item" data-imei="${escapeHtml(valor)}"${attrs}>
        <div class="imei-texto">${texto}${chip}</div>
        <div class="imei-botoes">
            <button type="button" class="btn-sm btn-neutral" onclick="substituirImei(this)" title="Trocar só este número por outro">Substituir</button>
            <button type="button" class="btn-sm btn-danger" onclick="excluirImei(this)" title="Tirar este número, sem colocar outro no lugar">Excluir</button>
        </div>
    </div>`;
}

// Lê os dados de volta da linha na tela
export function imeiDaLinha(linha) {
    const { imei: valor, chip, iccid, ref } = linha.dataset;
    const extras = { ...(chip ? { chip } : {}), ...(iccid ? { iccid } : {}), ...(ref ? { ref } : {}) };
    if (valor.includes('|')) {
        const [rastreador, teclado] = valor.split('|');
        return { tipo: 'kit', rastreador, teclado, ...extras };
    }
    return { tipo: 'simples', imei: valor, ...extras };
}

// Resumo acima da lista e rótulo do botão que abre a seção
export function atualizarResumoImeis(card) {
    const n = card.querySelectorAll('.imei-item').length;
    const resumo = card.querySelector('.it-imei-resumo');
    if (resumo) {
        resumo.style.display = n ? 'block' : 'none';
        resumo.textContent = `${n} ${n === 1 ? 'número neste item' : 'números neste item'}. `
            + 'Com defeito? Use "Substituir" para trocar só ele, ou "Excluir" se não vai colocar outro no lugar.';
    }
    const botao = card.querySelector('.imei-toggle');
    if (botao) botao.textContent = n ? `IMEIs do item (${n})` : '+ Adicionar IMEIs';
}

// Avisa a tela (faixa de alterações não salvas e de pendências) de uma mudança feita por código
export function sinalizarMudanca() {
    document.getElementById('items_container')?.dispatchEvent(new Event('change', { bubbles: true }));
}

function lembreteDeSalvar() {
    if (AppState.currentHistoricoId) return ' Para gravar, clique em "Salvar no pedido".';
    if (AppState.currentDraftId) return ' Para gravar, clique em "Salvar Rascunho".';
    return '';
}

const limparNumero = s => String(s || '').replace(/[|\t\r\n]/g, '').trim();
const descricaoDo = card => card.querySelector('.it-desc')?.value.trim() || 'item sem descrição';

// Número -> descrição do item, para todas as outras linhas do formulário
function numerosDasOutrasLinhas(linhaAtual) {
    const mapa = new Map();
    document.querySelectorAll('.imei-item').forEach(linha => {
        if (linha === linhaAtual) return;
        const desc = descricaoDo(linha.closest('.item-card'));
        const im = imeiDaLinha(linha);
        [im.imei, im.rastreador, im.teclado, im.iccid].filter(Boolean).forEach(n => mapa.set(n, desc));
    });
    return mapa;
}

export async function substituirImei(btn) {
    const linha = btn.closest('.imei-item');
    const card = linha.closest('.item-card');
    const atual = imeiDaLinha(linha);
    const kit = atual.tipo === 'kit';
    const desc = descricaoDo(card);

    const campos = kit
        ? [
            { nome: 'rastreador', rotulo: 'Rastreador', valor: atual.rastreador, focar: true },
            { nome: 'teclado', rotulo: 'Teclado', valor: atual.teclado }
        ]
        : [{ nome: 'imei', rotulo: 'Número novo', placeholder: 'Digite ou bipe o número', focar: true }];
    if (atual.chip) {
        campos.push({
            nome: 'iccid', rotulo: 'ICCID do chip', valor: atual.iccid || '',
            ajuda: 'O chip continua nesta linha. Altere só se ele também foi trocado.'
        });
    }

    const novos = await pedirCampos({
        titulo: `Substituir em ${desc}`,
        mensagem: kit
            ? 'Altere só o número do equipamento com defeito. O outro continua igual.'
            : `Número com defeito: ${atual.imei}. Informe o número do equipamento que vai no lugar dele.`,
        sim: 'Substituir',
        campos,
        validar: valores => {
            const v = { ...valores };
            Object.keys(v).forEach(k => { v[k] = limparNumero(v[k]); });
            if (!kit && !v.imei) return { campo: 'imei', mensagem: 'Digite o número novo. Se não vai colocar outro no lugar, cancele e use "Excluir".' };
            if (kit && atual.rastreador && !v.rastreador) return { campo: 'rastreador', mensagem: 'O rastreador não pode ficar vazio.' };
            if (kit && atual.teclado && !v.teclado) return { campo: 'teclado', mensagem: 'O teclado não pode ficar vazio.' };
            if (kit && v.rastreador && v.rastreador === v.teclado) return { campo: 'teclado', mensagem: 'Rastreador e teclado estão com o mesmo número.' };

            const mudouNumero = kit
                ? v.rastreador !== atual.rastreador || v.teclado !== atual.teclado
                : v.imei !== atual.imei;
            const mudouChip = !!atual.chip && v.iccid !== (atual.iccid || '');
            if (!mudouNumero && !mudouChip) {
                return kit
                    ? 'Nenhum número foi alterado. Mude o número do equipamento com defeito.'
                    : { campo: 'imei', mensagem: 'Esse é o número com defeito. Digite o número do equipamento novo.' };
            }

            const outros = numerosDasOutrasLinhas(linha);
            for (const nome of ['imei', 'rastreador', 'teclado', 'iccid']) {
                if (v[nome] && outros.has(v[nome])) {
                    return { campo: nome, mensagem: `O número ${v[nome]} já está em "${outros.get(v[nome])}". Confira o número digitado.` };
                }
            }
            return null;
        }
    });
    if (!novos) return;

    const atualizado = { ...atual };
    if (kit) {
        atualizado.rastreador = limparNumero(novos.rastreador);
        atualizado.teclado = limparNumero(novos.teclado);
    } else {
        atualizado.imei = limparNumero(novos.imei);
    }
    if (atual.chip) {
        const iccid = limparNumero(novos.iccid);
        if (iccid) atualizado.iccid = iccid; else delete atualizado.iccid;
    }

    linha.outerHTML = linhaImeiHtml(atualizado);
    sinalizarMudanca();
    toast(`Número substituído.${lembreteDeSalvar()}`, 'success', 6000);
}

// Uma unidade a menos na quantidade por OS/ticket, para o e-mail continuar separando certo
function tirarDaQuantidadePorOS(card, ref) {
    if (!card.dataset.porRef) return;
    const porRef = JSON.parse(card.dataset.porRef);
    const refs = Object.keys(porRef);
    const alvo = ref && porRef[ref] !== undefined ? ref : (refs.length === 1 ? refs[0] : null);
    if (!alvo) return;
    porRef[alvo] -= 1;
    if (porRef[alvo] <= 0) delete porRef[alvo];
    card.dataset.porRef = JSON.stringify(porRef);
}

export async function excluirImei(btn) {
    const linha = btn.closest('.imei-item');
    const card = linha.closest('.item-card');
    const atual = imeiDaLinha(linha);
    const desc = descricaoDo(card);
    const qtd = card.querySelector('.it-qty');
    const antes = parseInt(qtd.value) || 1;
    const depois = antes - 1;
    const numero = atual.tipo === 'kit' ? `${atual.rastreador} / ${atual.teclado}` : atual.imei;
    const ehKit = card.dataset.papel === 'kit';

    const consequencia = depois <= 0
        ? `É o único número de "${desc}", então o item inteiro sai do envio.`
        : `"${desc}" passa de ${antes} para ${depois} ${ehKit ? '(um kit a menos, com os acessórios dele)' : 'na quantidade'}.`;

    const ok = await confirmar({
        titulo: 'Excluir este número?',
        mensagem: `${numero}\n\n${consequencia}\n\nSe vai colocar outro equipamento no lugar, use "Substituir".`,
        tipo: 'perigo',
        sim: 'Excluir',
        nao: 'Manter'
    });
    if (!ok) return;

    linha.remove();
    if (depois <= 0) {
        card.remove();
    } else {
        qtd.value = depois;
        tirarDaQuantidadePorOS(card, atual.ref);
        if (!card.querySelector('.imei-item')) {
            qtd.readOnly = false;
            qtd.style.backgroundColor = '';
        }
        atualizarResumoImeis(card);
    }
    sinalizarMudanca();
    toast(`Número excluído.${lembreteDeSalvar()}`, 'success', 6000);
}

// Cola em massa: um por linha, ou "RASTREADOR<TAB>TECLADO" para kits
export async function procesarIMEIs(btn) {
    const card = btn.closest('.item-card');
    const textarea = card.querySelector('.it-imei-input');
    const imeiList = card.querySelector('.it-imei-list');
    const qtdInput = card.querySelector('.it-qty');

    const imeiText = textarea.value.trim();
    if (!imeiText) {
        toast('Cole os números/IMEIs no campo acima e clique em "Processar IMEIs" de novo.', 'warning');
        textarea.focus();
        return;
    }

    const lines = imeiText.split('\n').map(l => l.trim()).filter(l => l);
    const isKit = lines.some(l => l.includes('\t'));
    let imeis = [];
    lines.forEach(line => {
        if (!isKit) { imeis.push({ tipo: 'simples', imei: limparNumero(line) }); return; }
        const parts = line.split('\t').map(limparNumero).filter(p => p);
        if (parts.length) imeis.push({ tipo: 'kit', rastreador: parts[0], teclado: parts[1] || '' });
    });

    // Remove repetidos (mesmo IMEI ou mesmo par rastreador|teclado)
    const vistos = new Set();
    const totalColado = imeis.length;
    imeis = imeis.filter(i => {
        const chave = i.tipo === 'kit' ? `${i.rastreador}|${i.teclado}` : i.imei;
        if (!chave || vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
    });
    const duplicados = totalColado - imeis.length;

    if (imeis.length === 0) {
        toast('Nenhum número válido encontrado no texto colado.', 'warning');
        return;
    }

    const jaTem = imeiList.querySelectorAll('.imei-item').length;
    if (jaTem) {
        const comChip = imeiList.querySelector('[data-chip]') ? ' Os chips ligados a esses números também saem.' : '';
        const ok = await confirmar({
            titulo: 'Trocar a lista inteira?',
            mensagem: `Este item já tem ${jaTem} número(s). A lista colada vai ocupar o lugar deles.${comChip}\n\nPara trocar um equipamento só, cancele e use "Substituir" na linha dele.`,
            tipo: 'aviso',
            sim: 'Trocar a lista',
            nao: 'Cancelar'
        });
        if (!ok) return;
    }

    qtdInput.value = imeis.length;
    qtdInput.readOnly = true;
    qtdInput.style.backgroundColor = '#e8f4f8';
    imeiList.innerHTML = imeis.map(linhaImeiHtml).join('');
    textarea.value = '';
    atualizarResumoImeis(card);
    sinalizarMudanca();

    if (duplicados) toast(`${imeis.length} número(s) processado(s). ${duplicados} repetido(s) ignorado(s).`, 'warning', 5000);
    else toast(`${imeis.length} número(s) processado(s).`);
}

// Remove todos os números do item e libera a quantidade para edição
export async function limparIMEIs(btn) {
    const card = btn.closest('.item-card');
    const n = card.querySelectorAll('.imei-item').length;
    if (n) {
        const ok = await confirmar({
            titulo: 'Limpar todos os números?',
            mensagem: `Os ${n} número(s) de "${descricaoDo(card)}" saem da lista e a quantidade fica livre para editar.\n\nPara mexer em um só, use "Substituir" ou "Excluir" na linha dele.`,
            tipo: 'perigo',
            sim: 'Limpar todos',
            nao: 'Manter'
        });
        if (!ok) return;
    }
    card.querySelector('.it-imei-list').innerHTML = '';
    card.querySelector('.it-imei-input').value = '';
    const qtd = card.querySelector('.it-qty');
    qtd.readOnly = false;
    qtd.style.backgroundColor = '';
    atualizarResumoImeis(card);
    sinalizarMudanca();
}

window.substituirImei = substituirImei;
window.excluirImei = excluirImei;
window.procesarIMEIs = procesarIMEIs;
window.limparIMEIs = limparIMEIs;
