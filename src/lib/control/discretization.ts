/**
 * Polynomial helpers and Tustin (bilinear) discretization.
 *
 * All polynomials use descending-power convention:
 *   coeffs[0] * z^n + coeffs[1] * z^{n-1} + … + coeffs[n]
 *
 * Tustin (bilinear) transform:
 *   s  →  (2 / T) · (z − 1) / (z + 1)
 *
 * For a continuous-time transfer function C(s) = N(s) / D(s) of degree n
 * (deg(D) = n ≥ deg(N)):
 *
 *   C_d(z) = N_d(z) / D_d(z)
 *
 * where
 *
 *   N_d(z) = Σ_{k} n_k · (2/T)^k · (z−1)^k · (z+1)^{n−k}
 *   D_d(z) = Σ_{k} d_k · (2/T)^k · (z−1)^k · (z+1)^{n−k}
 *
 * and k is the power of s represented by each coefficient.
 *
 * Input requirement: deg(numerator) ≤ deg(denominator) (proper system).
 * The function will throw if this is violated.
 *
 * Pure functions only. No side effects.
 */

/**
 * Multiply two polynomials (descending-power convention).
 *
 * polyMul([1, 2], [3, 4]) → [3, 10, 8]  (= (z+2)(3z+4) = 3z²+10z+8)
 */
export function polyMul(a: number[], b: number[]): number[] {
	if (a.length === 0 || b.length === 0) return [0];
	const result = new Array(a.length + b.length - 1).fill(0);
	for (let i = 0; i < a.length; i++) {
		for (let j = 0; j < b.length; j++) {
			result[i + j] += a[i] * b[j];
		}
	}
	return result;
}

/**
 * Add two polynomials (descending-power convention, may differ in degree).
 *
 * Shorter polynomial is zero-padded on the left (higher powers).
 */
export function polyAdd(a: number[], b: number[]): number[] {
	const n = Math.max(a.length, b.length);
	const result = new Array(n).fill(0);
	for (let i = 0; i < a.length; i++) result[n - a.length + i] += a[i];
	for (let i = 0; i < b.length; i++) result[n - b.length + i] += b[i];
	return result;
}

/** Scale every coefficient of a polynomial by constant c. */
export function polyScale(p: number[], c: number): number[] {
	return p.map((x) => x * c);
}

/**
 * Raise a polynomial to a non-negative integer power.
 *
 * polyPow([1, -1], 2) → [1, -2, 1]  (= (z−1)²)
 */
export function polyPow(p: number[], n: number): number[] {
	if (n === 0) return [1];
	let result = [1];
	for (let i = 0; i < n; i++) result = polyMul(result, p);
	return result;
}

/**
 * Apply the Tustin (bilinear) transform to discretize a continuous-time transfer function.
 *
 * Substitutes s = (2/T) · (z−1)/(z+1) into C(s) = N(s)/D(s).
 * Multiplies through by (z+1)^n (where n = deg(D)) to clear the denominator.
 *
 * @param numerator   - Continuous numerator coefficients, highest power first
 * @param denominator - Continuous denominator coefficients, highest power first
 * @param dt          - Sample period T (seconds), must be positive
 * @returns Discrete-time numerator and denominator in descending z^k order
 * @throws Error if the system is improper (deg(N) > deg(D)) or dt ≤ 0
 */
export function tustinDiscretize(
	numerator: number[],
	denominator: number[],
	dt: number
): { numerator: number[]; denominator: number[] } {
	if (dt <= 0) throw new Error('tustinDiscretize: dt must be positive');

	const degNum = numerator.length - 1;
	const degDen = denominator.length - 1;

	if (degNum > degDen) {
		throw new Error(
			`tustinDiscretize: improper system — deg(N)=${degNum} > deg(D)=${degDen}. ` +
				'Add a fast filter pole to make the system proper before discretizing.'
		);
	}

	const n = degDen; // denominator degree
	const twoOverT = 2 / dt;

	/**
	 * Discretize one polynomial p(s) by substituting s = (2/T)(z-1)/(z+1),
	 * then multiplying by (z+1)^n to clear the denominator.
	 *
	 * Result = Σ_k p_k · (2/T)^k · (z−1)^k · (z+1)^(n−k)
	 */
	function discretizePoly(coeffs: number[]): number[] {
		let result: number[] = [];
		for (let i = 0; i < coeffs.length; i++) {
			const power = coeffs.length - 1 - i; // power of s in this term
			const c = coeffs[i];
			if (c === 0) continue;

			const scale = c * Math.pow(twoOverT, power);
			// (z-1)^power in descending order: [1, -1]^power
			const zMinus1p = polyPow([1, -1], power);
			// (z+1)^(n-power) in descending order: [1, +1]^(n-power)
			const zPlus1np = polyPow([1, 1], n - power);
			const term = polyScale(polyMul(zMinus1p, zPlus1np), scale);
			result = result.length === 0 ? term : polyAdd(result, term);
		}
		return result.length === 0 ? [0] : result;
	}

	const discNum = discretizePoly(numerator);
	const discDen = discretizePoly(denominator);

	return { numerator: discNum, denominator: discDen };
}

/**
 * Normalize a polynomial so its leading coefficient is 1.
 * Also strips leading near-zero coefficients.
 *
 * @param coeffs - Polynomial in descending order
 * @param eps    - Threshold below which a leading coefficient is considered zero
 */
export function normalizePoly(coeffs: number[], eps = 1e-12): number[] {
	let start = 0;
	while (start < coeffs.length - 1 && Math.abs(coeffs[start]) < eps) start++;
	const trimmed = coeffs.slice(start);
	const lead = trimmed[0];
	return lead === 0 ? trimmed : trimmed.map((c) => c / lead);
}

/**
 * Format a z-domain polynomial for human display.
 *
 * e.g. [1.0, -0.8] → "1.000z¹ − 0.800"
 *
 * @param coeffs - Polynomial coefficients in descending z^k order
 * @param digits - Number of decimal places
 */
export function formatPolyZ(coeffs: number[], digits = 3): string {
	const n = coeffs.length - 1; // degree
	const terms: { sign: string; term: string }[] = [];
	for (let i = 0; i < coeffs.length; i++) {
		const power = n - i;
		const c = coeffs[i];
		if (Math.abs(c) < 1e-12) continue;
		const absC = Math.abs(c);
		const sign = c < 0 ? '−' : '+';
		const coeff = absC.toFixed(digits);
		const varPart =
			power === 0 ? '' : power === 1 ? 'z' : `z${power > 1 ? superscript(power) : ''}`;
		const term = varPart ? `${coeff}${varPart}` : coeff;
		terms.push({ sign, term });
	}
	if (terms.length === 0) return '0';
	const first = terms[0];
	const rest = terms.slice(1);
	return (
		(first.sign === '−' ? '−' : '') + first.term + rest.map((t) => ` ${t.sign} ${t.term}`).join('')
	);
}

/** Convert a small positive integer to a Unicode superscript string. */
function superscript(n: number): string {
	const map: Record<string, string> = {
		'0': '⁰',
		'1': '¹',
		'2': '²',
		'3': '³',
		'4': '⁴',
		'5': '⁵',
		'6': '⁶',
		'7': '⁷',
		'8': '⁸',
		'9': '⁹'
	};
	return String(n)
		.split('')
		.map((d) => map[d] ?? d)
		.join('');
}
