"""Export the flora parity fixture for sim-core (D-034): a small quant-mode scenario run by this
prototype, with its converted parameters and state checkpoints, plus the exact TOML texts it used.
The Rust test (sim-core/tests/flora_parity.rs) replays it and demands identical state, so the port
stays exact. The fixture is self-contained: retuning data/*.toml does not invalidate it.

Run: npm run rs:fixture
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import numpy as np

from prototype.flora import BALANCE, ONE, SPECIES, U16, Flora

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "sim-core" / "tests" / "fixtures" / "flora_parity.json"
CHECKPOINTS = (0, 1, 2, 5, 10, 40, 120, 300)
PARAMS = ("kmax", "rdt", "rate", "soil_dt", "cast", "tol", "seed_b", "est_thr", "smother",
          "litter", "soil_min", "w_opt", "w_tol", "l_opt", "l_tol", "aff", "cap")  # fmt: skip


def texts() -> tuple[str, str]:
    """The real data files, with a small grasses cap so the cap rule runs in a 14 x 14 map."""
    species = SPECIES.read_text(encoding="utf-8")
    species = re.sub(  # 30 of the 196 cells
        r"(\[flora\.grasses\][^\[]*?\ncap = )[\d.]+", r"\g<1>0.1531", species, count=1
    )
    return BALANCE.read_text(encoding="utf-8"), species


def balance_from(balance: str, species: str) -> dict:
    bal = tomllib.loads(balance)
    for kind, tables in tomllib.loads(species).items():
        bal[kind] |= tables
    return bal


def run() -> dict:
    balance_text, species_text = texts()
    fl = Flora(balance_from(balance_text, species_text), "quant", "floor")
    n = 14
    st = fl.new_state(n)
    # Soil: a gradient from bare (row 0) to rich (row 13), crossing the succession ramps.
    st.soil[:] = (np.arange(n)[:, None] * U16 // (n - 1)).astype(np.int64)
    rows = np.zeros((n, n), bool)
    rows[3:11] = True
    left, right = rows.copy(), rows.copy()
    left[:, 4:] = False
    right[:, :10] = False
    for player, side, plants in (
        (1, left, (("grasses", 1.0), ("wildflowers", 0.5), ("elder", 0.8), ("oak", 0.9))),
        (2, right, (("grasses", 1.0), ("bramble", 0.7), ("hawthorn", 0.6), ("beech", 0.9))),
    ):
        for name, frac in plants:
            fl.plant(st, player, name, side, frac=frac)
    checkpoints = []
    for t in range(max(CHECKPOINTS) + 1):
        if t in CHECKPOINTS:
            checkpoints.append({
                "t": t,
                "owner": st.owner.ravel().tolist(),
                "bio": st.bio.ravel().tolist(),
                "gauge": st.gauge.ravel().tolist(),
                "soil": st.soil.ravel().tolist(),
                "soil_type": st.soil_type.ravel().tolist(),
                "water": st.water.ravel().tolist(),
                "light": st.light.ravel().tolist(),
                "prog": st.prog.reshape(2, -1).tolist(),
                "dead": st.dead.ravel().tolist(),
            })  # fmt: skip
        fl.step(st)
    params = {k: np.asarray(getattr(fl, k)).tolist() for k in PARAMS}
    params |= {"alpha": int(fl.alpha), "plant_g": int(fl.plant_g), "soil_ramp": int(fl.soil_ramp),
               "water0": int(fl.water0), "light0": int(fl.light0), "one": ONE}  # fmt: skip
    return {"balance": balance_text, "species": species_text, "n": n, "params": params,
            "checkpoints": checkpoints}  # fmt: skip


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = run()
    OUT.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    owned = sum(1 for o in data["checkpoints"][-1]["owner"] if o)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {owned} owned cells at the end)")


if __name__ == "__main__":
    main()
