import { clamp } from '../core/math.js';

function smoothstep(low, high, value) {
	const t = clamp((value - low) / (high - low), 0, 1);
	return t * t * (3 - 2 * t);
}

// A civil clock: sunrise around 06:00, solar noon at 12:00, sunset around 18:00.
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
	return settings.day_cycle === false
		? { brightness: 1, tint: [1, 1, 1], sunStrength: 1, sunTint: [1, 1, 1], twilight: 0, daylight: 1 }
		: dayCycle(settings.time_of_day ?? 12);
}

// Work on owned pixels only; imported HDR/background sources remain reusable.
export function applyEnvironmentCycle(pixels, settings) {
	const cycle = environmentCycle(settings);
	for (let i = 0; i < pixels.length; i += 4) {
		for (let c = 0; c < 3; c++) pixels[i + c] *= cycle.brightness * cycle.tint[c];
	}
	return pixels;
}
