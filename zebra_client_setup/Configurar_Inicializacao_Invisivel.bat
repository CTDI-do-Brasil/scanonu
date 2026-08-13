@echo off
echo ===================================================
echo * CONFIGURANDO INICIALIZACAO INVISIVEL - PYTHON *
echo ===================================================
echo(

:: Cria o arquivo silent launcher na pasta Startup do Windows
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP_FOLDER%\ZebraPythonClient.vbs"
echo WshShell.Run "python """ ^& "%~dp0" ^& "zebra_cloud_client.py""", 0, False >> "%STARTUP_FOLDER%\ZebraPythonClient.vbs"

echo [1/2] Atalho de inicializacao criado na pasta Startup.

:: Encerra o script Python visivel atual para evitar duplicidade
echo [2/2] Reiniciando o servico em modo invisivel...
taskkill /F /IM python.exe >nul 2>nul

:: Executa imediatamente em modo invisivel
wscript.exe "%STARTUP_FOLDER%\ZebraPythonClient.vbs"

echo(
echo ===================================================
echo * CONFIGURACAO CONCLUIDA COM SUCESSO! *
echo ===================================================
echo(
echo O script agora esta rodando de forma 100%% invisivel.
echo Ele iniciara sozinho em segundo plano toda vez que o Windows ligar.
echo(
pause
