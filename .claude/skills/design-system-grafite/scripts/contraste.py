#!/usr/bin/env python3
"""Contraste WCAG do Grafite.

Uso:
  python3 contraste.py                 # confere todos os pares do sistema, Dia e Noite
  python3 contraste.py "#5E6865" "#F4F5F2" [minimo]   # confere um par avulso

Sai com código 1 se algum par ficar abaixo do mínimo.
"""
import sys

DIA = {
    "papel": "#F4F5F2", "folha": "#FFFFFF", "grafite": "#1E2523", "grafite-suave": "#5E6865",
    "linha": "#DFE3DF", "nanquim": "#2E5E5A", "nanquim-escuro": "#224744", "nanquim-tinta": "#E2ECEA",
    "sobre-nanquim": "#FFFFFF", "positivo": "#2F7D4F", "negativo": "#B3403A", "atencao": "#9A5D0C",
    "notas": "#3D5A80", "financas": "#4F6B3A", "tarefas": "#8A5F17", "editor": "#9A4E4E",
    "cerebro": "#6A5A8C", "borda-controle": "#7A8480",
}
NOITE = {
    "papel": "#121514", "folha": "#1A1E1D", "grafite": "#E6EAE7", "grafite-suave": "#9AA4A0",
    "linha": "#2A302E", "nanquim": "#7FB5AE", "nanquim-escuro": "#A3CDC7", "nanquim-tinta": "#1F3331",
    "sobre-nanquim": "#121514", "positivo": "#6FCF97", "negativo": "#F08A84", "atencao": "#F0B860",
    "notas": "#8FAAD0", "financas": "#9DBF83", "tarefas": "#D6AE62", "editor": "#D99A9A",
    "cerebro": "#AD9FD6", "borda-controle": "#6B7571",
}

# (frente, fundo, mínimo)
PARES = [
    *[(t, f, 4.5) for t in ("grafite", "grafite-suave", "nanquim", "positivo", "negativo", "atencao")
      for f in ("papel", "folha")],
    ("grafite", "nanquim-tinta", 4.5),
    ("sobre-nanquim", "nanquim", 4.5),
    ("sobre-nanquim", "nanquim-escuro", 4.5),
    ("papel", "grafite", 4.5),  # toast / tooltip
    # 3:1 — ícones, bordas de controle, anel de foco
    *[(t, f, 3.0) for t in ("notas", "financas", "tarefas", "editor", "cerebro", "borda-controle", "nanquim")
      for f in ("papel", "folha")],
    *[("folha", t, 3.0) for t in ("notas", "financas", "tarefas", "editor", "cerebro")],  # glifo no ícone de ferramenta
]


def lum(hex_):
    h = hex_.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = out
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def razao(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    if len(sys.argv) >= 3:
        minimo = float(sys.argv[3]) if len(sys.argv) > 3 else 4.5
        r = razao(sys.argv[1], sys.argv[2])
        print(f"{sys.argv[1]} sobre {sys.argv[2]}: {r:.2f}:1 ({'ok' if r >= minimo else 'FALHA'}, mínimo {minimo})")
        sys.exit(0 if r >= minimo else 1)

    falhas = 0
    for nome, tema in (("Dia", DIA), ("Noite", NOITE)):
        print(f"== {nome}")
        for fg, bg, minimo in PARES:
            r = razao(tema[fg], tema[bg])
            ok = r >= minimo
            falhas += not ok
            print(f"  {'ok   ' if ok else 'FALHA'} {fg:15} sobre {bg:14} {r:5.2f}:1 (mín {minimo})")
    print(f"\n{falhas} falha(s)")
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
