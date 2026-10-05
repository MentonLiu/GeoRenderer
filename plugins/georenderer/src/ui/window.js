import { clamp } from '../core/math.js';
import { PathTracer } from '../gpu/path-tracer.js';
import { syncControls } from './controls.js';
import { el } from './dom.js';
import { saveImage } from './io.js';
import { buildMaterialList } from './material-panel.js';
import { applyResolution, closeRenderer, loop, rebuildScene, setInteracting, showError, updateStatus } from './render-loop.js';
import { exportSettingsToClipboard, importSettingsFromClipboard, resetToDefaults } from './settings-actions.js';
import { buildSidebar } from './sidebar.js';
import { PTR, saveSettings } from './state.js';

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
	const overlay = el('div', { id: 'ptr_overlay', text: '准备中（首次加载可能会较为卡顿）…' });
	const watermark = el('div', { id: 'ptr_watermark' });
	const viewport = el('div', { id: 'ptr_viewport' }, [canvas, overlay, watermark]);
	const sidebar = buildSidebar();
	const root = el('div', { id: 'ptr_root' }, [viewport, sidebar]);

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

	const btnModeLabel = el('span', { text: '切换到成片渲染' });
	const btnMode = el('button', { class: 'ptr_btn' }, [btnModeLabel]);
	btnMode.addEventListener('click', () => {
		PTR.settings.render_mode = PTR.settings.render_mode === 'final' ? 'preview' : 'final';
		syncControls();
		saveSettings();
		updateModeButton();
		if (PTR.paused) {
			PTR.paused = false;
			btnPauseIcon.textContent = 'pause';
			btnPauseLabel.textContent = '暂停';
			PTR.lastFrame = performance.now();
		}
		updateStatus();
	});
	function updateModeButton() {
		const isFinal = PTR.settings.render_mode === 'final';
		btnModeLabel.textContent = isFinal ? '切换到预览' : '切换到成片渲染';
		btnMode.classList.toggle('accent', isFinal);
	}
	updateModeButton();
	PTR.updateModeButton = updateModeButton;

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
		status, progress, btnMode, btnPause, toolGroup, btnSave,
	]);

	const wrapper = el('div', {
		style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '420px' },
	}, [root, footer]);

	PTR.nodes = Object.assign(PTR.nodes || {}, {
		canvas: canvas, overlay: overlay, viewport: viewport, sidebar: sidebar,
		status: status, bar: bar, wrapper: wrapper, btnPause: btnPause, watermark: watermark,
	});
	root.style.flex = '1 1 auto';
	root.style.minHeight = '0';
	return wrapper;
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

	attachViewportEvents(PTR.nodes.canvas);

	PTR.open = true;
	PTR.paused = false;
	PTR.lastFrame = performance.now();
	cancelAnimationFrame(PTR.raf);
	loop();
}

export function openWindow() {
	if (typeof Dialog === 'undefined') return;
	if (PTR.dialog) {
		closeRenderer();
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
		onCancel() { closeRenderer(); },
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
			startRenderer();
		} catch (err) {
			showError(err);
			if (PTR.nodes.overlay) {
				PTR.nodes.overlay.textContent = '初始化失败: ' + (err && err.message ? err.message : err);
			}
		}
	}, 60);
}
