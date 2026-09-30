"""M0.5 economy prototype: biomass points, tech-tree unlocks, spawn costs, victory
(gamerules §4, §7, §11.3; D-018, D-023, D-027, D-029). Costs, yields and caps come from the
species stat sheet (species.toml). The prototype keeps the bank as a float; sim-core will use
fixed-point.
"""

from __future__ import annotations

import numpy as np

from prototype.fauna import PREDATOR, Agents, Fauna
from prototype.flora import PLAYERS, Flora, State, X


class Economy:
    """Each player's bank and unlocked species. Unlocking is per species (D-029): a species needs
    one unlocked species on the previous tier of its family and, for an animal, one of its habitat
    plants; species with unlock_cost 0 are available at start."""

    def __init__(self, balance: dict, flora: Flora, fauna: Fauna | None):
        e, m = balance["economy"], balance["match"]
        self.e, self.flora, self.fauna = e, flora, fauna
        self.species = {n: ("L", balance["flora"][n]) for n in flora.names}
        if fauna:
            self.species |= {n: ("F", balance["fauna"][n]) for n in fauna.names}
        self.bank = dict.fromkeys(PLAYERS, float(e["start_budget"]))
        start = {n for n, (_, s) in self.species.items() if s["unlock_cost"] == 0}
        self.unlocked = {p: set(start) for p in PLAYERS}
        self.events: list[tuple[int, str, int]] = []  # (player, species, cost) bought, for the log
        self.time_limit, self.fixed = m["time_limit_s"], m["victory_territory"]
        self.decay = (m["territory_start"], m["territory_end"]) if m["territory_decay"] else None

    def stat(self, name: str, key: str):
        return self.species[name][1][key]

    def missing(self, p: int, name: str) -> list[str]:
        """Species still to unlock for `name`, in buying order."""
        if name in self.unlocked[p]:
            return []
        tree, s = self.species[name]
        need = []
        if s["tier"] > 1:  # one species of the previous tier, the cheapest path first
            pos = (tree, s["family"], s["tier"] - 1)
            below = [n for n, (t, x) in self.species.items() if (t, x["family"], x["tier"]) == pos]
            if not any(n in self.unlocked[p] for n in below):
                need += min((self.missing(p, n) for n in below), key=self._cost)
        if tree == "F":  # the first habitat plant, if none is unlocked yet
            habitat = [self.flora.names[i] for i in np.flatnonzero(
                self.fauna.habitat[self.fauna.idx(name)])]  # fmt: skip
            if not any(h in self.unlocked[p] for h in habitat):
                need += self.missing(p, habitat[0])
        return list(dict.fromkeys([*need, name]))

    def _cost(self, names: list[str]) -> float:
        return sum(self.stat(n, "unlock_cost") for n in names)

    def prepare(self, p: int, name: str) -> bool:
        """Buy the next missing species for `name` if affordable. True once `name` is unlocked."""
        need = self.missing(p, name)
        if need and self.pay(p, self.stat(need[0], "unlock_cost")):
            self.unlocked[p].add(need[0])
            self.events.append((p, need[0], self.stat(need[0], "unlock_cost")))
            need = need[1:]
        return not need

    def pay(self, p: int, amount: float) -> bool:
        if self.bank[p] < amount:
            return False
        self.bank[p] -= amount
        return True

    def plant_cost(self, name: str, cells: int) -> float:
        return self.stat(name, "spawn_cost") * cells

    def spawn_cost(self, name: str, count: int, outside: bool = False) -> float:
        cost = self.stat(name, "spawn_cost") * count
        if outside and self.fauna.role[self.fauna.idx(name)] == PREDATOR:
            cost *= self.e["drop_surcharge"]
        return cost

    def income(self, p: int, st: State, ag: Agents | None) -> float:
        """Points per second: each plant yields per fully covered cell (x cover), each animal
        yields per head (D-029)."""
        cover = np.minimum(st.bio / X(self.flora.kmax), 1)[:, st.owner == p].sum(1)
        points = float(self.flora.yld @ cover)
        if ag is not None and len(ag):
            points += float(self.fauna.yld[ag.sp[ag.owner == p]].sum())
        return points

    def threshold(self, t: float) -> float:
        """Territorial victory threshold at time t: fixed, or decaying (§11.3 switch)."""
        if not self.decay:
            return self.fixed
        start, end = self.decay
        return start + (end - start) * min(t / self.time_limit, 1)

    def winner(self, t: float, territory: dict, standing: dict):
        """(winner or 0 for a draw, reason) once the match is decided, else None. Territory at any
        time; at the time limit, standing biomass, then territory share (D-023)."""
        top = max(PLAYERS, key=lambda p: territory[p])
        if territory[top] >= self.threshold(t):
            return top, "territory"
        if t < self.time_limit:
            return None
        for key, reason in ((standing, "biomass"), (territory, "territory share")):
            if key[1] != key[2]:
                return (1 if key[1] > key[2] else 2), reason
        return 0, "draw"
