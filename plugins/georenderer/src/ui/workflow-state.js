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
