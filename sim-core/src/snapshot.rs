//! Read-only view of the world for renderers and tools (INSTRUCTIONS §6). The renderer never
//! mutates the simulation: it gets a `Snapshot`, a copy in display units.

use crate::fauna::{Fauna, Role};
use crate::fixed::{ONE, div_round};
use crate::flora::{Flora, FloraState, U16};

/// Pressure display (D-076): an enemy grazer on a cell pushes like a quarter of a fully covered
/// smothering neighbour, and this much push draws the widest frontier line.
const GRAZER_PUSH: i64 = ONE as i64 / 4;
const PUSH_FULL: i64 = 2 * ONE as i64;

/// Standing dead wood per cell, 0..=255 (D-127): 255 is a full dead stand (the stoutest tree at
/// full cover, times the standing share); any wood at all shows at least 1. A view, not hashed.
#[must_use]
pub fn deadwood_frame(flora: &Flora, st: &FloraState) -> Vec<u8> {
    let p = &flora.p;
    let stoutest = p.strata[crate::flora::LEVELS - 1]
        .iter()
        .map(|&s| p.kmax[s])
        .max()
        .unwrap_or(1);
    let full = div_round(stoutest * p.wood_share, ONE as i64).max(1);
    st.snag
        .iter()
        .map(|&w| {
            if w <= 0 {
                0
            } else {
                u8::try_from(div_round(w.min(full) * 255, full).max(1)).unwrap_or(255)
            }
        })
        .collect()
}

/// How hard the non-owner pushes into each cell, 0..=255, for the frontier lines (D-076): the
/// flora step's smothering attack (`Flora::push`) plus the enemy grazers standing on the cell.
/// Derived from the state, never hashed: a view, like the snapshot.
#[must_use]
pub fn pressure_frame(flora: &Flora, st: &FloraState, fauna: &Fauna) -> Vec<u8> {
    let mut push = flora.push(st);
    let a = &fauna.agents;
    for i in 0..a.len() {
        let k = a.cell(i, st.n);
        let grazer = fauna.p.role[usize::from(a.sp[i])] == Role::Herbivore;
        if grazer && st.owner[k] == 3 - a.owner[i] {
            push[k] += GRAZER_PUSH;
        }
    }
    push.iter()
        .map(|&v| u8::try_from(div_round(v.clamp(0, PUSH_FULL) * 255, PUSH_FULL)).unwrap_or(255))
        .collect()
}

/// The flora fields of one tick, one byte per cell and layer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub tick: u64,
    /// Flora ticks done: the fields change only when this does.
    pub flora_tick: u64,
    pub n: usize,
    pub species: usize,
    /// 0 none, else player.
    pub owner: Vec<u8>,
    /// Soil development, 0..=255.
    pub soil: Vec<u8>,
    /// Cover of each plant species (min(biomass, k_max) / k_max), 0..=255, species-major.
    pub cover: Vec<u8>,
}

impl Snapshot {
    #[must_use]
    pub fn new(tick: u64, flora: &Flora, st: &FloraState) -> Snapshot {
        let cells = st.n * st.n;
        let byte = |v: i64, max: i64| {
            u8::try_from(div_round(v.clamp(0, max) * 255, max)).unwrap_or(u8::MAX)
        };
        let cover = (0..st.bio.len())
            .map(|i| {
                let kmax = flora.p.kmax[i / cells];
                byte(st.bio[i], kmax)
            })
            .collect();
        Snapshot {
            tick,
            flora_tick: st.t,
            n: st.n,
            species: flora.p.species(),
            owner: st.owner.clone(),
            soil: st.soil.iter().map(|&s| byte(s, U16)).collect(),
            cover,
        }
    }

    /// The field frame in the replay v3 layout the viewer decodes (D-031): owner, soil, then the
    /// cover of each plant species, `n * n` bytes each.
    #[must_use]
    pub fn field_frame(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.owner.len() * (2 + self.species));
        out.extend_from_slice(&self.owner);
        out.extend_from_slice(&self.soil);
        out.extend_from_slice(&self.cover);
        out
    }
}
