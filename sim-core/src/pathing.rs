//! Paths around obstacles (D-084): a straight line when nothing blocks it, else a bounded A* on
//! the cell grid (8 neighbours, no corner cutting). Integer only, with a fixed tie order, so every
//! peer walks the same way. `stand(cell)` says whether the animal may stand on a cell (it depends
//! on the species' medium: walk, swim, amphibious, fly).

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::fixed::ONE;

const ONE_I: i64 = ONE as i64;
/// Samples per cell along a line of sight.
const SAMPLES_PER_CELL: i64 = 4;
/// Step costs: straight and diagonal (≈ 10 × sqrt 2).
const STRAIGHT: i64 = 10;
const DIAGONAL: i64 = 14;

/// The cell under a Q16 position (cells), or None outside an `n x n` map.
#[must_use]
pub fn cell_at(y: i64, x: i64, n: usize) -> Option<usize> {
    let (cy, cx) = (y >> 16, x >> 16);
    let ni = i64::try_from(n).ok()?;
    ((0..ni).contains(&cy) && (0..ni).contains(&cx))
        .then(|| usize::try_from(cy * ni + cx).ok())
        .flatten()
}

/// Whether the straight segment between two Q16 positions only crosses cells where `stand`.
#[must_use]
pub fn line_clear(n: usize, stand: &dyn Fn(usize) -> bool, a: (i64, i64), b: (i64, i64)) -> bool {
    let (dy, dx) = (b.0 - a.0, b.1 - a.1);
    let cells = (dy.abs().max(dx.abs()) + ONE_I - 1) / ONE_I;
    let steps = (cells * SAMPLES_PER_CELL).max(1);
    (0..=steps).all(|i| {
        let (y, x) = (a.0 + dy * i / steps, a.1 + dx * i / steps);
        cell_at(y, x, n).is_some_and(stand)
    })
}

/// The cells of a shortest path from `from` to `to` (both included), exploring at most `limit`
/// cells; None when `to` cannot be reached within that.
#[must_use]
pub fn route(
    n: usize,
    stand: &dyn Fn(usize) -> bool,
    from: usize,
    to: usize,
    limit: usize,
) -> Option<Vec<usize>> {
    if from == to {
        return Some(vec![from]);
    }
    if !stand(to) {
        return None;
    }
    let cells = n * n;
    let (ty, tx) = (to / n, to % n);
    let guess = |k: usize| {
        let (dy, dx) = ((k / n).abs_diff(ty), (k % n).abs_diff(tx));
        let (lo, hi) = (dy.min(dx), dy.max(dx));
        i64::try_from(lo).unwrap_or(0) * DIAGONAL + i64::try_from(hi - lo).unwrap_or(0) * STRAIGHT
    };
    let mut cost = vec![i64::MAX; cells];
    let mut came = vec![usize::MAX; cells];
    let mut open = BinaryHeap::new();
    cost[from] = 0;
    open.push(Reverse((guess(from), from)));
    let mut explored = 0;
    while let Some(Reverse((_, k))) = open.pop() {
        if k == to {
            let mut path = vec![to];
            while let Some(&last) = path.last() {
                if last == from {
                    break;
                }
                path.push(came[last]);
            }
            path.reverse();
            return Some(path);
        }
        explored += 1;
        if explored > limit {
            return None;
        }
        let (y, x) = (k / n, k % n);
        for (dy, dx) in [
            (-1i64, 0i64),
            (1, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        ] {
            let (ny, nx) = (
                i64::try_from(y).unwrap_or(0) + dy,
                i64::try_from(x).unwrap_or(0) + dx,
            );
            let ni = i64::try_from(n).unwrap_or(0);
            if !(0..ni).contains(&ny) || !(0..ni).contains(&nx) {
                continue;
            }
            let m = usize::try_from(ny * ni + nx).unwrap_or(0);
            if !stand(m) {
                continue;
            }
            let diagonal = dy != 0 && dx != 0;
            // No corner cutting: both sides of a diagonal step must be open.
            let side_a = usize::try_from(ny * ni + i64::try_from(x).unwrap_or(0)).unwrap_or(0);
            let side_b = usize::try_from(i64::try_from(y).unwrap_or(0) * ni + nx).unwrap_or(0);
            if diagonal && !(stand(side_a) && stand(side_b)) {
                continue;
            }
            let c = cost[k] + if diagonal { DIAGONAL } else { STRAIGHT };
            if c < cost[m] {
                cost[m] = c;
                came[m] = k;
                open.push(Reverse((c + guess(m), m)));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A map from rows of text: `#` blocked, anything else open.
    fn grid(rows: &[&str]) -> (usize, Vec<bool>) {
        let n = rows.len();
        let open = rows
            .iter()
            .flat_map(|r| r.chars().map(|c| c != '#'))
            .collect();
        (n, open)
    }

    fn centre(k: usize, n: usize) -> (i64, i64) {
        let c = |v: usize| i64::try_from(v).unwrap() * ONE_I + ONE_I / 2;
        (c(k / n), c(k % n))
    }

    #[test]
    fn a_clear_line_is_seen_and_a_wall_blocks_it() {
        let (n, open) = grid(&["....", ".##.", "....", "...."]);
        let stand = |k: usize| open[k];
        assert!(
            line_clear(n, &stand, centre(0, n), centre(3, n)),
            "along the top row"
        );
        assert!(
            !line_clear(n, &stand, centre(4, n), centre(7, n)),
            "through the wall"
        );
    }

    #[test]
    fn a_route_goes_around_a_wall_and_through_a_gap() {
        let (n, open) = grid(&[".....", "####.", ".....", ".####", "....."]);
        let stand = |k: usize| open[k];
        let path = route(n, &stand, 0, 20, 100).expect("the zig-zag is open");
        assert_eq!(path.first(), Some(&0));
        assert_eq!(path.last(), Some(&20));
        assert!(path.iter().all(|&k| open[k]), "never on a blocked cell");
        assert!(path.contains(&4) && path.contains(&15), "through both gaps");
        let (n, open) = grid(&["..#..", "..#..", "..#..", "..#..", "..#.."]);
        assert!(
            route(n, &|k: usize| open[k], 0, 4, 100).is_none(),
            "a closed wall"
        );
        assert!(
            route(n, &|k: usize| open[k], 0, 4, 3).is_none(),
            "or too far to look"
        );
    }

    #[test]
    fn diagonal_steps_do_not_cut_corners() {
        let (n, open) = grid(&[".#", "#."]);
        assert!(
            route(n, &|k: usize| open[k], 0, 3, 100).is_none(),
            "two corners touch only"
        );
    }
}
