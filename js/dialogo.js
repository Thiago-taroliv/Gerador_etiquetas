// Modais de confirmação, aviso e pergunta (substituem confirm(), alert() e prompt() do navegador).
// Ficam acima de qualquer outro modal; se dois forem pedidos juntos, um espera o outro.

const ICONES = { pergunta: '?', perigo: '!', aviso: '!', erro: '✕', sucesso: '✓' };

let fila = Promise.resolve();

function naFila(opcoes) {
    const resposta = fila.then(() => abrir(opcoes));
    fila = resposta.catch(() => {});
    return resposta;
}

function criar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined) el.textContent = texto;
    return el;
}

// Monta o modal e resolve com valorSim/valores dos campos, ou null/false ao cancelar
function abrir({ titulo, mensagem, detalhe, tipo = 'pergunta', sim = 'OK', nao = null, campos = null, validar = null }) {
    return new Promise(resolve => {
        const overlay = criar('div', 'modal-overlay dialogo-overlay');
        const card = criar('div', `modal-card dialogo-card dialogo-${tipo}`);
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-label', titulo);

        const topo = criar('div', 'dialogo-topo');
        topo.append(criar('span', 'dialogo-icone', ICONES[tipo] || ICONES.pergunta), criar('strong', 'dialogo-titulo', titulo));
        card.appendChild(topo);

        if (mensagem) card.appendChild(criar('p', 'dialogo-mensagem', mensagem));
        if (detalhe) card.appendChild(criar('pre', 'dialogo-detalhe', detalhe));

        const inputs = {};
        (campos || []).forEach(c => {
            const id = `dialogo_campo_${c.nome}`;
            const rotulo = criar('label', 'dialogo-rotulo', c.rotulo);
            rotulo.htmlFor = id;
            const input = criar('input');
            input.id = id;
            input.type = 'text';
            input.autocomplete = 'off';
            input.value = c.valor ?? '';
            input.placeholder = c.placeholder || '';
            input.addEventListener('focus', () => input.select());
            inputs[c.nome] = input;
            card.append(rotulo, input);
            if (c.ajuda) card.appendChild(criar('div', 'dialogo-ajuda', c.ajuda));
        });

        const erro = criar('div', 'dialogo-msg-erro');
        erro.setAttribute('role', 'alert');
        if (campos) card.appendChild(erro);

        const acoes = criar('div', 'modal-actions');
        const botaoSim = criar('button', tipo === 'perigo' ? 'btn-danger' : '', sim);
        botaoSim.type = 'button';
        let botaoNao = null;
        if (nao) {
            botaoNao = criar('button', 'btn-neutral', nao);
            botaoNao.type = 'button';
            acoes.appendChild(botaoNao);
        }
        acoes.appendChild(botaoSim);
        card.appendChild(acoes);
        overlay.appendChild(card);

        // Volta o foco para onde estava, ou para o campo que o código pediu enquanto o modal abria
        let voltarPara = document.activeElement;

        function fechar(valor) {
            document.removeEventListener('keydown', teclado, true);
            document.removeEventListener('focusin', prenderFoco, true);
            overlay.remove();
            if (voltarPara?.isConnected) voltarPara.focus?.();
            resolve(valor);
        }

        const cancelar = () => fechar(campos ? null : false);

        function confirmarResposta() {
            if (!campos) { fechar(true); return; }
            const valores = {};
            campos.forEach(c => { valores[c.nome] = inputs[c.nome].value.trim(); });
            const problema = validar?.(valores);
            if (problema) {
                const mensagemErro = typeof problema === 'string' ? problema : problema.mensagem;
                erro.textContent = mensagemErro;
                erro.style.display = 'block';
                const alvo = (typeof problema === 'object' && inputs[problema.campo]) || inputs[campos[0].nome];
                alvo.focus();
                return;
            }
            fechar(valores);
        }

        function teclado(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation(); // os modais de baixo não fecham junto
                cancelar();
            } else if (e.key === 'Enter') {
                e.stopPropagation();
                if (e.repeat) { e.preventDefault(); return; } // Enter segurado não confirma sozinho
                const ordem = Object.values(inputs);
                const i = ordem.indexOf(e.target);
                if (i < 0) return; // em botão, o Enter clica nele mesmo
                e.preventDefault();
                // Leitor de código de barras termina com Enter: passa ao próximo campo, e o último confirma
                if (i < ordem.length - 1) ordem[i + 1].focus();
                else confirmarResposta();
            } else if (e.key === 'Tab') {
                const focaveis = [...card.querySelectorAll('input, button')];
                const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
                if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
                else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
            }
        }

        function prenderFoco(e) {
            if (card.contains(e.target)) return;
            voltarPara = e.target;
            inicial().focus();
        }

        // Com campos, começa neles; em ação perigosa, o foco fica em "não" para um Enter não apagar nada
        const inicial = () => {
            if (campos) return (campos.find(c => c.focar) ? inputs[campos.find(c => c.focar).nome] : inputs[campos[0].nome]);
            return tipo === 'perigo' && botaoNao ? botaoNao : botaoSim;
        };

        botaoSim.addEventListener('click', confirmarResposta);
        botaoNao?.addEventListener('click', cancelar);
        // Clicar fora só cancela quando não há nada digitado a perder
        if (!campos) overlay.addEventListener('click', e => { if (e.target === overlay) cancelar(); });

        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        document.addEventListener('keydown', teclado, true);
        document.addEventListener('focusin', prenderFoco, true);
        inicial().focus();
    });
}

// Pergunta sim/não. tipo: 'pergunta' | 'aviso' | 'perigo' (botão vermelho). Resolve true/false.
// detalhe: texto em caixa rolável, para resumos longos.
export function confirmar({ titulo, mensagem, detalhe, tipo = 'pergunta', sim = 'Confirmar', nao = 'Cancelar' }) {
    return naFila({ titulo, mensagem, detalhe, tipo, sim, nao });
}

// Aviso com um botão só. tipo: 'aviso' | 'erro' | 'sucesso'.
export function avisar({ titulo, mensagem, detalhe, tipo = 'aviso', sim = 'Entendi' }) {
    return naFila({ titulo, mensagem, detalhe, tipo, sim }).then(() => {});
}

// Pede um ou mais valores. campos: [{ nome, rotulo, valor, placeholder, ajuda, focar }].
// validar(valores): devolve texto (ou { campo, mensagem }) quando há problema; o modal continua aberto.
// Resolve com { nome: valor } já sem espaços nas pontas, ou null se cancelou.
export function pedirCampos({ titulo, mensagem, tipo = 'pergunta', sim = 'Salvar', nao = 'Cancelar', campos, validar }) {
    return naFila({ titulo, mensagem, tipo, sim, nao, campos, validar });
}
