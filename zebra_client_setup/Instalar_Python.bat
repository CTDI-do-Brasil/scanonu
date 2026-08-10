@echo off
echo ===================================================
echo * INSTALADOR DE IMPRESSORA NUVEM PYTHON - SMART SCAN *
echo ===================================================
echo(
echo Verificando instalacao do Python...

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Python nao esta instalado neste computador!
    echo Por favor, instale o Python 3 (marque a opcao "Add Python to PATH" no instalador).
    echo Baixe em: https://www.python.org/
    echo(
    pause
    exit /b
)

echo [1/2] Instalando bibliotecas necessarias (requests, pywin32)...
pip install requests pywin32 --quiet

echo [2/2] Iniciando configuracao da impressora...
python "%~dp0zebra_cloud_client.py"

pause
