"""
conferencia_rastreio.py

Programa GUI (PySimpleGUI) para cruzar Planilha A (transportadora) com Planilha B (base interna)
usando Comparação EXCLUSIVA pelo Código de Rastreio:
    Planilha A -> "Numero da Etiqueta"
    Planilha B -> "Código Rastreio"

Cria colunas na Planilha A:
    OS/Ticket, Cliente, Unidade, Tipo

Gera:
    RESULTADO.xlsx      -> planilha A original + 4 colunas preenchidas
    NAO_ENCONTRADO.xlsx -> linhas da planilha A cujo Numero da Etiqueta não tem match em B

Requisitos: pandas, openpyxl, PySimpleGUI
"""

import os
import traceback
import pandas as pd
import PySimpleGUI as sg
from pathlib import Path

# ---------------------------
# Funções utilitárias
# ---------------------------
def normalize_text(s):
    """Normaliza nomes de colunas e strings: strip, remove múltiplos espaços, lower, remove acentos básicos."""
    if pd.isna(s):
        return ""
    if not isinstance(s, str):
        s = str(s)
    s = s.strip()
    # substituir múltiplos espaços por único
    s = " ".join(s.split())
    # lower
    s = s.lower()
    # remover acentos básicos (forma simples)
    replacements = {
        "á":"a","à":"a","ã":"a","â":"a","ä":"a",
        "é":"e","è":"e","ê":"e","ë":"e",
        "í":"i","ì":"i","î":"i","ï":"i",
        "ó":"o","ò":"o","õ":"o","ô":"o","ö":"o",
        "ú":"u","ù":"u","û":"u","ü":"u",
        "ç":"c","ñ":"n",
        "º":"o","ª":"a"
    }
    for k,v in replacements.items():
        s = s.replace(k,v)
    return s

def find_column_by_candidates(columns, candidates_list):
    """
    Tenta encontrar a melhor coluna em `columns` comparando com uma lista de possíveis nomes (candidates_list).
    Retorna o nome da coluna existente (case-sensitive original) ou None.
    """
    normalized_to_original = {normalize_text(col): col for col in columns}
    for cand in candidates_list:
        nc = normalize_text(cand)
        if nc in normalized_to_original:
            return normalized_to_original[nc]
    # Tentar correspondência por substring de normalizados (mais tolerante)
    for cand in candidates_list:
        nc = normalize_text(cand)
        for ncol_norm, col_orig in normalized_to_original.items():
            if nc in ncol_norm or ncol_norm in nc:
                return col_orig
    return None

def normalize_code_val(x):
    """Normaliza o código de rastreio / etiqueta: transforma em string, remove espaços, maiúsculas."""
    if pd.isna(x):
        return ""
    # se float sem decimais, converter sem '.0'
    if isinstance(x, float):
        if x.is_integer():
            x = int(x)
    s = str(x)
    s = s.strip()
    # remover espaços internos
    s = "".join(s.split())
    return s.upper()

# ---------------------------
# Processamento principal
# ---------------------------
def process_files(path_a, path_b, output_folder=None, window=None):
    """
    Lê planilha A e B, cruza por Código de Rastreio e salva RESULTADO.xlsx e NAO_ENCONTRADO.xlsx.
    """
    if output_folder is None:
        output_folder = Path(path_a).parent

    # Carregar com pandas (openpyxl)
    try:
        df_a = pd.read_excel(path_a, dtype=object)
    except Exception as e:
        raise RuntimeError(f"Erro ao abrir Planilha A: {e}")
    try:
        df_b = pd.read_excel(path_b, dtype=object)
    except Exception as e:
        raise RuntimeError(f"Erro ao abrir Planilha B: {e}")

    # Normalizar nomes de colunas para busca
    cols_a = list(df_a.columns)
    cols_b = list(df_b.columns)

    # Procurar coluna "Numero da Etiqueta" em A (várias variações possíveis)
    candidates_num_etiqueta = [
        "Numero da Etiqueta", "Número da Etiqueta", "numero da etiqueta", "numero etiqueta",
        "numero_etiqueta", "numeroetiqueta", "numero da etiqueta ", "numero etiqueta "
    ]
    col_num_etiqueta = find_column_by_candidates(cols_a, candidates_num_etiqueta)
    if not col_num_etiqueta:
        raise RuntimeError("Não foi encontrada a coluna 'Numero da Etiqueta' na Planilha A. "
                           "Verifique nomes das colunas e tente novamente.")

    # Procurar coluna "Código Rastreio" em B (várias variações possíveis)
    candidates_codigo_rastreio = [
        "Código Rastreio", "Codigo Rastreio", "Codigo do Rastreio", "CodigoRastreio",
        "codigo rastreio", "codigo_de_rastreio", "codigo_rastreio", "codigo rastreamento",
        "codigo", "codigorastreio", "codigo de rastreio"
    ]
    col_codigo_rastreio = find_column_by_candidates(cols_b, candidates_codigo_rastreio)
    if not col_codigo_rastreio:
        raise RuntimeError("Não foi encontrada a coluna 'Código Rastreio' na Planilha B. "
                           "Verifique nomes das colunas e tente novamente.")

    # Colunas a extrair de B: OS/Ticket, Cliente, Unidade, Tipo
    # Procurar os nomes exatos (usuário pediu para manter exatamente os nomes em B, mas queremos extrair)
    desired_cols = {
        "OS/Ticket": ["OS/Ticket", "OS/Ticket", "os/ticket", "os ticket", "os_ticket", "ticket", "os"],
        "Cliente": ["Cliente", "cliente", "nome cliente", "cliente "],
        "Unidade": ["Unidade", "unidade"],
        "Tipo": ["Tipo", "tipo"]
    }
    # map to actual column names present in B or None
    mapped_desired_cols = {}
    for key, cand_list in desired_cols.items():
        mapped = find_column_by_candidates(cols_b, cand_list)
        mapped_desired_cols[key] = mapped  # may be None -> we'll fill blank if missing in B

    # Prepare a lookup dictionary from B: normalized_code -> row (we'll use first match)
    lookup = {}
    # Fill progress if window provided
    total_rows_b = len(df_b)
    for idx, row in df_b.iterrows():
        raw_code = row.get(col_codigo_rastreio, "")
        code_norm = normalize_code_val(raw_code)
        if code_norm == "":
            continue
        # If multiple rows same code, keep the first occurrence (user didn't request special handling)
        if code_norm not in lookup:
            lookup[code_norm] = row

    # Prepare new columns in A if not exist
    new_cols = ["OS/Ticket", "Cliente", "Unidade", "Tipo"]
    for nc in new_cols:
        if nc not in df_a.columns:
            df_a[nc] = ""  # criar coluna vazia

    # Iterar A e preencher
    nao_encontrados_rows = []
    total_rows_a = len(df_a)
    processed = 0
    for idx, row in df_a.iterrows():
        raw_label = row.get(col_num_etiqueta, "")
        code_norm = normalize_code_val(raw_label)
        if code_norm == "":
            # sem etiqueta -> considerar não encontrado (conforme regra: se não existir deixe em branco e registre)
            nao_encontrados_rows.append(row)
            # deixa colunas em branco (já estão)
        else:
            match_row = lookup.get(code_norm)
            if match_row is None:
                # registrar como não encontrado
                nao_encontrados_rows.append(row)
            else:
                # preencher os campos pedidos
                for target_col, src_col in mapped_desired_cols.items():
                    if src_col is None:
                        # não existe na planilha B -> deixar em branco
                        df_a.at[idx, target_col] = ""
                    else:
                        value = match_row.get(src_col, "")
                        df_a.at[idx, target_col] = value
        processed += 1
        # atualizar barra de progresso se gui
        if window is not None:
            try:
                window['-PROG-'].update_bar(processed, total_rows_a if total_rows_a>0 else 1)
            except:
                pass

    # Salvar RESULTADO.xlsx (todos os campos originais de A + 4 novas colunas)
    resultado_path = Path(output_folder) / "RESULTADO.xlsx"
    try:
        # manter index=False para Excel limpo
        df_a.to_excel(resultado_path, index=False, engine='openpyxl')
    except Exception as e:
        raise RuntimeError(f"Falha ao salvar {resultado_path}: {e}")

    # Salvar NAO_ENCONTRADO.xlsx
    nao_encontrado_path = Path(output_folder) / "NAO_ENCONTRADO.xlsx"
    try:
        if len(nao_encontrados_rows) > 0:
            df_nao = pd.DataFrame(nao_encontrados_rows)
            # garantir colunas novas presentes para visualização
            for nc in new_cols:
                if nc not in df_nao.columns:
                    df_nao[nc] = ""
            df_nao.to_excel(nao_encontrado_path, index=False, engine='openpyxl')
        else:
            # criar arquivo vazio com cabeçalho (todas as colunas da planilha A + novas)
            df_empty = df_a.iloc[0:0].copy()
            df_empty.to_excel(nao_encontrado_path, index=False, engine='openpyxl')
    except Exception as e:
        raise RuntimeError(f"Falha ao salvar {nao_encontrado_path}: {e}")

    # Retornar caminhos e estatísticas
    stats = {
        "total_a": total_rows_a,
        "total_b": total_rows_b,
        "matches": total_rows_a - len(nao_encontrados_rows),
        "not_found": len(nao_encontrados_rows),
        "resultado_path": str(resultado_path),
        "nao_encontrado_path": str(nao_encontrado_path)
    }
    return stats

# ---------------------------
# GUI (PySimpleGUI)
# ---------------------------
def build_gui():
    sg.theme('DefaultNoMoreNagging')

    layout = [
        [sg.Text("Planilha A (transportadora - origem dos valores):"), sg.Input(key="-FILEA-"), sg.FileBrowse(file_types=(("Excel Files", "*.xlsx;*.xls"),))],
        [sg.Text("Planilha B (base interna - com Código Rastreio):    "), sg.Input(key="-FILEB-"), sg.FileBrowse(file_types=(("Excel Files", "*.xlsx;*.xls"),))],
        [sg.Text("Pasta de saída (opcional):"), sg.Input(key="-OUTFOLDER-"), sg.FolderBrowse()],
        [sg.Button("Processar", size=(12,1)), sg.Button("Sair", size=(8,1))],
        [sg.Text("", key="-STATUS-", size=(70,2))],
        [sg.ProgressBar(max_value=100, orientation='h', size=(50, 12), key='-PROG-')],
        [sg.Multiline(size=(80,10), key='-LOG-', disabled=True)]
    ]

    window = sg.Window("Conferência de Rastreio - Planilha A x Planilha B", layout, finalize=True)
    return window

def main():
    window = build_gui()

    while True:
        event, values = window.read()
        if event == sg.WIN_CLOSED or event == "Sair":
            break
        if event == "Processar":
            path_a = values["-FILEA-"]
            path_b = values["-FILEB-"]
            out_folder = values["-OUTFOLDER-"] or None

            window['-LOG-'].update("")  # limpar log
            if not path_a or not path_b:
                window['-STATUS-'].update("Selecione as duas planilhas antes de processar.")
                continue
            # checar arquivos existem
            if not os.path.isfile(path_a):
                window['-STATUS-'].update("Arquivo A não encontrado. Verifique o caminho.")
                continue
            if not os.path.isfile(path_b):
                window['-STATUS-'].update("Arquivo B não encontrado. Verifique o caminho.")
                continue

            window['-STATUS-'].update("Processando... (aguarde)")
            window['-PROG-'].update_bar(0, 100)
            try:
                stats = process_files(path_a, path_b, output_folder=out_folder, window=window)
                # Mostrar resultado
                msg = (f"Processamento concluído!\nRESULTADO: {stats['resultado_path']}\n"
                       f"NAO_ENCONTRADO: {stats['nao_encontrado_path']}\n"
                       f"Linhas em A: {stats['total_a']}, em B: {stats['total_b']}\n"
                       f"Encontrados: {stats['matches']}, Não encontrados: {stats['not_found']}")
                window['-STATUS-'].update("Sucesso: processamento finalizado.")
                window['-LOG-'].update(msg)
                window['-PROG-'].update_bar(100, 100)
            except Exception as e:
                tb = traceback.format_exc()
                window['-STATUS-'].update("Erro durante o processamento. Veja log.")
                window['-LOG-'].update(f"Erro: {e}\n\nTraceback:\n{tb}")

    window.close()

if __name__ == "__main__":
    main()
