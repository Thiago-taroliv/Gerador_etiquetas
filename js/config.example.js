export const SUPABASE_URL = 'SUA_URL_AQUI';
export const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANONIMA_AQUI';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const SENDERS = {
    ranor: { company: 'Ranor Rastreamento', cnpj: '10.980.591/0001-64', address: 'Coronel João de Barros, 427B \n 37900-049 - Centro, Passos-MG' },
    nortrack: { company: 'NORTRACK OPERAÇÕES LTDA', cnpj: '58.231.979/0001-99', address: 'R JULIETA FILIPINI,47, SALA 01 \n 06030-510 – UMUARAMA, OSASCO – SP' }
};

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
