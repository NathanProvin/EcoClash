"""M0.5 economy prototype: biomass points, tech-tree unlocks, spawn costs, victory
(gamerules §4, §7, §11.3; D-018, D-023). Points are integers, like the future sim.
"""

from __future__ import annotations

import numpy as np

from prototype.fauna import PREDATOR, Fauna
from prototype.flora import PLAYERS, Flora


class Economy:
    """Each player's bank and unlocked cards. A card is (tree, level, tier), tree "L" or "F";
    it unlocks every species at that position."""

    def __init__(self, balance: dict, flora: Flora, fauna: Fauna | None):
        e, m = balance["economy"], balance["match"]
        self.e, self.fauna, self.flora = e, fauna, flora
        self.pos = {n: ("L", balance["flora"][n]["level"], balance["flora"][n]["tier"])
                    for n in flora.names}  # fmt: skip
        if fauna:
            self.pos |= {n: ("F", balance["fauna"][n]["level"], balance["fauna"][n]["tier"])
                         for n in fauna.names}  # fmt: skip
        self.bank = dict.fromkeys(PLAYERS, int(e["start_budget"]))
        self.unlocked = {p: {("L", 1, 1), ("F", 1, 1)} for p in PLAYERS}
        self.time_limit, self.fixed = m["time_limit_s"], m["victory_territory"]
        self.decay = (m["territory_start"], m["territory_end"]) if m["territory_decay"] else None

    def unlock_cost(self, card) -> int:
        tree, level, tier = card
        base = self.e["unlock_flora" if tree == "L" else "unlock_fauna"][level - 1]
        return round(base * self.e["tier_multiplier"] ** (tier - 1))

    def missing(self, p: int, name: str) -> list:
        """Cards still needed for `name`, in buying order: the tiers of its level up to its own,
        and, for an animal, the path to its first habitat plant if none is unlocked (§4.1)."""
        tree, level, tier = self.pos[name]
        need = [(tree, level, t) for t in range(1, tier + 1)]
        if tree == "F":
            habitat_mask = self.fauna.habitat[self.fauna.idx(name)]
            habitat = [self.flora.names[i] for i in np.flatnonzero(habitat_mask)]
            if not any(self.pos[h] in self.unlocked[p] for h in habitat):
                need = self.missing(p, habitat[0]) + need
        return [c for c in dict.fromkeys(need) if c not in self.unlocked[p]]

    def prepare(self, p: int, name: str) -> bool:
        """Buy the next missing card for `name` if affordable. True once `name` is unlocked."""
        need = self.missing(p, name)
        if need and self.pay(p, self.unlock_cost(need[0])):
            self.unlocked[p].add(need[0])
            need = need[1:]
        return not need

    def pay(self, p: int, amount: int) -> bool:
        if self.bank[p] < amount:
            return False
        self.bank[p] -= amount
        return True

    def plant_cost(self, name: str, cells: int) -> int:
        return self.e["plant_cost"][self.pos[name][1] - 1] * cells

    def spawn_cost(self, name: str, count: int, outside: bool = False) -> int:
        s = self.fauna.idx(name)
        cost = self.fauna.body[s] * self.e["spawn_cost_per_body"] * count
        if outside and self.fauna.role[s] == PREDATOR:
            cost *= self.e["drop_surcharge"]
        return round(cost)

    def earn(self, p: int, flora_growth: float, fed: int) -> None:
        """Income: a share of flora growth, plus the energy the player's animals gained (§6.4)."""
        self.bank[p] += int(flora_growth * self.e["income_rate"]) + fed

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
