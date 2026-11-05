// Notificações rápidas no canto da tela, só para o que deu certo ou para ofertas com botão.
// Avisos e erros precisam ser lidos: viram modal (dialogo.js).
import { avisar } from './dialogo.js';

let container = null;

const TITULOS = { warning: 'Atenção', error: 'Não foi possível concluir' };

// acao (opcional): { label, onClick } — mostra um botão no toast, ex. "Pedir PIX do frete"
export function toast(msg, tipo = 'success', ms = 3000, acao = null) {
    if (TITULOS[tipo] && !acao) {
        avisar({ titulo: TITULOS[tipo], mensagem: msg, tipo: tipo === 'error' ? 'erro' : 'aviso' });
        return;
    }
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    // A mesma mensagem repetida não empilha: a nova ocupa o lugar da anterior
    [...container.children].find(t => t.dataset.msg === msg)?.remove();
    const el = document.createElement('div');
    el.dataset.msg = msg;
    el.className = `toast toast-${tipo}`;
    el.textContent = msg;
    container.appendChild(el);

    const fechar = () => {
        el.classList.add('toast-hide');
        setTimeout(() => el.remove(), 300);
    };

    if (acao) {
        const btn = document.createElement('button');
        btn.className = 'toast-acao';
        btn.textContent = acao.label;
        btn.onclick = () => { fechar(); acao.onClick(); };
        el.appendChild(btn);
    }

    setTimeout(fechar, ms);
}

window.toast = toast;
