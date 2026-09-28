"""M0 scripted match: two build orders play out on the flora + fauna prototype; CSV and plots.

Run: npm run proto -- --seed 1 --minutes 20 [--mode quant] [--no-animals] [--compare]
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

import numpy as np

from prototype.economy import Economy
from prototype.fauna import DECOMPOSER, HERBIVORE, PREDATOR, Agents, Fauna
from prototype.flora import DIRS, PLAYERS, SWITCHES, U16, Flora, load_balance, nb

# Build orders for player 1. Flora: (time_s, species, dy, dx, radius) around the base; offsets are
# in cells of a 128 map and scale with the map size. Fauna: (time_s, species), spawned per
# gamerules §6.3 with the base as the clicked point. An order waits until it can be executed.
# Player 2 uses its own order, point-mirrored through the map centre.
BUILDS = {
    "forest": (  # pushes shrubs and trees toward the frontier (M0.7)
        (0, "grasses", 0, 0, 3),
        (0, "lichen", 0, 8, 3),
        (60, "earthworms"),
        (150, "clover", 0, 0, 2),
        (240, "elder", 0, 0, 2),
        (300, "hawthorn", 6, 0, 2),
        (300, "voles"),
        (360, "elder", 16, 16, 2),
        (420, "hawthorn", 18, 18, 2),
        (420, "oak", 0, 0, 2),
        (540, "oak", 14, 14, 2),
        (540, "beech", 4, 4, 2),
        (540, "caterpillars"),
        (600, "tits"),
        (720, "fox"),
        (900, "buzzard"),
    ),
    "meadow": (
        (0, "grasses", 0, 0, 3),
        (0, "lichen", 0, 8, 3),
        (60, "grasses", 8, 0, 3),
        (60, "earthworms"),
        (120, "grasses", 8, 8, 3),
        (150, "clover", 0, 0, 2),
        (240, "grasshoppers"),
        (300, "elder", 0, 0, 2),
        (360, "rabbits"),
        (600, "hedgehog"),
        (720, "fox"),
    ),
}


def run(
    flora: Flora,
    n: int,
    minutes: float,
    seed: int,
    builds=("forest", "meadow"),
    snap_min=(5, 10, 20),
    fauna: Fauna | None = None,
    economy: Economy | None = None,
):
    """Play the scripted match; without `fauna`, animal orders are skipped. With `economy`, orders
    buy their unlocks and wait until affordable, and the match stops at a victory (logged as
    "end: <reason>"). Returns (metrics rows, {minute: (owner, dominant, agents)}, final flora
    state, order log)."""
    rng = np.random.default_rng(seed)
    base = np.array([n // 4, n // 4]) + rng.integers(-2, 3, size=2)
    yy, xx = np.mgrid[:n, :n]
    st, ag = flora.new_state(n), Agents.empty()
    orders = {
        p: [o for o in sorted(BUILDS[b], key=lambda o: o[0]) if fauna or len(o) == 5]
        for p, b in zip(PLAYERS, builds, strict=True)
    }
    steps = round(minutes * 60 / flora.dt)
    snap_steps = {round(m * 60 / flora.dt): m for m in snap_min if m <= minutes}
    rows, snaps, log = [], {}, []
    total = {f"{k}_p{p}": 0 for k in ("taken", "kills", "grazed") for p in PLAYERS}
    for i in range(steps + 1):
        t = i * flora.dt
        for p in PLAYERS:
            home = base if p == 1 else n - 1 - base
            for o in [o for o in orders[p] if o[0] <= t]:
                name = o[1]
                if economy and not economy.prepare(p, name):
                    continue
                if len(o) == 5:
                    cy, cx = base + np.round(np.array(o[2:4]) * n / 128).astype(int)
                    if p == 2:
                        cy, cx = n - 1 - cy, n - 1 - cx
                    disc = (yy - cy) ** 2 + (xx - cx) ** 2 <= o[4] ** 2
                    if economy and economy.bank[p] < economy.plant_cost(name, int(disc.sum())):
                        continue
                    done = flora.plant(st, p, name, disc)
                    if economy and done:
                        economy.pay(p, economy.plant_cost(name, done))
                else:
                    group = int(fauna.group[fauna.idx(name)])
                    if economy and economy.bank[p] < economy.spawn_cost(name, group, True):
                        continue
                    ag, done = fauna.spawn(st, ag, p, name, home)
                    if economy and done:
                        outside = st.owner[ag.y[-1], ag.x[-1]] != p
                        economy.pay(p, economy.spawn_cost(name, done, outside))
                if done:
                    orders[p].remove(o)
                    log.append((t, p, o[1], done))
        if i in snap_steps:
            snaps[snap_steps[i]] = (
                st.owner.copy(),
                flora.dominant(st),
                ag.keep(np.arange(len(ag))),
            )
        if i == steps:
            break
        before = st.owner.copy()
        income = flora.step(st)
        stats = {}
        if fauna:
            ag, stats = fauna.step(st, ag)
            for k, v in stats.items():
                if k in total:
                    total[k] += v
        dom = flora.dominant(st)
        row = {"t_s": round(t + flora.dt, 3)}
        for p in PLAYERS:
            mine = st.owner == p
            # Frontier: own cells next to an enemy cell. front_hi: share of it held by L2+.
            front = mine & np.logical_or.reduce([nb(st.owner == 3 - p, *d) for d in DIRS])
            total[f"taken_p{p}"] += int((mine & (before == 3 - p)).sum())
            row[f"front_p{p}"] = int(front.sum())
            row[f"front_hi_p{p}"] = float((dom[front] >= 2).mean()) if front.any() else 0.0
            row[f"biomass_p{p}"] = float(st.bio.sum(0)[mine].sum())
            row[f"territory_p{p}"] = float(mine.mean())
            row[f"income_p{p}"] = income[p]
            row[f"soil_p{p}"] = float(st.soil[mine].mean() / U16) if mine.any() else 0.0
            row[f"mixed_p{p}"] = (
                float(((st.bio > 0).sum(0) >= 2)[mine].mean()) if mine.any() else 0.0
            )
            if fauna:
                role = fauna.role[ag.sp][ag.owner == p]
                for r, name in ((HERBIVORE, "herbivores"), (PREDATOR, "predators"),
                                (DECOMPOSER, "decomposers")):  # fmt: skip
                    row[f"{name}_p{p}"] = int((role == r).sum())
            if economy:
                economy.earn(p, income[p] * flora.dt, stats.get(f"fed_p{p}", 0))
                bodies = fauna.body[ag.sp[ag.owner == p]].sum() if fauna else 0
                row[f"standing_p{p}"] = row[f"biomass_p{p}"] + float(bodies)
                row[f"bank_p{p}"] = economy.bank[p]
        row.update(total)
        rows.append(row)
        if economy:
            territory = {p: row[f"territory_p{p}"] for p in PLAYERS}
            standing = {p: row[f"standing_p{p}"] for p in PLAYERS}
            end = economy.winner(row["t_s"], territory, standing)
            if end:
                log.append((row["t_s"], end[0], f"end: {end[1]}", 0))
                break
    return rows, snaps, st, log


P_COLOR = {1: "#0072B2", 2: "#E69F00"}  # Q-009 default pair, validated for CVD separation
P_DARK = {1: "#002a45", 2: "#5c3300"}  # agent dots, darker than any territory tint


def plot(rows, snaps, out: Path, fauna: Fauna | None = None):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    t = np.array([r["t_s"] for r in rows]) / 60
    panels = [
        ("biomass", "Standing flora biomass"),
        ("territory", "Territory share"),
        ("income", "Income (growth / s)"),
    ]
    fig, axes = plt.subplots(1, 3 + bool(fauna), figsize=(5 * (3 + bool(fauna)), 4),
                             layout="constrained")  # fmt: skip
    for ax, (key, title) in zip(axes, panels, strict=False):
        for p in PLAYERS:
            y = np.array([r[f"{key}_p{p}"] for r in rows])
            ax.plot(t, y, color=P_COLOR[p], lw=2, label=f"P{p}")
            ax.annotate(f"P{p}", (t[-1], y[-1]), xytext=(4, 0), textcoords="offset points",
                        va="center", color="#333")  # fmt: skip
        ax.set_title(title, loc="left")
    if fauna:  # animal populations: herbivores solid, predators dashed
        ax = axes[3]
        for p in PLAYERS:
            for key, ls in (("herbivores", "-"), ("predators", "--")):
                y = np.array([r[f"{key}_p{p}"] for r in rows])
                ax.plot(t, y, color=P_COLOR[p], lw=2, ls=ls, label=f"P{p} {key}")
        ax.set_title("Animals", loc="left")
    for ax in axes:
        ax.set_xlabel("minutes")
        ax.grid(color="#e5e5e5", lw=0.8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(frameon=False, fontsize=8)
    fig.savefig(out / "curves.png", dpi=110)
    plt.close(fig)

    # Signed dominant level: P2 L3..L1 (orange ramp), bare (grey), P1 L1..L3 (blue ramp).
    # Animals: dots (herbivores, decomposers) and triangles (predators) in dark player colours.
    cmap = ListedColormap(
        ["#8a4b00", "#E69F00", "#f5d08a", "#d9d6cf", "#9ecae9", "#0072B2", "#003d61"]
    )
    fig, axes = plt.subplots(
        1, len(snaps), figsize=(4.5 * len(snaps), 4.5), layout="constrained", squeeze=False
    )
    for ax, (m, (owner, dom, ag)) in zip(axes[0], sorted(snaps.items()), strict=True):
        lv = np.where(owner > 0, np.maximum(dom, 1), 0) * np.where(owner == 2, -1, 1)
        ax.imshow(lv, cmap=cmap, vmin=-3.5, vmax=3.5, interpolation="nearest")
        if fauna and len(ag):
            pred = fauna.role[ag.sp] == PREDATOR
            for p in PLAYERS:
                for sel, mk, size in ((~pred, "o", 4), (pred, "^", 18)):
                    k = sel & (ag.owner == p)
                    ax.scatter(ag.x[k], ag.y[k], s=size, marker=mk, color=P_DARK[p], lw=0)
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


def compare(balance: dict, n: int, minutes: float, seed: int, builds, out: Path, animals: bool):
    """Run every variant on the same scenario; write compare.csv and compare.png."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    results = []
    for label, kw in VARIANTS:
        t0 = time.perf_counter()
        fl = Flora(balance, seed=seed, **kw)
        fa = Fauna(balance, fl, seed) if animals else None
        rows, _, _, _ = run(fl, n, minutes, seed, builds, fauna=fa)
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
    for ax, (label, rows) in zip(axes.flat, results, strict=False):
        t = np.array([r["t_s"] for r in rows]) / 60
        for p in PLAYERS:
            y = np.array([r[f"territory_p{p}"] for r in rows])
            ax.plot(t, y, color=P_COLOR[p], lw=2, label=f"P{p} ({builds[p - 1]})")
            ax.annotate(f"{y[-1]:.0%}", (t[-1], y[-1]), xytext=(4, 0), textcoords="offset points",
                        va="center", color="#333", fontsize=8)  # fmt: skip
        ax.set_title(label, loc="left")
        ax.grid(color="#e5e5e5", lw=0.8)
        ax.spines[["top", "right"]].set_visible(False)
    for ax in axes.flat[len(results) :]:
        ax.set_axis_off()
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
    ap.add_argument("--no-animals", dest="animals", action="store_false")
    ap.add_argument("--no-economy", dest="economy", action="store_false")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    ap.add_argument("--compare", action="store_true", help="M0.3: run every variant (VARIANTS)")
    for s in SWITCHES:
        ap.add_argument(f"--no-{s.replace('_', '-')}", dest=s, action="store_false", default=None)
    a = ap.parse_args()
    balance = load_balance()
    if a.compare:
        out = a.out / f"compare_seed{a.seed}"
        out.mkdir(parents=True, exist_ok=True)
        compare(balance, a.size, a.minutes, a.seed, (a.p1, a.p2), out, a.animals)
        print(f"wrote {out}")
        return
    switches = {s: getattr(a, s) for s in SWITCHES if getattr(a, s) is not None}
    flora = Flora(balance, a.mode, a.rounding, a.seed, **switches)
    fauna = Fauna(balance, flora, a.seed) if a.animals else None
    economy = Economy(balance, flora, fauna) if a.economy else None
    tag = a.mode if a.mode == "float" else f"quant-{a.rounding}"
    out = a.out / f"{tag}_seed{a.seed}"
    out.mkdir(parents=True, exist_ok=True)
    rows, snaps, _, log = run(
        flora, a.size, a.minutes, a.seed, (a.p1, a.p2), fauna=fauna, economy=economy
    )
    for t, p, name, count in log:
        if name.startswith("end"):
            print(f"{t / 60:5.1f} min  {'draw' if p == 0 else f'P{p} wins'} ({name[5:]})")
        else:
            print(f"{t / 60:5.1f} min  P{p} {name} ({count})")
    with open(out / "metrics.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    plot(rows, snaps, out, fauna)
    last = rows[-1]
    for p in PLAYERS:
        line = f"P{p}: territory {last[f'territory_p{p}']:.1%}, flora {last[f'biomass_p{p}']:.3g}"
        if economy:
            line += f", standing {last[f'standing_p{p}']:.3g}, bank {last[f'bank_p{p}']}"
        if fauna:
            line += (f", herbivores {last[f'herbivores_p{p}']}, predators {last[f'predators_p{p}']}"
                     f", kills {last[f'kills_p{p}']}, grazed {last[f'grazed_p{p}']}")  # fmt: skip
        print(line)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
