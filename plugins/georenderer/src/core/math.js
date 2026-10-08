

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

export function hexToLinear(hex) {
	let h = (hex || '#000000').replace('#', '');
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const r = parseInt(h.substr(0, 2), 16) / 255;
	const g = parseInt(h.substr(2, 2), 16) / 255;
	const b = parseInt(h.substr(4, 2), 16) / 255;
	return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function srgbToLinear(c) {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function vNorm(v) {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}
export function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function vCross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}
export function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export const CUBE_FACE_NORMALS = {
	east: [1, 0, 0], west: [-1, 0, 0],
	up: [0, 1, 0], down: [0, -1, 0],
	south: [0, 0, 1], north: [0, 0, -1],
};
export function triangleFacesInward(indices, positions, normal) {
	const a = indices[0] * 3, b = indices[1] * 3, c = indices[2] * 3;
	const geometric = vCross(
		[positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]],
		[positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
	);
	return vDot(geometric, normal) < 0;
}
function nextPow2(n) {
	let p = 1;
	while (p < n) p *= 2;
	return p;
}
