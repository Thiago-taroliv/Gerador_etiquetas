// Tela "Montar kit": mostra a sugestão (qual item é cada componente e quantos kits por OS/ticket),
// deixa trocar tudo e só monta depois da confirmação. Também edita a receita do kit.
// Usada na prévia da importação de estoque e no formulário.
import { escapeHtml } from './config.js';
import { sugerirKit, maxKits, montarKit, totalKits, acharItem } from './kit.js';
import { carregarReceitas, salvarReceita, receitasSalvasNoBanco } from './kitReceitas.js';
import { datalistItensHtml } from './dePara.js';
import { toast } from './toast.js';

let estado = null; // { itens, rotuloRef, receitas, receita, escolha, editando, rascunhoReceita, resolver }

function garantirModal() {
    if (document.getElementById('modal-kit')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="modal-kit" class="modal-overlay">
            <div class="modal-card importar-card">
                <div class="modal-header">
                    <strong>Montar kit</strong>
                    <button class="modal-close" onclick="fecharMontarKit(null)" title="Cancelar">&times;</button>
                </div>
                <div id="kit_corpo" class="kit-corpo"></div>
                <div class="modal-actions">
                    <button class="btn-neutral" onclick="fecharMontarKit(null)">Cancelar</button>
                    <button id="kit_confirmar" onclick="confirmarMontarKit()">Montar</button>
                </div>
            </div>
        </div>`);
}

// itens: no formato do formulário. escolhaAnterior (opcional): reabre com o que foi confirmado antes.
// Resolve com a escolha confirmada { nome, componentes: [{ nome, qtd, desc }], kitsPorRef } ou null.
export async function abrirMontarKit(itens, { rotuloRef = 'OS', escolhaAnterior = null } = {}) {
    garantirModal();
    const receitas = await carregarReceitas();
    const receita = receitas.find(r => r.nome === escolhaAnterior?.nome) || receitas[0];
    estado = { itens, rotuloRef, receitas, receita, editando: false, rascunhoReceita: null };
    estado.escolha = escolhaAnterior
        ? { ...escolhaAnterior, componentes: escolhaAnterior.componentes.map(c => ({ ...c })), kitsPorRef: { ...escolhaAnterior.kitsPorRef } }
        : sugerirKit(itens, receita);
    render();
    document.getElementById('modal-kit').style.display = 'flex';
    return new Promise(resolve => { estado.resolver = resolve; });
}

window.fecharMontarKit = function (resultado) {
    document.getElementById('modal-kit').style.display = 'none';
    const resolver = estado?.resolver;
    estado = null;
    resolver?.(resultado);
};

window.confirmarMontarKit = function () {
    const { escolha } = estado;
    if (!totalKits(escolha.kitsPorRef)) { toast('Nenhum kit para montar.', 'warning'); return; }
    window.fecharMontarKit({
        nome: escolha.nome,
        componentes: escolha.componentes.map(({ nome, qtd, desc }) => ({ nome, qtd, desc })),
        kitsPorRef: Object.fromEntries(Object.entries(escolha.kitsPorRef).filter(([, n]) => n > 0))
    });
};

// Recalcula o máximo por OS e limita o que foi pedido (sem perder o que o usuário digitou abaixo do máximo)
function recalcular(manterPedido = true) {
    const e = estado.escolha;
    e.max = maxKits(estado.itens, e.componentes);
    const pedido = manterPedido ? e.kitsPorRef : {};
    e.kitsPorRef = Object.fromEntries(Object.entries(e.max).map(([ref, m]) =>
        [ref, Math.min(m, pedido[ref] ?? m)]));
}

function render() {
    const { itens, rotuloRef, receitas, receita, escolha, editando } = estado;
    if (!escolha.max) recalcular();
    const usados = escolha.componentes.map(c => c.desc).filter(Boolean);
    const repetido = usados.find((d, i) => usados.indexOf(d) !== i);

    const opcoes = sel => ['<option value="">— não tem neste envio —</option>',
        ...itens.filter(it => it.papel !== 'kit').map(it =>
            `<option value="${escapeHtml(it.desc)}"${it.desc === sel ? ' selected' : ''}>${escapeHtml(it.desc)} (${escapeHtml(String(it.qty))})</option>`)].join('');

    const componentesHtml = escolha.componentes.map((c, i) => {
        const it = acharItem(itens, c.desc);
        const falta = !c.desc;
        return `<div class="kit-linha${falta ? ' falta' : ''}">
            <span class="kit-comp">${c.qtd}× ${escapeHtml(c.nome)}</span>
            <select onchange="kitTrocarItem(${i}, this.value)">${opcoes(c.desc)}</select>
            ${it && it.desc !== c.nome ? '<span class="kit-tag" title="O nome do item é diferente do nome na receita: confira">confira</span>' : ''}
        </div>`;
    }).join('');

    const refs = Object.keys(escolha.max);
    const kitsHtml = refs.length ? refs.map(ref => `
        <div class="kit-linha">
            <span class="kit-comp">${ref ? `${escapeHtml(rotuloRef)} ${escapeHtml(ref)}` : 'Kits'}</span>
            <input type="number" min="0" max="${escolha.max[ref]}" value="${escolha.kitsPorRef[ref] ?? 0}"
                   onchange="kitMudarQtd('${escapeHtml(ref)}', this.value)">
            <span class="kit-max">de ${escolha.max[ref]} possíveis</span>
        </div>`).join('')
        : `<div class="estoque-aviso">⚠ ${repetido ? `O item "${escapeHtml(repetido)}" está em dois componentes.`
            : escolha.componentes.some(c => !c.desc) ? 'Falta item para algum componente: escolha o item ou ajuste a receita.'
            : 'As quantidades não fecham nenhum kit completo.'}</div>`;

    // Prévia do que fica fora do kit
    const total = totalKits(escolha.kitsPorRef);
    const sobra = total ? montarKit(itens, escolha).filter(it => it.papel !== 'kit' || it.desc !== escolha.nome) : [];
    const sobraHtml = total ? `<div class="kit-sobra"><strong>Fica fora do kit:</strong> ${sobra.length
        ? sobra.map(it => `${escapeHtml(String(it.qty))}× ${escapeHtml(it.desc)}`).join(', ') : 'nada'}</div>` : '';

    const receitaHtml = editando ? editorReceitaHtml() : `
        <div class="kit-linha">
            <span class="kit-comp">Receita</span>
            <select onchange="kitTrocarReceita(this.value)">${receitas.map(r =>
                `<option${r.nome === receita.nome ? ' selected' : ''}>${escapeHtml(r.nome)}</option>`).join('')}</select>
            <button type="button" class="btn-sm" onclick="kitEditarReceita()">Editar receita</button>
            <button type="button" class="btn-sm" onclick="kitNovaReceita()">Nova receita</button>
        </div>`;

    document.getElementById('kit_corpo').innerHTML = `
        ${receitaHtml}
        <div class="kit-secao">Item do envio para cada componente</div>
        ${componentesHtml}
        <div class="kit-secao">Quantos kits montar</div>
        ${kitsHtml}
        ${sobraHtml}`;

    const btn = document.getElementById('kit_confirmar');
    btn.disabled = !total || !!repetido || editando;
    btn.textContent = total ? `Montar ${total} ${escolha.nome}` : 'Montar';
}

function editorReceitaHtml() {
    const r = estado.rascunhoReceita;
    return `<div class="kit-editor">
        ${datalistItensHtml('kit_catalogo')}
        <div class="kit-linha">
            <span class="kit-comp">Nome do kit</span>
            <input type="text" value="${escapeHtml(r.nome)}" oninput="kitEditarNome(this.value)" placeholder="Ex: KIT RA24">
        </div>
        ${r.componentes.map((c, i) => `
            <div class="kit-linha">
                <input type="number" min="1" value="${c.qtd}" class="kit-qtd" onchange="kitEditarComp(${i}, 'qtd', this.value)">
                <input type="text" list="kit_catalogo" value="${escapeHtml(c.nome)}" placeholder="Nome do item no romaneio"
                       onchange="kitEditarComp(${i}, 'nome', this.value)">
                <button type="button" class="btn-sm btn-neutral" onclick="kitRemoverComp(${i})" title="Remover">✕</button>
            </div>`).join('')}
        <div class="kit-linha">
            <button type="button" class="btn-sm btn-neutral" onclick="kitAdicionarComp()">+ Componente</button>
            <span style="flex:1"></span>
            <button type="button" class="btn-sm btn-neutral" onclick="kitCancelarEdicao()">Cancelar</button>
            <button type="button" class="btn-sm" onclick="kitSalvarReceita(this)">Salvar receita</button>
        </div>
        ${receitasSalvasNoBanco() ? '' : '<div class="estoque-aviso">⚠ Tabela de receitas não encontrada: rode o sql/kit.sql no Supabase para salvar.</div>'}
    </div>`;
}

window.kitTrocarItem = (i, desc) => { estado.escolha.componentes[i].desc = desc; recalcular(false); render(); };
window.kitMudarQtd = (ref, v) => {
    const e = estado.escolha;
    e.kitsPorRef[ref] = Math.max(0, Math.min(e.max[ref] || 0, parseInt(v) || 0));
    render();
};
window.kitTrocarReceita = nome => {
    estado.receita = estado.receitas.find(r => r.nome === nome) || estado.receita;
    estado.escolha = sugerirKit(estado.itens, estado.receita);
    render();
};
window.kitEditarReceita = () => {
    estado.editando = true;
    estado.rascunhoReceita = { nome: estado.receita.nome, componentes: estado.receita.componentes.map(c => ({ ...c })) };
    render();
};
window.kitNovaReceita = () => {
    estado.editando = true;
    estado.rascunhoReceita = { nome: '', componentes: [{ nome: '', qtd: 1 }] };
    render();
};
window.kitEditarNome = v => { estado.rascunhoReceita.nome = v; };
window.kitEditarComp = (i, campo, v) => { estado.rascunhoReceita.componentes[i][campo] = campo === 'qtd' ? Math.max(1, parseInt(v) || 1) : v; };
window.kitRemoverComp = i => { estado.rascunhoReceita.componentes.splice(i, 1); render(); };
window.kitAdicionarComp = () => { estado.rascunhoReceita.componentes.push({ nome: '', qtd: 1 }); render(); };
window.kitCancelarEdicao = () => { estado.editando = false; render(); };
window.kitSalvarReceita = async btn => {
    const r = estado.rascunhoReceita;
    if (!r.nome.trim() || !r.componentes.some(c => c.nome.trim())) { toast('Dê um nome ao kit e pelo menos um componente.', 'warning'); return; }
    btn.disabled = true;
    const ok = await salvarReceita(r);
    if (!ok) { btn.disabled = false; toast('Não foi possível salvar a receita.', 'error'); return; }
    toast('Receita salva.');
    estado.receitas = await carregarReceitas();
    estado.receita = estado.receitas.find(x => x.nome === r.nome.trim().toUpperCase()) || estado.receitas[0];
    estado.editando = false;
    estado.escolha = sugerirKit(estado.itens, estado.receita);
    render();
};
