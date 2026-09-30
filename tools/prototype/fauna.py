"""M0.4 fauna prototype: animals as agents on the flora grid (gamerules §5.2, §6; D-023).

Agents stand on grid cells and update once per flora tick. Their arithmetic is integer only
(energy in Q16 biomass units), so the float and quant flora modes share the same fauna logic.
Behaviours, in priority order: flee a hunter, seek food (enemy flora first, own flora at a reduced
rate), wander. Then: graze, decompose, hunt, starve, reproduce (split at full energy once the
breeding cooldown is over, under the player and species caps).
Not yet: player orders (M3), stances, seed eating as spread reduction (§6.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar

import numpy as np

from prototype.flora import DIRS, ONE, PLAYERS, U16, Flora, State, X, nb, round_half_away

ROLES = ("decomposer", "herbivore", "predator")
DECOMPOSER, HERBIVORE, PREDATOR = range(3)


@dataclass
class Agents:
    """Structure of arrays: one row per living animal, in creation order. Ids are never reused,
    so a renderer can follow an animal between frames."""

    sp: np.ndarray  # int16 fauna species index
    owner: np.ndarray  # int8 player
    y: np.ndarray  # int64 cell row
    x: np.ndarray  # int64 cell column
    energy: np.ndarray  # int64, Q16 biomass units (ONE = 1 biomass)
    id: np.ndarray  # int64 unique id
    cooldown: np.ndarray  # int64 ticks before this animal may give birth again
    next_id: int = 0
    ARRAYS: ClassVar = ("sp", "owner", "y", "x", "energy", "id", "cooldown")
    DTYPES: ClassVar = (np.int16, np.int8, np.int64, np.int64, np.int64, np.int64, np.int64)

    @classmethod
    def empty(cls) -> Agents:
        return cls(*(np.zeros(0, d) for d in cls.DTYPES))

    def __len__(self) -> int:
        return len(self.sp)

    def keep(self, m) -> Agents:
        return Agents(*(getattr(self, k)[m] for k in self.ARRAYS), self.next_id)

    def append(self, sp, owner, y, x, energy, cooldown=None) -> Agents:
        k = len(sp)
        cooldown = np.zeros(k) if cooldown is None else cooldown
        new = (sp, owner, y, x, energy, np.arange(self.next_id, self.next_id + k), cooldown)
        return Agents(
            *(np.concatenate([getattr(self, a), np.asarray(v, d)])
              for a, d, v in zip(self.ARRAYS, self.DTYPES, new, strict=True)),
            self.next_id + k,
        )  # fmt: skip


class Fauna:
    """Fauna tables and rules, converted once from balance.toml + species.toml."""

    def __init__(self, balance: dict, flora: Flora, seed: int = 0):
        fa, dt = balance["fauna"], flora.dt
        self.fl = flora
        self.rng = np.random.default_rng(seed + 1)  # agent randomness, separate from flora's
        self.names = [k for k, v in fa.items() if isinstance(v, dict)]
        sp = [fa[n] for n in self.names]

        def flora_set(names):  # a family name ("L2", "W") means every plant of that family
            m = np.zeros(len(flora.names), bool)
            for n in names:
                if n in flora.family:
                    m |= flora.family == n
                else:
                    m[flora.idx(n)] = True
            return m

        for n, s in zip(self.names, sp, strict=True):
            assert s["role"] in ROLES, n
            if s["role"] == "predator":
                assert set(s["eats"]) <= set(self.names), n
        self.role = np.array([ROLES.index(s["role"]) for s in sp])
        self.habitat = np.array([flora_set(s["habitat"]) for s in sp])
        self.eats_flora = np.array([flora_set(s["eats"] if s["role"] == "herbivore" else [])
                                    for s in sp])  # fmt: skip
        self.eats_fauna = np.array([[n in s["eats"] for n in self.names] if s["role"] == "predator"
                                    else [False] * len(sp) for s in sp])  # fmt: skip
        self.small = np.array([s.get("small", False) for s in sp])
        self.body = np.array([s["body"] for s in sp], np.int64)
        self.bite = round_half_away([s.get("bite", 0) * dt for s in sp])
        self.upkeep = np.maximum(
            round_half_away([s["body"] * s["upkeep"] * dt * ONE for s in sp]), 1
        )
        self.speed = np.array([s["speed"] for s in sp], np.int64)
        self.sight = np.array([s["sight"] for s in sp], np.int64)
        self.group = np.array([s["group"] for s in sp], np.int64)
        self.transfer = int(round_half_away(fa["transfer"] * ONE))
        self.own_graze = int(round_half_away(fa["own_graze"] * ONE))
        self.soil_per_dead = int(round_half_away(fa["soil_per_dead"] * ONE))
        self.herb_range, self.flee = fa["herbivore_range"], fa["flee_radius"]
        self.refuge, self.refuge_cover = flora_set(fa["refuge_flora"]), fa["refuge_cover"]
        self.cap = balance["agents"]["max_agents"] // len(PLAYERS)
        self.species_cap = np.array([s["cap"] for s in sp], np.int64)  # animals per player
        self.breed = np.maximum(round_half_away([s["growth"] / dt for s in sp]), 1)  # ticks
        self.yld = np.array([s["yield"] for s in sp], np.float64)  # points per s per animal
        # Search offsets up to the widest radius, nearest first (ties in row-major order).
        r = int(max(self.sight.max(), self.flee))
        dy, dx = (a.ravel() for a in np.mgrid[-r : r + 1, -r : r + 1])
        order = np.lexsort((dx, dy, dy * dy + dx * dx))
        self.offs, self.offd2 = np.stack([dy[order], dx[order]], 1), (dy * dy + dx * dx)[order]

    def idx(self, name: str) -> int:
        return self.names.index(name)

    def nearest(self, mask, ay, ax, r):
        """Nearest True cell of `mask` within radius `r` of each agent. Returns (found, ty, tx)."""
        n0, n1 = mask.shape
        k = self.offd2 <= r * r
        ys, xs = ay[:, None] + self.offs[k, 0], ax[:, None] + self.offs[k, 1]
        inside = (ys >= 0) & (ys < n0) & (xs >= 0) & (xs < n1)
        hit = inside & mask[np.clip(ys, 0, n0 - 1), np.clip(xs, 0, n1 - 1)]
        j, rows = hit.argmax(1), np.arange(len(ay))
        return hit.any(1), ys[rows, j], xs[rows, j]

    def safe(self, st: State, ag: Agents) -> np.ndarray:
        """Small fauna inside its owner's dense hawthorn or bramble cannot be hunted (D-023)."""
        dense = (st.bio[self.refuge] / X(self.fl.kmax[self.refuge])).sum(0) >= self.refuge_cover
        return self.small[ag.sp] & dense[ag.y, ag.x] & (st.owner[ag.y, ag.x] == ag.owner)

    def prey_mask(self, st: State, ag: Agents, s: int, p: int, safe) -> np.ndarray:
        """Cells holding enemy agents that predator species `s` of player `p` may hunt."""
        prey = self.eats_fauna[s][ag.sp] & (ag.owner == 3 - p) & ~safe
        grid = np.zeros(st.owner.shape, bool)
        grid[ag.y[prey], ag.x[prey]] = True
        return grid

    def herb_food(self, st: State, s: int) -> np.ndarray:
        return (st.bio[self.eats_flora[s]] >= 1).any(0)

    def spawn(self, st: State, ag: Agents, p: int, name: str, near) -> tuple[Agents, int]:
        """Spawn a species card for player p near the clicked cell `near` (gamerules §6.3):
        habitat on own land, then the trigger. Predators are dropped on the nearest enemy prey;
        herbivores need enemy food within `herbivore_range` of own land; decomposers need habitat
        only. Returns (agents, number spawned)."""
        s, q = self.idx(name), 3 - p
        mine = ag.owner == p
        count = int(min(self.group[s], self.cap - mine.sum(),
                        self.species_cap[s] - (mine & (ag.sp == s)).sum()))  # fmt: skip
        est = st.bio >= X(self.fl.est_thr)
        home = (st.owner == p) & (est & X(self.habitat[s])).any(0)
        if count <= 0 or not home.any():
            return ag, 0

        def closest(cells, pt):
            return cells[np.argmin(((cells - np.asarray(pt)) ** 2).sum(1))]

        if self.role[s] == PREDATOR:
            prey = self.eats_fauna[s][ag.sp] & (ag.owner == q) & ~self.safe(st, ag)
            if not prey.any():
                return ag, 0
            at = closest(np.stack([ag.y[prey], ag.x[prey]], 1), near)
        elif self.role[s] == HERBIVORE:
            reach = st.owner == p
            for _ in range(self.herb_range):
                reach = reach | np.logical_or.reduce([nb(reach, dy, dx) for dy, dx in DIRS])
            food = (st.owner == q) & self.herb_food(st, s) & reach
            if not food.any():
                return ag, 0
            at = closest(np.argwhere(home), closest(np.argwhere(food), near))
        else:
            at = closest(np.argwhere(home), near)
        k = np.full(count, 1)
        return ag.append(s * k, p * k, at[0] * k, at[1] * k, self.body[s] * ONE // 2 * k), count

    def step(self, st: State, ag: Agents) -> tuple[Agents, dict]:
        """Advance one tick (the flora tick). Mutates the flora state (grazing, dead biomass,
        soil) and returns the surviving and newborn agents plus this tick's counters."""
        stats = {f"{k}_p{p}": 0 for k in ("kills", "grazed") for p in PLAYERS}
        if not len(ag):
            return ag, stats
        n0, n1 = st.owner.shape
        ag.energy = ag.energy - self.upkeep[ag.sp]
        ag.cooldown = np.maximum(ag.cooldown - 1, 0)
        safe = self.safe(st, ag)
        dy, dx = np.zeros(len(ag), np.int64), np.zeros(len(ag), np.int64)
        moved = np.zeros(len(ag), bool)

        def move(i, ty, tx, s, away=False):
            sign = -1 if away else 1
            dy[i] = np.clip(sign * (ty - ag.y[i]), -self.speed[s], self.speed[s])
            dx[i] = np.clip(sign * (tx - ag.x[i]), -self.speed[s], self.speed[s])
            moved[i] = True

        species = np.unique(ag.sp)
        # 1. Flee the nearest enemy hunter within flee_radius.
        for v in species:
            for p in PLAYERS:
                me = np.flatnonzero((ag.sp == v) & (ag.owner == p) & ~safe)
                hunters = self.eats_fauna[:, v][ag.sp] & (ag.owner == 3 - p)
                if not len(me) or not hunters.any():
                    continue
                grid = np.zeros((n0, n1), bool)
                grid[ag.y[hunters], ag.x[hunters]] = True
                f, ty, tx = self.nearest(grid, ag.y[me], ag.x[me], self.flee)
                move(me[f], ty[f], tx[f], v, away=True)

        # 2. Seek food within sight: enemy flora, then own flora (herbivores); dead biomass on
        #    non-enemy land (decomposers); enemy prey (predators). Grazers only target cells whose
        #    stock covers everyone of their kind already there; in an overcrowded cell they wander
        #    off instead, so herds break up.
        for s in species:
            for p in PLAYERS:
                mine = (ag.sp == s) & (ag.owner == p)
                idx = np.flatnonzero(mine & ~moved)
                if not len(idx):
                    continue
                if self.role[s] == PREDATOR:
                    targets = (self.prey_mask(st, ag, s, p, safe),)
                else:
                    crowd = np.zeros((n0, n1), np.int64)
                    np.add.at(crowd, (ag.y[mine], ag.x[mine]), 1)
                    if self.role[s] == HERBIVORE:
                        stock = st.bio[self.eats_flora[s]].max(0)
                        lands = (st.owner == 3 - p, st.owner == p)
                    else:
                        stock, lands = st.dead, (st.owner != 3 - p,)
                    enough = stock >= self.bite[s] * np.maximum(crowd, 1)
                    crowded = (stock >= 1) & ~enough
                    idx = idx[~crowded[ag.y[idx], ag.x[idx]]]
                    targets = tuple(enough & land for land in lands)
                for m in targets:
                    f, ty, tx = self.nearest(m, ag.y[idx], ag.x[idx], self.sight[s])
                    move(idx[f], ty[f], tx[f], s)
                    idx = idx[~f]

        # 3. Everyone else wanders one cell.
        rest = np.flatnonzero(~moved)
        dy[rest] = self.rng.integers(-1, 2, len(rest))
        dx[rest] = self.rng.integers(-1, 2, len(rest))
        ag.y, ag.x = np.clip(ag.y + dy, 0, n0 - 1), np.clip(ag.x + dx, 0, n1 - 1)

        # 4. Herbivores graze the richest diet species of their cell: enemy flora at full bite,
        #    own flora at own_graze. Agents biting the same stock share it pro rata.
        i = np.flatnonzero(self.role[ag.sp] == HERBIVORE)
        if len(i):
            cy, cx, cell_owner = ag.y[i], ag.x[i], st.owner[ag.y[i], ag.x[i]]
            have = np.floor(st.bio[:, cy, cx].T).astype(np.int64)  # (agents, flora species)
            ok = self.eats_flora[ag.sp[i]] & (have >= 1)
            pick = np.where(ok, have, -1).argmax(1)
            bite = self.bite[ag.sp[i]]
            bite = np.where(cell_owner == ag.owner[i], bite * self.own_graze // ONE, bite)
            bite = np.where(ok.any(1) & (cell_owner > 0), bite, 0)
            eaten = self._share(st.bio.shape, (pick, cy, cx), bite, have[np.arange(len(i)), pick])
            np.add.at(st.bio, (pick, cy, cx), -eaten)
            ag.energy[i] += eaten * self.transfer
            np.add.at(st.dead, (cy, cx), eaten - eaten * self.transfer // ONE)
            for p in PLAYERS:
                stats[f"grazed_p{p}"] = int(eaten[(ag.owner[i] == p) & (cell_owner == 3 - p)].sum())

        # 5. Decomposers eat dead biomass and turn it into soil development.
        i = np.flatnonzero(self.role[ag.sp] == DECOMPOSER)
        if len(i):
            cy, cx = ag.y[i], ag.x[i]
            have = np.floor(st.dead[cy, cx]).astype(np.int64)
            eaten = self._share(st.dead.shape, (cy, cx), self.bite[ag.sp[i]], have)
            np.add.at(st.dead, (cy, cx), -eaten)
            ag.energy[i] += eaten * self.transfer
            np.add.at(st.soil, (cy, cx), eaten * self.soil_per_dead // ONE)
            st.soil[:] = np.minimum(st.soil, U16)

        # 6. Predators kill one huntable enemy prey in their cell, in index order.
        alive = np.ones(len(ag), bool)
        cell = ag.y * n1 + ag.x
        for a in np.flatnonzero(self.role[ag.sp] == PREDATOR):
            prey = alive & (cell == cell[a]) & (ag.owner == 3 - ag.owner[a]) & ~safe
            prey &= self.eats_fauna[ag.sp[a]][ag.sp]
            if alive[a] and prey.any():
                b = int(prey.argmax())
                alive[b] = False
                body = self.body[ag.sp[b]]
                ag.energy[a] += body * self.transfer
                st.dead[ag.y[b], ag.x[b]] += body - body * self.transfer // ONE
                stats[f"kills_p{ag.owner[a]}"] += 1

        # 7. Starvation: the carcass (half the body) becomes dead biomass.
        starve = alive & (ag.energy <= 0)
        np.add.at(st.dead, (ag.y[starve], ag.x[starve]), self.body[ag.sp[starve]] // 2)
        ag = ag.keep(alive & ~starve)

        # 8. Reproduction (D-023, D-029): at full energy and once its cooldown (the species'
        #    growth stat) is over, an animal splits in two, under the player and species caps.
        count = {p: int((ag.owner == p).sum()) for p in PLAYERS}
        kin = {}
        for s, p in zip(ag.sp.tolist(), ag.owner.tolist(), strict=True):
            kin[s, p] = kin.get((s, p), 0) + 1
        kids = []
        for a in np.flatnonzero((ag.energy >= self.body[ag.sp] * ONE) & (ag.cooldown == 0)):
            s, p = int(ag.sp[a]), int(ag.owner[a])
            if count[p] < self.cap and kin[s, p] < self.species_cap[s]:
                half = ag.energy[a] // 2
                ag.energy[a] -= half
                ag.cooldown[a] = self.breed[s]
                kids.append((s, p, ag.y[a], ag.x[a], half, self.breed[s]))
                count[p] += 1
                kin[s, p] += 1
        if kids:
            ag = ag.append(*zip(*kids, strict=True))
        return ag, stats

    @staticmethod
    def _share(shape, at, bite, have):
        """Bites on one stock are served pro rata when the stock is short. Integer, exact."""
        demand = np.zeros(shape, np.int64)
        np.add.at(demand, at, bite)
        d = demand[at]
        return np.where(d > have, bite * have // np.maximum(d, 1), bite)
