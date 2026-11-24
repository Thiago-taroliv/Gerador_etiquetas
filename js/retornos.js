// Retornos de material (BETA): o que deveria voltar para a Ranor no lugar do que foi enviado.
// Regra do beta: cada equipamento (rastreador, kit ou teclado) enviado num pedido de tipo MAN, COR ou FOR
// conta como uma unidade esperada de volta, do técnico (destinatário) / da unidade do envio.
// O que já voltou fica na tabela retornos (sql/datas_retornos.sql); o resto é calculado a partir dos envios.
// Próximos passos possíveis: dar baixa sozinho pela planilha de estoque (linhas com destinatário RANOR, pelo IMEI)
// e escolher em Configurações quais tipos geram retorno.
import { escapeHtml } from './config.js';
import { carregarEnviosComRetorno, carregarRetornos, registrarRetorno, desfazerRetorno } from './db.js';
import { papelDoItem, unidadeDoItem } from './planilha.js';
import { pedirCampos, confirmar } from './dialogo.js';
import { hojeInput, deInput, problemaData } from './datas.js';
import { abrirVisualizacaoEnvio } from './envioView.js';
import { toast } from './toast.js';

export const TIPOS_COM_RETORNO = ['MAN', 'COR', 'FOR'];
const ROTULO_TIPO = { MAN: 'Manutenção', COR: 'Correção', FOR: 'Fornecedor' };
const DIA = 864e5;

let cache = null;      // { envios, retornos (null = sem tabela), desde }
let estado = { agrupar: 'tecnico', mostrar: 'pendentes', tipo: '', busca: '', meses: '6', abertos: new Set() };
let alvo = null;       // elemento onde a visão é desenhada

// Unidades esperadas de volta de um envio: uma por IMEI (ou por quantidade, sem IMEI)
export function unidadesEsperadas(envio) {
    const dados = { client_mode: envio.client_mode, unit_name: envio.unit_name || envio.unidade, dest_name: envio.destinatario };
    const lista = [];
    (envio.itens || []).forEach((it, i) => {
        if (!['rastreador', 'kit', 'teclado'].includes(papelDoItem(it))) return;
        const desc = String(it.desc || '').trim();
        const unidade = unidadeDoItem(dados, it) || envio.unidade || '';
        const imeis = (it.imeis || []).filter(im => im.imei || im.rastreador || im.teclado);
        if (imeis.length) {
            imeis.forEach(im => {
                const numero = im.tipo === 'kit' ? (im.rastreador || im.teclado) : im.imei;
                lista.push({ chave: numero, numero, desc, unidade });
            });
        } else {
            const qtd = Math.max(1, parseInt(it.qty, 10) || 1);
            for (let n = 1; n <= qtd; n++) lista.push({ chave: `item${i}-${n}`, numero: '', desc, unidade });
        }
    });
    return lista;
}

async function carregar(recarregar) {
    const desde = estado.meses ? new Date(Date.now() - Number(estado.meses) * 30 * DIA).toISOString() : '';
    if (cache && !recarregar && cache.desde === desde) return true;
    const [envios, retornos] = await Promise.all([carregarEnviosComRetorno(TIPOS_COM_RETORNO, desde), carregarRetornos()]);
    if (!envios) return false;
    cache = { envios, retornos, desde };
    return true;
}

// Todas as unidades esperadas, com o retorno registrado (se houver)
function unidades() {
    const recebidos = new Map((cache.retornos || []).map(r => [`${r.historico_id}|${r.chave}`, r]));
    const agora = Date.now();
    return cache.envios.flatMap(e => unidadesEsperadas(e).map(u => ({
        ...u,
        envio: e,
        tecnico: (e.destinatario || '').trim() || 'Sem destinatário',
        unidade: (u.unidade || '').trim() || 'Sem unidade',
        dias: e.despachado_em ? Math.floor((agora - new Date(e.despachado_em)) / DIA) : null,
        retorno: recebidos.get(`${e.id}|${u.chave}`) || null
    })));
}

export async function renderRetornos(el, recarregar = false) {
    alvo = el;
    if (!cache || recarregar) el.innerHTML = '<div class="empty-state">Carregando os retornos...</div>';
    if (!(await carregar(recarregar))) {
        el.innerHTML = '<div class="empty-state">Erro ao carregar os retornos. Tente atualizar.</div>';
        return;
    }
    desenhar();
}

function desenhar() {
    const todas = unidades();
    const termo = estado.busca.trim().toLowerCase();
    const filtradas = todas.filter(u =>
        (!estado.tipo || u.envio.tipo === estado.tipo)
        && (estado.mostrar === 'todos' || (estado.mostrar === 'recebidos') === !!u.retorno)
        && (!termo || [u.tecnico, u.unidade, u.numero, u.desc, u.envio.referencia].join(' ').toLowerCase().includes(termo)));

    const pendentes = todas.filter(u => !u.retorno);
    const semTabela = cache.retornos === null;

    // Grupos: técnico ou unidade
    const chaveGrupo = u => estado.agrupar === 'tecnico' ? u.tecnico : u.unidade;
    const grupos = new Map();
    filtradas.forEach(u => {
        const k = chaveGrupo(u);
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(u);
    });
    const ordenados = [...grupos.entries()].map(([k, l]) => ({
        nome: k, lista: l.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)),
        pend: l.filter(u => !u.retorno).length,
        maisAntigo: Math.max(...l.filter(u => !u.retorno).map(u => u.dias ?? 0), 0)
    })).sort((a, b) => b.pend - a.pend || b.maisAntigo - a.maisAntigo || a.nome.localeCompare(b.nome, 'pt-BR'));

    const porTipo = TIPOS_COM_RETORNO.map(tp => ({ tp, n: pendentes.filter(u => u.envio.tipo === tp).length }));
    const antigos = pendentes.filter(u => (u.dias ?? 0) >= 30).length;

    const opcao = (campo, v, rotulo) => `<option value="${v}"${estado[campo] === v ? ' selected' : ''}>${rotulo}</option>`;

    alvo.innerHTML = `
        <div class="painel-alerta beta">
            <b>Beta.</b> Cada equipamento (rastreador, kit ou teclado) enviado em ${TIPOS_COM_RETORNO.map(tp => `${tp} (${ROTULO_TIPO[tp]})`).join(', ')}
            conta como uma unidade que deve voltar. Marque "Recebido" quando ela chegar. É uma estimativa: confira antes de cobrar alguém.
            ${semTabela ? '<br>⚠ Para marcar recebidos, rode o <code>sql/datas_retornos.sql</code> no SQL Editor do Supabase.' : ''}
        </div>

        <div class="painel-tiles retornos-tiles">
            <div class="painel-tile hero"><div class="painel-tile-rotulo">Aguardando retorno</div>
                <div class="painel-tile-valor">${pendentes.length}</div>
                <div class="painel-explica">Unidades enviadas que ainda não voltaram (envios ${estado.meses ? `dos últimos ${estado.meses} meses` : 'de qualquer data'}).</div></div>
            ${porTipo.map(x => `<div class="painel-tile"><div class="painel-tile-rotulo">${x.tp} · ${ROTULO_TIPO[x.tp]}</div>
                <div class="painel-tile-valor">${x.n}</div><div class="painel-explica">pendentes</div></div>`).join('')}
            <div class="painel-tile"><div class="painel-tile-rotulo">Há 30 dias ou mais</div>
                <div class="painel-tile-valor">${antigos}</div><div class="painel-explica">pendentes despachados há 30+ dias</div></div>
        </div>

        <div class="painel-filtros">
            <select class="kanban-filtro" onchange="retornosFiltro('agrupar', this.value)" title="Agrupar">
                ${opcao('agrupar', 'tecnico', 'Por técnico')}${opcao('agrupar', 'unidade', 'Por unidade')}
            </select>
            <select class="kanban-filtro" onchange="retornosFiltro('mostrar', this.value)" title="Mostrar">
                ${opcao('mostrar', 'pendentes', 'Só pendentes')}${opcao('mostrar', 'recebidos', 'Só recebidos')}${opcao('mostrar', 'todos', 'Pendentes e recebidos')}
            </select>
            <select class="kanban-filtro" onchange="retornosFiltro('tipo', this.value)" title="Tipo">
                ${opcao('tipo', '', 'Todos os tipos')}${TIPOS_COM_RETORNO.map(tp => opcao('tipo', tp, `${tp} · ${ROTULO_TIPO[tp]}`)).join('')}
            </select>
            <select class="kanban-filtro" onchange="retornosFiltro('meses', this.value, true)" title="Envios despachados nos últimos">
                ${opcao('meses', '3', 'Últimos 3 meses')}${opcao('meses', '6', 'Últimos 6 meses')}${opcao('meses', '12', 'Últimos 12 meses')}${opcao('meses', '', 'Qualquer data')}
            </select>
            <input type="text" class="retornos-busca" placeholder="Buscar técnico, unidade, IMEI, OS..." value="${escapeHtml(estado.busca)}"
                oninput="retornosBusca(this)">
        </div>

        ${ordenados.length ? `<div class="retornos-grupos">${ordenados.map(g => grupoHtml(g, semTabela)).join('')}</div>`
            : '<div class="empty-state">Nada para mostrar com estes filtros.</div>'}`;
}

function grupoHtml(g, semTabela) {
    const aberto = estado.abertos.has(g.nome);
    return `<details class="retornos-grupo"${aberto ? ' open' : ''} data-grupo="${escapeHtml(g.nome)}" ontoggle="retornosAbrir(this)">
        <summary>
            <span class="retornos-nome">${escapeHtml(g.nome)}</span>
            <span class="retornos-resumo">${g.pend ? `<b>${g.pend}</b> pendente(s)${g.maisAntigo ? ` · mais antigo há ${g.maisAntigo} dias` : ''}` : '✓ nada pendente'}
                ${g.lista.length > g.pend ? ` · ${g.lista.length - g.pend} recebido(s)` : ''}</span>
        </summary>
        <table class="data-table retornos-tabela"><thead><tr>
            <th>Envio</th><th>Despacho</th><th>Tipo</th><th>${estado.agrupar === 'tecnico' ? 'Unidade' : 'Técnico'}</th><th>Equipamento</th><th>IMEI</th><th>Situação</th>
        </tr></thead><tbody>${g.lista.map(u => `<tr>
            <td><a href="#" onclick="event.preventDefault(); retornosVerEnvio('${u.envio.id}')">${escapeHtml(u.envio.referencia || 'sem referência')}</a></td>
            <td class="col-date">${u.envio.despachado_em ? new Date(u.envio.despachado_em).toLocaleDateString('pt-BR') : '—'}${u.dias != null && !u.retorno ? `<br><small class="${u.dias >= 30 ? 'texto-alerta' : ''}">há ${u.dias} dias</small>` : ''}</td>
            <td><span class="visao-tipo">${escapeHtml(u.envio.tipo)}</span></td>
            <td>${escapeHtml(estado.agrupar === 'tecnico' ? u.unidade : u.tecnico)}</td>
            <td>${escapeHtml(u.desc)}</td>
            <td class="mono">${escapeHtml(u.numero) || '<span class="visao-vazio">sem IMEI</span>'}</td>
            <td>${u.retorno
                ? `<span class="data-selo ok">✓ recebido ${new Date(u.retorno.recebido_em).toLocaleDateString('pt-BR')}</span>${u.retorno.obs ? `<div class="painel-lista-sub">${escapeHtml(u.retorno.obs)}</div>` : ''}
                   ${semTabela ? '' : `<button class="link-btn" onclick="retornosDesfazer('${u.retorno.id}')">desfazer</button>`}`
                : semTabela ? '<span class="data-selo pendente">pendente</span>'
                : `<button class="btn-sm btn-neutral" onclick="retornosMarcar('${u.envio.id}', '${escapeHtml(u.chave)}')">Recebido</button>`}</td>
        </tr>`).join('')}</tbody></table>
    </details>`;
}

// --- Ações ---
let esperaBusca = null;
window.retornosBusca = input => {
    estado.busca = input.value;
    clearTimeout(esperaBusca);
    esperaBusca = setTimeout(() => {
        const pos = input.selectionStart;
        desenhar();
        const novo = alvo.querySelector('.retornos-busca');
        novo?.focus();
        novo?.setSelectionRange(pos, pos);
    }, 250);
};
window.retornosFiltro = async (campo, valor, recarregar = false) => {
    estado[campo] = valor;
    if (recarregar) await renderRetornos(alvo);
    else desenhar();
};
window.retornosAbrir = el => {
    if (el.open) estado.abertos.add(el.dataset.grupo); else estado.abertos.delete(el.dataset.grupo);
};
window.retornosVerEnvio = id => abrirVisualizacaoEnvio(id);

window.retornosMarcar = async (historicoId, chave) => {
    const u = unidades().find(x => String(x.envio.id) === String(historicoId) && x.chave === chave);
    if (!u) return;
    const v = await pedirCampos({
        titulo: 'Retorno recebido',
        mensagem: `${u.desc}${u.numero ? ` · IMEI ${u.numero}` : ''}\nEnviado para ${u.tecnico} (${u.envio.referencia || 'sem referência'}).`,
        sim: 'Marcar recebido',
        campos: [
            { nome: 'data', rotulo: 'Recebido em', tipo: 'date', valor: hojeInput(), max: hojeInput() },
            { nome: 'obs', rotulo: 'Observação (opcional)', placeholder: 'Ex: voltou o IMEI 8612... no lugar' }
        ],
        validar: x => { const p = problemaData(x.data, { rotulo: 'A data' }); return p ? { campo: 'data', mensagem: p } : null; }
    });
    if (!v) return;
    const r = await registrarRetorno({ historico_id: historicoId, chave, recebido_em: deInput(v.data), obs: v.obs });
    if (!r) { toast('Não foi possível registrar o retorno.', 'error'); return; }
    cache.retornos = [...(cache.retornos || []).filter(x => x.id !== r.id), r];
    desenhar();
    toast('Retorno registrado.');
};

window.retornosDesfazer = async id => {
    const ok = await confirmar({ titulo: 'Desfazer o retorno?', mensagem: 'A unidade volta a aparecer como pendente.', sim: 'Desfazer', nao: 'Manter' });
    if (!ok) return;
    if (!(await desfazerRetorno(id))) { toast('Não foi possível desfazer.', 'error'); return; }
    cache.retornos = (cache.retornos || []).filter(x => String(x.id) !== String(id));
    desenhar();
};
