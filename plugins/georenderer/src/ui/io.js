import { clamp, srgbToLinear } from '../core/math.js';
import { parseHDR } from '../scene/environment.js';
import { syncControls } from './controls.js';
import { showError } from './render-loop.js';
import { PTR, saveSettings } from './state.js';
import { canExport } from './workflow-state.js';

export function loadEnvFile(file) {
	PTR.scenePresetRequest++;
	PTR.sceneCubemap = null;
	const name = file.name || '';
	const reader = new FileReader();
	reader.onerror = () => showError(new Error('读取文件失败'));
	if (/\.hdr$/i.test(name)) {
		reader.onload = () => {
			try {
				PTR.customEnv = parseHDR(reader.result);
				PTR.customEnvName = name;
				PTR.settings.env_mode = 'image';
				syncControls();
				PTR.nodes.envName.textContent = name + '  (' + PTR.customEnv.width + '×' + PTR.customEnv.height + ')';
				if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
				else if (PTR.tracer) PTR.needsRebuild = true;
				saveSettings();
				PTR.workspaceScene?.refresh();
			} catch (err) { showError(err); }
		};
		reader.readAsArrayBuffer(file);
	} else {
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				try {
					const c = document.createElement('canvas');
					const maxW = 4096;
					const sc = Math.min(1, maxW / img.naturalWidth);
					c.width = Math.max(2, Math.round(img.naturalWidth * sc));
					c.height = Math.max(2, Math.round(img.naturalHeight * sc));
					const ctx = c.getContext('2d');
					ctx.drawImage(img, 0, 0, c.width, c.height);
					const src = ctx.getImageData(0, 0, c.width, c.height).data;
					const data = new Float32Array(c.width * c.height * 4);
					for (let i = 0; i < c.width * c.height; i++) {
						data[i * 4] = srgbToLinear(src[i * 4] / 255);
						data[i * 4 + 1] = srgbToLinear(src[i * 4 + 1] / 255);
						data[i * 4 + 2] = srgbToLinear(src[i * 4 + 2] / 255);
						data[i * 4 + 3] = 1;
					}
					PTR.customEnv = { width: c.width, height: c.height, data: data };
					PTR.customEnvName = name;
					PTR.settings.env_mode = 'image';
					syncControls();
					PTR.nodes.envName.textContent = name + '  (' + c.width + '×' + c.height + ')';
					if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
					else if (PTR.tracer) PTR.needsRebuild = true;
					saveSettings();
					PTR.workspaceScene?.refresh();
				} catch (err) { showError(err); }
			};
			img.onerror = () => showError(new Error('无法解码图片'));
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	}
}

function drawWatermark(ctx, w, h) {
	const s = PTR.settings;
	if (!s.watermark_enable || !s.watermark_text) return;
	const size = Math.max(6, s.watermark_size);
	ctx.save();
	ctx.font = size + 'px sans-serif';
	ctx.textBaseline = 'bottom';
	ctx.textAlign = 'left';
	ctx.globalAlpha = clamp(s.watermark_opacity, 0, 1);
	ctx.fillStyle = s.watermark_color;
	ctx.shadowColor = 'rgba(0,0,0,0.6)';
	ctx.shadowBlur = Math.max(2, size * 0.12);
	const pad = Math.max(4, size * 0.35);
	ctx.fillText(s.watermark_text, pad, h - pad);
	ctx.restore();
}

function renderOutputCanvas() {
	const t = PTR.tracer;
	if (!t || !canExport(PTR.step, PTR.finalStarted, t.spp, PTR.settings.final_samples)) {
		Blockbench.showQuickMessage('请等待最终渲染完成', 1500);
		return null;
	}
	t.present(PTR.settings);
	const out = document.createElement('canvas');
	out.width = t.canvas.width;
	out.height = t.canvas.height;
	const ctx = out.getContext('2d');
	ctx.drawImage(t.canvas, 0, 0);
	drawWatermark(ctx, out.width, out.height);
	return out;
}

export function saveImage() {
	try {
		const canvas = renderOutputCanvas();
		if (!canvas) return;
		Blockbench.export({
			type: 'PNG',
			extensions: ['png'],
			name: (Project && Project.name ? Project.name : 'render') + '_georenderer',
			content: canvas.toDataURL('image/png'),
			savetype: 'image',
		});
	} catch (err) {
		showError(err);
	}
}

export async function copyImage() {
	try {
		const canvas = renderOutputCanvas();
		if (!canvas) return;
		if (typeof clipboard !== 'undefined' && typeof nativeImage !== 'undefined') {
			clipboard.writeImage(nativeImage.createFromDataURL(canvas.toDataURL('image/png')));
		} else if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
			const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法编码 PNG')), 'image/png'));
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		} else {
			throw new Error('当前环境不支持图片剪贴板');
		}
		Blockbench.showQuickMessage('渲染图片已复制到剪贴板', 1800);
	} catch (err) { showError(err); }
}

export function openBlockbenchScreenshot() {
	try {
		const canvas = renderOutputCanvas();
		if (!canvas) return;
		if (typeof Screencam === 'undefined' || !Screencam.returnScreenshot) throw new Error('Blockbench 截图面板不可用');
		Screencam.returnScreenshot(canvas.toDataURL('image/png'));
	} catch (err) { showError(err); }
}
