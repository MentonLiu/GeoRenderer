import { clamp } from '../core/math.js';
import { el } from './dom.js';
import { applyResolution, rebuildScene, showError, updateStatus } from './render-loop.js';
import { CHANGE_KIND, PTR, refreshRasterMaterials, saveSettings } from './state.js';

// 创建统一的标签加控件行，保证所有设置面板拥有一致的 DOM 结构。
export function makeRow(label, ctrls) {
	return el('div', { class: 'ptr_row' }, [
		el('label', { text: label, title: label }),
		el('div', { class: 'ptr_ctrl' }, ctrls),
	]);
}

// 登记控件回写函数，使加载设置或切换预设时可以统一刷新界面。
function register(key, setter) {
	PTR.controls.push({ key: key, set: setter });
}

// 将当前设置值同步到所有已登记控件，单个控件失败不影响其他控件。
export function syncControls() {
	// 控件数组由各类 row 工厂追加，顺序与创建面板的顺序一致。
	PTR.controls.forEach(c => {
		try { c.set(PTR.settings[c.key]); } catch (err) { }
	});
}

// 创建双向同步的滑块和数字输入控件。
export function rowSlider(label, key, min, max, step, digits) {
	const s = PTR.settings;
	const range = el('input', { type: 'range', min: min, max: max, step: step, value: s[key] });
	const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
	// 根据输入来源更新设置；src 用于避免再次回写触发控件循环。
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

// 创建带范围限制的数字输入控件。
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

// 创建布尔开关控件，并将 change 事件映射到统一设置入口。
export function rowCheck(label, key) {
	const s = PTR.settings;
	const box = el('input', { type: 'checkbox' });
	box.checked = !!s[key];
	box.addEventListener('change', () => { s[key] = box.checked; onSettingChanged(key); });
	register(key, v => { box.checked = !!v; });
	return makeRow(label, [box]);
}

// 创建文本输入控件，用于水印等字符串设置。
export function rowText(label, key, placeholder) {
	const s = PTR.settings;
	const inp = el('input', { type: 'text', value: s[key] || '' });
	if (placeholder) inp.setAttribute('placeholder', placeholder);
	inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
	register(key, v => { inp.value = v || ''; });
	return makeRow(label, [inp]);
}

// 创建颜色输入控件，保存浏览器标准十六进制颜色值。
export function rowColor(label, key) {
	const s = PTR.settings;
	const inp = el('input', { type: 'color', value: s[key] });
	inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
	register(key, v => { inp.value = v; });
	return makeRow(label, [inp]);
}

// 创建下拉选择控件，options 的键保存到设置，值显示给用户。
export function rowSelect(label, key, options) {
	const s = PTR.settings;
	const sel = el('select');
	// 按 options 的枚举顺序生成选项，键和值的分工是固定协议。
	for (const val in options) {
		const o = el('option', { value: val, text: options[val] });
		sel.appendChild(o);
	}
	sel.value = s[key];
	sel.addEventListener('change', () => { s[key] = sel.value; onSettingChanged(key); });
	register(key, v => { sel.value = v; });
	return makeRow(label, [sel]);
}

// 创建带材质图标标题和内容节点的设置卡片。
export function card(title, icon, children) {
	const head = el('div', { class: 'ptr_card_head' }, [
		el('i', { class: 'material-icons', text: icon }),
		el('span', { text: title }),
	]);
	return el('div', { class: 'ptr_card' }, [head].concat(children));
}

// 创建工作流阶段容器，并缓存每个阶段面板以便后续切换显隐。
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

// 按 CHANGE_KIND 将设置变化路由到重建场景、更新环境、调整尺寸或刷新后处理。
function onSettingChanged(key) {
	if (PTR.onSettingChanged) PTR.onSettingChanged(key);
	saveSettings();
	// kind 是设置到渲染动作的分类协议，未知键默认按 reset 处理。
	const kind = CHANGE_KIND[key] || 'reset';
	if (kind === 'scene' || key === 'filter_linear') refreshRasterMaterials();
	const t = PTR.tracer;
	if (!t) return;
	if (!PTR.open) { PTR.needsRebuild = true; return; }
	if (kind === 'post') {
		PTR.needsPresent = true;
		try {
			if (t.isFrameReady()) { t.present(PTR.settings); t.endFrame(); PTR.needsPresent = false; }
		} catch (err) { showError(err); PTR.paused = true; }
		updateStatus();
		return;
	}
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
