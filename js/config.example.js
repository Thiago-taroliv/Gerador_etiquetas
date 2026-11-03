export const SUPABASE_URL = 'SUA_URL_AQUI';
export const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANONIMA_AQUI';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


export const AppState = {
    formData: null,
    selectedDocType: null,
    emailBody: null
};

export function $(id) {
    return document.getElementById(id);
}

export function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
