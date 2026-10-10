export const STEPS = [
	{ id: 'materials', label: '材质', icon: 'account_tree' },
	{ id: 'scene', label: '场景', icon: 'landscape' },
	{ id: 'camera', label: '相机', icon: 'videocam' },
	{ id: 'preview', label: '预览渲染', icon: 'tune' },
	{ id: 'export', label: '最终导出', icon: 'save_alt' },
];

// 返回工作流步骤在固定顺序中的索引，用于导航和进度显示。
export function stepIndex(id) {
	return STEPS.findIndex(step => step.id === id);
}

// 判断当前步骤是否需要创建或驱动路径追踪器。
export function isTraceStep(id) {
	return id === 'preview' || id === 'export';
}

// 只有相机步骤允许直接改变渲染相机。
export function canMoveCamera(id) {
	return id === 'camera';
}

// 判断当前步骤是否属于只查看材质/场景的检查阶段。
export function isInspectionStep(id) {
	return id === 'materials' || id === 'scene';
}

// 判断当前步骤是否允许在预览区域中旋转或缩放视图。
export function canNavigatePreview(id) {
	return isInspectionStep(id) || canMoveCamera(id);
}

// 只有最终渲染已启动、分块完成且样本达到目标时才允许导出。
export function canExport(step, finalStarted, spp, finalSamples, completed = true) {
	return step === 'export' && !!finalStarted && completed && spp >= Math.max(1, finalSamples);
}

// 校验最终输出尺寸，先限制整数和像素下限，再检查 GPU 与总像素上限。
export function validateFinalSize(width, height, maxTextureSize) {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) return '最终尺寸必须是至少 8 像素的整数';
	if (width > maxTextureSize || height > maxTextureSize) return '最终尺寸超过当前 GPU 的纹理上限';
	if (width * height > 16_777_216) return '最终画面超过 1600 万像素，请降低宽度或高度';
	return null;
}

// 根据输出模式、预览缩放和交互缩放计算实际渲染尺寸。
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
