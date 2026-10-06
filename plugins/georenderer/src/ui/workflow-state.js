export const STEPS = [
	{ id: 'camera', label: '镜头与材质', icon: 'videocam' },
	{ id: 'scene', label: '场景', icon: 'landscape' },
	{ id: 'preview', label: '预览渲染', icon: 'tune' },
	{ id: 'export', label: '最终导出', icon: 'save_alt' },
];

export function stepIndex(id) {
	return STEPS.findIndex(step => step.id === id);
}

export function isTraceStep(id) {
	return id === 'preview' || id === 'export';
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
