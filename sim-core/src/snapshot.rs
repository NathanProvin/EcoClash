//! Read-only view of the world for renderers and tools (INSTRUCTIONS §6). The renderer never
//! mutates the simulation: it gets a `Snapshot`, a copy in display units.

use crate::fixed::div_round;
use crate::flora::{Flora, FloraState, U16};

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
