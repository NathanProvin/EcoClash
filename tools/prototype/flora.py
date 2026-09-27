"""M0 flora prototype: the gamerules cell model (gamerules §2.1, §3; D-019, D-022).

Each cell has an owner. Several of the owner's species can share a cell, also within one stratum
(L1 herbaceous, L2 shrub, L3 canopy): they compete with partial niche overlap, so mixed stands
hold more biomass than monocultures. State units match the future integer sim: biomass and soil
development in [0, U16], cover and colonization progress in [0, ONE]. Every rule reads the
previous state (double buffering).

Run: npm run proto:flora -- --seed 1 --minutes 20 [--mode quant] [--compare]
"""

from __future__ import annotations

import argparse
import csv
import time
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
    """Value of each cell's neighbour at (y + dy, x + dx) over the last two axes; 0 outside the
    map (no wrap)."""
    n0, n1 = a.shape[-2:]
    p = np.pad(a, [(0, 0)] * (a.ndim - 2) + [(1, 1), (1, 1)])
    return p[..., 1 + dy : 1 + dy + n0, 1 + dx : 1 + dx + n1]


def X(a: np.ndarray) -> np.ndarray:
    """Per-species column, broadcast over the map."""
    return a[:, None, None]


@dataclass
class State:
    owner: np.ndarray  # (N, N) int8: 0 none, else player
    bio: np.ndarray  # (S, N, N) biomass per species
    soil: np.ndarray  # (N, N) soil development
    prog: np.ndarray  # (2, N, N) colonization progress on empty cells, per player
    prog_own: np.ndarray  # (S, N, N) own-cell spread progress, per species
    t: int = 0  # flora steps done


class Flora:
    """Species tables and rules, converted once from balance.toml."""

    def __init__(self, balance: dict, mode="float", rounding="floor", seed=0, **switches: bool):
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
        sp = [f[n] for n in self.names]  # species index = table order
        assert 0 <= f["niche_overlap"] <= 1
        for n, s in zip(self.names, sp, strict=True):
            assert s["level"] in (1, 2, 3), n
            assert 0 < s["k_max"] <= U16, n
            assert 0 <= s["shade_cast"] < 1 and 0 <= s["shade_tolerance"] <= 1, n
            assert s["growth_rate"] * self.dt < 1, f"{n}: growth_rate * dt must stay < 1"

        def col(key, scale=1.0):
            return np.array([s[key] * scale for s in sp], dtype=np.float64)

        self.level = np.array([s["level"] for s in sp], dtype=np.int8)
        self.strata = [np.flatnonzero(self.level == s + 1) for s in range(STRATA)]
        self.kmax = col("k_max")
        self.rdt = col("growth_rate", self.dt * ONE)
        self.rate = col("spread_rate", self.dt * ONE)
        self.soil_dt = col("soil_gain", self.dt * U16)
        self.cast = col("shade_cast", ONE)
        self.tol = col("shade_tolerance", ONE)
        self.alpha = np.float64(f["niche_overlap"] * ONE)
        self.seed_b = self.kmax * f["seed_fraction"]
        self.spread_thr = self.kmax * f["spread_threshold"]
        self.est_thr = self.kmax * f["establish_threshold"]
        self.smother = self.kmax * f["smother_rate"] * self.dt
        mins = np.array(f["soil_min_level"]) * U16
        self.soil_min = np.where(col("pioneer") > 0, 0.0, mins[self.level - 1])
        # Spread target preference: fastest spread (it arrives first), then highest level, then
        # lowest index. Higher strata reach bare land later, through own-cell spread.
        order = sorted(range(len(sp)), key=lambda i: (self.rate[i], self.level[i], -i))
        self.rank = np.zeros(len(sp), dtype=np.int16)
        self.rank[order] = np.arange(1, len(sp) + 1)
        self.by_rank = np.array([-1, *order])  # rank 0 = no candidate
        if mode == "quant":  # converted once at load, after which everything is integer
            for k in ("kmax", "rdt", "rate", "soil_dt", "cast", "tol", "alpha", "seed_b",
                      "spread_thr", "est_thr", "smother", "soil_min"):  # fmt: skip
                setattr(self, k, round_half_away(getattr(self, k)))

    def div(self, a, b):
        """a / b; in quant mode rounded half away from zero (INSTRUCTIONS §4). b > 0."""
        if self.mode == "float":
            return a / b
        return np.sign(a) * ((np.abs(a) + b // 2) // b)

    def grow_div(self, a, b):
        """Division for growth, where low densities would round to 0 (Q-015, D-021)."""
        if self.mode == "float":
            return a / b
        if self.rounding == "floor":
            q = self.div(a, b)
            return np.where((q == 0) & (a > 0), 1, q)
        q, r = np.divmod(np.abs(a), b)  # stochastic: the remainder is the probability of +1
        return np.sign(a) * (q + (self.rng.integers(0, b, size=np.shape(a)) < r))

    def idx(self, name: str) -> int:
        return self.names.index(name)

    def new_state(self, n: int) -> State:
        z, d, s = np.zeros, self.dtype, len(self.names)
        return State(
            owner=z((n, n), np.int8),
            bio=z((s, n, n), d),
            soil=z((n, n), d),
            prog=z((2, n, n), d),
            prog_own=z((s, n, n), d),
        )

    def plant(self, st: State, player: int, name: str, mask: np.ndarray, frac=None) -> int:
        """Seed a species on own or empty cells of `mask` (gamerules §8), alongside what already
        grows there. Returns the number of cells planted."""
        i = self.idx(name)
        ok = mask & ((st.owner == 0) | (st.owner == player))
        if self.sw["succession"]:
            ok &= st.soil >= self.soil_min[i]
        b = self.seed_b[i] if frac is None else self.kmax[i] * frac
        b = b if self.mode == "float" else round_half_away(b)
        st.owner[ok] = player
        st.bio[i][ok] = np.maximum(st.bio[i][ok], b)
        return int(ok.sum())

    def dominant(self, st: State) -> np.ndarray:
        dom = np.zeros(st.owner.shape, np.int8)
        for s, idx in enumerate(self.strata):
            dom[(st.bio[idx] >= X(self.est_thr[idx])).any(0)] = s + 1
        return dom

    def step(self, st: State) -> dict[int, float]:
        """Advance one flora tick. Returns each player's income (positive growth per second)."""
        sw, bio, owner = self.sw, st.bio, st.owner
        present = bio > 0
        cover = self.div(bio * ONE, X(self.kmax))

        # 1. Shade: the cover of each upper stratum lowers the capacity of the species below it.
        shade = np.full(bio.shape, ONE, self.dtype)
        if sw["shade"]:
            for u in (1, 2):
                up = self.strata[u]
                cast = self.div((X(self.cast[up]) * cover[up]).sum(0), ONE)
                low = np.flatnonzero(self.level <= u)
                block = self.div(cast * X(ONE - self.tol[low]), ONE)
                shade[low] = self.div(shade[low] * np.maximum(ONE - block, 0), ONE)
            shade = np.maximum(shade, 1)

        # 2. Growth: logistic, with competition inside a stratum weighted by niche overlap.
        comp = np.empty_like(cover)
        for idx in self.strata:
            others = cover[idx].sum(0) - cover[idx]
            comp[idx] = cover[idx] + self.div(self.alpha * others, ONE)
        growth = self.grow_div(X(self.rdt) * bio * (shade - comp), shade * ONE)
        growth = np.where(present, growth, 0)

        # 3. Soil development (succession).
        soil = st.soil
        if sw["succession"]:
            soil = np.minimum(soil + self.div((X(self.soil_dt) * cover).sum(0), ONE), U16)

        # 4. Spread candidates from the 4 neighbours, per player and species.
        dom = self.dominant(st)
        soil_ok = st.soil >= X(self.soil_min) if sw["succession"] else np.True_
        reach, best, att, rate, attackers = {}, {}, {}, {}, {}
        for p in PLAYERS:
            src = (owner == p) & (bio >= X(self.spread_thr))
            reach[p] = np.zeros(bio.shape, bool)
            attackers[p] = np.zeros(owner.shape, np.int8)
            higher = X(self.level) > dom
            for dy, dx in DIRS:
                ok = nb(src, dy, dx) & soil_ok
                reach[p] |= ok
                attackers[p] += (ok & higher).any(0)
            best[p] = np.where(reach[p], X(self.rank), 0).max(0)  # target on empty land
            att[p] = np.where(reach[p] & higher, X(self.rank), 0).max(0)  # target when smothering
            rate[p] = np.where(reach[p], X(self.rate), 0).max(0)

        # 5. Growth minus smothering by higher enemy levels; species below 1 die.
        new_bio = bio + growth
        for p in PLAYERS:
            enemy = (owner == 3 - p) & present
            new_bio = new_bio - np.where(enemy, attackers[p] * X(self.smother), 0)
        new_bio = np.clip(new_bio, 0, U16)
        new_bio = np.where(new_bio < 1, 0, new_bio)
        new_owner = np.where((new_bio > 0).any(0), owner, 0).astype(np.int8)
        prog, prog_own = st.prog.copy(), np.zeros_like(st.prog_own)

        def establish(mask, p, target):
            ys, xs = np.nonzero(mask)
            i = self.by_rank[target[ys, xs]]
            new_bio[i, ys, xs] = self.seed_b[i]
            new_owner[mask] = p

        # 6. Smothered enemy cells flip to the attacker.
        for p in PLAYERS:
            establish((owner == 3 - p) & (new_owner == 0) & (att[p] > 0), p, att[p])

        # 7. Empty cells: progress builds up; the first player to complete takes the cell.
        empty = owner == 0
        done = {}
        for p in PLAYERS:
            prog[p - 1] = np.where(empty, prog[p - 1] + rate[p], 0)
            done[p] = empty & (prog[p - 1] >= ONE) & (best[p] > 0)
        both = done[1] & done[2]
        for p in PLAYERS:
            q = 3 - p
            win = done[p] & ~done[q]
            if sw["contested_cells"]:
                lv = {k: self.level[self.by_rank[best[k]]] for k in PLAYERS}
                win |= both & (lv[p] > lv[q])
            establish(win, p, best[p])
        prog[:, done[1] | done[2]] = 0

        # 8. Own-cell spread: each species fills neighbouring own cells where it is absent.
        if sw["own_spread"]:
            for p in PLAYERS:
                own = (owner == p) & (new_owner == p)
                opn = own & (new_bio == 0) & reach[p]
                prog_own = np.where(opn, st.prog_own + X(self.rate), prog_own)
                full = opn & (prog_own >= ONE)
                new_bio = np.where(full, X(self.seed_b), new_bio)
                prog_own[full] = 0

        income = {
            p: float(np.where((owner == p) & (growth > 0), growth, 0).sum() / self.dt)
            for p in PLAYERS
        }
        st.owner, st.bio, st.soil, st.prog, st.prog_own = new_owner, new_bio, soil, prog, prog_own
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
            row[f"mixed_p{p}"] = (
                float(((st.bio > 0).sum(0) >= 2)[mine].mean()) if mine.any() else 0.0
            )
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


# M0.3 comparison variants: (label, Flora keyword arguments). Baseline: float, all switches on.
VARIANTS = (
    ("baseline", {}),
    ("quant", {"mode": "quant"}),
    *((f"no {s.replace('_', ' ')}", {s: False}) for s in SWITCHES),
)


def compare(balance: dict, n: int, minutes: float, seed: int, builds, out: Path):
    """Run every variant on the same scenario; write compare.csv and compare.png."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    results = []
    for label, kw in VARIANTS:
        t0 = time.perf_counter()
        rows, _, _, _ = run(Flora(balance, seed=seed, **kw), n, minutes, seed, builds)
        results.append((label, rows))
        last = rows[-1]
        print(f"{label:<20} {time.perf_counter() - t0:5.1f} s  " + "  ".join(
            f"P{p} terr {last[f'territory_p{p}']:.1%} bio {last[f'biomass_p{p}']:.3g} "
            f"mixed {last[f'mixed_p{p}']:.0%}" for p in PLAYERS))  # fmt: skip
    keys = [k for k in results[0][1][-1] if k != "t_s"]
    with open(out / "compare.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["variant", *keys])
        w.writerows([label, *(rows[-1][k] for k in keys)] for label, rows in results)

    # Small multiples: territory share per variant, same axes, P1 blue / P2 orange.
    fig, axes = plt.subplots(2, 3, figsize=(13, 7), sharex=True, sharey=True, layout="constrained")
    for ax, (label, rows) in zip(axes.flat, results, strict=True):
        t = np.array([r["t_s"] for r in rows]) / 60
        for p in PLAYERS:
            y = np.array([r[f"territory_p{p}"] for r in rows])
            ax.plot(t, y, color=P_COLOR[p], lw=2, label=f"P{p} ({builds[p - 1]})")
            ax.annotate(f"{y[-1]:.0%}", (t[-1], y[-1]), xytext=(4, 0), textcoords="offset points",
                        va="center", color="#333", fontsize=8)  # fmt: skip
        ax.set_title(label, loc="left")
        ax.grid(color="#e5e5e5", lw=0.8)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0, 0].legend(frameon=False)
    for ax in axes[1]:
        ax.set_xlabel("minutes")
    fig.suptitle("Territory share by variant", x=0.01, ha="left")
    fig.savefig(out / "compare.png", dpi=110)
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
    ap.add_argument("--compare", action="store_true", help="M0.3: run every variant (VARIANTS)")
    for s in SWITCHES:
        ap.add_argument(f"--no-{s.replace('_', '-')}", dest=s, action="store_false", default=None)
    a = ap.parse_args()
    if a.compare:
        out = a.out / f"compare_seed{a.seed}"
        out.mkdir(parents=True, exist_ok=True)
        compare(load_balance(), a.size, a.minutes, a.seed, (a.p1, a.p2), out)
        print(f"wrote {out}")
        return
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
