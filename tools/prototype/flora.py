"""M0 flora prototype: the gamerules cell model (gamerules §2.1, §3; D-019, D-022, D-024).

Each cell has an owner. Several of the owner's species can share a cell, also within one stratum
(L1 herbaceous, L2 shrub, L3 canopy): they compete with partial niche overlap, so mixed stands
hold more biomass than monocultures. Each species has a colonization gauge per cell (0-100 %),
driven by same-species neighbours and site suitability; it caps the species' capacity there.
State units match the future integer sim: biomass, soil development, water and light in
[0, U16]; cover, gauge and claim progress in [0, ONE]. Every rule reads the previous state
(double buffering).

The scripted match, plots and CLI are in match.py (npm run proto).
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BALANCE = ROOT / "data" / "balance.toml"
SPECIES = ROOT / "data" / "species.toml"
ONE = 1 << 16  # Q16.16 one: scale of fractions and of colonization progress
U16 = ONE - 1
STRATA = 4  # height strata: herbs, intermediate, shrubs, trees (D-087)
PLAYERS = (1, 2)
DIRS = ((-1, 0), (1, 0), (0, -1), (0, 1))
SWITCHES = ("succession", "shade", "contested_cells")


def load_balance(path: Path = BALANCE, species: Path = SPECIES) -> dict:
    """Global rules (balance.toml) with the per-species tables of species.toml merged into
    balance["flora"] and balance["fauna"] (D-029)."""
    balance = tomllib.loads(path.read_text(encoding="utf-8"))
    for kind, tables in tomllib.loads(species.read_text(encoding="utf-8")).items():
        balance[kind] |= tables
    return balance


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
    gauge: np.ndarray  # (S, N, N) colonization gauge in [0, ONE]: capacity = k_max x gauge
    soil: np.ndarray  # (N, N) soil development
    soil_type: np.ndarray  # (N, N) int8 index into terrain.soil_types (V1: 0 = loam)
    water: np.ndarray  # (N, N) moisture in [0, U16] (V1: constant)
    light: np.ndarray  # (N, N) light in [0, U16] (V1: constant)
    prog: np.ndarray  # (2, N, N) claim progress on empty cells, per player
    dead: np.ndarray  # (N, N) dead biomass (litter), eaten by decomposers
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
        f, sim, terrain = balance["flora"], balance["sim"], balance["terrain"]
        self.step_s = sim["flora_every_ticks"] / sim["tick_hz"]  # real seconds per flora step
        self.pace = sim["pace"]  # seconds of ecology per real second (D-069)
        self.dt = self.step_s * self.pace  # ecology seconds per step: every rate uses it
        self.sw = {k: switches.get(k, f.get(k, False)) for k in SWITCHES}  # retired rules (D-226)
        self.names = [k for k, v in f.items() if isinstance(v, dict)]
        sp = [f[n] for n in self.names]  # species index = table order
        soil_types = terrain["soil_types"]
        assert soil_types[0] == "loam" and 0 <= f["niche_overlap"] <= 1 and f["soil_ramp"] > 0
        for n, s in zip(self.names, sp, strict=True):
            assert 1 <= s["level"] <= STRATA, n
            assert 0 < s["k_max"] <= U16, n
            assert 0 <= s["shade_cast"] < 1 and 0 <= s["shade_tolerance"] <= 1, n
            assert s["biomass_rate"] * self.dt < 1, f"{n}: biomass_rate * dt must stay < 1"
            assert s["growth"] * self.dt <= 1, f"{n}: growth * dt must stay <= 1"
            assert 0 < s["cap"] <= 1, f"{n}: cap is a share of the map (D-045)"
            assert set(s.get("soil_affinity", {})) <= set(soil_types), n

        def col(key, scale=1.0, default=None):
            return np.array([s.get(key, default) * scale for s in sp], dtype=np.float64)

        self.level = np.array([s["level"] for s in sp], dtype=np.int8)
        self.family = np.array([s["family"] for s in sp])  # tech-tree family (D-087)
        self.strata = [np.flatnonzero(self.level == s + 1) for s in range(STRATA)]
        self.kmax = col("k_max")
        self.rdt = col("biomass_rate", self.dt * ONE)
        self.rate = col("growth", self.dt * ONE)  # colonization gauge speed (D-029 stat)
        self.yld = col("yield")  # points per second per fully covered cell (economy)
        self.cap = col("cap", ONE)  # share of the map's cells per player (Q16, D-045)
        self.soil_dt = col("soil_gain", self.dt * U16)
        self.cast = col("shade_cast", ONE)
        self.tol = col("shade_tolerance", ONE)
        self.alpha = np.float64(f["niche_overlap"] * ONE)
        self.seed_b = self.kmax * f["seed_fraction"]
        self.est_thr = self.kmax * f["establish_threshold"]
        self.smother = self.kmax * f["smother_rate"] * self.dt
        self.litter = self.rdt * f["litter_fraction"]  # per tick, Q16 (INSTRUCTIONS §5.2 death)
        self.plant_g = np.float64(f["plant_gauge"] * ONE)
        # Soft succession: suitability ramps from 0 at soil_min - soil_ramp to 1 at soil_min.
        mins = np.array(f["soil_min_level"]) * U16
        self.soil_min = np.where(col("pioneer", default=False) > 0, 0.0, mins[self.level - 1])
        self.soil_ramp = np.float64(f["soil_ramp"] * U16)
        # Bioclimate response (gamerules §2.3). Absent keys are neutral: tolerance 0 = indifferent.
        self.water0, self.light0 = terrain["water"] * U16, terrain["light"] * U16
        self.w_opt, self.w_tol = col("water_optimum", U16, 0), col("water_tolerance", U16, 0)
        self.l_opt, self.l_tol = col("light_optimum", U16, 0), col("light_tolerance", U16, 0)
        self.aff = np.array(
            [[s.get("soil_affinity", {}).get(t, 1.0) * ONE for t in soil_types] for s in sp]
        )
        if mode == "quant":  # converted once at load, after which everything is integer
            for k in ("kmax", "rdt", "rate", "soil_dt", "cast", "tol", "alpha", "seed_b",
                      "est_thr", "smother", "litter", "plant_g", "soil_min", "soil_ramp", "water0",
                      "light0", "w_opt", "w_tol", "l_opt", "l_tol", "aff", "cap"):  # fmt: skip
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

    def cap_cells(self, n2: int):
        """Cell cap per species (D-045): its map share times the map's cell count."""
        return self.div(self.cap * n2, ONE)

    def idx(self, name: str) -> int:
        return self.names.index(name)

    def new_state(self, n: int) -> State:
        z, d, s = np.zeros, self.dtype, len(self.names)
        return State(
            owner=z((n, n), np.int8),
            bio=z((s, n, n), d),
            gauge=z((s, n, n), d),
            soil=z((n, n), d),
            soil_type=z((n, n), np.int8),
            water=np.full((n, n), self.water0, d),
            light=np.full((n, n), self.light0, d),
            prog=z((2, n, n), d),
            dead=z((n, n), d),
        )

    def response(self, x, opt, tol):
        """Triangular response in [0, ONE]: 1 at the optimum, 0 at `tol` away; tol 0 = neutral."""
        safe = np.where(tol > 0, tol, 1)
        f = np.clip(ONE - self.div(np.abs(x - X(opt)) * ONE, X(safe)), 0, ONE)
        return np.where(X(tol) > 0, f, ONE)

    def suitability(self, st: State) -> np.ndarray:
        """The single site modifier (gamerules §2.3): f_dev x f_soil x f_water x f_light, per
        species and cell, in [0, ONE]. Every factor is neutral in V1 except soil development."""
        suit = self.aff[:, st.soil_type]
        if self.sw["succession"]:
            dev = self.div((st.soil - X(self.soil_min - self.soil_ramp)) * ONE, self.soil_ramp)
            suit = self.div(suit * np.clip(dev, 0, ONE), ONE)
        suit = self.div(suit * self.response(st.water, self.w_opt, self.w_tol), ONE)
        return self.div(suit * self.response(st.light, self.l_opt, self.l_tol), ONE)

    def plant(self, st: State, player: int, name: str, mask: np.ndarray, frac=None) -> int:
        """Seed a species on own or empty cells of `mask` (gamerules §8), alongside what already
        grows there. Sets its gauge to at least `plant_gauge`. Returns the cells planted."""
        i = self.idx(name)
        ok = mask & ((st.owner == 0) | (st.owner == player)) & (self.suitability(st)[i] > 0)
        held = int(((st.bio[i] > 0) & (st.owner == player)).sum())
        room = self.cap_cells(st.owner.size)[i] - held
        new = ok & (st.bio[i] == 0)
        ok &= ~new | (
            np.cumsum(new).reshape(ok.shape) <= room
        )  # cell cap: first cells in row order
        b = self.seed_b[i] if frac is None else self.kmax[i] * frac
        g = self.plant_g if frac is None else max(self.plant_g, frac * ONE)
        if self.mode == "quant":
            b, g = round_half_away(b), round_half_away(g)
        st.owner[ok] = player
        st.bio[i][ok] = np.maximum(st.bio[i][ok], b)
        st.gauge[i][ok] = np.maximum(st.gauge[i][ok], g)
        return int(ok.sum())

    def dominant(self, st: State) -> np.ndarray:
        dom = np.zeros(st.owner.shape, np.int8)
        for s, idx in enumerate(self.strata):
            dom[(st.bio[idx] >= X(self.est_thr[idx])).any(0)] = s + 1
        return dom

    def step(self, st: State) -> dict[int, float]:
        """Advance one flora tick. Returns each player's income (positive growth per second)."""
        sw, bio, gauge, owner = self.sw, st.bio, st.gauge, st.owner
        present = bio > 0
        cover = self.div(bio * ONE, X(self.kmax))
        suit = self.suitability(st)

        # 1. Shade: the cover of each upper stratum lowers the capacity of the species below it.
        shade = np.full(bio.shape, ONE, self.dtype)
        if sw["shade"]:
            for u in range(1, STRATA):
                up = self.strata[u]
                cast = self.div((X(self.cast[up]) * cover[up]).sum(0), ONE)
                low = np.flatnonzero(self.level <= u)
                block = self.div(cast * X(ONE - self.tol[low]), ONE)
                shade[low] = self.div(shade[low] * np.maximum(ONE - block, 0), ONE)

        # 2. Growth: logistic toward capacity = shade x gauge, with competition inside a stratum
        #    weighted by niche overlap (D-022).
        cap = np.maximum(self.div(shade * gauge, ONE), 1)
        comp = np.empty_like(cover)
        for idx in self.strata:
            others = cover[idx].sum(0) - cover[idx]
            comp[idx] = cover[idx] + self.div(self.alpha * others, ONE)
        growth = np.where(present, self.grow_div(X(self.rdt) * bio * (cap - comp), cap * ONE), 0)

        # 3. Soil development (succession).
        soil = st.soil
        if sw["succession"]:
            soil = np.minimum(soil + self.div((X(self.soil_dt) * cover).sum(0), ONE), U16)

        # 4. Colonization pressure of each player's species: own cover in the cell plus the cover
        #    of its 4 neighbours, / 5. Attack: best higher-level neighbour cover, summed. Only
        #    species established in a neighbour (biomass >= establish_threshold) can arrive.
        dom = self.dominant(st)
        can = (X(self.level) > dom) & (suit > 0)
        established = bio >= X(self.est_thr)
        pressure, attack, seeds = {}, {}, {}
        for p in PLAYERS:
            cov = np.where(owner == p, cover, 0)
            near = [nb(cov, dy, dx) for dy, dx in DIRS]
            pressure[p] = np.minimum(self.div(cov + sum(near), 5), ONE)
            attack[p] = sum(np.where(can, n, 0).max(0) for n in near)
            mine = established & (owner == p)
            seeds[p] = np.logical_or.reduce([nb(mine, dy, dx) for dy, dx in DIRS]) & (suit > 0)
        # Species at their cell cap (D-029) cannot enter free cells this tick; flips of enemy
        # cells ignore caps (D-113; so do claims of land grazed bare from the enemy in sim-core,
        # which has the lockout). The check uses the previous state, so simultaneous arrivals may
        # overshoot by one tick's worth.
        caps = self.cap_cells(owner.size)
        full = {p: X(((bio > 0) & (owner == p)).sum((1, 2)) >= caps) for p in PLAYERS}

        # 5. Growth, minus litter (turnover) and smothering by higher enemy levels. Litter,
        #    die-back (negative growth) and smothered biomass become dead biomass.
        litter = np.where(present, self.div(X(self.litter) * bio, ONE), 0)
        new_bio = bio + growth - litter
        smothered = np.zeros_like(bio)
        for p in PLAYERS:
            enemy = (owner == 3 - p) & present
            smothered = smothered + np.where(enemy, self.div(X(self.smother) * attack[p], ONE), 0)
        smothered = np.minimum(smothered, np.maximum(new_bio, 0))
        dead = (litter + smothered + np.maximum(-growth, 0)).sum(0)
        new_bio = np.clip(new_bio - smothered, 0, U16)
        new_bio = np.where(new_bio < 1, 0, new_bio)
        new_g = np.where(new_bio > 0, gauge, 0)
        new_owner = np.where((new_bio > 0).any(0), owner, 0).astype(np.int8)
        prog = st.prog.copy()

        # 6. Own cells: the gauge rises toward the suitability, driven by pressure; seed rain
        #    brings biomass in proportion (gamerules §3, D-024).
        for p in PLAYERS:
            own = (owner == p) & (new_owner == p) & (suit > 0) & ~(full[p] & (new_bio == 0))
            gap = np.maximum(suit - new_g, 0)
            dg = np.where(own, self.div(X(self.rate) * pressure[p] * gap, ONE * ONE), 0)
            new_g = new_g + dg
            new_bio = new_bio + np.where(dg > 0, self.div(X(self.seed_b) * dg, ONE), 0)

        def arrive(mask, p, cand):
            """Cells of `mask` become p's; each candidate species starts at gauge pressure x suit,
            established (biomass >= establish_threshold) so the new owner can hold the cell."""
            m = cand & mask
            g = self.div(pressure[p] * suit, ONE)
            new_g[m] = g[m]
            new_bio[m] = np.maximum(self.grow_div(X(self.seed_b) * g, ONE), X(self.est_thr))[m]
            new_owner[mask] = p

        # 7. Smothered enemy cells flip to the attacker's higher-level species.
        for p in PLAYERS:
            won = (owner == 3 - p) & (new_owner == 0) & (attack[p] > 0)
            arrive(won, p, can & seeds[p])

        # 8. Empty cells: claim progress builds up; the first player to complete takes the cell.
        empty = owner == 0
        cand, lvl, done = {}, {}, {}
        for p in PLAYERS:
            cand[p] = seeds[p] & ~full[p]
            push = np.where(cand[p], self.div(X(self.rate) * pressure[p] * suit, ONE * ONE), 0)
            prog[p - 1] = np.where(empty, prog[p - 1] + push.max(0), 0)
            done[p] = empty & (prog[p - 1] >= ONE) & cand[p].any(0)
            lvl[p] = np.where(cand[p], X(self.level), 0).max(0)
        both = done[1] & done[2]
        for p in PLAYERS:
            q = 3 - p
            win = done[p] & ~done[q]
            if sw["contested_cells"]:
                win |= both & (lvl[p] > lvl[q])
            arrive(win, p, cand[p])
        prog[:, done[1] | done[2]] = 0

        # 9. Biomass below 1 is gone, with its gauge (no sub-unit ghosts in float mode).
        new_bio = np.where(new_bio < 1, 0, new_bio)
        new_g = np.where(new_bio > 0, new_g, 0)
        new_owner = np.where((new_bio > 0).any(0), new_owner, 0).astype(np.int8)

        income = {
            p: float(np.where((owner == p) & (growth > 0), growth, 0).sum() / self.dt)
            for p in PLAYERS
        }
        st.dead = st.dead + dead
        st.owner, st.bio, st.gauge, st.soil, st.prog = new_owner, new_bio, new_g, soil, prog
        st.t += 1
        return income
