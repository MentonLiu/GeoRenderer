import { clamp } from '../core/math.js';
import { PathTracer } from '../gpu/path-tracer.js';
import { el } from './dom.js';
import { saveImage } from './io.js';
import { buildMaterialList } from './material-panel.js';
import { applyResolution, closeRenderer, loop, pauseRenderer, rebuildScene, resumeRenderer, setInteracting, showError, updateStatus } from './render-loop.js';
import { exportSettingsToClipboard, importSettingsFromClipboard, resetToDefaults } from './settings-actions.js';
import { buildSidebar } from './sidebar.js';
import { PTR, saveSettings } from './state.js';
import { RasterPreview } from './raster-preview.js';
import { applyTimeOfDay, formatClock } from '../scene/presets.js';
import { STEPS, isTraceStep, stepIndex } from './workflow-state.js';

function attachViewportEvents(canvas) {
	let dragging = 0;
	let lastX = 0, lastY = 0;

	const endDrag = () => {
		dragging = 0;
		canvas.classList.remove('dragging');
		clearTimeout(PTR.interactTimer);
		PTR.interactTimer = setTimeout(() => setInteracting(false), 200);
	};

	canvas.addEventListener('pointerdown', e => {
		dragging = (e.button === 0 && !e.shiftKey && !e.ctrlKey) ? 1 : 2;
		lastX = e.clientX; lastY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
		canvas.classList.add('dragging');
		clearTimeout(PTR.interactTimer);
		setInteracting(true);
		e.preventDefault();
	});
	canvas.addEventListener('pointermove', e => {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX; lastY = e.clientY;
		if (dragging === 1) PTR.cam.orbit(dx, dy);
		else PTR.cam.pan(dx / Math.max(canvas.clientWidth, 1), dy / Math.max(canvas.clientHeight, 1), 1);
		if (PTR.tracer) PTR.tracer.reset();
	});
	canvas.addEventListener('pointerup', e => { endDrag(); try { canvas.releasePointerCapture(e.pointerId); } catch (err) { } });
	canvas.addEventListener('pointercancel', endDrag);
	canvas.addEventListener('contextmenu', e => e.preventDefault());
	canvas.addEventListener('wheel', e => {
		e.preventDefault();
		PTR.cam.zoom(e.deltaY);
		clearTimeout(PTR.interactTimer);
		setInteracting(true);
		PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
		if (PTR.tracer) PTR.tracer.reset();
	}, { passive: false });
}

function buildWindow() {
	const canvas = el('canvas', { id: 'ptr_canvas' });
	const rasterCanvas = el('canvas', { id: 'ptr_raster_canvas' });
	const overlay = el('div', { id: 'ptr_overlay', text: '准备中（首次加载可能会较为卡顿）…' });
	const watermark = el('div', { id: 'ptr_watermark' });
	const frame = el('div', { id: 'ptr_frame' }, [rasterCanvas, canvas, overlay, watermark]);
	const viewport = el('div', { id: 'ptr_viewport' }, [frame]);
	const sidebar = buildSidebar();
	const root = el('div', { id: 'ptr_root' }, [viewport, sidebar]);
	const nav = el('nav', { id: 'ptr_step_nav', 'aria-label': '渲染流程' });
	PTR.nodes.navButtons = {};
	for (const [index, step] of STEPS.entries()) {
		const button = el('button', { type: 'button', class: 'ptr_step', title: step.label }, [
			el('span', { class: 'ptr_step_number', text: String(index + 1) }),
			el('span', { text: step.label }),
		]);
		button.addEventListener('click', () => setStep(step.id));
		PTR.nodes.navButtons[step.id] = button;
		nav.appendChild(button);
	}

	const bar = el('div');
	const progress = el('div', { id: 'ptr_progress' }, [bar]);
	const status = el('div', { id: 'ptr_status', text: '' });

	const btnPauseIcon = el('i', { class: 'material-icons', text: 'pause' });
	const btnPauseLabel = el('span', { text: '暂停' });
	const btnPause = el('button', { class: 'ptr_btn' }, [btnPauseIcon, btnPauseLabel]);
	btnPause.addEventListener('click', () => {
		PTR.paused = !PTR.paused;
		btnPauseIcon.textContent = PTR.paused ? 'play_arrow' : 'pause';
		btnPauseLabel.textContent = PTR.paused ? '继续' : '暂停';
		PTR.lastFrame = performance.now();
		updateStatus();
	});

	const btnStart = el('button', { class: 'ptr_btn accent', text: '开始最终渲染' });
	btnStart.addEventListener('click', startFinal);

	const iconBtn = (icon, title, onClick) => {
		const b = el('button', { class: 'ptr_iconbtn', title: title }, [el('i', { class: 'material-icons', text: icon })]);
		b.addEventListener('click', onClick);
		return b;
	};
	const btnRestart = iconBtn('replay', '重新开始', () => { if (PTR.tracer) PTR.tracer.reset(); });
	const btnReload = iconBtn('refresh', '重载模型', () => rebuildScene());
	const btnDefault = iconBtn('undo', '重置为默认参数', () => resetToDefaults());
	const btnExport = iconBtn('file_upload', '导出配置（不含材质单独设置）到剪贴板', () => exportSettingsToClipboard());
	const btnImport = iconBtn('file_download', '从剪贴板导入配置（不含材质单独设置）', () => importSettingsFromClipboard());
	const btnSave = el('button', { class: 'ptr_btn accent' }, [
		el('i', { class: 'material-icons', text: 'save' }),
		el('span', { text: '保存 PNG' }),
	]);
	btnSave.addEventListener('click', saveImage);
	const toolGroup = el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } }, [
		btnRestart, btnReload, btnDefault, btnExport, btnImport,
	]);

	const footer = el('div', { id: 'ptr_footer' }, [
		status, progress, btnStart, btnPause, toolGroup, btnSave,
	]);

	const wrapper = el('div', {
		style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '420px' },
	}, [nav, root, footer]);

	PTR.nodes = Object.assign(PTR.nodes || {}, {
		canvas: canvas, rasterCanvas: rasterCanvas, frame: frame,
		overlay: overlay, viewport: viewport, sidebar: sidebar,
		status: status, bar: bar, wrapper: wrapper, btnPause: btnPause, watermark: watermark,
		btnStart: btnStart, btnSave: btnSave, toolGroup: toolGroup, footer: footer,
	});
	root.style.flex = '1 1 auto';
	root.style.minHeight = '0';
	attachViewportEvents(canvas);
	attachViewportEvents(rasterCanvas);
	return wrapper;
}

function fitFrame() {
	const frame = PTR.nodes.frame;
	const viewport = PTR.nodes.viewport;
	if (!frame || !viewport) return;
	const width = viewport.clientWidth;
	const height = viewport.clientHeight;
	if (!width || !height) return;
	const aspect = Math.max(0.1, PTR.settings.res_width / Math.max(1, PTR.settings.res_height));
	const w = Math.min(width, height * aspect);
	frame.style.width = Math.floor(w) + 'px';
	frame.style.height = Math.floor(w / aspect) + 'px';
}

export function setStep(id) {
	if (stepIndex(id) < 0 || !PTR.dialog) return;
	const wasTrace = isTraceStep(PTR.step);
	PTR.step = id;
	for (const step of STEPS) {
		const active = step.id === id;
		PTR.nodes.navButtons[step.id].classList.toggle('active', active);
		PTR.nodes.navButtons[step.id].setAttribute('aria-current', active ? 'step' : 'false');
		PTR.nodes.stagePanes[step.id].hidden = !active;
	}
	const trace = isTraceStep(id);
	PTR.nodes.canvas.style.display = trace ? 'block' : 'none';
	PTR.nodes.rasterCanvas.style.display = trace ? 'none' : 'block';
	PTR.nodes.overlay.style.display = trace ? '' : 'none';
	PTR.nodes.watermark.style.display = trace ? '' : 'none';
	PTR.nodes.footer.style.display = trace ? 'flex' : 'none';
	PTR.nodes.btnStart.style.display = id === 'export' ? '' : 'none';
	PTR.nodes.btnSave.style.display = id === 'export' && PTR.finalStarted ? '' : 'none';
	PTR.nodes.btnPause.style.display = id === 'preview' || PTR.finalStarted ? '' : 'none';
	PTR.nodes.toolGroup.style.display = id === 'preview' ? 'flex' : 'none';
	if (trace) {
		if (PTR.raster) PTR.raster.stop();
		if (!PTR.tracer) {
			PTR.settings.render_mode = 'preview';
			PTR.finalStarted = false;
			try { startRenderer(); } catch (err) { showError(err); }
		} else {
			if (!PTR.open) resumeRenderer();
			if (id === 'preview' || !PTR.finalStarted) {
				if (PTR.settings.render_mode !== 'preview') PTR.tracer.reset();
				PTR.settings.render_mode = 'preview';
				PTR.finalStarted = false;
			}
			if (PTR.needsRebuild) {
				PTR.needsRebuild = false;
				PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
				rebuildScene();
			}
		}
		if (PTR.tracer) applyResolution();
	} else {
		if (wasTrace && PTR.tracer) pauseRenderer();
		PTR.finalStarted = false;
		if (PTR.raster) PTR.raster.start();
	}
	fitFrame();
	if (trace && PTR.tracer) applyResolution();
	saveSettings();
}

function startFinal() {
	if (PTR.step !== 'export' || !PTR.tracer) return;
	PTR.finalStarted = true;
	PTR.settings.render_mode = 'final';
	PTR.paused = false;
	applyResolution();
	PTR.tracer.reset();
	PTR.lastFrame = performance.now();
	PTR.nodes.btnSave.style.display = '';
	updateStatus();
	saveSettings();
}

function startRenderer() {
	const tracer = new PathTracer(PTR.nodes.canvas);
	tracer.init();
	PTR.tracer = tracer;
	PTR.refreshMaterialList = buildMaterialList;

	PTR.open = true;

	applyResolution();
	tracer.setEnvironment(PTR.settings, PTR.customEnv);
	rebuildScene();

	if (!PTR.camInitialized) {
		if (!PTR.cam.syncFromPreview() && tracer.scene) PTR.cam.frameBounds(tracer.scene.bounds);
		PTR.settings.fov = PTR.cam.fov;
		PTR.settings.ortho = PTR.cam.ortho;
		syncControls();
		PTR.camInitialized = true;
	}
	tracer.setCamera(PTR.cam.state());

	if (window.ResizeObserver) {
		PTR.resizeObs = new ResizeObserver(() => {
			if (PTR.settings.res_mode === 'fit') applyResolution();
		});
		PTR.resizeObs.observe(PTR.nodes.viewport);
	}

	PTR.open = true;
	PTR.paused = false;
	PTR.lastFrame = performance.now();
	cancelAnimationFrame(PTR.raf);
	loop();
}

export function openWindow() {
	if (typeof Dialog === 'undefined') return;
	if (PTR.dialog) {
		closeWindow();
		try { PTR.dialog.hide(); } catch (e) { }
		try { PTR.dialog.delete(); } catch (e) { }
		PTR.dialog = null;
	}
	const content = buildWindow();
	PTR.dialog = new Dialog('georenderer_dialog', {
		title: 'GeoRenderer',
		width: 1180,
		resizable: true,
		darken: false,
		cancel_on_click_outside: false,
		buttons: [],
		lines: [content],
		onCancel() { closeWindow(); },
		onResize() {
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
		},
	});
	PTR.dialog.show();
	if (PTR.dialog.object && !PTR.dialog.object.style.height) {
		const h = Math.round(clamp(window.innerHeight * 0.72, 420, window.innerHeight - 60));
		PTR.dialog.object.style.height = h + 'px';
	}

	setTimeout(() => {
		try {
			if (PTR.dialog && PTR.dialog.object) PTR.dialog.object.classList.add('ptr_dialog_root');
			PTR.step = 'camera';
			PTR.finalStarted = false;
			PTR.raster = new RasterPreview(PTR.nodes.rasterCanvas);
			PTR.raster.setGroundTexture(((typeof Texture !== 'undefined' && Texture.all) || []).find(texture => texture.uuid === PTR.settings.ground_texture_uuid));
			PTR.onSettingChanged = key => {
				if (key === 'res_width' || key === 'res_height') fitFrame();
				if (key === 'fov') PTR.cam.fov = PTR.settings.fov;
				if (key === 'ortho') PTR.cam.ortho = !!PTR.settings.ortho;
				if (key === 'time_of_day') {
					applyTimeOfDay(PTR.settings, PTR.settings.time_of_day);
					if (PTR.nodes.timeDisplay) PTR.nodes.timeDisplay.textContent = formatClock(PTR.settings.time_of_day);
				}
				if (key === 'ground_texture_uuid' && PTR.raster) PTR.raster.setGroundTexture((Texture.all || []).find(texture => texture.uuid === PTR.settings.ground_texture_uuid));
			};
			PTR.frameResizeObs = new ResizeObserver(() => fitFrame());
			PTR.frameResizeObs.observe(PTR.nodes.viewport);
			setStep('camera');
		} catch (err) {
			showError(err);
			if (PTR.nodes.overlay) {
				PTR.nodes.overlay.textContent = '初始化失败: ' + (err && err.message ? err.message : err);
			}
		}
	}, 60);
}

export function closeWindow() {
	closeRenderer();
	if (PTR.raster) { PTR.raster.dispose(); PTR.raster = null; }
	if (PTR.frameResizeObs) { PTR.frameResizeObs.disconnect(); PTR.frameResizeObs = null; }
	PTR.onSettingChanged = null;
}
