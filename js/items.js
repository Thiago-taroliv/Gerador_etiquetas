import { supabaseClient, escapeHtml } from './config.js';

// Lista padrão de items
const DEFAULT_ITEMS = [
    'KIT RA24',
    'TECLADO RA24',
    'RASTREADOR RA24',
    'SENSOR DE COLISÃO RA24',
    'CONVERSOR',
    'TECLADO RA23',
    'RASTREADOR RA23',
    'RASTREADOR RA22',
    'CHICOTE C1',
    'CHICOTE C2',
    'CHICOTE C3',
    'CHICOTE C4',
    'CHICOTE RA23',
    'TECLADO NIATRON',
    'ST340UR',
    'ST340US',
    'RASTREADOR RST',
    'LEITOR RFID',
    'SENSOR DE TEMPERATURA',
    'CHIP'
];

// Estado local de items
let cachedItems = [];

// Inicializar items do banco ou com padrão
export async function initializeItems() {
    const { data, error } = await supabaseClient
        .from('items')
        .select('nome')
        .order('nome', { ascending: true });

    if (!error && data && data.length > 0) {
        cachedItems = data.map(item => item.nome);
        return;
    }
    if (error) {
        console.error('Erro ao buscar items, usando lista padrão:', error.message);
    } else {
        // Tabela vazia: grava a lista padrão no banco para que adições futuras não a "apaguem"
        const { error: seedError } = await supabaseClient
            .from('items')
            .insert(DEFAULT_ITEMS.map(nome => ({ nome })));
        if (seedError) console.error('Erro ao gravar items padrão:', seedError.message);
    }

    cachedItems = [...DEFAULT_ITEMS];
}

// Obter todos os items
export function getItems() {
    return [...cachedItems];
}

// Adicionar novo item (salvar no banco)
export async function addItem(nome) {
    if (!nome || nome.trim() === '') return false;

    const upperName = nome.toUpperCase().trim();

    // Evitar duplicatas local
    if (cachedItems.includes(upperName)) return false;

    const { error } = await supabaseClient
        .from('items')
        .insert([{ nome: upperName }]);

    if (error) {
        console.error('Erro ao adicionar item:', error.message);
        return false;
    }

    // Adicionar ao cache local
    cachedItems.push(upperName);
    cachedItems.sort();

    return true;
}

// Deletar item
export async function deleteItem(nome) {
    const upperName = nome.toUpperCase().trim();

    const { error } = await supabaseClient
        .from('items')
        .delete()
        .eq('nome', upperName);

    if (error) {
        console.error('Erro ao deletar item:', error.message);
        return false;
    }

    // Remover do cache
    cachedItems = cachedItems.filter(item => item !== upperName);

    return true;
}

// Buscar items por substring para autocomplete
export function searchItems(query) {
    if (!query || query.trim() === '') return [];

    const q = query.toUpperCase().trim();
    return cachedItems.filter(item => item.includes(q));
}

// Renderizar dropdown de autocomplete
export function renderItemsDropdown(container, query, onSelect) {
    container.innerHTML = '';

    const results = searchItems(query);
    const limitedResults = results.slice(0, 8); // Limitar a 8 sugestões

    if (limitedResults.length === 0) {
        const noResults = document.createElement('div');
        noResults.style.cssText = 'padding:8px;color:#999;font-size:12px;';
        noResults.textContent = 'Sem resultados. Pressione ENTER para criar novo item.';
        container.appendChild(noResults);
        return;
    }

    limitedResults.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'padding:8px;cursor:pointer;background:#fff;border-bottom:1px solid #eee;font-size:12px;';
        div.textContent = item;
        div.onclick = () => onSelect(item);
        div.onmouseenter = () => div.style.backgroundColor = '#f0f0f0';
        div.onmouseleave = () => div.style.backgroundColor = '#fff';
        container.appendChild(div);
    });
}

// Renderizar lista de todos os items com CRUD
export function renderItemsCRUD(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = getItems();

    let html = `
        <div style="display:flex;gap:8px;align-items:flex-end;margin-top:12px;">
            <input type="text" id="new_item_input" placeholder="Digite novo item..."
                onkeydown="if(event.key==='Enter') window.addNewItem_global()">
            <button onclick="window.addNewItem_global()" style="margin:0;white-space:nowrap;">+ Adicionar</button>
        </div>
        <div class="small">${items.length} item(ns) cadastrado(s)</div>
        <div class="list-box">
    `;

    if (items.length === 0) {
        html += '<div class="empty-state">Nenhum item cadastrado</div>';
    } else {
        items.forEach(item => {
            html += `
                <div class="list-row" style="padding:8px 16px;">
                    <span style="font-size:13px;">${escapeHtml(item)}</span>
                    <button class="btn-sm btn-danger" data-item="${escapeHtml(item)}" onclick="window.deleteItem_global(this.dataset.item)">Deletar</button>
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;
}

// Função global para adicionar item (chamada do botão HTML)
window.addNewItem_global = async function() {
    const input = document.getElementById('new_item_input');
    if (!input) return;

    const nome = input.value.trim();
    if (!nome) {
        alert('Digite o nome do item');
        return;
    }

    const success = await addItem(nome);
    if (success) {
        input.value = '';
        // Renderizar novamente
        if (window.renderItemsCRUD_fn) {
            window.renderItemsCRUD_fn('items_list');
        }
    } else {
        alert('Item já existe ou erro ao adicionar');
    }
};

// Função global para deletar item
window.deleteItem_global = async function(nome) {
    if (!confirm(`Deletar "${nome}"?`)) return;

    const success = await deleteItem(nome);
    if (success) {
        // Renderizar novamente
        if (window.renderItemsCRUD_fn) {
            window.renderItemsCRUD_fn('items_list');
        }
    } else {
        alert('Erro ao deletar item');
    }
};

// Exportar função para reutilizar
window.renderItemsCRUD_fn = renderItemsCRUD;
