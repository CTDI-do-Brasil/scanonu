@echo off
echo ===================================================
echo * INSTALADOR DE IMPRESSORA NUVEM PYTHON - SMART SCAN *
echo ===================================================
echo.
echo Verificando instalacao do Python...
python --version > nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao esta instalado neste computador!
    echo Por favor, instale o Python 3 (marque a opcao "Add Python to PATH" no instalador).
    echo Baixe em: https://www.python.org/
    pause
    exit /b
)

echo [1/2] Instalando bibliotecas necessarias (requests, pywin32)...
pip install requests pywin32 --quiet
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias via pip.
    pause
    exit /b
)

echo [2/2] Iniciando configuracao da impressora...
python "%~dp0zebra_cloud_client.py"

pause
