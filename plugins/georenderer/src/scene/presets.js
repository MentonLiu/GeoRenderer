import { clamp } from '../core/math.js';
import { dayCycle } from './day-cycle.js';

export const SCENE_PRESETS = {
	studio: { label: '工作室', env_mode: 'gradient', grad_top: '#dce2e8', grad_bottom: '#30343b', sky_horizon: '#bec8d2', ground_color: '#aab0b6', sun_color: '#ffffff', sun_intensity: 5, env_intensity: 1.2 },
	minecraft_overworld: { label: '主世界', env_mode: 'sky', sky_zenith: '#4f8bd7', sky_horizon: '#c5e2fc', sky_ground: '#64765b', ground_color: '#6c8b55', sun_color: '#fff4cf', sun_intensity: 6, env_intensity: 1 },
	minecraft_end: { label: '末地', env_mode: 'gradient', grad_top: '#19132c', grad_bottom: '#55456b', sky_horizon: '#60517a', ground_color: '#c9c5a2', sun_color: '#bba7ff', sun_intensity: 1.2, env_intensity: 0.6 },
	minecraft_nether: { label: '下界', env_mode: 'gradient', grad_top: '#2d0b0b', grad_bottom: '#8a3020', sky_horizon: '#8a3020', ground_color: '#59332d', sun_color: '#ff7b38', sun_intensity: 2.5, env_intensity: 0.8 },
};

export function applyPreset(settings, id) {
	const preset = SCENE_PRESETS[id];
	if (!preset) return false;
	settings.scene_preset = id;
	for (const [key, value] of Object.entries(preset)) if (key !== 'label') settings[key] = value;
	return true;
}

export function applyTimeOfDay(settings, hour) {
	const time = clamp(Number(hour) || 0, 0, 24);
	settings.time_of_day = time;
	const cycle = dayCycle(time);
	settings.sun_azimuth = cycle.azimuth;
	settings.sun_elevation = cycle.elevation;
	settings.sun_enable = cycle.sunStrength > 0;
	return time;
}

export function formatClock(hour) {
	const minutes = Math.round(clamp(Number(hour) || 0, 0, 24) * 60);
	return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
