

// 将数值限制在指定的最小值和最大值之间。
export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// 将十六进制 sRGB 颜色转换为路径追踪使用的线性 RGB 颜色。
export function hexToLinear(hex) {
	let h = (hex || '#000000').replace('#', '');
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const r = parseInt(h.substr(0, 2), 16) / 255;
	const g = parseInt(h.substr(2, 2), 16) / 255;
	const b = parseInt(h.substr(4, 2), 16) / 255;
	return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

// 将单个 sRGB 通道按标准分段公式转换为线性值。
export function srgbToLinear(c) {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// 返回归一化向量；零向量保持有限值，避免 GPU 数据出现 NaN。
export function vNorm(v) {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}
// 计算两个三维向量的差。
export function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
// 计算两个三维向量的和。
export function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
// 将三维向量的每个分量乘以标量。
export function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
// 计算两个三维向量的叉积，结果垂直于输入向量构成的平面。
export function vCross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}
// 计算两个三维向量的点积，用于夹角和朝向判断。
export function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export const CUBE_FACE_NORMALS = {
	east: [1, 0, 0], west: [-1, 0, 0],
	up: [0, 1, 0], down: [0, -1, 0],
	south: [0, 0, 1], north: [0, 0, -1],
};
// 判断三角形几何朝向是否与给定立方体面法线相反。
export function triangleFacesInward(indices, positions, normal) {
	const a = indices[0] * 3, b = indices[1] * 3, c = indices[2] * 3;
	const geometric = vCross(
		[positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]],
		[positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
	);
	return vDot(geometric, normal) < 0;
}
// 返回不小于输入值的最小二次幂，用于需要规整尺寸的缓冲区规划。
function nextPow2(n) {
	let p = 1;
	// 逐次翻倍，保证结果既足够大又不会引入不必要的尺寸。
	while (p < n) p *= 2;
	return p;
}
