import { supabaseClient, $ } from './config.js';
import { carregarDestinatarios, popularSelectDestinatarios } from './db.js';

export async function checkSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session) {
        $('auth_container').style.display = 'none';
        $('app_content').style.display = 'block';
        carregarDestinatarios(); 
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

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

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
    const { error } = await supabaseClient.auth.signOut();
    if(error) alert("Erro ao sair: " + error.message);
    else checkSession();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') checkSession();
});
