import os
import sys
import time
import json
import socket
import random
import string
import requests

# Tenta importar win32print. Se não estiver instalado, avisa o usuário.
try:
    import win32print
except ImportError:
    print("Erro: A biblioteca 'pywin32' nao esta instalada.")
    print("Por favor, execute: pip install pywin32 requests")
    input("Pressione Enter para sair...")
    sys.exit(1)

CLOUD_URL = 'https://scanonu.ctdibrasil.com.br/api'
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

config = {
    "station_id": "",
    "station_name": "",
    "printer_name": "",
    "is_network_gateway": False
}

def load_config():
    global config
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except Exception as e:
            print(f"⚠️ Erro ao ler config.json: {e}")
    
    # Gera ID único se não existir
    if not config.get("station_id"):
        rand_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        config["station_id"] = f"station_{rand_str}"
        
    # Nome padrão baseado no computador
    if not config.get("station_name"):
        config["station_name"] = f"Zebra_{socket.gethostname()}"
        
    save_config()

def save_config():
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"⚠️ Erro ao salvar config.json: {e}")

def select_printer():
    # Lista impressoras instaladas no Windows
    print("\n--- Impressoras Instaladas no Windows ---")
    try:
        printers_info = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)
        printers = [p[2] for p in printers_info]
    except Exception as e:
        print(f"Erro ao listar impressoras: {e}")
        return
        
    if not printers:
        print("Nenhuma impressora encontrada no Windows!")
        return

    for idx, printer in enumerate(printers):
        print(f"[{idx + 1}] {printer}")
        
    print("-----------------------------------------")
    
    # Se já tem impressora salva, mostra a opção de manter
    current_printer = config.get("printer_name")
    prompt_msg = "Selecione o numero da impressora Zebra local: "
    if current_printer in printers:
        print(f"Impressora atual configurada: {current_printer}")
        prompt_msg = f"Selecione o numero (ou aperte Enter para manter '{current_printer}'): "

    while True:
        try:
            val = input(prompt_msg).strip()
            if not val and current_printer in printers:
                break
            choice = int(val) - 1
            if 0 <= choice < len(printers):
                config["printer_name"] = printers[choice]
                save_config()
                break
            else:
                print("Opção inválida.")
        except ValueError:
            print("Por favor, digite um número válido.")

def print_zpl_raw(zpl_code):
    printer_name = config.get("printer_name")
    if not printer_name:
        print("❌ Nenhuma impressora selecionada na configuração.")
        return False
        
    try:
        hPrinter = win32print.OpenPrinter(printer_name)
        try:
            # Envia em formato RAW direto para o Spooler do Windows
            hJob = win32print.StartDocPrinter(hPrinter, 1, ("SmartScan Print Job", None, "RAW"))
            try:
                win32print.StartPagePrinter(hPrinter)
                win32print.WritePrinter(hPrinter, zpl_code.encode('utf-8'))
                win32print.EndPagePrinter(hPrinter)
                return True
            finally:
                win32print.EndDocPrinter(hPrinter)
        finally:
            win32print.ClosePrinter(hPrinter)
    except Exception as e:
        print(f"❌ Erro ao enviar ZPL para a impressora '{printer_name}': {e}")
        return False

def print_zpl_to_network(ip, port, zpl_code):
    try:
        # Abre uma conexao TCP socket direta com a impressora de rede local
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5.0)
        s.connect((ip, int(port)))
        s.sendall(zpl_code.encode('utf-8'))
        s.close()
        return True
    except Exception as e:
        print(f"❌ Erro de comunicacao com impressora de rede local {ip}:{port}: {e}")
        return False

def send_heartbeat():
    try:
        payload = {
            "id": config["station_id"],
            "name": config["station_name"]
        }
        res = requests.post(f"{CLOUD_URL}/active-printers", json=payload, timeout=5)
        if res.status_code != 200:
            print(f"⚠️ Erro ao registrar na nuvem: Status {res.status_code}")
    except Exception as e:
        print(f"⚠️ Falha de conexão com a nuvem (Heartbeat): {e}")

def poll_jobs():
    try:
        # Define url e inclui network se configurado como gateway
        url = f"{CLOUD_URL}/print-jobs?station={config['station_id']}"
        if config.get("is_network_gateway"):
            url += "&include_network=true"
            
        res = requests.get(url, timeout=5)
        if res.status_code == 200:
            data = res.json()
            jobs = data.get("jobs", [])
            for job in jobs:
                job_id = job.get("id")
                zpl = job.get("zpl")
                target_ip = job.get("ip")
                target_port = job.get("port", 9100)
                
                if target_ip:
                    print(f"📥 Recebido Job de Rede #{job_id} para {target_ip}:{target_port}!")
                    success = print_zpl_to_network(target_ip, target_port, zpl)
                else:
                    print(f"📥 Recebido Job Local #{job_id} da nuvem!")
                    success = print_zpl_raw(zpl)
                
                # Se imprimiu, apaga da fila
                if success:
                    if target_ip:
                        print(f"✅ Impresso com sucesso na impressora de rede: {target_ip}:{target_port}")
                    else:
                        print(f"✅ Impresso com sucesso na impressora local: {config['printer_name']}")
                        
                    requests.delete(f"{CLOUD_URL}/print-jobs/{job_id}", timeout=5)
                    print(f"🗑️ Job #{job_id} removido da fila.")
        else:
            print(f"⚠️ Erro de polling: Status {res.status_code}")
    except Exception as e:
        # Silencia erros de timeout/conexao temporarios
        pass

def main():
    print("==================================================")
    print("🐍 SMART SCAN - CLIENTE DE IMPRESSÃO PYTHON v2.0 🐍")
    print("==================================================")
    
    load_config()
    
    # Se não tiver nome definido no config.json, pede ao usuário
    if not config.get("station_name") or config["station_name"].startswith("Zebra_"):
        name_input = input(f"Digite o nome deste computador no sistema (ou Enter para '{config['station_name']}'): ").strip()
        if name_input:
            config["station_name"] = name_input
            save_config()
            
    # Pergunta se quer ativar como Gateway de Rede se nao estiver configurado
    if "is_network_gateway" not in config:
        gateway_input = input("Deseja que este computador funcione como Gateway para impressoras de rede local (IP)? (s/n): ").strip().lower()
        config["is_network_gateway"] = gateway_input in ['s', 'sim', 'y', 'yes']
        save_config()
    
    # Configura a impressora física local
    select_printer()
    
    print("\n--------------------------------------------------")
    print(f"🆔 ID da Estação: {config['station_id']}")
    print(f"🖥️ Nome da Estação: {config['station_name']}")
    print(f"🖨️ Impressora Windows Local: {config['printer_name']}")
    print(f"🌐 Gateway de Rede: {'ATIVADO' if config.get('is_network_gateway') else 'DESATIVADO'}")
    print(f"📡 Conectado à nuvem: {CLOUD_URL}")
    print("--------------------------------------------------")
    print("Serviço iniciado! Deixe esta janela aberta para imprimir...")
    
    last_heartbeat = 0
    while True:
        now = time.time()
        # Envia heartbeat a cada 10s
        if now - last_heartbeat >= 10:
            send_heartbeat()
            last_heartbeat = now
            
        # Faz o polling de novos trabalhos de impressão a cada 2s
        poll_jobs()
        time.sleep(2)

if __name__ == "__main__":
    main()
