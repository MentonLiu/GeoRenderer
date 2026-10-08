import { FINAL_PASS_CAP, IDLE_PASS_CAP, INTERACTIVE_MAX_BOUNCE, INTERACTIVE_PASS_CAP, MAX_RENDER_BUFFER_SIDE } from '../core/config.js';
import { clamp } from '../core/math.js';
import { PTR, formatDuration, saveSettings } from './state.js';
import { isTraceStep, resolveRenderSize } from './workflow-state.js';

const watchedPreviewImages = new WeakSet();

export function showError(err) {
	console.error('[PathTracer]', err);
	if (PTR.nodes.overlay) PTR.nodes.overlay.textContent = '错误: ' + (err && err.message ? err.message : err);
	try { Blockbench.showQuickMessage('路径追踪出错: ' + (err && err.message ? err.message : err), 3000); } catch (e) { }
}

export function rebuildScene() {
	const t = PTR.tracer;
	if (!t) return;
	if (!PTR.open || !isTraceStep(PTR.step)) { PTR.needsRebuild = true; return; }
	try {
		const scene = t.buildScene(PTR.settings, PTR.overrides, PTR.groupOverrides);
		for (const image of scene.pendingImages || []) {
			if (image.complete && image.naturalWidth) {
				queueMicrotask(rebuildScene);
				continue;
			}
			if (watchedPreviewImages.has(image)) continue;
			watchedPreviewImages.add(image);
			image.addEventListener('load', () => rebuildScene(), { once: true });
		}
		PTR.stale = false;
		if (PTR.refreshMaterialList) PTR.refreshMaterialList();
		if (PTR.finalRender) PTR.finalRender.restart(t);
		else t.reset();
		updateStatus(scene);
	} catch (err) {
		showError(err);
	}
}

export function applyResolution() {
	const t = PTR.tracer;
	if (!t || !PTR.open || !isTraceStep(PTR.step) || !PTR.nodes.viewport) return;
	if (PTR.finalRender) return;
	const rect = (PTR.nodes.frame || PTR.nodes.viewport).getBoundingClientRect();
	const size = resolveRenderSize(PTR.settings, PTR.step, PTR.finalStarted, rect, PTR.interacting);
	const limit = Math.min(MAX_RENDER_BUFFER_SIDE, t.gl.getParameter(t.gl.MAX_TEXTURE_SIZE), t.gl.getParameter(t.gl.MAX_RENDERBUFFER_SIZE));
	const scale = Math.min(1, limit / size.width, limit / size.height);
	const nw = Math.max(8, Math.round(size.width * scale)), nh = Math.max(8, Math.round(size.height * scale));
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
	const job = PTR.finalRender;
	const pct = job ? job.progress(t.spp) : clamp(t.spp / Math.max(max, 1), 0, 1);
	PTR.nodes.bar.style.width = (pct * 100).toFixed(1) + '%';
	let line = t.spp + ' / ' + max + ' spp　' + (job ? job.plan.width + '×' + job.plan.height : t.width + '×' + t.height);
	if (job) line += '　区块 ' + Math.min(job.index + 1, job.plan.tiles.length) + ' / ' + job.plan.tiles.length;
	if (PTR.spsEma > 0.001) {
		const msPerSpp = 1000 / PTR.spsEma;
		const mpix = t.width * t.height * PTR.spsEma / 1e6;
		line += '　' + (msPerSpp < 10 ? msPerSpp.toFixed(1) : msPerSpp.toFixed(0)) + ' ms/spp';
		line += '　' + mpix.toFixed(1) + ' Mpix/s';
		const left = job ? (job.plan.tiles.length - job.index) * max - (job.completed ? 0 : t.spp) : max - t.spp;
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
		PTR.nodes.overlay.textContent = job
			? job.completed ? '渲染完成 · ' + max + ' spp' : '区块 ' + (job.index + 1) + ' / ' + job.plan.tiles.length + ' · ' + t.spp + ' spp'
			: t.spp >= max && !t.frameSync ? '渲染完成 · ' + t.spp + ' spp' : t.spp + ' spp';
	}
	if (PTR.onRenderStatus) PTR.onRenderStatus();
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
	const imageWidth = PTR.finalRender?.plan.width || t.width, imageHeight = PTR.finalRender?.plan.height || t.height;
	const renderAspect = imageWidth / imageHeight;
	const boxAspect = vw / vh;
	let dispW, dispH;
	if (renderAspect > boxAspect) { dispW = vw; dispH = vw / renderAspect; }
	else { dispH = vh; dispW = vh * renderAspect; }
	const offX = (vw - dispW) / 2;
	const offY = (vh - dispH) / 2;
	const scale = dispH / imageHeight;
	wm.style.display = 'block';
	wm.style.left = offX + Math.max(4, dispW * 0.02) + 'px';
	wm.style.bottom = offY + Math.max(4, dispH * 0.02) + 'px';
	wm.style.fontSize = Math.max(6, s.watermark_size * scale) + 'px';
	wm.style.color = s.watermark_color;
	wm.style.opacity = s.watermark_opacity;
	wm.textContent = s.watermark_text;
}

export function loop() {
	if (!PTR.open || !isTraceStep(PTR.step)) return;
	if (PTR.nodes.canvas && !PTR.nodes.canvas.isConnected) { closeRenderer(); return; }
	PTR.raf = requestAnimationFrame(loop);
	const t = PTR.tracer;
	if (!t || !t.scene || !t.env || PTR.paused) return;

	const now = performance.now();
	const dt = now - PTR.lastFrame;
	const targetMs = PTR.interacting ? 24 : 42;
	const passCap = PTR.interacting ? INTERACTIVE_PASS_CAP : PTR.finalRender ? FINAL_PASS_CAP : IDLE_PASS_CAP;
	try {
		if (t.isFrameReady && !t.isFrameReady()) return;
	} catch (err) { showError(err); PTR.paused = true; return; }
	PTR.lastFrame = now;
	if (dt < targetMs * 0.75) PTR.passesPerFrame = Math.min(passCap, PTR.passesPerFrame + 1);
	else if (dt > targetMs * 1.35) PTR.passesPerFrame = Math.max(1, Math.ceil(PTR.passesPerFrame / 2));
	if (PTR.passesPerFrame > passCap) PTR.passesPerFrame = passCap;

	if (PTR.lastPasses > 0 && dt > 0.5) {
		const inst = PTR.lastPasses * 1000 / dt;
		PTR.spsEma = PTR.spsEma > 0 ? (PTR.spsEma * 0.85 + inst * 0.15) : inst;
	}
	PTR.lastPasses = 0;

	const maxSamples = currentMaxSamples();

	try {
		const job = PTR.finalRender;
		if (job) {
			job.updateSamples(maxSamples, t);
			if (job.completed) return;
			if (t.spp >= maxSamples) {
				job.finishTile(t);
				updateStatus();
				if (job.completed) return;
			} else if (t.spp > 0) job.copyTile(t.canvas);
		}
		if (t.spp >= maxSamples) {
			if (PTR.needsPresent) { t.present(PTR.settings); t.endFrame?.(); PTR.needsPresent = false; }
			updateStatus();
			return;
		}
		t.setCameraOnly(PTR.lockedCamera || PTR.cam.state());
		const passSettings = PTR.interacting ? interactiveSettings(PTR.settings) : PTR.settings;
		const n = Math.min(PTR.passesPerFrame, maxSamples - t.spp);
		if (n > 0 && t.beginFrame(passSettings, PTR.interacting)) {
			for (let i = 0; i < n; i++) t.renderPass();
			PTR.lastPasses = n;
		} else {
			PTR.lastPasses = 0;
		}
		t.present(PTR.interacting ? Object.assign({}, PTR.settings, { denoise: false, bloom_enable: false }) : PTR.settings);
		t.endFrame?.();
		PTR.needsPresent = false;
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
	if (!PTR.tracer || PTR.open || !isTraceStep(PTR.step)) return;
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
