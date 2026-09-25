/**
 * `exp`, `ln`, `sin`, `cos` and `atan2`, built only from operations ECMAScript defines exactly.
 *
 * Two phones holding the same reports must draw the same region (FR-018). ECMA-262 specifies Number
 * `+ − × ÷` as IEEE 754 binary64 with round-to-nearest-even and forbids fusing them, and §21.3.2.33
 * defines `Math.sqrt` as the correctly rounded root. The note in §21.3.2 says the opposite of
 * `exp`, `log`, `sin`, `cos` and `atan2`: they are "not precisely specified", and V8 and
 * JavaScriptCore really do differ in the last bit. One bit is enough to move a boundary cell across
 * the 90% cut, and then an iPhone and an Android phone draw different regions (research R5).
 *
 * So these five are owned: range reduction, then a fixed-degree series evaluated in a fixed order,
 * using only `+ − × ÷`, comparisons, `Math.sqrt`, `Math.floor` and `Math.abs`. Every coefficient
 * is computed by division at load time rather than typed in, so a mistyped digit cannot exist.
 * `tests/unit/detmath.test.ts` holds each one to `Math` within 1e-12 over the ranges the estimate
 * uses, and `tests/unit/estimate-purity.test.ts` fails any other `Math` call in this module tree.
 */

export const PI = 3.141592653589793;
const HALF_PI = PI / 2;

/** Degrees to radians and back, by one multiplication each. */
const RADIANS_PER_DEGREE = PI / 180;
const DEGREES_PER_RADIAN = 180 / PI;

export function toRadians(degrees: number): number {
  return degrees * RADIANS_PER_DEGREE;
}

export function toDegrees(radians: number): number {
  return radians * DEGREES_PER_RADIAN;
}

// ---- Powers of two ----

/** The smallest exponent a binary64 subnormal reaches, and the largest a finite value does. */
const MIN_EXPONENT = -1074;
const MAX_EXPONENT = 1023;

/**
 * Every power of two a binary64 can hold, 2^-1074 to 2^1023, built by exact doubling and halving.
 * Multiplying or dividing by an entry is exact whenever the result is representable.
 */
const POW2 = (() => {
  const table = new Float64Array(MAX_EXPONENT - MIN_EXPONENT + 1);
  table[-MIN_EXPONENT] = 1;
  for (let e = 1; e <= MAX_EXPONENT; e++)
    table[e - MIN_EXPONENT] = table[e - 1 - MIN_EXPONENT]! * 2;
  for (let e = -1; e >= MIN_EXPONENT; e--)
    table[e - MIN_EXPONENT] = table[e + 1 - MIN_EXPONENT]! / 2;
  return table;
})();

function pow2(e: number): number {
  return POW2[e - MIN_EXPONENT]!;
}

const TWO_64 = pow2(64);
const TWO_MINUS_64 = pow2(-64);

// ---- exp ----

/** ln 2 split so that k × LN2_HI is exact for every k the reduction produces (fdlibm). */
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;

/** Taylor coefficients 1/k! for k = 0..EXP_DEGREE. |r| ≤ ln2/2 makes the tail below 1e-17. */
const EXP_DEGREE = 14;
const EXP_COEFFS = (() => {
  const c = [1];
  for (let k = 1; k <= EXP_DEGREE; k++) c.push(c[k - 1]! / k);
  return c;
})();

/** Guard band for results that land in the subnormal range, applied and removed in two steps. */
const SUBNORMAL_GUARD = 60;

export function exp(x: number): number {
  if (x !== x) return x;
  if (x === Infinity) return Infinity;
  if (x === -Infinity) return 0;

  // x = k·ln2 + r, |r| ≤ ln2/2, and exp(x) = 2^k · exp(r).
  const k = Math.floor(x * INV_LN2 + 0.5);
  if (k > MAX_EXPONENT + 1) return Infinity;
  if (k < MIN_EXPONENT - SUBNORMAL_GUARD) return 0;
  const r = x - k * LN2_HI - k * LN2_LO;

  let p = EXP_COEFFS[EXP_DEGREE]!;
  for (let i = EXP_DEGREE - 1; i >= 0; i--) p = p * r + EXP_COEFFS[i]!;

  if (k > MAX_EXPONENT) return p * pow2(k - 1) * 2;
  // Below the normal range, scale into it first so the result is rounded once, at the end.
  if (k < -MAX_EXPONENT + 1) return p * pow2(k + SUBNORMAL_GUARD) * pow2(-SUBNORMAL_GUARD);
  return p * pow2(k);
}

// ---- ln ----

/** Series terms 1/(2k+1) for atanh-form ln. |f| ≤ 0.172 makes the tail below 1e-17. */
const LN_TERMS = 13;
const LN_COEFFS = (() => {
  const c: number[] = [];
  for (let k = 0; k <= LN_TERMS; k++) c.push(1 / (2 * k + 1));
  return c;
})();

const SQRT2 = Math.sqrt(2);

export function ln(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;

  // x = m · 2^e with m in [√½, √2), exactly: scaling by powers of two loses nothing. Coarse steps
  // first, since the estimate's arguments sit within a few steps of 1.
  let m = x;
  let e = 0;
  while (m >= TWO_64) {
    m *= TWO_MINUS_64;
    e += 64;
  }
  while (m < TWO_MINUS_64) {
    m *= TWO_64;
    e -= 64;
  }
  while (m >= 16) {
    m *= 0.0625;
    e += 4;
  }
  while (m < 0.0625) {
    m *= 16;
    e -= 4;
  }
  while (m >= 2) {
    m *= 0.5;
    e += 1;
  }
  while (m < 1) {
    m *= 2;
    e -= 1;
  }
  if (m > SQRT2) {
    m = m / 2;
    e = e + 1;
  }

  // ln m = 2·atanh(f), f = (m−1)/(m+1).
  const f = (m - 1) / (m + 1);
  const s = f * f;
  let p = LN_COEFFS[LN_TERMS]!;
  for (let i = LN_TERMS - 1; i >= 0; i--) p = p * s + LN_COEFFS[i]!;
  const lnM = 2 * f * p;

  return e * LN2_HI + (e * LN2_LO + lnM);
}

// ---- sin, cos ----

/**
 * π/2 in three parts (fdlibm's pio2_1, pio2_2, pio2_3). The first two have trailing zero bits, so
 * k × part is exact for the small k the estimate produces, and the reduction keeps ~100 bits of π.
 */
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_3 = 2.0222662487111664558e-21;

/** Taylor terms for sin and cos on |r| ≤ π/4. The tails are below 1e-18. */
const TRIG_TERMS = 10;
const SIN_COEFFS = (() => {
  // (−1)^k / (2k+1)!
  const c = [1];
  for (let k = 1; k <= TRIG_TERMS; k++) c.push(-c[k - 1]! / (2 * k * (2 * k + 1)));
  return c;
})();
const COS_COEFFS = (() => {
  // (−1)^k / (2k)!
  const c = [1];
  for (let k = 1; k <= TRIG_TERMS; k++) c.push(-c[k - 1]! / ((2 * k - 1) * (2 * k)));
  return c;
})();

function sinKernel(r: number): number {
  const z = r * r;
  let p = SIN_COEFFS[TRIG_TERMS]!;
  for (let i = TRIG_TERMS - 1; i >= 0; i--) p = p * z + SIN_COEFFS[i]!;
  return r * p;
}

function cosKernel(r: number): number {
  const z = r * r;
  let p = COS_COEFFS[TRIG_TERMS]!;
  for (let i = TRIG_TERMS - 1; i >= 0; i--) p = p * z + COS_COEFFS[i]!;
  return p;
}

/** x = k·π/2 + r, |r| ≤ π/4; returns the quadrant k mod 4 and r. */
function reduce(x: number): { quadrant: number; r: number } {
  const k = Math.floor(x / HALF_PI + 0.5);
  const r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
  const quadrant = k - 4 * Math.floor(k / 4);
  return { quadrant, r };
}

export function sin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const { quadrant, r } = reduce(x);
  switch (quadrant) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

export function cos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const { quadrant, r } = reduce(x);
  switch (quadrant) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

// ---- atan2 ----

const SQRT3 = Math.sqrt(3);
/** tan(π/12) = 2 − √3: above it, atan shifts by π/6 to bring the argument back below it. */
const TAN_PI_12 = 2 - SQRT3;
const PI_6 = PI / 6;

/** Series terms (−1)^k/(2k+1) on |u| ≤ tan(π/12). The tail is below 1e-17. */
const ATAN_TERMS = 15;
const ATAN_COEFFS = (() => {
  const c: number[] = [];
  for (let k = 0; k <= ATAN_TERMS; k++) c.push((k % 2 === 0 ? 1 : -1) / (2 * k + 1));
  return c;
})();

function atanSeries(u: number): number {
  const z = u * u;
  let p = ATAN_COEFFS[ATAN_TERMS]!;
  for (let i = ATAN_TERMS - 1; i >= 0; i--) p = p * z + ATAN_COEFFS[i]!;
  return u * p;
}

/** atan(t) for t in [0, 1]. */
function atanUnit(t: number): number {
  if (t <= TAN_PI_12) return atanSeries(t);
  // atan(t) = π/6 + atan((t√3 − 1)/(√3 + t))
  return PI_6 + atanSeries((t * SQRT3 - 1) / (SQRT3 + t));
}

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return x < 0 || 1 / x < 0 ? (1 / y < 0 ? -PI : PI) : y;

  let a: number;
  if (ay <= ax) a = atanUnit(ay / ax);
  else a = HALF_PI - atanUnit(ax / ay);

  if (x < 0) a = PI - a;
  return y < 0 || (y === 0 && 1 / y < 0) ? -a : a;
}
