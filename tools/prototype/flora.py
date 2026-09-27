"""M0 flora prototype: the gamerules cell model (gamerules §2.1, §3; D-019).

Each cell has an owner and at most one species per stratum (L1 herbaceous, L2 shrub, L3 canopy).
State units match the future integer sim: biomass and soil development in [0, U16], cover and
colonization progress in [0, ONE]. Every rule reads the previous state (double buffering).

Run: npm run proto:flora -- --seed 1 --minutes 20 [--mode quant]
"""

from __future__ import annotations

import argparse
import csv
import tomllib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BALANCE = ROOT / "data" / "balance.toml"
ONE = 1 << 16  # Q16.16 one: scale of fractions and of colonization progress
U16 = ONE - 1
STRATA = 3
PLAYERS = (1, 2)
DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1))
SWITCHES = ("succession", "shade", "contested_cells", "own_spread")


def load_balance(path: Path = BALANCE) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def round_half_away(x) -> np.ndarray:
    """INSTRUCTIONS §4 rounding rule, for converting balance values to integers."""
    x = np.asarray(x, dtype=np.float64)
    return (np.sign(x) * np.floor(np.abs(x) + 0.5)).astype(np.int64)


def nb(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """Value of each cell's neighbour at (y + dy, x + dx); 0 outside the map (no wrap)."""
    n0, n1 = a.shape
    return np.pad(a, 1)[1 + dy : 1 + dy + n0, 1 + dx : 1 + dx + n1]


@dataclass
class State:
    owner: np.ndarray  # (N, N) int8: 0 none, else player
    species: np.ndarray  # (3, N, N) int16: species id per stratum, 0 none
    bio: np.ndarray  # (3, N, N) biomass
    soil: np.ndarray  # (N, N) soil development
    prog: np.ndarray  # (2, N, N) colonization progress on empty cells, per player
    prog_own: np.ndarray  # (3, N, N) own-cell spread progress, per stratum
    t: int = 0  # flora steps done


class Flora:
    """Species tables and rules, converted once from balance.toml."""

    def __init__(
        self, balance: dict, mode="float", rounding="floor", seed=0, **switches: bool
    ):
        """mode "quant" holds the state in integers with Q16.16 rates (INSTRUCTIONS §4). rounding
        picks the low-density growth fix: "floor" (+1 minimum, chosen by D-021) or "stochastic"."""
        assert mode in ("float", "quant") and rounding in ("stochastic", "floor")
        self.mode, self.rounding = mode, rounding
        self.dtype = np.float64 if mode == "float" else np.int64
        self.rng = np.random.default_rng(seed)
        f, sim = balance["flora"], balance["sim"]
        self.dt = sim["flora_every_ticks"] / sim["tick_hz"]
        self.sw = {k: switches.get(k, f[k]) for k in SWITCHES}
        self.names = [k for k, v in f.items() if isinstance(v, dict)]
        sp = [f[n] for n in self.names]  # species id = index + 1; id 0 = none
        for n, s in zip(self.names, sp, strict=True):
            assert s["level"] in (1, 2, 3), n
            assert 0 < s["k_max"] <= U16, n
            assert 0 <= s["shade_cast"] < 1 and 0 <= s["shade_tolerance"] <= 1, n
            assert s["growth_rate"] * self.dt < 1, f"{n}: growth_rate * dt must stay < 1"

        def col(key, scale=1.0, none=0.0):
            return np.array([none] + [s[key] * scale for s in sp], dtype=np.float64)

        self.level = np.array([0] + [s["level"] for s in sp], dtype=np.int8)
        self.kmax = col("k_max", none=1.0)
        self.rdt = col("growth_rate", self.dt * ONE)
        self.rate = col("spread_rate", self.dt * ONE)
        self.soil_dt = col("soil_gain", self.dt * U16)
        self.cast = col("shade_cast", ONE)
        self.tol = col("shade_tolerance", ONE)
        self.seed_b = self.kmax * f["seed_fraction"]
        self.spread_thr = self.kmax * f["spread_threshold"]
        self.est_thr = self.kmax * f["establish_threshold"]
        self.smother = self.kmax * f["smother_rate"] * self.dt
        mins = np.array([0.0] + f["soil_min_level"]) * U16
        self.soil_min = np.where(col("pioneer") > 0, 0.0, mins[self.level])
        self.soil_min[0] = 0
        # Spread target preference: highest level, then fastest spread, then lowest id.
        order = sorted(range(1, len(sp) + 1), key=lambda i: (self.level[i], self.rate[i], -i))
        self.rank = np.zeros(len(sp) + 1, dtype=np.int16)
        self.rank[order] = np.arange(1, len(sp) + 1)
        self.by_rank = np.array([0, *order], dtype=np.int16)
        if mode == "quant":  # converted once at load, after which everything is integer
            for k in ("kmax", "rdt", "rate", "soil_dt", "cast", "tol", "seed_b", "spread_thr",
                      "est_thr", "smother", "soil_min"):  # fmt: skip
                setattr(self, k, round_half_away(getattr(self, k)))

    def div(self, a, b):
        """a / b; in quant mode rounded half away from zero (INSTRUCTIONS §4). b > 0."""
        if self.mode == "float":
            return a / b
        return np.sign(a) * ((np.abs(a) + b // 2) // b)

    def grow_div(self, a, b):
        """Division for growth, where low densities would round to 0 (Q-015)."""
        if self.mode == "float":
            return a / b
        if self.rounding == "floor":
            q = self.div(a, b)
            return np.where((q == 0) & (a > 0), 1, q)
        q, r = np.divmod(np.abs(a), b)  # stochastic: the remainder is the probability of +1
        return np.sign(a) * (q + (self.rng.integers(0, b, size=np.shape(a)) < r))

    def id(self, name: str) -> int:
        return self.names.index(name) + 1

    def new_state(self, n: int) -> State:
        z, d = np.zeros, self.dtype
        return State(
            owner=z((n, n), np.int8),
            species=z((STRATA, n, n), np.int16),
            bio=z((STRATA, n, n), d),
            soil=z((n, n), d),
            prog=z((2, n, n), d),
            prog_own=z((STRATA, n, n), d),
        )

    def plant(self, st: State, player: int, name: str, mask: np.ndarray, frac=None) -> int:
        """Seed a species on own or empty cells of `mask` (gamerules §8). Replaces the player's own
        species in that stratum. Returns the number of cells planted."""
        sp = self.id(name)
        s = self.level[sp] - 1
        ok = mask & ((st.owner == 0) | (st.owner == player))
        if self.sw["succession"]:
            ok &= st.soil >= self.soil_min[sp]
        st.owner[ok] = player
        st.species[s][ok] = sp
        b = self.seed_b[sp] if frac is None else self.kmax[sp] * frac
        st.bio[s][ok] = b if self.mode == "float" else round_half_away(b)
        return int(ok.sum())

    def dominant(self, st: State) -> np.ndarray:
        dom = np.zeros(st.owner.shape, np.int8)
        for s in range(STRATA):
            sp = st.species[s]
            dom[(sp > 0) & (st.bio[s] >= self.est_thr[sp])] = s + 1
        return dom

    def step(self, st: State) -> dict[int, float]:
        """Advance one flora tick. Returns each player's income (positive growth per second)."""
        sw, sp, bio, owner = self.sw, st.species, st.bio, st.owner
        k = self.kmax[sp]
        cover = self.div(bio * ONE, k)

        # 1. Growth, logistic per stratum. Shade: upper strata lower the capacity of lower ones.
        shade = np.full(bio.shape, ONE, self.dtype)
        if sw["shade"]:
            for s in range(STRATA - 1):
                for u in range(s + 1, STRATA):
                    block = self.div(
                        self.cast[sp[u]] * cover[u] * (ONE - self.tol[sp[s]]), ONE * ONE
                    )
                    shade[s] = self.div(shade[s] * (ONE - block), ONE)
        keff = np.maximum(self.div(k * shade, ONE), 1)
        growth = np.where(sp > 0, self.grow_div(self.rdt[sp] * bio * (keff - bio), keff * ONE), 0)

        # 2. Soil development (succession).
        soil = st.soil
        if sw["succession"]:
            gain = sum(self.div(self.soil_dt[sp[s]] * cover[s], ONE) for s in range(STRATA))
            soil = np.minimum(soil + gain, U16)

        # 3. Spread candidates from the 4 neighbours, per player and stratum.
        dom = self.dominant(st)
        best, rate, attackers = {}, {}, {}
        for p in PLAYERS:
            src = [
                np.where((owner == p) & (sp[s] > 0) & (bio[s] >= self.spread_thr[sp[s]]), sp[s], 0)
                for s in range(STRATA)
            ]
            best[p] = np.zeros(sp.shape, np.int16)
            rate[p] = np.zeros(bio.shape, self.dtype)
            attackers[p] = np.zeros(owner.shape, np.int8)
            for dy, dx in DIRS:
                hit = np.zeros(owner.shape, bool)
                for s in range(STRATA):
                    c = nb(src[s], dy, dx)
                    ok = c > 0
                    if sw["succession"]:
                        ok &= st.soil >= self.soil_min[c]
                    best[p][s] = np.maximum(best[p][s], np.where(ok, self.rank[c], 0))
                    rate[p][s] = np.maximum(rate[p][s], np.where(ok, self.rate[c], 0))
                    hit |= ok & (self.level[c] > dom)
                attackers[p] += hit
        top = {p: self.by_rank[best[p].max(0)] for p in PLAYERS}  # best species over all strata

        # 4. Growth minus smothering by higher enemy levels; strata below 1 die.
        new_bio = bio + growth
        for p in PLAYERS:
            enemy = (owner == 3 - p) & (sp > 0)
            new_bio = new_bio - np.where(enemy, attackers[p] * self.smother[sp], 0)
        new_bio = np.clip(new_bio, 0, U16)
        new_sp = np.where(new_bio < 1, 0, sp).astype(np.int16)
        new_bio = np.where(new_sp > 0, new_bio, 0)
        new_owner = np.where((new_sp > 0).any(0), owner, 0).astype(np.int8)
        prog, prog_own = st.prog.copy(), np.zeros_like(st.prog_own)

        def establish(mask, p, species):
            for s in range(STRATA):
                m = mask & (self.level[species] == s + 1)
                new_sp[s][m] = species[m]
                new_bio[s][m] = self.seed_b[species][m]
            new_owner[mask] = p

        # 5. Smothered enemy cells flip to the attacker.
        for p in PLAYERS:
            won = (owner == 3 - p) & (new_owner == 0) & (attackers[p] > 0) & (top[p] > 0)
            establish(won, p, top[p])

        # 6. Empty cells: progress builds up; the first player to complete takes the cell.
        empty = owner == 0
        done = {}
        for p in PLAYERS:
            prog[p - 1] = np.where(empty, prog[p - 1] + rate[p].max(0), 0)
            done[p] = empty & (prog[p - 1] >= ONE) & (top[p] > 0)
        both = done[1] & done[2]
        for p in PLAYERS:
            q = 3 - p
            win = done[p] & ~done[q]
            if sw["contested_cells"]:
                win |= both & (self.level[top[p]] > self.level[top[q]])
            establish(win, p, top[p])
        prog[:, done[1] | done[2]] = 0

        # 7. Own-cell spread: any stratum fills the same empty stratum of a neighbouring own cell.
        if sw["own_spread"]:
            for p in PLAYERS:
                own = (owner == p) & (new_owner == p)
                for s in range(STRATA):
                    opn = own & (new_sp[s] == 0) & (best[p][s] > 0)
                    prog_own[s] = np.where(opn, st.prog_own[s] + rate[p][s], prog_own[s])
                    full = opn & (prog_own[s] >= ONE)
                    species = self.by_rank[best[p][s]]
                    new_sp[s][full] = species[full]
                    new_bio[s][full] = self.seed_b[species][full]
                    prog_own[s][full] = 0

        income = {
            p: float(np.where((owner == p) & (growth > 0), growth, 0).sum() / self.dt)
            for p in PLAYERS
        }
        st.owner, st.species, st.bio, st.soil = new_owner, new_sp, new_bio, soil
        st.prog, st.prog_own = prog, prog_own
        st.t += 1
        return income


# Scripted build orders for player 1: (time_s, species, dy, dx, radius) around the base.
# Player 2 uses its own order, point-mirrored through the map centre.
BUILDS = {
    "forest": (
        (0, "grasses", 0, 0, 3),
        (0, "lichen", 0, 8, 3),
        (150, "clover", 0, 0, 2),
        (240, "elder", 0, 0, 2),
        (300, "hawthorn", 6, 0, 2),
        (420, "oak", 0, 0, 2),
        (540, "beech", 4, 4, 2),
    ),
    "meadow": (
        (0, "grasses", 0, 0, 3),
        (0, "lichen", 0, 8, 3),
        (60, "grasses", 8, 0, 3),
        (120, "grasses", 8, 8, 3),
        (150, "clover", 0, 0, 2),
        (300, "elder", 0, 0, 2),
    ),
}


def run(
    flora: Flora,
    n: int,
    minutes: float,
    seed: int,
    builds=("forest", "meadow"),
    snap_min=(5, 10, 20),
):
    """Play the scripted scenario. An order waits until it can plant at least one cell, like a
    player waiting for the soil. Returns (metrics rows, {minute: (owner, dominant)}, final state,
    planting log)."""
    rng = np.random.default_rng(seed)
    base = np.array([n // 4, n // 4]) + rng.integers(-2, 3, size=2)
    yy, xx = np.mgrid[:n, :n]
    st = flora.new_state(n)
    orders = {p: sorted(BUILDS[b]) for p, b in zip(PLAYERS, builds, strict=True)}
    steps = round(minutes * 60 / flora.dt)
    snap_steps = {round(m * 60 / flora.dt): m for m in snap_min if m <= minutes}
    rows, snaps, log = [], {}, []
    for i in range(steps + 1):
        t = i * flora.dt
        for p in PLAYERS:
            while orders[p] and orders[p][0][0] <= t:
                _, name, dy, dx, r = orders[p][0]
                cy, cx = base + (dy, dx)
                if p == 2:
                    cy, cx = n - 1 - cy, n - 1 - cx
                cells = flora.plant(st, p, name, (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r)
                if not cells:
                    break
                orders[p].pop(0)
                log.append((t, p, name, cells))
        if i in snap_steps:
            snaps[snap_steps[i]] = (st.owner.copy(), flora.dominant(st))
        if i == steps:
            break
        income = flora.step(st)
        row = {"t_s": round(t + flora.dt, 3)}
        for p in PLAYERS:
            mine = st.owner == p
            row[f"biomass_p{p}"] = float(st.bio.sum(0)[mine].sum())
            row[f"territory_p{p}"] = float(mine.mean())
            row[f"income_p{p}"] = income[p]
            row[f"soil_p{p}"] = float(st.soil[mine].mean() / U16) if mine.any() else 0.0
        rows.append(row)
    return rows, snaps, st, log


P_COLOR = {1: "#0072B2", 2: "#E69F00"}  # Q-009 default pair, validated for CVD separation


def plot(rows, snaps, out: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    t = np.array([r["t_s"] for r in rows]) / 60
    fig, axes = plt.subplots(1, 3, figsize=(15, 4), layout="constrained")
    for ax, (key, title) in zip(
        axes,
        (
            ("biomass", "Standing biomass"),
            ("territory", "Territory share"),
            ("income", "Income (growth / s)"),
        ),
        strict=True,
    ):
        for p in PLAYERS:
            y = np.array([r[f"{key}_p{p}"] for r in rows])
            ax.plot(t, y, color=P_COLOR[p], lw=2, label=f"P{p}")
            ax.annotate(
                f"P{p}",
                (t[-1], y[-1]),
                xytext=(4, 0),
                textcoords="offset points",
                va="center",
                color="#333",
            )
        ax.set_title(title, loc="left")
        ax.set_xlabel("minutes")
        ax.grid(color="#e5e5e5", lw=0.8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(frameon=False)
    fig.savefig(out / "curves.png", dpi=110)
    plt.close(fig)

    # Signed dominant level: P2 L3..L1 (orange ramp), bare (grey), P1 L1..L3 (blue ramp).
    cmap = ListedColormap(
        ["#8a4b00", "#E69F00", "#f5d08a", "#d9d6cf", "#9ecae9", "#0072B2", "#003d61"]
    )
    fig, axes = plt.subplots(
        1, len(snaps), figsize=(4.5 * len(snaps), 4.5), layout="constrained", squeeze=False
    )
    for ax, (m, (owner, dom)) in zip(axes[0], sorted(snaps.items()), strict=True):
        lv = np.where(owner > 0, np.maximum(dom, 1), 0) * np.where(owner == 2, -1, 1)
        ax.imshow(lv, cmap=cmap, vmin=-3.5, vmax=3.5, interpolation="nearest")
        ax.set_title(f"{m} min — dominant level (P1 blue, P2 orange)", loc="left", fontsize=9)
        ax.set_axis_off()
    fig.savefig(out / "maps.png", dpi=110)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--p1", choices=BUILDS, default="forest")
    ap.add_argument("--p2", choices=BUILDS, default="meadow")
    ap.add_argument("--mode", choices=("float", "quant"), default="float")
    ap.add_argument("--rounding", choices=("floor", "stochastic"), default="floor")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    for s in SWITCHES:
        ap.add_argument(f"--no-{s.replace('_', '-')}", dest=s, action="store_false", default=None)
    a = ap.parse_args()
    flora = Flora(
        load_balance(),
        a.mode,
        a.rounding,
        a.seed,
        **{s: getattr(a, s) for s in SWITCHES if getattr(a, s) is not None},
    )
    tag = a.mode if a.mode == "float" else f"quant-{a.rounding}"
    out = a.out / f"{tag}_seed{a.seed}"
    out.mkdir(parents=True, exist_ok=True)
    rows, snaps, _, log = run(flora, a.size, a.minutes, a.seed, (a.p1, a.p2))
    for t, p, name, cells in log:
        print(f"{t / 60:5.1f} min  P{p} planted {name} ({cells} cells)")
    with open(out / "metrics.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    plot(rows, snaps, out)
    last = rows[-1]
    print(
        " | ".join(
            f"P{p}: territory {last[f'territory_p{p}']:.1%}, biomass {last[f'biomass_p{p}']:.3g}"
            for p in PLAYERS
        )
    )
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
