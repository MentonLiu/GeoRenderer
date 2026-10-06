import { clamp } from '../core/math.js';
import { el } from './dom.js';
import { makeRow } from './controls.js';
import { rebuildScene } from './render-loop.js';
import { PTR, saveSettings } from './state.js';

export function buildGroupList() {
	const host = PTR.nodes.groupList;
	if (!host) return;
	host.replaceChildren();
	const groups = (typeof Group !== 'undefined' && Group.all) || [];
	if (!groups.length) {
		host.appendChild(el('div', { class: 'ptr_note', text: '当前模型没有组；在 Blockbench 的大纲中建立组后可在这里分别配置。' }));
		return;
	}
	for (const group of groups) {
		const box = el('div', { class: 'ptr_mat' });
		box.appendChild(el('div', { class: 'ptr_mat_head', text: group.name || '未命名组' }));
		let ov = PTR.groupOverrides[group.uuid] || null;
		const toggle = el('input', { type: 'checkbox' });
		toggle.checked = !!ov;
		const settingsBox = el('div');
		settingsBox.hidden = !ov;
		const update = () => {
			saveSettings();
			if (PTR.raster) PTR.raster.refreshModel();
			if (PTR.tracer) {
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(rebuildScene, 180);
			}
		};
		toggle.addEventListener('change', () => {
			if (toggle.checked) {
				ov = { roughness: PTR.settings.def_roughness, metalness: PTR.settings.def_metalness, emissive: 0 };
				PTR.groupOverrides[group.uuid] = ov;
			} else {
				delete PTR.groupOverrides[group.uuid];
				ov = null;
			}
			settingsBox.hidden = !ov;
			if (ov) buildGroupList();
			update();
		});
		box.appendChild(makeRow('覆盖材质', [toggle]));
		for (const [label, key, min, max, step] of [
			['粗糙度', 'roughness', 0, 1, 0.01],
			['金属度', 'metalness', 0, 1, 0.01],
			['自发光', 'emissive', 0, 20, 0.1],
		]) {
			const input = el('input', { type: 'number', min, max, step, value: ov ? ov[key] : 0 });
			input.addEventListener('change', () => {
				if (!ov) return;
				const value = Number(input.value);
				if (!Number.isFinite(value)) return;
				ov[key] = clamp(value, min, max);
				input.value = ov[key];
				update();
			});
			settingsBox.appendChild(makeRow(label, [input]));
		}
		const color = el('input', { type: 'color', value: (ov && ov.emissive_color) || '#ffffff' });
		color.addEventListener('input', () => { if (ov) { ov.emissive_color = color.value; update(); } });
		settingsBox.appendChild(makeRow('发光颜色', [color]));
		box.appendChild(settingsBox);
		host.appendChild(box);
	}
}
