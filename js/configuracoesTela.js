// Tela Gerenciar Dados > Configurações: um cartão por configuração (salvar / restaurar padrão)
// e as receitas de kit. Os valores ficam em js/configuracoes.js e js/kitReceitas.js.
import { $, escapeHtml } from './config.js';
import { config, PADROES, infoConfiguracao, salvarConfiguracao, restaurarPadrao, configuracoesNoBanco, carregarConfiguracoes } from './configuracoes.js';
import { carregarReceitas, salvarReceita, excluirReceita, receitasSalvasNoBanco } from './kitReceitas.js';
import { popularSelectRemetentes, onSenderChange, validarDoc } from './ui.js';
import { FASES } from './db.js';
import { TIPOS } from './planilha.js';
import { toast } from './toast.js';

const clonar = v => JSON.parse(JSON.stringify(v));
let edicao = {};    // chave -> valor sendo editado
let receitas = [];

const rotuloFase = f => FASES.find(x => x.chave === f)?.rotulo || f;
const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Cada cartão: título, explicação, campos (a partir de edicao[chave]) e validação antes de salvar
const CARTOES = {
    financeiro_emails: {
        titulo: 'E-mails do financeiro',
        ajuda: 'Recebem o pedido de nota fiscal. Um e-mail por linha.',
        campos: v => `<textarea rows="3" oninput="cfgValor('financeiro_emails', this.value.split(/\\n/))">${escapeHtml(v.join('\n'))}</textarea>`,
        limpar: v => v.map(e => e.trim()).filter(Boolean),
        validar: v => !v.length ? 'Informe pelo menos um e-mail.' : v.find(e => !emailValido(e)) ? `E-mail inválido: ${v.find(e => !emailValido(e))}` : null
    },
    remetentes: {
        titulo: 'Remetentes',
        ajuda: 'Opções de "Selecionar remetente" no formulário. O marcado como padrão vem preenchido no Novo envio e nos envios importados do estoque. Rascunhos já salvos não mudam.',
        campos: v => `${v.map((r, i) => `
            <div class="cfg-bloco">
                <div class="cfg-linha">
                    <input type="text" placeholder="Empresa" value="${escapeHtml(r.company)}" oninput="cfgCampo('remetentes', ${i}, 'company', this.value)">
                    <input type="text" placeholder="CNPJ" value="${escapeHtml(r.cnpj)}" oninput="cfgCampo('remetentes', ${i}, 'cnpj', this.value)" style="max-width:200px">
                </div>
                <textarea rows="2" placeholder="Endereço (2 linhas)" oninput="cfgCampo('remetentes', ${i}, 'address', this.value)">${escapeHtml(String(r.address || '').replace(/ ?\n ?/g, '\n'))}</textarea>
                <div class="cfg-linha">
                    <label class="cfg-check"><input type="radio" name="cfg_rem_padrao" ${r.padrao ? 'checked' : ''} onchange="cfgPadraoRemetente(${i})"> Padrão</label>
                    <span style="flex:1"></span>
                    <button type="button" class="btn-sm btn-neutral" onclick="cfgRemover('remetentes', ${i})">Remover</button>
                </div>
            </div>`).join('')}
            <button type="button" class="btn-sm btn-neutral" onclick="cfgAdicionar('remetentes')">+ Remetente</button>`,
        novo: () => ({ id: '', company: '', cnpj: '', address: '' }),
        limpar: v => v.map(r => ({
            ...r,
            id: r.id || String(r.company).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'remetente',
            company: r.company.trim(), cnpj: r.cnpj.trim(),
            // Mesmo formato de antes: " \n " entre as linhas do endereço
            address: String(r.address || '').split('\n').map(l => l.trim()).filter(Boolean).join(' \n ')
        })).filter(r => r.company),
        validar: v => {
            if (!v.length) return 'Cadastre pelo menos um remetente.';
            const ruim = v.find(r => !validarDoc(r.cnpj));
            if (ruim) return `CNPJ inválido em "${ruim.company}".`;
            const ids = v.map(r => r.id);
            if (new Set(ids).size < ids.length) return 'Dois remetentes com o mesmo nome.';
            return null;
        },
        depois: () => { popularSelectRemetentes(); onSenderChange(); }
    },
    motivo_tipo: {
        titulo: 'Motivo → Tipo',
        ajuda: 'Tipo da planilha de envio a partir do MOTIVO da planilha de estoque: vale a primeira regra em que o motivo começa com o texto (sem diferenciar acento e maiúsculas).',
        campos: v => `${v.map((r, i) => `
            <div class="cfg-linha">
                <input type="text" placeholder="Motivo começa com..." value="${escapeHtml(r.comeca)}" oninput="cfgCampo('motivo_tipo', ${i}, 'comeca', this.value)">
                <select onchange="cfgCampo('motivo_tipo', ${i}, 'tipo', this.value)" style="max-width:100px">
                    ${TIPOS.map(t => `<option${t === r.tipo ? ' selected' : ''}>${t}</option>`).join('')}
                </select>
                <button type="button" class="btn-sm btn-neutral" onclick="cfgRemover('motivo_tipo', ${i})">✕</button>
            </div>`).join('')}
            <button type="button" class="btn-sm btn-neutral" onclick="cfgAdicionar('motivo_tipo')">+ Regra</button>`,
        novo: () => ({ comeca: '', tipo: TIPOS[0] }),
        limpar: v => v.map(r => ({ comeca: r.comeca.trim(), tipo: r.tipo })).filter(r => r.comeca),
        validar: v => v.find(r => !TIPOS.includes(r.tipo)) ? 'Tipo inválido.' : null
    },
    kanban_atraso: {
        titulo: 'Prazos de atraso do kanban',
        ajuda: 'Dias parado na fase até o card ficar amarelo e vermelho.',
        campos: v => Object.entries(v).map(([fase, [amarelo, vermelho]]) => `
            <div class="cfg-linha">
                <span class="cfg-rotulo">${escapeHtml(rotuloFase(fase))}</span>
                amarelo <input type="number" min="0" value="${amarelo}" oninput="cfgPrazo('${fase}', 0, this.value)" style="width:70px">
                vermelho <input type="number" min="0" value="${vermelho}" oninput="cfgPrazo('${fase}', 1, this.value)" style="width:70px">
            </div>`).join(''),
        limpar: v => v,
        validar: v => {
            const ruim = Object.entries(v).find(([, [a, b]]) => !(a >= 0) || !(b > a));
            return ruim ? `${rotuloFase(ruim[0])}: o vermelho precisa ser maior que o amarelo.` : null;
        }
    },
    juncao_dias: {
        titulo: 'Janela da junção de pedidos',
        ajuda: 'Pedidos do mesmo técnico criados ou mexidos nestes últimos dias são oferecidos para juntar.',
        campos: v => `<div class="cfg-linha"><input type="number" min="1" value="${v}" oninput="cfgValor('juncao_dias', parseInt(this.value))" style="width:90px"> dias</div>`,
        limpar: v => v,
        validar: v => v >= 1 ? null : 'Informe pelo menos 1 dia.'
    },
    transportadora_padrao: {
        titulo: 'Transportadora padrão',
        ajuda: 'Vem preenchida no Novo envio.',
        campos: v => `<input type="text" value="${escapeHtml(v)}" oninput="cfgValor('transportadora_padrao', this.value)">`,
        limpar: v => String(v || '').trim(),
        validar: v => v ? null : 'Informe a transportadora.'
    },
    email_textos: {
        titulo: 'Textos do e-mail ao financeiro',
        ajuda: 'Começo do assunto (a referência vem depois) e a saudação. O resto do e-mail é montado pelo sistema, e cada e-mail ainda pode ser editado antes de enviar.',
        campos: v => `
            <label>Assunto</label>
            <input type="text" value="${escapeHtml(v.assunto)}" oninput="cfgCampo('email_textos', null, 'assunto', this.value)">
            <label>Saudação</label>
            <input type="text" value="${escapeHtml(v.saudacao)}" oninput="cfgCampo('email_textos', null, 'saudacao', this.value)">`,
        limpar: v => ({ assunto: v.assunto.trim(), saudacao: v.saudacao.trim() }),
        validar: v => v.assunto && v.saudacao ? null : 'Preencha o assunto e a saudação.'
    },
    veiculos_telefone: {
        titulo: 'Planilha de veículos: telefone do chip',
        ajuda: 'Valor da coluna Chip_Telefone nas "Linhas p/ Veículos".',
        campos: v => `<input type="text" value="${escapeHtml(v)}" oninput="cfgValor('veiculos_telefone', this.value)">`,
        limpar: v => String(v || '').trim(),
        validar: v => v ? null : 'Informe o telefone.'
    },
    plataforma_clientes: {
        titulo: 'Planilha de veículos: cliente na plataforma',
        ajuda: 'Nome do cliente na plataforma para cada Cliente/Unidade do pedido. É preenchido sozinho quando você corrige o nome na prévia das "Linhas p/ Veículos".',
        campos: v => `${v.length ? '' : '<div class="small">Nenhum nome guardado ainda.</div>'}${v.map((r, i) => `
            <div class="cfg-linha">
                <input type="text" placeholder="Cliente/Unidade do pedido" value="${escapeHtml(r.unidade)}" oninput="cfgCampo('plataforma_clientes', ${i}, 'unidade', this.value)">
                →
                <input type="text" placeholder="Nome na plataforma" value="${escapeHtml(r.cliente)}" oninput="cfgCampo('plataforma_clientes', ${i}, 'cliente', this.value)">
                <button type="button" class="btn-sm btn-neutral" onclick="cfgRemover('plataforma_clientes', ${i})">✕</button>
            </div>`).join('')}
            <button type="button" class="btn-sm btn-neutral" onclick="cfgAdicionar('plataforma_clientes')">+ Cliente</button>`,
        novo: () => ({ unidade: '', cliente: '' }),
        limpar: v => v.map(r => ({ unidade: r.unidade.trim(), cliente: r.cliente.trim() })).filter(r => r.unidade && r.cliente),
        validar: () => null
    }
};

export async function renderConfiguracoes() {
    const el = $('config_conteudo');
    if (!el) return;
    el.innerHTML = '<div class="empty-state">Carregando...</div>';
    await carregarConfiguracoes();
    receitas = await carregarReceitas(true);
    edicao = Object.fromEntries(Object.keys(CARTOES).map(k => [k, clonar(config(k))]));
    render();
}

function render() {
    const el = $('config_conteudo');
    const aviso = configuracoesNoBanco() ? ''
        : '<div class="estoque-aviso">⚠ Tabela de configurações não encontrada: rode o sql/configuracoes.sql no Supabase para salvar. Até lá valem os padrões.</div>';
    el.innerHTML = aviso + Object.keys(CARTOES).map(cartaoHtml).join('') + receitasHtml();
}

function cartaoHtml(chave) {
    const c = CARTOES[chave];
    const info = infoConfiguracao(chave);
    const quando = info?.atualizado_em ? new Date(info.atualizado_em).toLocaleDateString('pt-BR') : '';
    return `<fieldset class="cfg-cartao" id="cfg_${chave}">
        <legend>${escapeHtml(c.titulo)}</legend>
        <div class="small">${escapeHtml(c.ajuda)}</div>
        <div class="cfg-campos">${c.campos(edicao[chave])}</div>
        <div class="cfg-rodape">
            <span class="small">${info ? `Alterado${info.atualizado_por ? ` por ${escapeHtml(info.atualizado_por)}` : ''}${quando ? ` em ${quando}` : ''}` : 'Usando o padrão do sistema'}</span>
            <span style="flex:1"></span>
            ${info ? `<button type="button" class="btn-sm btn-neutral" onclick="cfgRestaurar('${chave}')">Restaurar padrão</button>` : ''}
            <button type="button" class="btn-sm" onclick="cfgSalvar('${chave}', this)">Salvar</button>
        </div>
    </fieldset>`;
}

// Refaz só um cartão (depois de adicionar/remover linhas), sem perder o que foi digitado nos outros
function renderCartao(chave) {
    const atual = document.getElementById(`cfg_${chave}`);
    if (atual) atual.outerHTML = cartaoHtml(chave);
}

window.cfgValor = (chave, v) => { edicao[chave] = v; };
window.cfgCampo = (chave, i, campo, v) => {
    if (i === null) edicao[chave][campo] = v;
    else edicao[chave][i][campo] = v;
};
window.cfgPrazo = (fase, pos, v) => { edicao.kanban_atraso[fase][pos] = parseInt(v); };
window.cfgPadraoRemetente = i => { edicao.remetentes.forEach((r, j) => { r.padrao = j === i; }); };
window.cfgAdicionar = chave => { edicao[chave].push(CARTOES[chave].novo()); renderCartao(chave); };
window.cfgRemover = (chave, i) => { edicao[chave].splice(i, 1); renderCartao(chave); };

window.cfgSalvar = async function (chave, btn) {
    const c = CARTOES[chave];
    const valor = c.limpar(clonar(edicao[chave]));
    const erro = c.validar(valor);
    if (erro) { toast(erro, 'warning'); return; }
    if (chave === 'remetentes' && !valor.some(r => r.padrao)) valor[0].padrao = true;
    btn.disabled = true;
    const ok = await salvarConfiguracao(chave, valor);
    btn.disabled = false;
    if (!ok) { toast('Não foi possível salvar. Confira se o sql/configuracoes.sql foi rodado.', 'error'); return; }
    edicao[chave] = clonar(valor);
    c.depois?.();
    toast(`${c.titulo}: salvo.`);
    renderCartao(chave);
};

window.cfgRestaurar = async function (chave) {
    const c = CARTOES[chave];
    if (!confirm(`Voltar "${c.titulo}" ao padrão do sistema?`)) return;
    if (!(await restaurarPadrao(chave))) { toast('Não foi possível restaurar.', 'error'); return; }
    edicao[chave] = clonar(PADROES[chave]);
    c.depois?.();
    toast(`${c.titulo}: padrão restaurado.`);
    renderCartao(chave);
};

// --- Receitas de kit (tabela kit_receitas) ---
// Componentes editados como texto, um por linha: "2 x LACRE -ADESIVO" (sem número = 1)
const componentesTexto = r => r.componentes.map(c => `${c.qtd} x ${c.nome}`).join('\n');
const lerComponentes = texto => texto.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\s*[xX×]\s*(.+)$/);
    return m ? { qtd: parseInt(m[1]), nome: m[2].trim() } : { qtd: 1, nome: l };
});

function receitasHtml() {
    const salvas = receitasSalvasNoBanco();
    return `<fieldset class="cfg-cartao" id="cfg_receitas">
        <legend>Receitas de kit</legend>
        <div class="small">Itens do romaneio (nome do de-para) e quantos de cada formam 1 kit. Um componente por linha,
            no formato "2 x LACRE -ADESIVO". Usadas na tela "Montar kit", que sempre pede confirmação.</div>
        ${salvas ? '' : '<div class="estoque-aviso">⚠ Tabela de receitas não encontrada: rode o sql/kit.sql no Supabase para salvar.</div>'}
        ${receitas.map((r, i) => `
            <div class="cfg-bloco" data-receita="${i}">
                <div class="cfg-linha">
                    <input type="text" class="cfg-receita-nome" value="${escapeHtml(r.nome)}" placeholder="Nome do kit (ex. KIT RA24)">
                </div>
                <textarea rows="${Math.max(3, r.componentes.length)}" class="cfg-receita-comp">${escapeHtml(componentesTexto(r))}</textarea>
                <div class="cfg-linha">
                    ${r.id ? '' : '<span class="small">Padrão do sistema (ainda não salva)</span>'}
                    <span style="flex:1"></span>
                    ${r.id ? `<button type="button" class="btn-sm btn-neutral" onclick="cfgExcluirReceita(${i})">Excluir</button>` : ''}
                    <button type="button" class="btn-sm" onclick="cfgSalvarReceita(${i}, this)">Salvar</button>
                </div>
            </div>`).join('')}
        <button type="button" class="btn-sm btn-neutral" onclick="cfgNovaReceita()">+ Nova receita</button>
    </fieldset>`;
}

const renderReceitas = () => { document.getElementById('cfg_receitas').outerHTML = receitasHtml(); };

window.cfgNovaReceita = () => { receitas.push({ nome: '', componentes: [] }); renderReceitas(); };

window.cfgSalvarReceita = async function (i, btn) {
    const bloco = document.querySelector(`[data-receita="${i}"]`);
    const nome = bloco.querySelector('.cfg-receita-nome').value.trim();
    const componentes = lerComponentes(bloco.querySelector('.cfg-receita-comp').value);
    if (!nome || !componentes.length) { toast('Dê um nome ao kit e pelo menos um componente.', 'warning'); return; }
    // Renomear = salvar com o nome novo e apagar o antigo
    const antigo = receitas[i];
    btn.disabled = true;
    const ok = await salvarReceita({ nome, componentes });
    if (ok && antigo.id && antigo.nome !== nome.toUpperCase()) await excluirReceita(antigo.nome);
    btn.disabled = false;
    if (!ok) { toast('Não foi possível salvar a receita.', 'error'); return; }
    toast('Receita salva.');
    receitas = await carregarReceitas(true);
    renderReceitas();
};

window.cfgExcluirReceita = async function (i) {
    const r = receitas[i];
    if (!r?.id || !confirm(`Excluir a receita "${r.nome}"?`)) return;
    if (!(await excluirReceita(r.nome))) { toast('Não foi possível excluir.', 'error'); return; }
    toast('Receita excluída.');
    receitas = await carregarReceitas(true);
    renderReceitas();
};
