import { DEFAULTS } from '../core/config.js';
import { syncControls } from './controls.js';
import { applyResolution, rebuildScene, showError } from './render-loop.js';
import { PTR, saveSettings } from './state.js';

export function exportSettingsToClipboard() {
	try {
		const data = {};
		for (const k in DEFAULTS) data[k] = PTR.settings[k];
		const payload = { __pathtracer_settings: true, version: 1, data: data };
		const text = JSON.stringify(payload);
		if (typeof Clipbench !== 'undefined' && Clipbench.setText) {
			Clipbench.setText(text);
		} else if (navigator.clipboard) {
			navigator.clipboard.writeText(text);
		} else {
			throw new Error('当前环境不支持写入剪贴板');
		}
		Blockbench.showQuickMessage('渲染设置已复制到剪贴板', 2000);
	} catch (err) { showError(err); }
}

function applyImportedSettings(payload) {
	if (!payload || !payload.__pathtracer_settings || !payload.data) {
		throw new Error('剪贴板内容不是有效的路径追踪渲染设置');
	}
	clearTimeout(PTR.rebuildTimer);
	const data = payload.data;
	PTR.scenePresetRequest++;
	PTR.sceneCubemap = null;
	for (const k in DEFAULTS) if (data[k] !== undefined) PTR.settings[k] = data[k];
	PTR.settings.render_mode = 'preview';
	PTR.finalStarted = false;
	if (PTR.settings.env_mode === 'image' && !PTR.customEnv) {
		PTR.settings.env_mode = 'sky';
	}
	syncControls();
	if (PTR.onSettingsLoaded) PTR.onSettingsLoaded();
	saveSettings();
	const t = PTR.tracer;
	if (t) {
		try {
			t.setEnvironment(PTR.settings, PTR.customEnv);
			applyResolution();
			rebuildScene();
			t.reset();
		} catch (err) { showError(err); }
	}
	Blockbench.showQuickMessage('已从剪贴板导入渲染设置', 2000);
}

export async function importSettingsFromClipboard() {
	try {
		if (!navigator.clipboard || !navigator.clipboard.readText) {
			throw new Error('当前环境不支持读取剪贴板');
		}
		const text = await navigator.clipboard.readText();
		if (!text) throw new Error('剪贴板为空');
		let payload;
		try { payload = JSON.parse(text); } catch (err) { throw new Error('剪贴板内容不是有效的 JSON'); }
		applyImportedSettings(payload);
	} catch (err) { showError(err); }
}

export function resetToDefaults() {
	if (!confirm('确定要将所有渲染设置重置为默认值吗？（不影响材质单独覆盖的参数）')) return;
	clearTimeout(PTR.rebuildTimer);
	for (const k in DEFAULTS) PTR.settings[k] = DEFAULTS[k];
	PTR.settings.render_mode = 'preview';
	PTR.finalStarted = false;
	PTR.scenePresetRequest++;
	PTR.sceneCubemap = null;
	PTR.customEnv = null;
	PTR.customEnvName = '';
	PTR.customEnvSource = '';
	if (PTR.nodes.envName) PTR.nodes.envName.textContent = '(未载入)';
	syncControls();
	if (PTR.onSettingsLoaded) PTR.onSettingsLoaded();
	saveSettings();
	const t = PTR.tracer;
	if (t) {
		try {
			t.setEnvironment(PTR.settings, null);
			applyResolution();
			rebuildScene();
		} catch (err) { showError(err); }
	}
}
