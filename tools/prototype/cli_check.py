"""Cross-check sim-cli against the prototype's quant mode (ROADMAP M1.6): the same command file
runs in both, and every flora tick must report identical territory, biomass and cells per species.
Since the flora port is exact (D-034), the comparison is exact too.

Run: npm run cli:check   (needs cargo; builds sim-cli in release)
"""

from __future__ import annotations

import csv
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from prototype.flora import PLAYERS, Flora, load_balance

ROOT = Path(__file__).resolve().parents[2]


def commands(n: int) -> list[dict]:
    """Both players seed pioneers, then shrubs and more meadow; one order lands between two
    flora ticks (tick 52) and one player sends two orders in the same tick."""

    def plant(tick, player, seq, species, row, col, radius):
        payload = {"type": "plant", "species": species, "row": row, "col": col, "radius": radius}
        return {"tick": tick, "player": player, "seq": seq, "payload": payload}

    far = n - 1
    return [
        plant(0, 1, 0, "grasses", 8, 8, 3),
        plant(0, 1, 1, "lichen", 8, 16, 2),
        plant(0, 2, 0, "grasses", far - 8, far - 8, 3),
        plant(0, 2, 1, "moss", far - 8, far - 16, 2),
        plant(52, 2, 2, "grasses", far - 20, far - 4, 2),
        plant(300, 1, 2, "clover", 8, 8, 2),
        plant(300, 1, 3, "elder", 9, 9, 1),
    ]


def run_cli(cmds: list[dict], n: int, ticks: int, work: Path) -> list[dict]:
    path = work / "commands.jsonl"
    path.write_text("".join(json.dumps(c) + "\n" for c in cmds), encoding="utf-8")
    out = work / "metrics.csv"
    subprocess.run(
        ["cargo", "run", "-q", "--release", "-p", "sim-cli", "--", "run", "--seed", "1",
         "--ticks", str(ticks), "--size", str(n), "--commands", str(path), "--out", str(out)],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )  # fmt: skip
    with open(out, encoding="utf-8") as fh:
        return [{k: v for k, v in row.items() if k != "hash"} for row in csv.DictReader(fh)]


def run_prototype(cmds: list[dict], n: int, ticks: int) -> list[dict]:
    """sim-core semantics: a command at tick T applies at the start of T, in (player, seq)
    order; flora steps on ticks divisible by flora_every_ticks."""
    balance = load_balance()
    fl = Flora(balance, "quant", "floor")
    every = balance["sim"]["flora_every_ticks"]
    st = fl.new_state(n)
    yy, xx = np.mgrid[:n, :n]
    pending = sorted(cmds, key=lambda c: (c["tick"], c["player"], c["seq"]))
    rows = []
    for tick in range(ticks):
        while pending and pending[0]["tick"] == tick:
            c = pending.pop(0)
            p = c["payload"]
            disc = (yy - p["row"]) ** 2 + (xx - p["col"]) ** 2 <= p["radius"] ** 2
            fl.plant(st, c["player"], p["species"], disc)
        if tick % every:
            continue
        fl.step(st)
        row = {"tick": str(tick + 1), "flora_tick": str(st.t)}
        for player in PLAYERS:
            mine = st.owner == player
            row[f"territory_p{player}"] = str(int(mine.sum()))
            row[f"biomass_p{player}"] = str(int(st.bio[:, mine].sum()))
            for i, name in enumerate(fl.names):
                row[f"cells_{name}_p{player}"] = str(int(((st.bio[i] > 0) & mine).sum()))
        rows.append(row)
    return rows


def check(n: int = 48, ticks: int = 1200) -> int:
    """Compare; returns the number of flora ticks checked. Raises on the first difference."""
    cmds = commands(n)
    with tempfile.TemporaryDirectory() as tmp:
        rust = run_cli(cmds, n, ticks, Path(tmp))
    proto = run_prototype(cmds, n, ticks)
    assert len(rust) == len(proto), (len(rust), len(proto))
    for r, p in zip(rust, proto, strict=True):
        diff = {k: (r[k], p[k]) for k in p if r[k] != p[k]}
        assert not diff, f"tick {p['tick']}: (sim-cli, prototype) {diff}"
    return len(proto)


if __name__ == "__main__":
    print(f"sim-cli matches the prototype on {check()} flora ticks")
