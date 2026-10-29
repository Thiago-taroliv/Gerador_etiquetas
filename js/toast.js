// Notificações rápidas no canto da tela (substituem alert() de sucesso/aviso)
let container = null;

// acao (opcional): { label, onClick } — mostra um botão no toast, ex. "Desfazer"
export function toast(msg, tipo = 'success', ms = 3000, acao = null) {
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
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
