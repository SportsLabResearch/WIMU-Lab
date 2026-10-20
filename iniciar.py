"""Arranque de WIMU Lab.

1. Comprueba (e instala si faltan) las dependencias.
2. Inicia el servidor local en 127.0.0.1 (los datos nunca salen del equipo).
3. Abre la interfaz en una ventana de aplicación (Microsoft Edge / Chrome en modo app) o, si no, en el navegador.
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)
sys.path.insert(0, str(HERE))

REQ = {"numpy": "numpy", "pandas": "pandas", "scipy": "scipy", "matplotlib": "matplotlib", "openpyxl": "openpyxl", "docx": "python-docx"}


def check_deps():
    missing = [pkg for mod, pkg in REQ.items() if importlib.util.find_spec(mod) is None]
    if missing:
        print("Instalando dependencias:", ", ".join(missing))
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", "-r", str(HERE / "requirements.txt")])


def find_browser():
    if sys.platform.startswith("win"):
        cands = []
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LocalAppData")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
        for c in cands:
            if c.exists():
                return str(c)
    for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    if sys.platform == "darwin":
        for c in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"):
            if Path(c).exists():
                return c
    return None


def minimizar_consola():
    """Minimiza la ventana de la consola en Windows (se cierra sola al cerrar la aplicación)."""
    if sys.platform.startswith("win"):
        try:
            import ctypes
            h = ctypes.windll.kernel32.GetConsoleWindow()
            if h:
                ctypes.windll.user32.ShowWindow(h, 6)   # SW_MINIMIZE
        except Exception:  # noqa: BLE001
            pass


def main():
    # En Windows, arrancar el servidor sin consola en un proceso independiente.
    # El lanzador finaliza y PowerShell/cmd se cierra sin matar el servidor.
    if sys.platform.startswith("win") and "--sin-consola" not in sys.argv:
        check_deps()
        pythonw = Path(sys.executable).with_name("pythonw.exe")
        if pythonw.exists():
            flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            subprocess.Popen([str(pythonw), str(Path(__file__).resolve()), "--sin-consola", *sys.argv[1:]],
                             cwd=str(HERE), creationflags=flags,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    check_deps()
    from wimulab import APP_NAME, __version__
    from wimulab import config as C
    from wimulab import servidor
    from wimulab import servicio as SV

    browser = None if "--navegador" in sys.argv else find_browser()

    def abrir_ventana(url):
        if browser:
            profile = C.CONFIG_DIR / "ventana"
            profile.mkdir(parents=True, exist_ok=True)
            return subprocess.Popen([browser, f"--app={url}", "--start-maximized", f"--user-data-dir={profile}",
                                     "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"])
        webbrowser.open(url)
        return None

    otra = servidor.instancia_abierta()
    if otra:          # ya hay un WIMU Lab abierto con estos datos: se muestra esa en vez de abrir otra
        print(f"{APP_NAME} ya está abierto ({otra}); se muestra su ventana.")
        abrir_ventana(otra)
        return

    def vigilar_ventana(proc):
        """Al cerrar la ventana de la aplicación se cierra también el programa (si no hay tareas en marcha)."""
        t0 = time.time()
        proc.wait()
        if time.time() - t0 < 8:      # el navegador delegó en otro proceso: se usa el latido de la interfaz
            return
        if servidor.tareas_activas():
            print("Ventana cerrada: hay una tarea en curso; el programa se cerrará al terminar.")
            return
        servidor.salir()

    def ready(port):
        url = f"http://127.0.0.1:{port}/"
        print(f"{APP_NAME} v{__version__}")
        print(f"Interfaz disponible en {url}")
        print(f"Carpeta de datos (.qul): {SV.cfg()['carpeta_datos']}")
        print(f"Configuración: {C.CONFIG_FILE}")
        print("Esta ventana se cerrará sola al cerrar WIMU Lab.")
        proc = abrir_ventana(url)
        if proc:
            threading.Thread(target=vigilar_ventana, args=(proc,), daemon=True).start()
        time.sleep(2)
        minimizar_consola()

    Path(SV.cfg()["carpeta_datos"]).mkdir(parents=True, exist_ok=True)
    servidor.serve(port=0, auto_cerrar=True, on_ready=lambda p: threading.Thread(target=ready, args=(p,), daemon=True).start())


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        print("\nERROR:", e)
        input("Pulse Intro para salir…")
