import { clamp } from '../core/math.js';

// 使用平滑三次曲线把太阳高度映射为连续的过渡权重。
function smoothstep(low, high, value) {
	const t = clamp((value - low) / (high - low), 0, 1);
	return t * t * (3 - 2 * t);
}

// 将民用时钟映射为太阳高度：约 06:00 日出、12:00 中天、18:00 日落。
export function dayCycle(hour = 12) {
	const time = ((Number(hour) || 0) % 24 + 24) % 24;
	const elevation = Math.sin((time - 6) * Math.PI / 12) * 70;
	const daylight = smoothstep(-6, 12, elevation);
	const sunStrength = smoothstep(-2, 8, elevation);
	const twilight = Math.exp(-Math.pow(elevation / 12, 2));
	const warmth = 1 - smoothstep(0, 25, elevation);
	const dayArc = Math.sqrt(clamp(Math.sin(elevation * Math.PI / 180) / Math.sin(70 * Math.PI / 180), 0, 1));
	return {
		time, elevation, azimuth: time * 15, daylight, sunStrength, twilight,
		brightness: 0.008 + 0.992 * daylight * (0.25 + 0.75 * dayArc),
		tint: [0.3 + 0.7 * daylight, 0.45 + 0.55 * daylight, 1],
		sunTint: [1, 1 - 0.5 * warmth, 1 - 0.78 * warmth],
	};
}

export function environmentCycle(settings) {
	// 关闭日周期时返回恒定光照，否则根据设置中的时间计算环境参数。
	return settings.day_cycle === false
		? { brightness: 1, tint: [1, 1, 1], sunStrength: 1, sunTint: [1, 1, 1], twilight: 0, daylight: 1 }
		: dayCycle(settings.time_of_day ?? 12);
}

// 只修改当前渲染器拥有的像素数组，导入的 HDR/背景源仍可安全复用。
export function applyEnvironmentCycle(pixels, settings) {
	const cycle = environmentCycle(settings);
	// 每四个元素是一组 RGBA 像素，只调整前三个颜色通道。
	for (let i = 0; i < pixels.length; i += 4) {
		for (let c = 0; c < 3; c++) pixels[i + c] *= cycle.brightness * cycle.tint[c];
	}
	return pixels;
}
