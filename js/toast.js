// Notificações rápidas no canto da tela (substituem alert() de sucesso/aviso)
let container = null;

export function toast(msg, tipo = 'success', ms = 3000) {
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = msg;
    container.appendChild(el);

    setTimeout(() => {
        el.classList.add('toast-hide');
        setTimeout(() => el.remove(), 300);
    }, ms);
}

window.toast = toast;
