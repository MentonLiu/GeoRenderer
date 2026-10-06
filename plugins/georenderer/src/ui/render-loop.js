import { IDLE_PASS_CAP, INTERACTIVE_MAX_BOUNCE, INTERACTIVE_PASS_CAP } from '../core/config.js';
import { clamp } from '../core/math.js';
import { PTR, formatDuration, saveSettings } from './state.js';
import { resolveRenderSize } from './workflow-state.js';

export function showError(err) {
	console.error('[PathTracer]', err);
	if (PTR.nodes.overlay) PTR.nodes.overlay.textContent = '错误: ' + (err && err.message ? err.message : err);
	try { Blockbench.showQuickMessage('路径追踪出错: ' + (err && err.message ? err.message : err), 3000); } catch (e) { }
}

export function rebuildScene() {
	const t = PTR.tracer;
	if (!t || !PTR.open) return;
	try {
		const scene = t.buildScene(PTR.settings, PTR.overrides, PTR.groupOverrides);
		PTR.stale = false;
		if (PTR.refreshMaterialList) PTR.refreshMaterialList();
		updateStatus(scene);
		t.reset();
	} catch (err) {
		showError(err);
	}
}

export function applyResolution() {
	const t = PTR.tracer;
	if (!t || !PTR.open || !PTR.nodes.viewport) return;
	const rect = (PTR.nodes.frame || PTR.nodes.viewport).getBoundingClientRect();
	const { width: nw, height: nh } = resolveRenderSize(PTR.settings, PTR.step, PTR.finalStarted, rect, PTR.interacting);
	if (nw !== t.width || nh !== t.height) {
		PTR.spsEma = 0;
		PTR.lastPasses = 0;
	}
	t.resize(nw, nh);
	updateWatermarkPreview();
}

export function setInteracting(on) {
	if (PTR.interacting === on) return;
	PTR.interacting = on;
	if (on) {
		PTR.passesPerFrame = 1;
	} else {
		if (PTR.tracer) PTR.tracer.reset();
	}
	if (PTR.settings.interactive_scale < 1) applyResolution();
}

function interactiveSettings(settings) {
	if (settings.max_bounce <= INTERACTIVE_MAX_BOUNCE && settings.light_samples <= 1) return settings;
	const fast = Object.assign({}, settings);
	fast.max_bounce = Math.min(settings.max_bounce, INTERACTIVE_MAX_BOUNCE);
	fast.light_samples = 1;
	return fast;
}

function currentMaxSamples() {
	return PTR.settings.render_mode === 'final' ? PTR.settings.final_samples : PTR.settings.preview_samples;
}

export function updateStatus(scene) {
	const t = PTR.tracer;
	if (!t || !PTR.nodes.status) return;
	const s = scene || t.scene;
	const max = currentMaxSamples();
	const pct = clamp(t.spp / Math.max(max, 1), 0, 1);
	PTR.nodes.bar.style.width = (pct * 100).toFixed(1) + '%';
	let line = t.spp + ' / ' + max + ' spp　' + t.width + '×' + t.height;
	if (PTR.spsEma > 0.001) {
		const msPerSpp = 1000 / PTR.spsEma;
		const mpix = t.width * t.height * PTR.spsEma / 1e6;
		line += '　' + (msPerSpp < 10 ? msPerSpp.toFixed(1) : msPerSpp.toFixed(0)) + ' ms/spp';
		line += '　' + mpix.toFixed(1) + ' Mpix/s';
		const left = max - t.spp;
		if (left > 0 && !PTR.paused) line += '　剩余 ~' + formatDuration(left / PTR.spsEma);
	}
	if (s && s.stats) {
		line += '　△' + s.stats.tris + '　BVH ' + s.stats.nodes;
		if (s.stats.lights) line += '　光源 ' + s.stats.lights;
	}
	if (PTR.paused) line = '[暂停] ' + line;
	if (PTR.stale) line += '　(模型已修改)';
	PTR.nodes.status.textContent = line;
	if (PTR.nodes.overlay) {
		PTR.nodes.overlay.textContent = t.spp >= max ? '渲染完成 · ' + t.spp + ' spp' : t.spp + ' spp';
	}
	updateWatermarkPreview();
}

function updateWatermarkPreview() {
	const wm = PTR.nodes.watermark;
	const t = PTR.tracer;
	if (!wm) return;
	const s = PTR.settings;
	if (!s.watermark_enable || !s.watermark_text || !t || !t.width || !t.height) {
		wm.style.display = 'none';
		return;
	}
	const vp = PTR.nodes.viewport;
	const vw = vp ? vp.clientWidth : 0;
	const vh = vp ? vp.clientHeight : 0;
	if (!vw || !vh) { wm.style.display = 'none'; return; }
	const renderAspect = t.width / t.height;
	const boxAspect = vw / vh;
	let dispW, dispH;
	if (renderAspect > boxAspect) { dispW = vw; dispH = vw / renderAspect; }
	else { dispH = vh; dispW = vh * renderAspect; }
	const offX = (vw - dispW) / 2;
	const offY = (vh - dispH) / 2;
	const scale = dispH / t.height;
	wm.style.display = 'block';
	wm.style.left = offX + Math.max(4, dispW * 0.02) + 'px';
	wm.style.bottom = offY + Math.max(4, dispH * 0.02) + 'px';
	wm.style.fontSize = Math.max(6, s.watermark_size * scale) + 'px';
	wm.style.color = s.watermark_color;
	wm.style.opacity = s.watermark_opacity;
	wm.textContent = s.watermark_text;
}

export function loop() {
	if (!PTR.open) return;
	if (PTR.nodes.canvas && !PTR.nodes.canvas.isConnected) { closeRenderer(); return; }
	PTR.raf = requestAnimationFrame(loop);
	const t = PTR.tracer;
	if (!t || !t.scene || !t.env || PTR.paused) return;

	const now = performance.now();
	const dt = now - PTR.lastFrame;
	PTR.lastFrame = now;
	const targetMs = PTR.interacting ? 24 : 42;
	const passCap = PTR.interacting ? INTERACTIVE_PASS_CAP : IDLE_PASS_CAP;
	if (dt < targetMs * 0.75) PTR.passesPerFrame = Math.min(passCap, PTR.passesPerFrame + 1);
	else if (dt > targetMs * 1.35) PTR.passesPerFrame = Math.max(1, Math.ceil(PTR.passesPerFrame / 2));
	if (PTR.passesPerFrame > passCap) PTR.passesPerFrame = passCap;

	if (PTR.lastPasses > 0 && dt > 0.5) {
		const inst = PTR.lastPasses * 1000 / dt;
		PTR.spsEma = PTR.spsEma > 0 ? (PTR.spsEma * 0.85 + inst * 0.15) : inst;
	}
	PTR.lastPasses = 0;

	if (PTR.cam.fov !== PTR.settings.fov || PTR.cam.ortho !== !!PTR.settings.ortho) {
		PTR.cam.fov = PTR.settings.fov;
		PTR.cam.ortho = !!PTR.settings.ortho;
		t.reset();
	}

	if (PTR.settings.auto_sync) {
		const before = PTR.cam.position().concat(PTR.cam.target);
		if (PTR.cam.syncFromPreview()) {
			const after = PTR.cam.position().concat(PTR.cam.target);
			for (let i = 0; i < 6; i++) {
				if (Math.abs(before[i] - after[i]) > 1e-4) { t.reset(); break; }
			}
		}
	}

	const maxSamples = currentMaxSamples();
	if (t.spp >= maxSamples) return;

	try {
		t.setCameraOnly(PTR.cam.state());
		const passSettings = PTR.interacting ? interactiveSettings(PTR.settings) : PTR.settings;
		const n = Math.min(PTR.passesPerFrame, maxSamples - t.spp);
		if (n > 0 && t.beginFrame(passSettings, PTR.interacting)) {
			for (let i = 0; i < n; i++) t.renderPass();
			PTR.lastPasses = n;
		} else {
			PTR.lastPasses = 0;
		}
		t.present(PTR.interacting ? Object.assign({}, PTR.settings, { denoise: false, bloom_enable: false }) : PTR.settings);
	} catch (err) {
		showError(err);
		PTR.paused = true;
	}
	updateStatus();
}

export function pauseRenderer() {
	PTR.open = false;
	cancelAnimationFrame(PTR.raf);
	PTR.raf = 0;
}

export function resumeRenderer() {
	if (!PTR.tracer || PTR.open) return;
	PTR.open = true;
	PTR.paused = false;
	PTR.lastFrame = performance.now();
	loop();
}

export function closeRenderer() {
	pauseRenderer();
	if (PTR.resizeObs) { try { PTR.resizeObs.disconnect(); } catch (e) { } PTR.resizeObs = null; }
	if (PTR.tracer) { try { PTR.tracer.dispose(); } catch (e) { } PTR.tracer = null; }
	saveSettings();
}
