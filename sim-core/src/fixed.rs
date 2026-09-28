//! Fixed-point math (INSTRUCTIONS §4).
//!
//! `Q16` is a Q16.16 number in an `i32`. Every division or rescale uses one rounding rule:
//! **round half away from zero** ([`div_round`]), the same as the Python prototype's quant mode
//! (`tools/prototype/flora.py`, `Flora.div`). Rust's `/` truncates toward zero, which is
//! asymmetric for negative numbers and makes mass drift, so it is never used on its own for
//! scaling. Products go through `i64`. Results that do not fit saturate on purpose.

use core::ops::{Add, Neg, Sub};

/// Number of fractional bits of [`Q16`].
pub const FRAC_BITS: u32 = 16;
/// The raw value of 1.0 in [`Q16`].
pub const ONE: i32 = 1 << FRAC_BITS;

/// `n / d`, rounded half away from zero. Panics if `d == 0`.
#[must_use]
pub const fn div_round(n: i64, d: i64) -> i64 {
    assert!(d != 0, "div_round: division by zero");
    let (n_abs, d_abs) = (n.unsigned_abs(), d.unsigned_abs());
    let q = (n_abs + d_abs / 2) / d_abs; // halves go up in magnitude
    if (n < 0) != (d < 0) {
        -(q as i64)
    } else {
        q as i64
    }
}

/// A Q16.16 fixed-point number.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Q16(pub i32);

impl Q16 {
    pub const ZERO: Q16 = Q16(0);
    pub const ONE: Q16 = Q16(ONE);
    pub const MAX: Q16 = Q16(i32::MAX);
    pub const MIN: Q16 = Q16(i32::MIN);

    /// An integer, saturating outside the Q16.16 range (±32768).
    #[must_use]
    pub const fn from_int(n: i32) -> Q16 {
        Q16(saturate(n as i64 * ONE as i64))
    }

    /// `num / den` as Q16.16, rounded half away from zero.
    #[must_use]
    pub const fn from_ratio(num: i64, den: i64) -> Q16 {
        Q16(saturate(div_round(num * ONE as i64, den)))
    }

    /// Convert a balance value (INSTRUCTIONS §4: parsed once at load, same rounding rule, hashed
    /// after conversion). The only float operation allowed near the simulation: scaling by 2^16 is
    /// exact in IEEE 754, and `f64::round` rounds half away from zero, so the result is identical
    /// on every platform. Never call it from simulation logic.
    #[must_use]
    #[allow(clippy::float_arithmetic, clippy::cast_possible_truncation)]
    pub fn from_balance(value: f64) -> Q16 {
        assert!(value.is_finite(), "balance value must be finite: {value}");
        Q16(saturate((value * f64::from(ONE)).round() as i64))
    }

    /// Nearest integer, halves away from zero.
    #[must_use]
    pub const fn round(self) -> i32 {
        div_round(self.0 as i64, ONE as i64) as i32
    }

    /// `self * other`, rounded half away from zero, saturating.
    #[must_use]
    pub const fn mul(self, other: Q16) -> Q16 {
        Q16(saturate(div_round(
            self.0 as i64 * other.0 as i64,
            ONE as i64,
        )))
    }

    /// `self / other`, rounded half away from zero, saturating. Panics if `other` is zero.
    #[must_use]
    pub const fn div(self, other: Q16) -> Q16 {
        Q16(saturate(div_round(
            self.0 as i64 * ONE as i64,
            other.0 as i64,
        )))
    }

    /// Scale an integer quantity (a u16 field value, a count) by this factor, rounded half away
    /// from zero: `n * self`.
    #[must_use]
    pub const fn scale(self, n: i64) -> i64 {
        div_round(n * self.0 as i64, ONE as i64)
    }

    #[must_use]
    pub const fn saturating_add(self, other: Q16) -> Q16 {
        Q16(self.0.saturating_add(other.0))
    }

    #[must_use]
    pub const fn saturating_sub(self, other: Q16) -> Q16 {
        Q16(self.0.saturating_sub(other.0))
    }

    #[must_use]
    pub const fn min(self, other: Q16) -> Q16 {
        if self.0 < other.0 { self } else { other }
    }

    #[must_use]
    pub const fn max(self, other: Q16) -> Q16 {
        if self.0 > other.0 { self } else { other }
    }

    #[must_use]
    pub const fn clamp(self, lo: Q16, hi: Q16) -> Q16 {
        self.max(lo).min(hi)
    }
}

/// Plain `+` / `-` panic on overflow in every profile (`overflow-checks = true`): sums in the
/// simulation are bounded, so an overflow is a bug. Use the `saturating_*` methods where
/// saturation is the intended behaviour (INSTRUCTIONS §4).
impl Add for Q16 {
    type Output = Q16;
    fn add(self, other: Q16) -> Q16 {
        Q16(self.0 + other.0)
    }
}

impl Sub for Q16 {
    type Output = Q16;
    fn sub(self, other: Q16) -> Q16 {
        Q16(self.0 - other.0)
    }
}

impl Neg for Q16 {
    type Output = Q16;
    fn neg(self) -> Q16 {
        Q16(-self.0)
    }
}

const fn saturate(v: i64) -> i32 {
    if v > i32::MAX as i64 {
        i32::MAX
    } else if v < i32::MIN as i64 {
        i32::MIN
    } else {
        v as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn div_round_is_half_away_from_zero_and_symmetric() {
        assert_eq!(div_round(5, 2), 3);
        assert_eq!(div_round(-5, 2), -3);
        assert_eq!(div_round(5, -2), -3);
        assert_eq!(div_round(-5, -2), 3);
        assert_eq!(div_round(7, 3), 2);
        assert_eq!(div_round(-7, 3), -2);
        assert_eq!(div_round(0, 9), 0);
        for n in -1000..1000 {
            for d in [1, 2, 3, 7, 16, 65536] {
                assert_eq!(div_round(-n, d), -div_round(n, d), "n={n} d={d}");
            }
        }
    }

    #[test]
    #[should_panic(expected = "division by zero")]
    fn div_round_rejects_zero() {
        let _ = div_round(1, 0);
    }

    #[test]
    fn arithmetic() {
        let half = Q16::from_ratio(1, 2);
        assert_eq!(half, Q16(ONE / 2));
        assert_eq!(Q16::from_int(3).mul(half), Q16::from_ratio(3, 2));
        assert_eq!(
            Q16::from_int(3).div(Q16::from_int(2)),
            Q16::from_ratio(3, 2)
        );
        assert_eq!(Q16::from_ratio(-3, 2).round(), -2); // -1.5 -> -2 (away from zero)
        assert_eq!(Q16::from_ratio(3, 2).round(), 2);
        assert_eq!(Q16::from_ratio(1, 3).0, 21845); // 21845.33 -> 21845
        assert_eq!(Q16::from_ratio(2, 3).0, 43691); // 43690.67 -> 43691
        assert_eq!(half.scale(7), 4); // 3.5 -> 4
        assert_eq!(half.scale(-7), -4);
        assert_eq!(Q16::from_int(40_000), Q16::MAX); // saturates
        assert_eq!(Q16::MAX.saturating_add(Q16::ONE), Q16::MAX);
        assert_eq!(Q16::from_int(2).clamp(Q16::ZERO, Q16::ONE), Q16::ONE);
    }

    #[test]
    fn balance_conversion_matches_the_python_prototype() {
        // round_half_away(x * 65536) in tools/prototype/flora.py
        assert_eq!(Q16::from_balance(0.15), Q16(9830)); // 9830.4
        assert_eq!(Q16::from_balance(0.5), Q16(32768));
        assert_eq!(Q16::from_balance(-0.25), Q16(-16384));
        assert_eq!(Q16::from_balance(0.000_007_629_394_531_25), Q16(1)); // 2^-17: 0.5 -> 1
        assert_eq!(Q16::from_balance(-0.000_007_629_394_531_25), Q16(-1));
    }
}
