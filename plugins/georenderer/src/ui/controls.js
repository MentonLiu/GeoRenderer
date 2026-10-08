import { clamp } from '../core/math.js';
import { el } from './dom.js';
import { applyResolution, rebuildScene, showError, updateStatus } from './render-loop.js';
import { CHANGE_KIND, PTR, refreshRasterMaterials, saveSettings } from './state.js';

export function makeRow(label, ctrls) {
	return el('div', { class: 'ptr_row' }, [
		el('label', { text: label, title: label }),
		el('div', { class: 'ptr_ctrl' }, ctrls),
	]);
}

function register(key, setter) {
	PTR.controls.push({ key: key, set: setter });
}

export function syncControls() {
	PTR.controls.forEach(c => {
		try { c.set(PTR.settings[c.key]); } catch (err) { }
	});
}

export function rowSlider(label, key, min, max, step, digits) {
	const s = PTR.settings;
	const range = el('input', { type: 'range', min: min, max: max, step: step, value: s[key] });
	const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
	const apply = (raw, src) => {
		let v = parseFloat(raw);
		if (isNaN(v)) return;
		v = clamp(v, min, max);
		s[key] = v;
		if (src !== 'r') range.value = v;
		if (src !== 'n') num.value = digits != null ? +v.toFixed(digits) : v;
		onSettingChanged(key);
	};
	range.addEventListener('input', () => apply(range.value, 'r'));
	num.addEventListener('change', () => apply(num.value, 'n'));
	register(key, v => { range.value = v; num.value = digits != null ? +Number(v).toFixed(digits) : v; });
	return makeRow(label, [range, num]);
}

export function rowNumber(label, key, min, max, step) {
	const s = PTR.settings;
	const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
	num.addEventListener('change', () => {
		let v = parseFloat(num.value);
		if (isNaN(v)) return;
		v = clamp(v, min, max);
		s[key] = v;
		num.value = v;
		onSettingChanged(key);
	});
	register(key, v => { num.value = v; });
	return makeRow(label, [num]);
}

export function rowCheck(label, key) {
	const s = PTR.settings;
	const box = el('input', { type: 'checkbox' });
	box.checked = !!s[key];
	box.addEventListener('change', () => { s[key] = box.checked; onSettingChanged(key); });
	register(key, v => { box.checked = !!v; });
	return makeRow(label, [box]);
}

export function rowText(label, key, placeholder) {
	const s = PTR.settings;
	const inp = el('input', { type: 'text', value: s[key] || '' });
	if (placeholder) inp.setAttribute('placeholder', placeholder);
	inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
	register(key, v => { inp.value = v || ''; });
	return makeRow(label, [inp]);
}

export function rowColor(label, key) {
	const s = PTR.settings;
	const inp = el('input', { type: 'color', value: s[key] });
	inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
	register(key, v => { inp.value = v; });
	return makeRow(label, [inp]);
}

export function rowSelect(label, key, options) {
	const s = PTR.settings;
	const sel = el('select');
	for (const val in options) {
		const o = el('option', { value: val, text: options[val] });
		sel.appendChild(o);
	}
	sel.value = s[key];
	sel.addEventListener('change', () => { s[key] = sel.value; onSettingChanged(key); });
	register(key, v => { sel.value = v; });
	return makeRow(label, [sel]);
}

export function card(title, icon, children) {
	const head = el('div', { class: 'ptr_card_head' }, [
		el('i', { class: 'material-icons', text: icon }),
		el('span', { text: title }),
	]);
	return el('div', { class: 'ptr_card' }, [head].concat(children));
}

export function buildStages(stages) {
	const wrap = el('div', { id: 'ptr_sidebar' });
	const panes = el('div', { class: 'ptr_stagepanes' });
	PTR.nodes.stagePanes = {};
	stages.forEach(stage => {
		const pane = el('section', { class: 'ptr_stagepane', 'data-step': stage.id }, stage.cards);
		pane.hidden = stage.id !== PTR.step;
		PTR.nodes.stagePanes[stage.id] = pane;
		panes.appendChild(pane);
	});
	wrap.appendChild(panes);
	return wrap;
}

function onSettingChanged(key) {
	if (PTR.onSettingChanged) PTR.onSettingChanged(key);
	saveSettings();
	const kind = CHANGE_KIND[key] || 'reset';
	if (kind === 'scene' || key === 'filter_linear') refreshRasterMaterials();
	const t = PTR.tracer;
	if (!t) return;
	if (!PTR.open) { PTR.needsRebuild = true; return; }
	if (kind === 'post') { t.present(PTR.settings); updateStatus(); return; }
	if (kind === 'resize') { applyResolution(); return; }
	if (kind === 'env') {
		try { t.setEnvironment(PTR.settings, PTR.customEnv); } catch (err) { showError(err); return; }
	}
	if (kind === 'scene') {
		clearTimeout(PTR.rebuildTimer);
		PTR.rebuildTimer = setTimeout(() => rebuildScene(), 220);
		return;
	}
	t.reset();
}
