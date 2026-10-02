import { $, escapeHtml, SENDERS } from './config.js';
import { searchItems, getItems, addItem as addItemToDB } from './items.js';
import { toast } from './toast.js';

export function onSenderChange() {
    const v = $('sender_select').value;
    if (v === 'custom') {
        $('sender_company').readOnly = false;
        $('sender_cnpj').readOnly = false;
        $('sender_address').readOnly = false;
        $('sender_company').value = '';
        $('sender_cnpj').value = '';
        $('sender_address').value = '';
    } else {
        const s = SENDERS[v];
        $('sender_company').value = s.company;
        $('sender_cnpj').value = s.cnpj;
        $('sender_address').value = s.address;
        $('sender_company').readOnly = true;
        $('sender_cnpj').readOnly = true;
        $('sender_address').readOnly = true;
    }
}

export function onClientSelect() {
    const idx = $('client_select').value;
    if (idx === '') return;
    const arr = window.__destinatariosSupabase || [];
    const rec = arr[parseInt(idx)];
    if (!rec) return;

    $('dest_name').value = rec.nome || '';
    $('dest_doc').value = rec.cpf_cnpj || '';
    $('dest_addr1').value = rec.endereco_linha1 || '';
    $('dest_addr2').value = rec.endereco_linha2 || '';
    $('dest_phone').value = rec.contato || '';
}

export function addItem() {
    const container = $('items_container');
    const itemIdx = container.children.length;

    const itemCard = document.createElement('div');
    itemCard.className = 'item-card';
    itemCard.dataset.itemIdx = itemIdx;

    const multiMode = document.querySelector('input[name="client_mode"]:checked')?.value === 'multi';

    let clientFieldHTML = '';
    if (multiMode) {
        clientFieldHTML = `
            <div class="item-client">
                <label>Cliente:</label>
                <input class="it-client" type="text" placeholder="Ex: Martin Brower">
            </div>
        `;
    }

    itemCard.innerHTML = `
        <div class="item-row">
            <div class="it-desc-wrap">
                <label>Descrição:</label>
                <input class="it-desc" type="text" value="" placeholder="Comece a digitar...">
                <div class="autocomplete-suggestions" style="display:none;"></div>
            </div>
            <div class="it-qty-wrap">
                <label>Qtd:</label>
                <input class="it-qty" type="number" value="1" min="1">
            </div>
            <button type="button" class="it-remove btn-sm btn-danger" onclick="removeItem(this)" title="Remover item">✕</button>
        </div>
        ${clientFieldHTML}
        <button type="button" class="btn-sm btn-neutral imei-toggle" onclick="toggleIMEISection(this)">+ Adicionar IMEIs</button>
        <div class="it-imei-section" style="display:none;">
            <label style="font-weight:600;">IMEIs/Números Identificadores:</label>
            <div class="small" style="margin-top:2px;">Cole em massa (um por linha ou TAB para kits):</div>
            <textarea class="it-imei-input" placeholder="Cole aqui..."></textarea>
            <div class="imei-actions">
                <button type="button" class="btn-sm btn-success" onclick="procesarIMEIs(this)">Processar IMEIs</button>
                <button type="button" class="btn-sm btn-neutral" onclick="limparIMEIs(this)">Limpar IMEIs</button>
            </div>
            <div class="it-imei-list"></div>
        </div>
    `;

    container.appendChild(itemCard);

    // Adicionar event listeners para autocomplete
    // Busca dentro do próprio card (IDs globais colidiam após remover itens)
    const descInput = itemCard.querySelector('.it-desc');
    const suggestionsDiv = itemCard.querySelector('.autocomplete-suggestions');

    // Índice da sugestão destacada pelas setas (-1 = nenhuma)
    let activeIdx = -1;
    const sugestoes = () => suggestionsDiv.querySelectorAll('.ac-item');
    const destacar = (idx) => {
        const list = sugestoes();
        list.forEach((el, i) => el.classList.toggle('ac-active', i === idx));
        if (list[idx]) list[idx].scrollIntoView({ block: 'nearest' });
        activeIdx = idx;
    };

    descInput.addEventListener('input', function() {
        activeIdx = -1;
        const query = this.value.trim();
        if (query.length === 0) {
            suggestionsDiv.style.display = 'none';
            return;
        }

        const results = searchItems(query);
        if (results.length === 0) {
            suggestionsDiv.innerHTML = '<div style="padding:8px;color:#999;font-size:12px;">Sem resultados. <strong>ENTER</strong> para cadastrar como novo item.</div>';
            suggestionsDiv.style.display = 'block';
            return;
        }

        // mousedown (e não click) para selecionar antes do blur esconder a lista
        suggestionsDiv.innerHTML = results.slice(0, 8).map(item =>
            `<div class="ac-item" onmousedown="event.preventDefault(); selectItemSuggestion(this)" style="padding:8px;cursor:pointer;border-bottom:1px solid #eee;font-size:12px;">${escapeHtml(item)}</div>`
        ).join('');
        suggestionsDiv.style.display = 'block';
    });

    descInput.addEventListener('keydown', async function(e) {
        const aberta = suggestionsDiv.style.display !== 'none';
        const total = sugestoes().length;

        if (e.key === 'ArrowDown' && aberta && total) {
            e.preventDefault();
            destacar((activeIdx + 1) % total);
        } else if (e.key === 'ArrowUp' && aberta && total) {
            e.preventDefault();
            destacar((activeIdx - 1 + total) % total);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (aberta && activeIdx >= 0 && sugestoes()[activeIdx]) {
                window.selectItemSuggestion(sugestoes()[activeIdx]);
            } else {
                const value = this.value.trim();
                // Cadastra como novo item só se ainda não existir
                if (value && !getItems().includes(value.toUpperCase())) {
                    const ok = await addItemToDB(value);
                    if (ok) toast(`Item "${value.toUpperCase()}" cadastrado.`);
                    else toast('Não foi possível cadastrar o item.', 'error');
                }
                suggestionsDiv.style.display = 'none';
            }
            activeIdx = -1;
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
            activeIdx = -1;
        }
    });

    descInput.addEventListener('blur', function() {
        setTimeout(() => {
            suggestionsDiv.style.display = 'none';
        }, 100);
    });
}

export function removeItem(btn) {
    btn.closest('.item-card').remove();
}

export function clearItems() {
    $('items_container').innerHTML = '';
}

export function collectData() {
    const isMultiMode = document.querySelector('input[name="client_mode"]:checked')?.value === 'multi';

    const items = Array.from(document.querySelectorAll('.item-card'))
        .map(card => {
            const desc = card.querySelector('.it-desc')?.value || '';
            const qty = card.querySelector('.it-qty')?.value || '1';
            // Se modo multi, puxar campo 'Client' preenchido no item; modo simples fica vazio
            const client = isMultiMode ? (card.querySelector('.it-client')?.value || '') : '';

            // Coletar IMEIs da seção
            const imeiList = card.querySelector('.it-imei-list');
            const imeis = [];

            if (imeiList) {
                imeiList.querySelectorAll('.imei-item').forEach(item => {
                    const imeiValue = item.dataset.imei;
                    if (imeiValue) {
                        // Verificar se é kit (contém |)
                        if (imeiValue.includes('|')) {
                            const [rastreador, teclado] = imeiValue.split('|');
                            imeis.push({ tipo: 'kit', rastreador, teclado });
                        } else {
                            imeis.push({ tipo: 'simples', imei: imeiValue });
                        }
                    }
                });
            }

            return { desc, qty, client, imeis };
        })
        .filter(it => it.desc.trim() !== '');

    return {
        sender_company: $('sender_company').value || '',
        sender_cnpj: $('sender_cnpj').value || '',
        sender_address: $('sender_address').value || '',
        unit_name: $('unit_name')?.value || '', // Cliente/Unidade (visível no modo simples)
        dest_name: $('dest_name').value || '',
        dest_doc: $('dest_doc').value || '',
        dest_addr1: $('dest_addr1').value || '',
        dest_addr2: $('dest_addr2').value || '',
        dest_phone: $('dest_phone').value || '',
        doc_type: $('doc-selector')?.value || '',
        planilha_cliente: $('planilha_cliente')?.value.trim() || '',
        planilha_tipo: $('planilha_tipo')?.value || '',
        total_vol: Math.max(1, parseInt($('total_vol').value || 1)),
        reference: $('reference').value || '',
        reference_type: $('reference_type')?.value || 'ticket',
        carrier: $('carrier').value || '',
        receiver: $('receiver').value || '',
        client_mode: isMultiMode ? 'multi' : 'single',
        items: items
    };
}

export function preencherFormulario(dados) {
    if (!dados) return;

    // 1. Remetente
    // Encontrar se o remetente é um dos fixos (ranor, nortrack) ou customizado
    let senderKey = 'custom';
    if(dados.sender_cnpj === SENDERS['ranor'].cnpj) senderKey = 'ranor';
    if(dados.sender_cnpj === SENDERS['nortrack'].cnpj) senderKey = 'nortrack';

    $('sender_select').value = senderKey;
    $('sender_company').value = dados.sender_company || '';
    $('sender_cnpj').value = dados.sender_cnpj || '';
    $('sender_address').value = dados.sender_address || '';

    if(senderKey === 'custom') {
        $('sender_company').readOnly = false;
        $('sender_cnpj').readOnly = false;
        $('sender_address').readOnly = false;
    }

    // 2. Destinatário
    $('dest_name').value = dados.dest_name || '';
    $('dest_doc').value = dados.dest_doc || '';
    $('dest_addr1').value = dados.dest_addr1 || '';
    $('dest_addr2').value = dados.dest_addr2 || '';
    $('dest_phone').value = dados.dest_phone || '';

    // 3. Modo de Entrega (Single / Multi)
    const isMultiMode = dados.client_mode === 'multi';
    if(isMultiMode) {
        document.getElementById('client_mode_multi').checked = true;
    } else {
        document.getElementById('client_mode_single').checked = true;
    }

    if($('unit_name')) {
        $('unit_name').value = dados.unit_name || '';
    }

    // 4. Limpar itens atuais e recriar
    const container = $('items_container');
    container.innerHTML = '';

    if (dados.items && dados.items.length > 0) {
        // Toggle Client Mode primeiro para preparar a UI
        try { window.toggleClientMode(); } catch(e){}

        dados.items.forEach(it => {
            // Reutiliza a função addItem para garantir os listeners (autocomplete)
            // IMPORTANTE: precisamos chamar "addItem()" que insere na UI, depois buscar o ultimo inserido e preencher
            window.addItem();
            const cards = container.querySelectorAll('.item-card');
            const lastCard = cards[cards.length - 1];

            if(lastCard) {
                const descInput = lastCard.querySelector('.it-desc');
                if(descInput) descInput.value = it.desc || '';

                const qtyInput = lastCard.querySelector('.it-qty');
                if(qtyInput) qtyInput.value = it.qty || 1;

                if(isMultiMode) {
                    const clientInput = lastCard.querySelector('.it-client');
                    if(clientInput) clientInput.value = it.client || '';
                }

                // Restaurar IMEIs (se existirem)
                if(it.imeis && it.imeis.length > 0) {
                    const imeiSection = lastCard.querySelector('.it-imei-section');
                    if(imeiSection) {
                        imeiSection.style.display = 'block'; // forçar exibição

                        // Forçar readonly e cor
                        qtyInput.readOnly = true;
                        qtyInput.style.backgroundColor = '#e8f4f8';

                        const imeiList = lastCard.querySelector('.it-imei-list');
                        let imeisHtml = '';
                        it.imeis.forEach(imeiObj => {
                            let valA, labelHtml;
                            if(imeiObj.tipo === 'kit') {
                                valA = imeiObj.rastreador + '|' + imeiObj.teclado;
                                labelHtml = '<div>Rastreador: <strong>'+escapeHtml(imeiObj.rastreador)+'</strong> | Teclado: <strong>'+escapeHtml(imeiObj.teclado)+'</strong></div>';
                            } else {
                                valA = imeiObj.imei;
                                labelHtml = '<div>IMEI: <strong>'+escapeHtml(imeiObj.imei)+'</strong></div>';
                            }
                            imeisHtml += '<div class="imei-item" data-imei="'+escapeHtml(valA)+'">'+labelHtml+'</div>';
                        });
                        if(imeiList) imeiList.innerHTML = imeisHtml;
                    }
                }
            }
        });
    } else {
        // Se vazio, adiciona pelo menos 1
        window.addItem();
    }

    // 5. Dados Adicionais
    const refTypeElem = $('reference_type');
    if(refTypeElem) refTypeElem.value = dados.reference_type || 'ticket';

    // Atualiza estado do campo ANTES de preencher, senão o toggle apaga o valor
    try { window.toggleReferenceInput(); } catch(e){}
    $('reference').value = String(dados.reference || '');
    $('total_vol').value = dados.total_vol || 1;
    $('carrier').value = dados.carrier || 'Jadlog';
    $('receiver').value = dados.receiver || '';
    if ($('doc-selector')) $('doc-selector').value = dados.doc_type || '';
    if ($('planilha_cliente')) $('planilha_cliente').value = dados.planilha_cliente || '';
    if ($('planilha_tipo')) $('planilha_tipo').value = dados.planilha_tipo || '';
}

// Volta o formulário ao estado inicial (novo envio)
export function limparFormulario() {
    $('sender_select').value = 'ranor';
    onSenderChange();

    window.filtrarSeletorDestinatarios?.(''); // tira o filtro do seletor
    $('dest_doc').style.borderColor = '';
    ['client_search', 'dest_cep', 'dest_name', 'dest_doc', 'dest_phone', 'dest_addr1', 'dest_addr2', 'unit_name', 'receiver', 'planilha_cliente', 'planilha_tipo'].forEach(id => {
        if ($(id)) $(id).value = '';
    });

    $('client_mode_single').checked = true;
    try { window.toggleClientMode(); } catch(e){}

    $('items_container').innerHTML = '';
    addItem();

    $('reference_type').value = 'ticket';
    try { window.toggleReferenceInput(); } catch(e){}
    $('reference').value = '';
    $('total_vol').value = 1;
    $('carrier').value = 'Jadlog';
    $('doc-selector').value = '';
}

// --- CPF / CNPJ ---
// Aceita CNPJ alfanumérico (Receita Federal, a partir de jul/2026): 12 caracteres [0-9A-Z] + 2 DVs numéricos

export function formatarDoc(valor) {
    const v = String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
    // Só números e até 11 dígitos: CPF
    if (/^\d{0,11}$/.test(v)) {
        return v
            .replace(/^(\d{3})(\d)/, '$1.$2')
            .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
    }
    return v
        .replace(/^(\w{2})(\w)/, '$1.$2')
        .replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3')
        .replace(/\.(\w{3})(\w)/, '.$1/$2')
        .replace(/\/(\w{4})(\w{1,2})$/, '/$1-$2');
}

function validarCPF(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const dv = (len) => {
        let soma = 0;
        for (let i = 0; i < len; i++) soma += Number(cpf[i]) * (len + 1 - i);
        const r = (soma * 10) % 11;
        return r === 10 ? 0 : r;
    };
    return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

function validarCNPJ(cnpj) {
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\w)\1{13}$/.test(cnpj)) return false;
    // Valor de cada caractere = código ASCII - 48 (vale para dígitos e letras)
    const dv = (len) => {
        const pesos = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
        let soma = 0;
        for (let i = 0; i < len; i++) soma += (cnpj.charCodeAt(i) - 48) * pesos[i];
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

// true/false; vazio é considerado válido (campo opcional)
export function validarDoc(valor) {
    const v = String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!v) return true;
    return v.length === 11 ? validarCPF(v) : validarCNPJ(v);
}

// Aplica máscara enquanto digita e marca o campo se o documento for inválido
export function ligarMascaraDoc(input) {
    if (!input) return;
    input.addEventListener('input', () => {
        input.value = formatarDoc(input.value);
        input.style.borderColor = '';
    });
    input.addEventListener('blur', () => {
        input.style.borderColor = validarDoc(input.value) ? '' : '#e53935';
        if (!validarDoc(input.value)) toast('CPF/CNPJ inválido. Confira os números.', 'warning');
    });
}

// --- CEP (ViaCEP) ---
// prefixo: 'dest' (formulário), 'new_dest' (cadastro) ou 'modal_dest' (edição)
export async function buscarCep(prefixo) {
    const cepInput = $(`${prefixo}_cep`);
    const cep = (cepInput?.value || '').replace(/\D/g, '');
    if (cep.length !== 8) { toast('Digite um CEP com 8 números.', 'warning'); return; }

    try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await resp.json();
        if (data.erro) { toast('CEP não encontrado.', 'error'); return; }

        const cepFmt = cep.replace(/(\d{5})(\d{3})/, '$1-$2');
        const addr1 = $(`${prefixo}_addr1`);
        if (data.logradouro) addr1.value = `${data.logradouro}, `;
        $(`${prefixo}_addr2`).value = [data.bairro, `${data.localidade}/${data.uf}`, `CEP ${cepFmt}`].filter(Boolean).join(' - ');

        // Cursor no fim da linha 1 para digitar o número
        addr1.focus();
        addr1.setSelectionRange(addr1.value.length, addr1.value.length);
        toast('Endereço preenchido. Complete o número.');
    } catch (e) {
        toast('Não foi possível consultar o CEP agora.', 'error');
    }
}
