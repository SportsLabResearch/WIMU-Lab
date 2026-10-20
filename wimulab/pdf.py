"""Conversión HTML → PDF con Microsoft Edge o Google Chrome en modo sin ventana (ya instalados en Windows).

Si no se encuentra ningún navegador se intenta con Playwright y, en último término, se deja el HTML
(que puede imprimirse a PDF desde cualquier navegador).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_BROWSER = None


def navegador():
    global _BROWSER
    if _BROWSER is not None:
        return _BROWSER or None
    cands = []
    if sys.platform.startswith("win"):
        for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [Path(base) / "Microsoft/Edge/Application/msedge.exe", Path(base) / "Google/Chrome/Application/chrome.exe"]
    elif sys.platform == "darwin":
        cands += [Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                  Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    for n in ("msedge", "microsoft-edge", "google-chrome", "chromium", "chromium-browser", "chrome"):
        w = shutil.which(n)
        if w:
            cands.append(Path(w))
    _BROWSER = next((str(c) for c in cands if c and Path(c).exists()), "")
    return _BROWSER or None


def html_a_pdf(html_path: Path, pdf_path: Path, timeout=90) -> bool:
    html_path, pdf_path = Path(html_path).resolve(), Path(pdf_path).resolve()
    nav = navegador()
    if nav:
        with tempfile.TemporaryDirectory() as prof:
            cmd = [nav, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", f"--user-data-dir={prof}",
                   "--no-pdf-header-footer", "--print-to-pdf-no-header", "--run-all-compositor-stages-before-draw",
                   "--virtual-time-budget=4000", f"--print-to-pdf={pdf_path}", html_path.as_uri()]
            try:
                kw = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
                if sys.platform.startswith("win"):
                    kw["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
                subprocess.run(cmd, check=False, **kw)
            except Exception:  # noqa: BLE001
                pass
        if pdf_path.exists() and pdf_path.stat().st_size > 1000:
            return True
    try:  # alternativa (entornos de prueba)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page()
            pg.goto(html_path.as_uri())
            pg.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True)
            b.close()
        return pdf_path.exists()
    except Exception:  # noqa: BLE001
        return False
