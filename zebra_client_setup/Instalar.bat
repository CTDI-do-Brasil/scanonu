@echo off
chcp 65001 > nul
echo ===================================================
echo 🦓 INSTALADOR DE IMPRESSORA NUVEM - SMART SCAN 🦓
echo ===================================================
echo.
echo Este script configurara a inicializacao automatica invisivel
echo do cliente Zebra.
echo.

:: Solicita o nome personalizado
set /p STATION_NAME="Digite o nome deste computador (ex: Recepcao, Expedicao, PC_Jose): "

if "%STATION_NAME%"=="" (
    set STATION_NAME=Zebra_PC
)

:: Cria/atualiza o config.json com o nome digitado
echo.
echo [1/3] Configurando o arquivo local de identificacao...
node -e "const fs=require('fs'); const name=process.argv[1]; const id='station_'+Math.random().toString(36).substring(2,10); fs.writeFileSync('config.json', JSON.stringify({station_id:id, station_name:name}, null, 2));" "%STATION_NAME%"
if errorlevel 1 (
    echo [ERRO] Erro ao configurar o arquivo config.json. O Node.js esta instalado neste computador?
    pause
    exit /b
)

:: Cria o arquivo silent_launcher.vbs localmente para executar o node invisivel
echo Set WshShell = CreateObject("WScript.Shell") > silent_launcher.vbs
echo WshShell.Run "node """ ^& "%~dp0" ^& "zebra_cloud_client.js""", 0, False >> silent_launcher.vbs

:: Copia/Cria atalho na pasta Startup do Windows
echo.
echo [2/3] Configurando inicializacao automatica invisivel no Windows...
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy /y silent_launcher.vbs "%STARTUP_FOLDER%\ZebraCloudClient.vbs" > nul

:: Executa imediatamente
echo.
echo [3/3] Iniciando o servico de impressao em segundo plano...
wscript.exe "%STARTUP_FOLDER%\ZebraCloudClient.vbs"

echo.
echo ===================================================
echo 🎉 INSTALACAO CONCLUIDA COM SUCESSO! 🎉
echo ===================================================
echo.
echo O computador "%STATION_NAME%" ja esta online!
echo O servico de impressao rodara de forma 100%% invisivel toda vez que o Windows ligar.
echo.
pause
