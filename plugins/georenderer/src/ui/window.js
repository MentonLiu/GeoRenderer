import { clamp } from '../core/math.js';
import { PathTracer } from '../gpu/path-tracer.js';
import { syncControls } from './controls.js';
import { el } from './dom.js';
import { copyImage, openBlockbenchScreenshot, saveImage } from './io.js';
import { buildMaterialList } from './material-panel.js';
import { selectGroup } from './group-panel.js';
import { applyResolution, closeRenderer, loop, pauseRenderer, rebuildScene, resumeRenderer, setInteracting, showError, updateStatus } from './render-loop.js';
import { exportSettingsToClipboard, importSettingsFromClipboard, resetToDefaults } from './settings-actions.js';
import { buildSidebar, syncBlockbenchScene } from './sidebar.js';
import { PTR, saveSettings } from './state.js';
import { RasterPreview } from './raster-preview.js';
import { OrbitCam } from './orbit-camera.js';
import { applyTimeOfDay, formatClock } from '../scene/presets.js';
import { STEPS, canExport, canMoveCamera, canNavigatePreview, isInspectionStep, isTraceStep, resolveRenderSize, stepIndex, validateFinalSize } from './workflow-state.js';
import { updateExportSummary } from './export-panel.js';
import { restoreBlockbenchPreviewModelOverrides, restoreBlockbenchSceneSelection } from '../scene/blockbench-scene.js';

function attachViewportEvents(canvas) {
	let dragging = 0;
	let lastX = 0, lastY = 0;
	let startX = 0, startY = 0, moved = false;
	const activeCamera = () => canMoveCamera(PTR.step) ? PTR.cam : PTR.inspectionCam;

	const endDrag = () => {
		dragging = 0;
		canvas.classList.remove('dragging');
		if (canMoveCamera(PTR.step)) {
			clearTimeout(PTR.interactTimer);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 200);
		}
	};

	canvas.addEventListener('pointerdown', e => {
		if (!canNavigatePreview(PTR.step) || e.button > 2) return;
		dragging = (e.button === 0 && !e.shiftKey && !e.ctrlKey) ? 1 : 2;
		lastX = startX = e.clientX; lastY = startY = e.clientY; moved = false;
		canvas.setPointerCapture(e.pointerId);
		e.preventDefault();
	});
	canvas.addEventListener('pointermove', e => {
		if (!dragging) return;
		if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
		if (!moved) return;
		canvas.classList.add('dragging');
		if (canMoveCamera(PTR.step)) {
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
		}
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX; lastY = e.clientY;
		const camera = activeCamera();
		if (dragging === 1) camera.orbit(dx, dy);
		else camera.pan(dx / Math.max(canvas.clientWidth, 1), dy / Math.max(canvas.clientHeight, 1), 1);
		if (canMoveCamera(PTR.step) && PTR.tracer) PTR.tracer.reset();
	});
	canvas.addEventListener('pointerup', e => {
		if (dragging && !moved && PTR.step === 'materials' && e.button === 0) {
			const uuid = PTR.raster?.pickGroupAt(e.clientX, e.clientY);
			if (uuid) selectGroup(uuid);
		}
		endDrag();
		try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
	});
	canvas.addEventListener('pointercancel', endDrag);
	canvas.addEventListener('contextmenu', e => e.preventDefault());
	canvas.addEventListener('wheel', e => {
		e.preventDefault();
		if (!canNavigatePreview(PTR.step)) return;
		const camera = activeCamera();
		camera.zoom(e.deltaY);
		if (canMoveCamera(PTR.step)) {
			PTR.settings.camera_distance = camera.distance;
			syncControls();
			saveSettings();
		}
		if (canMoveCamera(PTR.step)) {
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
			if (PTR.tracer) PTR.tracer.reset();
		}
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
	const btnCopy = el('button', { class: 'ptr_btn', text: '复制图片' });
	btnCopy.addEventListener('click', copyImage);
	const btnBlockbench = el('button', { class: 'ptr_btn', text: 'Blockbench 截图' });
	btnBlockbench.addEventListener('click', openBlockbenchScreenshot);
	const toolGroup = el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } }, [
		btnRestart, btnReload, btnDefault, btnExport, btnImport,
	]);

	const footer = el('div', { id: 'ptr_footer' }, [
		status, progress, btnStart, btnPause, toolGroup, btnCopy, btnSave, btnBlockbench,
	]);

	const wrapper = el('div', {
		style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '420px' },
	}, [nav, root, footer]);

	PTR.nodes = Object.assign(PTR.nodes || {}, {
		canvas: canvas, rasterCanvas: rasterCanvas, frame: frame,
		overlay: overlay, viewport: viewport, sidebar: sidebar,
		status: status, bar: bar, wrapper: wrapper, btnPause: btnPause, watermark: watermark,
		btnStart: btnStart, btnCopy: btnCopy, btnSave: btnSave, btnBlockbench: btnBlockbench,
		toolGroup: toolGroup, footer: footer,
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
	if (isInspectionStep(PTR.step)) {
		frame.style.width = `${width}px`;
		frame.style.height = `${height}px`;
		return;
	}
	const aspect = Math.max(0.1, PTR.settings.res_width / Math.max(1, PTR.settings.res_height));
	const w = Math.min(width, height * aspect);
	frame.style.width = Math.floor(w) + 'px';
	frame.style.height = Math.floor(w / aspect) + 'px';
}

function syncSettingsToView() {
	restoreBlockbenchSceneSelection(PTR.settings.scene_preset);
	restoreBlockbenchPreviewModelOverrides(PTR.settings.preview_model_overrides);
	syncBlockbenchScene().catch(showError);
	PTR.cam.fov = PTR.settings.fov;
	PTR.cam.ortho = !!PTR.settings.ortho;
	PTR.cam.distance = PTR.settings.camera_distance;
	if (PTR.raster) PTR.raster.setGroundTexture(((typeof Texture !== 'undefined' && Texture.all) || []).find(texture => texture.uuid === PTR.settings.ground_texture_uuid));
	if (PTR.nodes.timeDisplay) PTR.nodes.timeDisplay.textContent = formatClock(PTR.settings.time_of_day);
	fitFrame();
	updateExportSummary();
}

function showRenderDialog() {
	if (PTR.dialog) return;
	PTR.dialog = new Dialog('georenderer_dialog', {
		title: 'GeoRenderer',
		width: 1180,
		resizable: true,
		darken: false,
		cancel_on_click_outside: false,
		buttons: [],
		lines: [PTR.nodes.wrapper],
		onCancel() { closeWindow(); return false; },
		onResize() {
			clearTimeout(PTR.interactTimer);
			setInteracting(true);
			PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
		},
	});
	PTR.dialog.show();
	PTR.dialog.object?.classList.add('ptr_dialog_root');
	if (PTR.dialog.object && !PTR.dialog.object.style.height) {
		const h = Math.round(clamp(window.innerHeight * 0.72, 420, window.innerHeight - 60));
		PTR.dialog.object.style.height = h + 'px';
	}
	if (!PTR.frameResizeObs && typeof ResizeObserver !== 'undefined') {
		PTR.frameResizeObs = new ResizeObserver(() => fitFrame());
		PTR.frameResizeObs.observe(PTR.nodes.viewport);
	}
}

function initializeCamera() {
	if (PTR.cameraInitialized) return;
	PTR.cam.fov = PTR.settings.fov;
	PTR.cam.ortho = !!PTR.settings.ortho;
	PTR.cam.distance = PTR.settings.camera_distance;
	PTR.cameraInitialized = true;
}

function ensureRasterPreview() {
	if (PTR.raster) return;
	PTR.raster = new RasterPreview(PTR.nodes.rasterCanvas);
	PTR.raster.setGroundTexture(((typeof Texture !== 'undefined' && Texture.all) || []).find(texture => texture.uuid === PTR.settings.ground_texture_uuid));
}

function updateExportActions() {
	const ready = canExport(PTR.step, PTR.finalStarted, PTR.tracer ? PTR.tracer.spp : 0, PTR.settings.final_samples);
	for (const button of [PTR.nodes.btnCopy, PTR.nodes.btnSave, PTR.nodes.btnBlockbench]) button.disabled = !ready;
	PTR.nodes.btnStart.disabled = !PTR.tracer || (PTR.finalStarted && !ready);
	PTR.nodes.btnStart.textContent = ready ? '重新渲染' : PTR.finalStarted ? '渲染中…' : '开始最终渲染';
}

export function setStep(id) {
	if (stepIndex(id) < 0 || !PTR.dialog) return;
	const wasTrace = isTraceStep(PTR.step);
	const trace = isTraceStep(id);
	if (id === 'camera' || trace) initializeCamera();
	if (trace && !wasTrace) {
		PTR.lockedCamera = PTR.cam.state();
		PTR.interacting = false;
	}
	PTR.step = id;
	PTR.nodes.frame.dataset.step = id;
	for (const step of STEPS) {
		const active = step.id === id;
		PTR.nodes.navButtons[step.id].classList.toggle('active', active);
		PTR.nodes.navButtons[step.id].setAttribute('aria-current', active ? 'step' : 'false');
		PTR.nodes.stagePanes[step.id].hidden = !active;
	}
	PTR.nodes.canvas.style.display = trace ? 'block' : 'none';
	PTR.nodes.rasterCanvas.style.display = trace ? 'none' : 'block';
	PTR.nodes.overlay.style.display = trace ? '' : 'none';
	PTR.nodes.watermark.style.display = trace ? '' : 'none';
	PTR.nodes.footer.style.display = trace ? 'flex' : 'none';
	PTR.nodes.btnStart.style.display = id === 'export' ? '' : 'none';
	PTR.nodes.btnSave.style.display = id === 'export' ? '' : 'none';
	PTR.nodes.btnCopy.style.display = id === 'export' ? '' : 'none';
	PTR.nodes.btnBlockbench.style.display = id === 'export' ? '' : 'none';
	PTR.nodes.btnPause.style.display = id === 'preview' || PTR.finalStarted ? '' : 'none';
	PTR.nodes.toolGroup.style.display = id === 'preview' ? 'flex' : 'none';
	if (trace) {
		if (PTR.raster) PTR.raster.stop();
		if (!PTR.tracer) {
			PTR.settings.render_mode = 'preview';
			PTR.finalStarted = false;
			try { startRenderer(); } catch (err) { showError(err); }
		} else {
			if (!wasTrace) PTR.tracer.setCamera(PTR.lockedCamera);
			if (!PTR.open) resumeRenderer();
			if (id === 'preview' || !PTR.finalStarted) {
				if (PTR.settings.render_mode !== 'preview') PTR.tracer.reset();
				PTR.settings.render_mode = 'preview';
				PTR.finalStarted = false;
			}
			if (PTR.needsRebuild || !wasTrace) {
				PTR.needsRebuild = false;
				PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
				rebuildScene();
			}
		}
	} else {
		if (wasTrace && PTR.tracer) pauseRenderer();
		PTR.finalStarted = false;
		PTR.raster?.start();
	}
	fitFrame();
	if (trace && PTR.tracer) applyResolution();
	updateExportSummary();
	updateExportActions();
	saveSettings();
}

function startFinal() {
	if (PTR.step !== 'export' || !PTR.tracer) return;
	const rect = PTR.nodes.frame.getBoundingClientRect();
	const target = resolveRenderSize(PTR.settings, 'export', true, rect, false);
	const gl = PTR.tracer.gl;
	const sizeError = validateFinalSize(target.width, target.height, gl.getParameter(gl.MAX_TEXTURE_SIZE));
	if (sizeError) { showError(new Error(sizeError)); return; }
	PTR.finalStarted = true;
	PTR.settings.render_mode = 'final';
	PTR.paused = false;
	try {
		applyResolution();
		PTR.tracer.reset();
		PTR.lastFrame = performance.now();
		updateStatus();
		updateExportActions();
		saveSettings();
	} catch (err) {
		PTR.finalStarted = false;
		PTR.settings.render_mode = 'preview';
		showError(err);
	}
}

function startRenderer() {
	const tracer = new PathTracer(PTR.nodes.canvas);
	try {
		tracer.init();
		PTR.tracer = tracer;
		PTR.refreshMaterialList = buildMaterialList;
		PTR.open = true;
		applyResolution();
		tracer.setEnvironment(PTR.settings, PTR.customEnv);
		rebuildScene();
		tracer.setCamera(PTR.lockedCamera || PTR.cam.state());
		if (window.ResizeObserver) {
			PTR.resizeObs = new ResizeObserver(() => {
				if (PTR.settings.res_mode === 'fit') applyResolution();
			});
			PTR.resizeObs.observe(PTR.nodes.frame);
		}
		PTR.paused = false;
		PTR.lastFrame = performance.now();
		cancelAnimationFrame(PTR.raf);
		loop();
	} catch (err) {
		PTR.open = false;
		PTR.tracer = null;
		tracer.dispose();
		throw err;
	}
}

export function openWindow() {
	if (typeof Dialog === 'undefined') return;
	if (PTR.dialog) closeWindow();
	try {
		PTR.step = 'materials';
		PTR.finalStarted = false;
		PTR.lockedCamera = null;
		PTR.cameraInitialized = false;
		PTR.cam = new OrbitCam();
		PTR.inspectionCam = new OrbitCam();
		restoreBlockbenchSceneSelection(PTR.settings.scene_preset);
		restoreBlockbenchPreviewModelOverrides(PTR.settings.preview_model_overrides);
		buildWindow();
		showRenderDialog();
		ensureRasterPreview();
		syncBlockbenchScene().catch(showError);
		if (!PTR.inspectionCam.syncFromPreview()) {
			const bounds = new THREE.Box3().setFromObject(PTR.raster.model);
			if (!bounds.isEmpty()) {
				const center = bounds.getCenter(new THREE.Vector3());
				const size = bounds.getSize(new THREE.Vector3());
				PTR.inspectionCam.frameBounds({ center: center.toArray(), radius: size.length() / 2 });
			}
		}
		if (typeof Group !== 'undefined' && Group.first_selected) selectGroup(Group.first_selected.uuid);
		PTR.onSettingChanged = key => {
			if (key === 'res_width' || key === 'res_height') fitFrame();
			if (key === 'fov') PTR.cam.fov = PTR.settings.fov;
			if (key === 'ortho') PTR.cam.ortho = !!PTR.settings.ortho;
			if (key === 'camera_distance') PTR.cam.distance = PTR.settings.camera_distance;
			if (key === 'time_of_day') {
				applyTimeOfDay(PTR.settings, PTR.settings.time_of_day);
				if (PTR.nodes.timeDisplay) PTR.nodes.timeDisplay.textContent = formatClock(PTR.settings.time_of_day);
				syncControls();
			}
			if (key === 'ground_texture_uuid' && PTR.raster) PTR.raster.setGroundTexture((Texture.all || []).find(texture => texture.uuid === PTR.settings.ground_texture_uuid));
			updateExportSummary();
		};
		PTR.onRenderStatus = updateExportActions;
		PTR.onSettingsLoaded = syncSettingsToView;
		setStep('materials');
	} catch (err) {
		showError(err);
		closeWindow();
	}
}

export function closeWindow() {
	PTR.scenePresetRequest++;
	clearTimeout(PTR.interactTimer);
	clearTimeout(PTR.rebuildTimer);
	clearTimeout(PTR.rasterRefreshTimer);
	closeRenderer();
	if (PTR.raster) { PTR.raster.dispose(); PTR.raster = null; }
	if (PTR.frameResizeObs) { PTR.frameResizeObs.disconnect(); PTR.frameResizeObs = null; }
	if (PTR.dialog) {
		try { PTR.dialog.hide(); PTR.dialog.delete(); } catch (err) { }
		PTR.dialog = null;
	}
	PTR.onSettingChanged = null;
	PTR.onRenderStatus = null;
	PTR.onSettingsLoaded = null;
	PTR.needsRebuild = false;
	PTR.refreshMaterialList = null;
	PTR.refreshGroundTextures = null;
	PTR.refreshPreviewScenes = null;
	PTR.refreshPreviewModels = null;
	PTR.lockedCamera = null;
	PTR.cameraInitialized = false;
	PTR.selectedGroupUuid = null;
	PTR.controls = [];
	PTR.nodes = {};
}
