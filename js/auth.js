import { supabaseClient, $ } from './config.js';
import { carregarDestinatarios, popularSelectDestinatarios } from './db.js';
import { initializeItems, renderItemsCRUD } from './items.js';
import { desligarTempoReal } from './kanban.js';
import { carregarConfiguracoes, config } from './configuracoes.js';
import { popularSelectRemetentes, onSenderChange, formularioAlterado } from './ui.js';
import { confirmar } from './dialogo.js';
import { toast } from './toast.js';

export async function checkSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session) {
        $('auth_container').style.display = 'none';
        $('app_content').style.display = 'block';
        // Configurações antes do kanban (prazos de atraso) e do formulário (remetentes, transportadora)
        await carregarConfiguracoes();
        popularSelectRemetentes();
        onSenderChange();
        if (!$('carrier').value.trim() || $('carrier').value === 'Jadlog') $('carrier').value = config('transportadora_padrao');
        carregarDestinatarios();
        // Items só podem ser lidos depois do login (RLS)
        initializeItems().then(() => renderItemsCRUD('items_list'));
        // Abre na aba principal (Pedidos), que carrega o kanban
        window.switchTab?.('tab-pedidos');
    } else {
        $('auth_container').style.display = 'flex';
        $('app_content').style.display = 'none';
        popularSelectDestinatarios([]); 
    }
}

export async function handleLogin() {
    const email = $('login_email').value;
    const password = $('login_password').value;
    const errorMsg = $('login_error');
    errorMsg.style.display = 'none';
    
    if(!email || !password) {
        errorMsg.innerText = "Preencha e-mail e senha.";
        errorMsg.style.display = 'block';
        return;
    }

    const btn = $('btn_login_submit');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = 'Entrar no Sistema';

    if (error) {
        if (error.message.includes('Invalid login credentials')) {
            errorMsg.innerText = "E-mail ou senha incorretos.";
        } else {
            errorMsg.innerText = "Erro: " + error.message;
        }
        errorMsg.style.display = 'block';
    } else {
        checkSession();
    }
}

export async function handleLogout() {
    if (formularioAlterado()) {
        const sair = await confirmar({
            titulo: 'Sair sem salvar?',
            mensagem: 'O formulário tem alterações que ainda não foram salvas e elas podem ser perdidas.',
            tipo: 'aviso',
            sim: 'Sair mesmo assim',
            nao: 'Continuar aqui'
        });
        if (!sair) return;
    }
    desligarTempoReal();
    const { error } = await supabaseClient.auth.signOut();
    if(error) toast('Erro ao sair: ' + error.message, 'error');
    else checkSession();
}

// Enter nos campos de login envia o formulário
['login_email', 'login_password'].forEach(id => {
    $(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
});

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') checkSession();
});
