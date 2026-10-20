@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul || (echo Se requiere Python SOLO para compilar. & pause & exit /b 1)
py -3 -m pip install -r requirements.txt pyinstaller || (pause & exit /b 1)
py -3 -m PyInstaller --noconfirm --clean --onedir --windowed --name WIMU-Lab --add-data "web;web" --collect-all scipy --collect-all matplotlib --collect-all pandas --collect-all openpyxl --collect-all docx iniciar.py || (pause & exit /b 1)
echo Ejecutable autonomo creado en dist\WIMU-Lab\WIMU-Lab.exe
pause
