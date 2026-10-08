export const STEPS = [
	{ id: 'materials', label: '材质', icon: 'account_tree' },
	{ id: 'scene', label: '场景', icon: 'landscape' },
	{ id: 'camera', label: '相机', icon: 'videocam' },
	{ id: 'preview', label: '预览渲染', icon: 'tune' },
	{ id: 'export', label: '最终导出', icon: 'save_alt' },
];

export function stepIndex(id) {
	return STEPS.findIndex(step => step.id === id);
}

export function isTraceStep(id) {
	return id === 'preview' || id === 'export';
}

export function canMoveCamera(id) {
	return id === 'materials' || id === 'scene' || id === 'camera';
}

export function canExport(step, finalStarted, spp, finalSamples) {
	return step === 'export' && !!finalStarted && spp >= Math.max(1, finalSamples);
}

export function validateFinalSize(width, height, maxTextureSize) {
	if (width > maxTextureSize || height > maxTextureSize) return '最终尺寸超过当前 GPU 的纹理上限';
	if (width * height > 16_777_216) return '最终画面超过 1600 万像素，请降低宽度或高度';
	return null;
}

export function resolveRenderSize(settings, step, finalStarted, viewport, interacting) {
	let width = settings.res_mode === 'custom' ? settings.res_width : Math.max(64, Math.floor(viewport.width));
	let height = settings.res_mode === 'custom' ? settings.res_height : Math.max(64, Math.floor(viewport.height));
	if (step === 'preview' || (step === 'export' && !finalStarted)) {
		const scale = Math.max(0.25, Math.min(1, settings.preview_scale || 1));
		width *= scale;
		height *= scale;
	}
	if (interacting) {
		const scale = Math.max(0.2, Math.min(1, settings.interactive_scale || 1));
		width *= scale;
		height *= scale;
	}
	return { width: Math.max(8, Math.round(width)), height: Math.max(8, Math.round(height)) };
}
