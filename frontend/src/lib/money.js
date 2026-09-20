/**
 * Money primitives for Quits.
 *
 * SPEC §5: all monetary values are integer cents and no floating-point
 * arithmetic touches money at any point. Every helper here works on integers
 * and strings only — there is not a single `/` or `*` applied to a money value
 * that could produce a fractional double.
 *
 * Percentages are integer basis points (3333 = 33.33%), never floats.
 */

/**
 * SPEC §5: the single distribution function. Every division of a total in the
 * app routes through here. There is no second rounding path.
 *
 * Largest remainder:
 *   1. base_i = (total * w_i) // sum(weights)
 *   2. hand out the leftover cents one each, in descending order of fractional
 *      remainder
 *   3. ties break by ascending participant created_at
 *
 * Callers pass `weights` in canonical participant order (ascending
 * `created_at`), so step 3 is simply ascending index.
 *
 * Guarantee: sum(distribute(total, weights)) === total.
 *
 * @param {number} totalCents non-negative integer
 * @param {number[]} weights non-negative integers, at least one, summing > 0
 * @returns {number[]} integer cents, one per weight
 */
export function distribute(totalCents, weights) {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new TypeError('distribute: totalCents must be a non-negative integer')
  }
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new TypeError('distribute: weights must be a non-empty array')
  }
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) {
    throw new TypeError('distribute: weights must be non-negative integers')
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight === 0) {
    throw new RangeError('distribute: weights must sum to more than zero')
  }

  // Step 1: integer floor share, and the numerator of the fractional part.
  const shares = []
  const remainders = []
  for (let i = 0; i < weights.length; i += 1) {
    const numerator = totalCents * weights[i]
    shares.push(Math.floor(numerator / totalWeight))
    remainders.push(numerator % totalWeight)
  }

  // Step 2 and 3: leftover cents, largest remainder first, earliest
  // participant first on a tie.
  let leftover = totalCents - shares.reduce((a, b) => a + b, 0)
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => remainders[b] - remainders[a] || a - b)

  for (let i = 0; leftover > 0; i += 1) {
    shares[order[i % order.length]] += 1
    leftover -= 1
  }

  return shares
}

/**
 * Sum integer cents. A named helper so summing money never reaches for a
 * float-shaped reduce inline.
 * @param {number[]} values
 * @returns {number}
 */
export function sumCents(values) {
  return values.reduce((a, b) => a + b, 0)
}

// Accepts "12", "12.4", "12.40", ".05", "1,234.56". Rejects anything else.
const DECIMAL_INPUT = /^(\d*)(?:\.(\d{0,2}))?$/

/**
 * Parse a user-typed decimal string into integer cents, without ever building
 * a float. "12.40" becomes 1240 by string surgery, not by multiplying by 100.
 *
 * @param {string} input
 * @returns {number|null} integer cents, or null if the input is not valid
 */
export function parseAmountToCents(input) {
  return parseScaledInteger(input)
}

/**
 * Parse a user-typed percentage into integer basis points. "33.33" becomes
 * 3333. SPEC §5: percentages are never stored as floats.
 *
 * @param {string} input
 * @returns {number|null} integer basis points, or null if invalid
 */
export function parseBasisPoints(input) {
  return parseScaledInteger(input)
}

/**
 * Shared string-only parse for "units.hundredths" inputs. Both money (cents)
 * and percentages (basis points) are the same shape: an integer scaled by 100.
 */
function parseScaledInteger(input) {
  if (typeof input !== 'string') return null

  const cleaned = input.trim().replace(/,/g, '')
  if (cleaned === '' || cleaned === '.') return null

  const match = DECIMAL_INPUT.exec(cleaned)
  if (!match) return null

  const whole = match[1] === '' ? '0' : match[1]
  const fraction = (match[2] ?? '').padEnd(2, '0')

  const scaled = Number(whole + fraction)
  return Number.isSafeInteger(scaled) ? scaled : null
}

/**
 * Render integer cents as an en-US decimal string: 123456 -> "1,234.56".
 * Done by slicing the digit string, so no division rounds anything.
 *
 * @param {number} cents
 * @returns {string}
 */
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const digits = String(Math.abs(cents)).padStart(3, '0')
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = digits.slice(-2)
  return `${sign}${whole}.${fraction}`
}

/**
 * Render integer cents with the trip's currency label.
 *
 * SPEC §10 and §11.4: the label is a display string with no conversion logic,
 * and the chosen rendering is a prefix — "EUR 1,234.56". This is the one
 * rendering used everywhere.
 *
 * @param {number} cents
 * @param {string} currencyLabel
 * @returns {string}
 */
export function formatMoney(cents, currencyLabel) {
  const amount = formatCents(cents)
  const label = (currencyLabel ?? '').trim()
  return label === '' ? amount : `${label} ${amount}`
}

/**
 * Render integer basis points as a percentage string, trimming the decimals
 * that carry no information: 5000 -> "50", 3333 -> "33.33", 1250 -> "12.5".
 *
 * @param {number} basisPoints
 * @returns {string}
 */
export function formatBasisPoints(basisPoints) {
  const sign = basisPoints < 0 ? '-' : ''
  const digits = String(Math.abs(basisPoints)).padStart(3, '0')
  const whole = digits.slice(0, -2)
  const fraction = digits.slice(-2).replace(/0+$/, '')
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '')
  return fraction === '' ? `${sign}${trimmedWhole}` : `${sign}${trimmedWhole}.${fraction}`
}
