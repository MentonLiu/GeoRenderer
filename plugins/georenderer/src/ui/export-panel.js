import { formatClock } from '../scene/presets.js';
import { listBlockbenchScenes } from '../scene/blockbench-scene.js';
import { card, rowNumber } from './controls.js';
import { el } from './dom.js';
import { PTR } from './state.js';

export function buildExportPanel() {
	PTR.nodes.exportSummary = el('div', { class: 'ptr_summary' });
	return [
		card('最终参数', 'fact_check', [
			PTR.nodes.exportSummary,
			rowNumber('成片采样数', 'final_samples', 1, 100000, 1),
		]),
		card('渲染与输出', 'save_alt', [
			el('div', { class: 'ptr_note', text: '左侧保留当前预览。确认后点击下方“开始最终渲染”；达到目标采样数后可复制图片、另存 PNG，或交给 Blockbench 截图面板。' }),
		]),
	];
}

export function updateExportSummary() {
	const host = PTR.nodes.exportSummary;
	if (!host) return;
	const s = PTR.settings;
	const size = s.res_mode === 'custom' ? `${s.res_width} × ${s.res_height}` : '适应预览窗口';
	const groups = Object.keys(PTR.groupOverrides).length;
	const scene = listBlockbenchScenes().find(item => item.id === s.scene_preset)?.name || '无';
	const effects = [s.denoise && '降噪', s.bloom_enable && '泛光', s.vignette_enable && '暗角', s.sharpen_enable && '锐化', s.grain_enable && '颗粒'].filter(Boolean).join('、') || '无';
	const groundTexture = ((typeof Texture !== 'undefined' && Texture.all) || []).find(texture => texture.uuid === s.ground_texture_uuid);
	const lines = [
		`画面：${size}，${s.final_samples} spp`,
		`镜头：${s.ortho ? '正交' : `FOV ${s.fov}°`}，光圈 ${s.aperture}，${s.auto_focus ? '自动对焦' : `焦距 ${s.focus_distance}`}`,
		`材质：${groups} 个组覆盖，默认粗糙度 ${s.def_roughness} / 金属度 ${s.def_metalness}`,
		`Blockbench 预览场景：${scene}；追踪环境：${s.env_mode === 'image' && PTR.customEnv ? (PTR.customEnvSource === 'scene' ? '场景立方体贴图' : '自定义 HDR / 图片') : 'GeoRenderer 环境'}，${formatClock(s.time_of_day)}`,
		`场景几何：${PTR.tracer?.scene?.previewTriCount || 0} 个三角形（含启用的预览模型）`,
		`追踪地面：${PTR.tracer?.scene?.sceneTriCount ? '使用场景几何' : s.ground_on ? '开启' : '关闭'}${!PTR.tracer?.scene?.sceneTriCount && groundTexture ? '（' + groundTexture.name + '）' : ''}`,
		`追踪：${s.max_bounce} 次反弹，${s.light_samples} 次光源采样`,
		`后期：${s.tone_mapping.toUpperCase()}，${effects}`,
	];
	host.replaceChildren(...lines.map(line => el('div', { class: 'ptr_summary_line', text: line })));
}
