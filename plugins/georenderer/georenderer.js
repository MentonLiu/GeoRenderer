(() => {
  // plugins/georenderer/src/core/config.js
  var PLUGIN_ID = "georenderer";
  var TRI_POS_TEXELS = 3;
  var TRI_ATTR_TEXELS = 4;
  var MAT_TEXELS = 5;
  var BVH_TEXELS = 2;
  var DATA_TEX_WIDTH = 1024;
  var MAX_LEAF_TRIS = 8;
  var SAH_BINS = 12;
  var ENV_W = 1024;
  var ENV_H = 512;
  var MAX_ENV_IMAGE_SIZE = 4096;
  var MAX_RENDER_BUFFER_SIDE = 1024;
  var FINAL_TILE_SIDE = 768;
  var ENV_DIST_W = 256;
  var ENV_DIST_H = 128;
  var INTERACTIVE_MAX_BOUNCE = 2;
  var INTERACTIVE_PASS_CAP = 8;
  var IDLE_PASS_CAP = 64;
  var FINAL_PASS_CAP = 4;
  var DEFAULTS = {
    res_mode: "custom",
    res_width: 1280,
    res_height: 720,
    render_mode: "preview",
    preview_samples: 8,
    preview_scale: 0.5,
    final_samples: 256,
    max_bounce: 6,
    light_samples: 1,
    clamp_value: 12,
    filter_linear: false,
    denoise: true,
    denoise_strength: 1,
    interactive_scale: 0.2,
    gpu_profile: "auto",
    auto_follow: false,
    ortho: false,
    fov: 45,
    camera_distance: 70,
    aperture: 0,
    focus_distance: 0,
    auto_focus: true,
    auto_sync: false,
    env_mode: "sky",
    scene_preset: "",
    background_preset: "",
    preview_model_overrides: {},
    time_of_day: 12,
    env_intensity: 1,
    env_rotation: 0,
    bg_mode: "env",
    bg_color: "#1b1b20",
    background_blur: 0,
    sun_enable: true,
    sun_elevation: 48,
    sun_azimuth: 140,
    sun_angle: 1.2,
    sun_intensity: 6,
    sun_color: "#fff2dd",
    sky_zenith: "#3c78c8",
    sky_horizon: "#c6dcf2",
    sky_ground: "#5a5a5e",
    sky_haze: 0.35,
    grad_top: "#8fb6e8",
    grad_bottom: "#2a2a2e",
    solid_color: "#808080",
    ground_on: true,
    ground_y: 0,
    ground_color: "#a8a8a8",
    ground_texture_uuid: "",
    ground_texture_scale: 1,
    ground_rough: 0.9,
    ground_metal: 0,
    ground_radius: 0,
    ground_catcher: false,
    render_sides: "auto",
    def_roughness: 0.85,
    def_metalness: 0,
    emissive_strength: 1,
    alpha_mode: "cutout",
    alpha_cutoff: 0.5,
    tone_mapping: "aces",
    exposure: 1,
    contrast: 1,
    saturation: 1,
    bloom_enable: false,
    bloom_threshold: 1,
    bloom_intensity: 0.5,
    bloom_radius: 2,
    vignette_enable: false,
    vignette_strength: 0.4,
    sharpen_enable: false,
    sharpen_strength: 0.25,
    grain_enable: false,
    grain_strength: 0.03,
    watermark_enable: false,
    watermark_text: "",
    watermark_size: 24,
    watermark_opacity: 0.85,
    watermark_color: "#ffffff"
  };

  // plugins/georenderer/src/core/math.js
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function hexToLinear(hex) {
    let h = (hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.substr(0, 2), 16) / 255;
    const g = parseInt(h.substr(2, 2), 16) / 255;
    const b = parseInt(h.substr(4, 2), 16) / 255;
    return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  }
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function vNorm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function vSub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function vAdd(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }
  function vScale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
  }
  function vCross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function vDot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  var CUBE_FACE_NORMALS = {
    east: [1, 0, 0],
    west: [-1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0],
    south: [0, 0, 1],
    north: [0, 0, -1]
  };
  function triangleFacesInward(indices, positions, normal) {
    const a = indices[0] * 3, b = indices[1] * 3, c = indices[2] * 3;
    const geometric = vCross(
      [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]],
      [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    );
    return vDot(geometric, normal) < 0;
  }

  // plugins/georenderer/src/ui/orbit-camera.js
  var OrbitCam = class {
    constructor() {
      this.target = [0, 12, 0];
      this.distance = 70;
      this.theta = Math.PI * 0.25;
      this.phi = Math.PI * 0.42;
      this.fov = 45;
      this.ortho = false;
    }
    position() {
      const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
      return [
        this.target[0] + this.distance * sp * Math.sin(this.theta),
        this.target[1] + this.distance * cp,
        this.target[2] + this.distance * sp * Math.cos(this.theta)
      ];
    }
    state() {
      return {
        pos: this.position(),
        target: this.target.slice(),
        fov: this.fov,
        ortho: this.ortho,
        orthoHalfHeight: this.distance * Math.tan(this.fov * Math.PI / 360)
      };
    }
    orbit(dx, dy) {
      this.theta -= dx * 8e-3;
      this.phi = clamp(this.phi - dy * 8e-3, 0.02, Math.PI - 0.02);
    }
    pan(dx, dy, aspectScale) {
      const pos = this.position();
      const fwd = vNorm(vSub(this.target, pos));
      let right = vCross(fwd, [0, 1, 0]);
      if (vDot(right, right) < 1e-8) right = [1, 0, 0];
      right = vNorm(right);
      const up = vNorm(vCross(right, fwd));
      const scale = this.distance * Math.tan(this.fov * Math.PI / 360) * 2 * aspectScale;
      this.target = vAdd(this.target, vAdd(vScale(right, -dx * scale), vScale(up, dy * scale)));
    }
    zoom(delta) {
      this.distance = clamp(this.distance * Math.exp(delta * 12e-4), 0.5, 2e4);
    }
    frameBounds(bounds) {
      if (!bounds) return;
      this.target = bounds.center.slice();
      this.distance = Math.max(bounds.radius * 2.6, 4);
    }
    syncFromPreview() {
      try {
        const prev = typeof Preview !== "undefined" ? Preview.selected : null;
        if (!prev || !prev.camera) return false;
        const c = prev.camera;
        c.updateMatrixWorld(true);
        const e = c.matrixWorld.elements;
        const pos = [e[12], e[13], e[14]];
        const tgt = prev.controls && prev.controls.target ? [prev.controls.target.x, prev.controls.target.y, prev.controls.target.z] : [0, 0, 0];
        const d = vSub(pos, tgt);
        const dist = Math.hypot(d[0], d[1], d[2]);
        if (!(dist > 1e-4)) return false;
        this.target = tgt;
        this.distance = dist;
        this.phi = clamp(Math.acos(clamp(d[1] / dist, -1, 1)), 0.02, Math.PI - 0.02);
        this.theta = Math.atan2(d[0], d[2]);
        if (typeof c.fov === "number") this.fov = c.fov;
        this.ortho = !!prev.isOrtho;
        return true;
      } catch (err) {
        console.warn("[PathTracer] 同步相机失败", err);
        return false;
      }
    }
  };

  // plugins/georenderer/src/ui/state.js
  var STORAGE_KEY = "pathtracer_preview_settings";
  var CHANGE_KIND = {
    def_roughness: "scene",
    def_metalness: "scene",
    emissive_strength: "scene",
    ground_texture_uuid: "scene",
    ground_texture_scale: "reset",
    background_blur: "reset",
    time_of_day: "env",
    alpha_cutoff: "scene",
    alpha_mode: "scene",
    render_sides: "scene",
    env_mode: "env",
    sun_enable: "env",
    sun_elevation: "env",
    sun_azimuth: "env",
    sun_intensity: "env",
    sun_color: "env",
    sky_zenith: "env",
    sky_horizon: "env",
    sky_ground: "env",
    sky_haze: "env",
    grad_top: "env",
    grad_bottom: "env",
    solid_color: "env",
    tone_mapping: "post",
    exposure: "post",
    contrast: "post",
    saturation: "post",
    denoise: "post",
    denoise_strength: "post",
    bloom_enable: "post",
    bloom_threshold: "post",
    bloom_intensity: "post",
    bloom_radius: "post",
    vignette_enable: "post",
    vignette_strength: "post",
    sharpen_enable: "post",
    sharpen_strength: "post",
    grain_enable: "post",
    grain_strength: "post",
    watermark_enable: "post",
    watermark_text: "post",
    watermark_size: "post",
    watermark_opacity: "post",
    watermark_color: "post",
    res_mode: "resize",
    res_width: "resize",
    res_height: "resize",
    preview_scale: "resize",
    render_mode: "post",
    preview_samples: "post",
    final_samples: "post",
    auto_follow: "post",
    auto_sync: "post",
    interactive_scale: "post",
    gpu_profile: "post"
  };
  var PTR = {
    dialog: null,
    cameraInitialized: false,
    tracer: null,
    cam: new OrbitCam(),
    inspectionCam: new OrbitCam(),
    settings: Object.assign({}, DEFAULTS),
    overrides: {},
    groupOverrides: {},
    sceneCubemap: null,
    scenePresetRequest: 0,
    backgroundPresetRequest: 0,
    backgroundScene: null,
    customEnv: null,
    customEnvName: "",
    customEnvSource: "",
    open: false,
    paused: false,
    raf: 0,
    passesPerFrame: 1,
    lastFrame: 0,
    interacting: false,
    interactTimer: 0,
    nodes: {},
    controls: [],
    step: "materials",
    lockedCamera: null,
    selectedGroupUuid: null,
    collapsedGroups: /* @__PURE__ */ new Set(),
    finalStarted: false,
    finalRender: null,
    needsPresent: false,
    raster: null,
    refreshMaterialList: null,
    rebuildTimer: 0,
    autoFollow: false,
    stale: false,
    needsRebuild: false,
    lastPasses: 0,
    spsEma: 0
  };
  function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return "--";
    if (sec < 90) return sec.toFixed(0) + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m" + Math.round(sec % 60) + "s";
    return Math.floor(sec / 3600) + "h" + Math.round(sec % 3600 / 60) + "m";
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        for (const k in DEFAULTS) if (data[k] !== void 0) PTR.settings[k] = data[k];
        migrateBackgroundSelection(data);
        if (data.__overrides) PTR.overrides = data.__overrides;
        if (data.__groups) PTR.groupOverrides = data.__groups;
      }
    } catch (err) {
    }
  }
  function migrateBackgroundSelection(data) {
    if (data.background_preset === void 0) PTR.settings.background_preset = data.scene_preset || "";
  }
  function saveSettings() {
    try {
      const data = Object.assign({}, PTR.settings);
      data.__overrides = PTR.overrides;
      data.__groups = PTR.groupOverrides;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
    }
  }
  function refreshRasterMaterials() {
    clearTimeout(PTR.rasterRefreshTimer);
    if (PTR.raster) PTR.rasterRefreshTimer = setTimeout(() => PTR.raster?.refreshModel(), 60);
  }

  // plugins/georenderer/src/ui/workflow-state.js
  var STEPS = [
    { id: "materials", label: "材质", icon: "account_tree" },
    { id: "scene", label: "场景", icon: "landscape" },
    { id: "camera", label: "相机", icon: "videocam" },
    { id: "preview", label: "预览渲染", icon: "tune" },
    { id: "export", label: "最终导出", icon: "save_alt" }
  ];
  function stepIndex(id) {
    return STEPS.findIndex((step) => step.id === id);
  }
  function isTraceStep(id) {
    return id === "preview" || id === "export";
  }
  function canMoveCamera(id) {
    return id === "camera";
  }
  function isInspectionStep(id) {
    return id === "materials" || id === "scene";
  }
  function canNavigatePreview(id) {
    return isInspectionStep(id) || canMoveCamera(id);
  }
  function canExport(step, finalStarted, spp, finalSamples, completed = true) {
    return step === "export" && !!finalStarted && completed && spp >= Math.max(1, finalSamples);
  }
  function validateFinalSize(width, height, maxTextureSize) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) return "最终尺寸必须是至少 8 像素的整数";
    if (width > maxTextureSize || height > maxTextureSize) return "最终尺寸超过当前 GPU 的纹理上限";
    if (width * height > 16777216) return "最终画面超过 1600 万像素，请降低宽度或高度";
    return null;
  }
  function resolveRenderSize(settings2, step, finalStarted, viewport, interacting) {
    let width = settings2.res_mode === "custom" ? settings2.res_width : Math.max(64, Math.floor(viewport.width));
    let height = settings2.res_mode === "custom" ? settings2.res_height : Math.max(64, Math.floor(viewport.height));
    if (step === "preview" || step === "export" && !finalStarted) {
      const scale = Math.max(0.25, Math.min(1, settings2.preview_scale || 1));
      width *= scale;
      height *= scale;
    }
    if (interacting) {
      const scale = Math.max(0.2, Math.min(1, settings2.interactive_scale || 1));
      width *= scale;
      height *= scale;
    }
    return { width: Math.max(8, Math.round(width)), height: Math.max(8, Math.round(height)) };
  }

  // plugins/georenderer/src/ui/render-loop.js
  var watchedPreviewImages = /* @__PURE__ */ new WeakSet();
  function showError(err) {
    console.error("[PathTracer]", err);
    if (PTR.nodes.overlay) PTR.nodes.overlay.textContent = "错误: " + (err && err.message ? err.message : err);
    try {
      Blockbench.showQuickMessage("路径追踪出错: " + (err && err.message ? err.message : err), 3e3);
    } catch (e) {
    }
  }
  function rebuildScene() {
    const t = PTR.tracer;
    if (!t) return;
    if (!PTR.open || !isTraceStep(PTR.step)) {
      PTR.needsRebuild = true;
      return;
    }
    try {
      const scene = t.buildScene(PTR.settings, PTR.overrides, PTR.groupOverrides);
      for (const image of scene.pendingImages || []) {
        if (image.complete && image.naturalWidth) {
          queueMicrotask(rebuildScene);
          continue;
        }
        if (watchedPreviewImages.has(image)) continue;
        watchedPreviewImages.add(image);
        image.addEventListener("load", () => rebuildScene(), { once: true });
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
  function applyResolution() {
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
  function setInteracting(on) {
    if (PTR.interacting === on) return;
    PTR.interacting = on;
    if (on) {
      PTR.passesPerFrame = 1;
    } else {
      if (PTR.tracer) PTR.tracer.reset();
    }
    if (PTR.settings.interactive_scale < 1) applyResolution();
  }
  function interactiveSettings(settings2) {
    if (settings2.max_bounce <= INTERACTIVE_MAX_BOUNCE && settings2.light_samples <= 1) return settings2;
    const fast = Object.assign({}, settings2);
    fast.max_bounce = Math.min(settings2.max_bounce, INTERACTIVE_MAX_BOUNCE);
    fast.light_samples = 1;
    return fast;
  }
  function currentMaxSamples() {
    return PTR.settings.render_mode === "final" ? PTR.settings.final_samples : PTR.settings.preview_samples;
  }
  function updateStatus(scene) {
    const t = PTR.tracer;
    if (!t || !PTR.nodes.status) return;
    const s = scene || t.scene;
    const max = currentMaxSamples();
    const job = PTR.finalRender;
    const pct = job ? job.progress(t.spp) : clamp(t.spp / Math.max(max, 1), 0, 1);
    PTR.nodes.bar.style.width = (pct * 100).toFixed(1) + "%";
    let line = t.spp + " / " + max + " spp　" + (job ? job.plan.width + "×" + job.plan.height : t.width + "×" + t.height);
    if (job) line += "　区块 " + Math.min(job.index + 1, job.plan.tiles.length) + " / " + job.plan.tiles.length;
    if (PTR.spsEma > 1e-3) {
      const msPerSpp = 1e3 / PTR.spsEma;
      const mpix = t.width * t.height * PTR.spsEma / 1e6;
      line += "　" + (msPerSpp < 10 ? msPerSpp.toFixed(1) : msPerSpp.toFixed(0)) + " ms/spp";
      line += "　" + mpix.toFixed(1) + " Mpix/s";
      const left = job ? (job.plan.tiles.length - job.index) * max - (job.completed ? 0 : t.spp) : max - t.spp;
      if (left > 0 && !PTR.paused) line += "　剩余 ~" + formatDuration(left / PTR.spsEma);
    }
    if (s && s.stats) {
      line += "　△" + s.stats.tris + "　BVH " + s.stats.nodes;
      if (s.stats.lights) line += "　光源 " + s.stats.lights;
    }
    if (PTR.paused) line = "[暂停] " + line;
    if (PTR.stale) line += "　(模型已修改)";
    PTR.nodes.status.textContent = line;
    if (PTR.nodes.overlay) {
      PTR.nodes.overlay.textContent = job ? job.completed ? "渲染完成 · " + max + " spp" : "区块 " + (job.index + 1) + " / " + job.plan.tiles.length + " · " + t.spp + " spp" : t.spp >= max && !t.frameSync ? "渲染完成 · " + t.spp + " spp" : t.spp + " spp";
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
      wm.style.display = "none";
      return;
    }
    const vp = PTR.nodes.viewport;
    const vw = vp ? vp.clientWidth : 0;
    const vh = vp ? vp.clientHeight : 0;
    if (!vw || !vh) {
      wm.style.display = "none";
      return;
    }
    const imageWidth = PTR.finalRender?.plan.width || t.width, imageHeight = PTR.finalRender?.plan.height || t.height;
    const renderAspect = imageWidth / imageHeight;
    const boxAspect = vw / vh;
    let dispW, dispH;
    if (renderAspect > boxAspect) {
      dispW = vw;
      dispH = vw / renderAspect;
    } else {
      dispH = vh;
      dispW = vh * renderAspect;
    }
    const offX = (vw - dispW) / 2;
    const offY = (vh - dispH) / 2;
    const scale = dispH / imageHeight;
    wm.style.display = "block";
    wm.style.left = offX + Math.max(4, dispW * 0.02) + "px";
    wm.style.bottom = offY + Math.max(4, dispH * 0.02) + "px";
    wm.style.fontSize = Math.max(6, s.watermark_size * scale) + "px";
    wm.style.color = s.watermark_color;
    wm.style.opacity = s.watermark_opacity;
    wm.textContent = s.watermark_text;
  }
  function loop() {
    if (!PTR.open || !isTraceStep(PTR.step)) return;
    if (PTR.nodes.canvas && !PTR.nodes.canvas.isConnected) {
      closeRenderer();
      return;
    }
    PTR.raf = requestAnimationFrame(loop);
    const t = PTR.tracer;
    if (!t || !t.scene || !t.env || PTR.paused) return;
    const now = performance.now();
    const dt = now - PTR.lastFrame;
    const targetMs = PTR.interacting ? 24 : 42;
    const passCap = PTR.interacting ? INTERACTIVE_PASS_CAP : PTR.finalRender ? FINAL_PASS_CAP : IDLE_PASS_CAP;
    try {
      if (t.isFrameReady && !t.isFrameReady()) return;
    } catch (err) {
      showError(err);
      PTR.paused = true;
      return;
    }
    PTR.lastFrame = now;
    if (dt < targetMs * 0.75) PTR.passesPerFrame = Math.min(passCap, PTR.passesPerFrame + 1);
    else if (dt > targetMs * 1.35) PTR.passesPerFrame = Math.max(1, Math.ceil(PTR.passesPerFrame / 2));
    if (PTR.passesPerFrame > passCap) PTR.passesPerFrame = passCap;
    if (PTR.lastPasses > 0 && dt > 0.5) {
      const inst = PTR.lastPasses * 1e3 / dt;
      PTR.spsEma = PTR.spsEma > 0 ? PTR.spsEma * 0.85 + inst * 0.15 : inst;
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
        if (PTR.needsPresent) {
          t.present(PTR.settings);
          t.endFrame?.();
          PTR.needsPresent = false;
        }
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
  function pauseRenderer() {
    PTR.open = false;
    cancelAnimationFrame(PTR.raf);
    PTR.raf = 0;
  }
  function resumeRenderer() {
    if (!PTR.tracer || PTR.open || !isTraceStep(PTR.step)) return;
    PTR.open = true;
    PTR.paused = false;
    PTR.lastFrame = performance.now();
    loop();
  }
  function closeRenderer() {
    pauseRenderer();
    if (PTR.resizeObs) {
      try {
        PTR.resizeObs.disconnect();
      } catch (e) {
      }
      PTR.resizeObs = null;
    }
    if (PTR.tracer) {
      try {
        PTR.tracer.dispose();
      } catch (e) {
      }
      PTR.tracer = null;
    }
    saveSettings();
  }

  // plugins/georenderer/src/shaders/fullscreen.vert.glsl
  var fullscreen_vert_default = "#version 300 es\nvoid main() {\n	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n}\n";

  // plugins/georenderer/src/shaders/pathtrace.frag.glsl
  var pathtrace_frag_default = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n\n#define PI 3.141592653589793\n#define INV_PI 0.3183098861837907\n#define TFAR 1.0e20\n#define RAY_EPS 1.0e-3\n\n#define MF_HAS_COLOR   1\n#define MF_HAS_MER     2\n#define MF_HAS_NORMAL  4\n#define MF_FULLBRIGHT  8\n#define MF_WRAP_REPEAT 16\n#define MF_ADDITIVE    32\n#define MF_HAS_EMISSIVE_MAP 64\n#define MF_EMIS_MAIN_COLOR  128\n#define MF_EMIS_CUSTOM_COLOR 256\n#define MF_FORCE_EMISSION 512\n#define MF_FORCE_ROUGHNESS 1024\n#define MF_FORCE_METALNESS 2048\n\nuniform vec2 uResolution;\nuniform vec2 uTileOrigin;\nuniform int  uSeed;\nuniform int  uMaxBounce;\nuniform int  uLightSamples;\nuniform float uClamp;\nuniform int  uFilterLinear;\n\nuniform vec3 uCamPos, uCamRight, uCamUp, uCamForward;\nuniform float uTanHalfFov, uAspect, uOrthoHalfHeight;\nuniform int  uOrtho;\nuniform float uAperture, uFocusDist;\n\nuniform sampler2D uTriPos;\nuniform sampler2D uTriAttr;\nuniform sampler2D uBVH;\nuniform sampler2D uMat;\nuniform sampler2D uAtlasC;\nuniform sampler2D uAtlasM;\nuniform sampler2D uAtlasN;\nuniform sampler2D uAtlasE;\nuniform sampler2D uLightTex;\nuniform int uTriPosW, uTriAttrW, uBVHW, uMatW, uLightW;\nuniform int uTriCount, uLightCount;\n\nuniform sampler2D uEnv;\nuniform sampler2D uEnvCond;\nuniform sampler2D uEnvMarg;\nuniform ivec2 uEnvDist;\nuniform float uEnvIntensity, uEnvRotation;\nuniform float uBackgroundLod;\nuniform int uBgMode;\nuniform vec3 uBgColor;\n\nuniform int  uSunEnable;\nuniform vec3 uSunDir;\nuniform float uSunCosRadius, uSunSolidAngle;\nuniform vec3 uSunRadiance;\n\nuniform int  uGroundOn, uGroundCatcher;\nuniform float uGroundY, uGroundRough, uGroundMetal, uGroundRadius;\nuniform vec3 uGroundColor;\nuniform int uGroundTexOn;\nuniform vec4 uGroundRect;\nuniform float uGroundTexScale;\nuniform int uFogMode;\nuniform vec3 uFogColor;\nuniform float uFogNear, uFogFar, uFogDensity;\n\nuniform sampler2D uAccum;\n#ifndef PTR_COLOR_ONLY\nuniform sampler2D uAccumAlb;\nuniform sampler2D uAccumNrm;\nuniform sampler2D uAccumMom;\n#endif\nuniform int uReset;\n\nlayout(location = 0) out vec4 outColor;\n#ifndef PTR_COLOR_ONLY\nlayout(location = 1) out vec4 outAlbedo;\nlayout(location = 2) out vec4 outNormal;\nlayout(location = 3) out vec4 outMoment;\n#endif\n\nuint g_rng;\nuint pcgNext() {\n	g_rng = g_rng * 747796405u + 2891336453u;\n	uint w = ((g_rng >> ((g_rng >> 28u) + 4u)) ^ g_rng) * 277803737u;\n	return (w >> 22u) ^ w;\n}\nfloat rnd() { return float(pcgNext()) * (1.0 / 4294967296.0); }\nvec2 rnd2() { return vec2(rnd(), rnd()); }\n\nvec4 fetchAt(sampler2D s, int idx, int w) {\n	return texelFetch(s, ivec2(idx - (idx / w) * w, idx / w), 0);\n}\nvec4 fTri(int i) { return fetchAt(uTriPos, i, uTriPosW); }\nvec4 fAttr(int i) { return fetchAt(uTriAttr, i, uTriAttrW); }\nvec4 fBVH(int i) { return fetchAt(uBVH, i, uBVHW); }\nvec4 fMat(int i) { return fetchAt(uMat, i, uMatW); }\nint triCullMode(int tri) { return int(fTri(tri * 3 + 1).w + 0.5); }\nbool isNegativeCubeTri(int tri) { return triCullMode(tri) >= 3; }\nbool isInsideOnlyTri(int tri) {\n	return triCullMode(tri) == 6;\n}\n\nstruct Mat {\n	vec3 tint;\n	int flags;\n	vec4 rect;\n	float rough, metal, emis, ior;\n	float transm, cutoff, nscale;\n	int amode;\n	vec3 emisColor;\n	float opacity;\n};\n\nMat loadMat(int id) {\n	vec4 m0 = fMat(id * 5 + 0);\n	vec4 m1 = fMat(id * 5 + 1);\n	vec4 m2 = fMat(id * 5 + 2);\n	vec4 m3 = fMat(id * 5 + 3);\n	vec4 m4 = fMat(id * 5 + 4);\n	Mat m;\n	m.tint = m0.rgb;\n	m.flags = int(m0.a + 0.5);\n	m.rect = m1;\n	m.rough = m2.x; m.metal = m2.y; m.emis = m2.z; m.ior = m2.w;\n	m.transm = m3.x; m.cutoff = m3.y; m.nscale = m3.z;\n	m.amode = int(m3.w + 0.5);\n	m.emisColor = m4.rgb;\n	m.opacity = m4.w;\n	return m;\n}\n\nvec3 srgbToLin(vec3 c) {\n	return mix(c / 12.92, pow(max(c + 0.055, vec3(0.0)) / 1.055, vec3(2.4)), step(vec3(0.04045), c));\n}\n\nvec4 fetchAtlas(sampler2D atlas, vec4 rect, vec2 f, bool rep) {\n	vec2 sz = max(rect.zw, vec2(1.0));\n	if (rep) f = mod(f, sz);\n	f = clamp(f, vec2(0.0), sz - 1.0);\n	return texelFetch(atlas, ivec2(rect.xy + f), 0);\n}\n\nvec4 sampleAtlas(sampler2D atlas, vec4 rect, vec2 uvIn, bool rep) {\n	vec2 uv = vec2(uvIn.x, 1.0 - uvIn.y);\n	vec2 sz = max(rect.zw, vec2(1.0));\n	if (uFilterLinear == 0) {\n		return fetchAtlas(atlas, rect, floor(uv * sz), rep);\n	}\n	vec2 t = uv * sz - 0.5;\n	vec2 f0 = floor(t);\n	vec2 fr = t - f0;\n	vec4 c00 = fetchAtlas(atlas, rect, f0, rep);\n	vec4 c10 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 0.0), rep);\n	vec4 c01 = fetchAtlas(atlas, rect, f0 + vec2(0.0, 1.0), rep);\n	vec4 c11 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 1.0), rep);\n	return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);\n}\n\nstruct Hit {\n	float t;\n	int tri;\n	vec2 bc;\n};\n\nbool hitAABB(vec3 bmin, vec3 bmax, vec3 ro, vec3 invD, float tmax) {\n	vec3 t0 = (bmin - ro) * invD;\n	vec3 t1 = (bmax - ro) * invD;\n	vec3 ts = min(t0, t1);\n	vec3 tb = max(t0, t1);\n	float tn = max(max(ts.x, ts.y), max(ts.z, 0.0));\n	float tf = min(min(tb.x, tb.y), min(tb.z, tmax));\n	return tn <= tf;\n}\n\nvoid triIntersect(int i, vec3 ro, vec3 rd, inout Hit hit) {\n	vec3 v0 = fTri(i * 3 + 0).xyz;\n	vec4 p1 = fTri(i * 3 + 1);\n	vec3 v1 = p1.xyz;\n	vec3 v2 = fTri(i * 3 + 2).xyz;\n	vec3 e1 = v1 - v0;\n	vec3 e2 = v2 - v0;\n	vec3 pv = cross(rd, e2);\n	float det = dot(e1, pv);\n	int cull = int(p1.w + 0.5);\n	if (cull >= 6) cull = 0;\n	else if (cull >= 3) cull -= 3;\n	if (cull == 1 && det <= 0.0) return;\n	if (cull == 2 && det >= 0.0) return;\n	if (abs(det) < 1e-12) return;\n	float inv = 1.0 / det;\n	vec3 tv = ro - v0;\n	float u = dot(tv, pv) * inv;\n	if (u < 0.0 || u > 1.0) return;\n	vec3 qv = cross(tv, e1);\n	float v = dot(rd, qv) * inv;\n	if (v < 0.0 || u + v > 1.0) return;\n	float t = dot(e2, qv) * inv;\n	if (t > 1e-4 && t < hit.t) {\n		hit.t = t; hit.tri = i; hit.bc = vec2(u, v);\n	}\n}\n\nvec3 safeInvDir(vec3 d) {\n	const float e = 1e-9;\n	vec3 s = vec3(d.x < 0.0 ? -e : e, d.y < 0.0 ? -e : e, d.z < 0.0 ? -e : e);\n	vec3 dd = vec3(abs(d.x) < e ? s.x : d.x, abs(d.y) < e ? s.y : d.y, abs(d.z) < e ? s.z : d.z);\n	return 1.0 / dd;\n}\n\nvoid intersectBVH(vec3 ro, vec3 rd, inout Hit hit) {\n	if (uTriCount == 0) return;\n	vec3 invD = safeInvDir(rd);\n	int stack[32];\n	int sp = 0;\n	stack[sp++] = 0;\n	for (int guard = 0; guard < 4096; guard++) {\n		if (sp <= 0) break;\n		int node = stack[--sp];\n		vec4 a = fBVH(node * 2);\n		vec4 b = fBVH(node * 2 + 1);\n		if (!hitAABB(a.xyz, b.xyz, ro, invD, hit.t)) continue;\n		int count = int(b.w + 0.5);\n		if (count > 0) {\n			int start = int(a.w + 0.5);\n			for (int i = 0; i < count; i++) triIntersect(start + i, ro, rd, hit);\n		} else if (sp <= 30) {\n			int left = int(a.w + 0.5);\n			stack[sp++] = left + 1;\n			stack[sp++] = left;\n		}\n	}\n}\n\nvoid intersectGround(vec3 ro, vec3 rd, inout Hit hit) {\n	if (uGroundOn == 0) return;\n	if (abs(rd.y) < 1e-7) return;\n	float t = (uGroundY - ro.y) / rd.y;\n	if (t <= 1e-4 || t >= hit.t) return;\n	vec3 p = ro + rd * t;\n	if (uGroundRadius > 0.0 && dot(p.xz, p.xz) > uGroundRadius * uGroundRadius) return;\n	hit.t = t; hit.tri = -2; hit.bc = vec2(0.0);\n}\n\nvoid intersectScene(vec3 ro, vec3 rd, inout Hit hit) {\n	intersectGround(ro, rd, hit);\n	intersectBVH(ro, rd, hit);\n}\n\nstruct Surface {\n	vec3 pos, ng, ns;\n	vec2 uv;\n	vec3 albedo;\n	float alpha, rough, metal, transm, ior, cutoff;\n	int amode;\n	vec3 emission;\n	bool isLight;\n};\n\nvoid triVerts(int i, out vec3 v0, out vec3 v1, out vec3 v2) {\n	v0 = fTri(i * 3 + 0).xyz;\n	v1 = fTri(i * 3 + 1).xyz;\n	v2 = fTri(i * 3 + 2).xyz;\n}\n\nvec2 triUV(int i, vec2 bc) {\n	vec4 a0 = fAttr(i * 4 + 0);\n	vec4 a1 = fAttr(i * 4 + 1);\n	vec4 a2 = fAttr(i * 4 + 2);\n	vec4 a3 = fAttr(i * 4 + 3);\n	vec2 uv0 = vec2(a0.w, a1.w);\n	vec2 uv1 = vec2(a2.w, a3.x);\n	vec2 uv2 = vec2(a3.y, a3.z);\n	float w = 1.0 - bc.x - bc.y;\n	return uv0 * w + uv1 * bc.x + uv2 * bc.y;\n}\n\nbool insideOnlyHitFromOutside(int i, vec2 bc, vec3 rd) {\n	vec3 n0 = fAttr(i * 4 + 0).xyz;\n	vec3 n1 = fAttr(i * 4 + 1).xyz;\n	vec3 n2 = fAttr(i * 4 + 2).xyz;\n	vec3 outward = normalize(n0 * (1.0 - bc.x - bc.y) + n1 * bc.x + n2 * bc.y);\n	return dot(rd, outward) < 0.0;\n}\n\nMat matOfTri(int i) {\n	return loadMat(int(fTri(i * 3 + 0).w + 0.5));\n}\n\nfloat alphaOfTri(int i, vec2 bc, Mat m) {\n	if ((m.flags & MF_HAS_COLOR) == 0) return m.opacity;\n	vec2 uv = triUV(i, bc);\n	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;\n	return sampleAtlas(uAtlasC, m.rect, uv, rep).a * m.opacity;\n}\n\nbool alphaPassThrough(Mat m, float alpha) {\n	if (m.amode == 0) return false;\n	if (m.amode == 1) return alpha < m.cutoff;\n	return rnd() >= alpha;\n}\n\nvec3 materialEmission(Mat m, vec2 uv, vec3 base) {\n	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;\n	if ((m.flags & MF_FORCE_EMISSION) != 0) return base * m.emisColor * m.emis;\n	if ((m.flags & MF_HAS_MER) != 0) {\n		float e = sampleAtlas(uAtlasM, m.rect, uv, rep).g;\n		if ((m.flags & MF_EMIS_CUSTOM_COLOR) != 0) return m.emisColor * e * m.emis;\n		if ((m.flags & MF_EMIS_MAIN_COLOR) != 0) return base * e * m.emis;\n		return base * m.emisColor * e * m.emis;\n	}\n	if ((m.flags & MF_HAS_EMISSIVE_MAP) != 0) {\n		vec3 emsCol = srgbToLin(sampleAtlas(uAtlasE, m.rect, uv, rep).rgb);\n		float mask = dot(emsCol, vec3(0.2126, 0.7152, 0.0722));\n		if ((m.flags & MF_EMIS_CUSTOM_COLOR) != 0) return m.emisColor * mask * m.emis;\n		if ((m.flags & MF_EMIS_MAIN_COLOR) != 0) return base * mask * m.emis;\n		return emsCol * m.emis;\n	}\n	if ((m.flags & MF_FULLBRIGHT) != 0) {\n		if ((m.flags & MF_EMIS_CUSTOM_COLOR) != 0) return m.emisColor * m.emis;\n		if ((m.flags & MF_EMIS_MAIN_COLOR) != 0) return base * m.emis;\n		return base * m.emisColor * m.emis;\n	}\n	return vec3(0.0);\n}\n\nvec3 triEmission(int i, vec2 bc) {\n	Mat m = loadMat(int(fTri(i * 3 + 0).w + 0.5));\n	vec2 uv = triUV(i, bc);\n	vec3 base = m.tint;\n	if ((m.flags & MF_HAS_COLOR) != 0) base *= srgbToLin(sampleAtlas(uAtlasC, m.rect, uv, (m.flags & MF_WRAP_REPEAT) != 0).rgb);\n	return materialEmission(m, uv, base);\n}\n\nvoid onb(vec3 n, out vec3 t, out vec3 b) {\n	float s = n.z >= 0.0 ? 1.0 : -1.0;\n	float a = -1.0 / (s + n.z);\n	float bb = n.x * n.y * a;\n	t = vec3(1.0 + s * n.x * n.x * a, s * bb, -s * n.x);\n	b = vec3(bb, s + n.y * n.y * a, -n.y);\n}\n\nSurface getSurface(Hit hit, vec3 ro, vec3 rd) {\n	Surface s;\n	s.pos = ro + rd * hit.t;\n	s.isLight = false;\n	s.transm = 0.0;\n	s.ior = 1.5;\n	s.cutoff = 0.0;\n	s.alpha = 1.0;\n	s.amode = 0;\n	s.emission = vec3(0.0);\n\n	if (hit.tri == -2) {\n		s.ng = vec3(0.0, 1.0, 0.0);\n		s.ns = s.ng;\n		s.uv = vec2(0.0);\n		s.albedo = uGroundColor;\n		if (uGroundTexOn == 1) {\n			vec2 groundUV = s.pos.xz / max(uGroundTexScale, 0.01);\n			s.albedo *= srgbToLin(sampleAtlas(uAtlasC, uGroundRect, groundUV, true).rgb);\n		}\n		s.rough = uGroundRough;\n		s.metal = uGroundMetal;\n		if (rd.y > 0.0) { s.ng = -s.ng; s.ns = -s.ns; }\n		return s;\n	}\n\n	int i = hit.tri;\n	vec3 v0, v1, v2;\n	triVerts(i, v0, v1, v2);\n	vec3 geoN = normalize(cross(v1 - v0, v2 - v0));\n\n	vec4 a0 = fAttr(i * 4 + 0);\n	vec4 a1 = fAttr(i * 4 + 1);\n	vec4 a2 = fAttr(i * 4 + 2);\n	vec4 a3 = fAttr(i * 4 + 3);\n	float w = 1.0 - hit.bc.x - hit.bc.y;\n	vec3 sn = a0.xyz * w + a1.xyz * hit.bc.x + a2.xyz * hit.bc.y;\n	if (dot(sn, sn) < 1e-12) sn = geoN; else sn = normalize(sn);\n	if (dot(sn, geoN) < 0.0) geoN = -geoN;\n\n	vec2 uv0 = vec2(a0.w, a1.w);\n	vec2 uv1 = vec2(a2.w, a3.x);\n	vec2 uv2 = vec2(a3.y, a3.z);\n	s.uv = uv0 * w + uv1 * hit.bc.x + uv2 * hit.bc.y;\n	s.isLight = a3.w > 0.5;\n\n	if (dot(geoN, rd) > 0.0) { geoN = -geoN; sn = -sn; }\n	s.ng = geoN;\n	s.ns = sn;\n\n	int matId = int(fTri(i * 3 + 0).w + 0.5);\n	Mat m = loadMat(matId);\n	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;\n\n	vec3 base = m.tint;\n	float alpha = 1.0;\n	if ((m.flags & MF_HAS_COLOR) != 0) {\n		vec4 c = sampleAtlas(uAtlasC, m.rect, s.uv, rep);\n		base *= srgbToLin(c.rgb);\n		alpha = c.a;\n	}\n	s.albedo = base;\n	s.alpha = alpha * m.opacity;\n	s.cutoff = m.cutoff;\n	s.amode = m.amode;\n	s.rough = clamp(m.rough, 0.015, 1.0);\n	s.metal = clamp(m.metal, 0.0, 1.0);\n	s.transm = clamp(m.transm, 0.0, 1.0);\n	s.ior = max(m.ior, 1.001);\n\n	if ((m.flags & MF_HAS_MER) != 0) {\n		vec3 mer = sampleAtlas(uAtlasM, m.rect, s.uv, rep).rgb;\n		s.metal = clamp(mer.r, 0.0, 1.0);\n		s.rough = clamp(mer.b, 0.015, 1.0);\n	}\n	s.emission = materialEmission(m, s.uv, base);\n	if ((m.flags & MF_FORCE_ROUGHNESS) != 0) s.rough = clamp(m.rough, 0.015, 1.0);\n	if ((m.flags & MF_FORCE_METALNESS) != 0) s.metal = clamp(m.metal, 0.0, 1.0);\n\n	if ((m.flags & MF_HAS_NORMAL) != 0 && m.nscale > 0.0) {\n		vec2 d1 = uv1 - uv0;\n		vec2 d2 = uv2 - uv0;\n		float r = d1.x * d2.y - d2.x * d1.y;\n		if (abs(r) > 1e-9) {\n			vec3 e1 = v1 - v0;\n			vec3 e2 = v2 - v0;\n			vec3 T = (e1 * d2.y - e2 * d1.y) / r;\n			T = normalize(T - s.ns * dot(s.ns, T));\n			if (dot(T, T) > 0.5) {\n				vec3 B = cross(s.ns, T);\n				vec3 nt = sampleAtlas(uAtlasN, m.rect, s.uv, rep).rgb * 2.0 - 1.0;\n				nt.xy *= m.nscale;\n				vec3 mapped = normalize(T * nt.x + B * nt.y + s.ns * max(nt.z, 0.05));\n				if (dot(mapped, s.ng) > 0.0) s.ns = mapped;\n			}\n		}\n	}\n	return s;\n}\n\nvec2 dirToEnvUV(vec3 d) {\n	float phi = atan(d.z, d.x) + uEnvRotation;\n	float u = fract(phi * 0.15915494309189535 + 0.5);\n	float v = acos(clamp(d.y, -1.0, 1.0)) * INV_PI;\n	return vec2(u, clamp(v, 0.0, 1.0));\n}\n\nvec3 envRadiance(vec3 d) {\n	return textureLod(uEnv, dirToEnvUV(d), 0.0).rgb * uEnvIntensity;\n}\n\nvec3 backgroundRadiance(vec3 d) {\n	return textureLod(uEnv, dirToEnvUV(d), uBackgroundLod).rgb * uEnvIntensity;\n}\n\nfloat envPdfDir(vec3 d) {\n	int W = uEnvDist.x, H = uEnvDist.y;\n	vec2 uv = dirToEnvUV(d);\n	int x = clamp(int(uv.x * float(W)), 0, W - 1);\n	int y = clamp(int(uv.y * float(H)), 0, H - 1);\n	float pm = (texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r - texelFetch(uEnvMarg, ivec2(y, 0), 0).r) * float(H);\n	float pc = (texelFetch(uEnvCond, ivec2(x + 1, y), 0).r - texelFetch(uEnvCond, ivec2(x, y), 0).r) * float(W);\n	float sinT = sqrt(max(0.0, 1.0 - d.y * d.y));\n	if (sinT < 1e-5) return 0.0;\n	return (pm * pc) / (2.0 * PI * PI * sinT);\n}\n\nvec3 envSampleDir(out vec3 L, out float pdf) {\n	int W = uEnvDist.x, H = uEnvDist.y;\n	float r1 = rnd(), r2 = rnd();\n	int lo = 0, hi = H;\n	for (int i = 0; i < 12; i++) {\n		if (lo + 1 >= hi) break;\n		int mid = (lo + hi) >> 1;\n		if (texelFetch(uEnvMarg, ivec2(mid, 0), 0).r <= r1) lo = mid; else hi = mid;\n	}\n	int y = lo;\n	float m0 = texelFetch(uEnvMarg, ivec2(y, 0), 0).r;\n	float m1 = texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r;\n	float dy = (m1 > m0) ? (r1 - m0) / (m1 - m0) : 0.5;\n\n	lo = 0; hi = W;\n	for (int i = 0; i < 12; i++) {\n		if (lo + 1 >= hi) break;\n		int mid = (lo + hi) >> 1;\n		if (texelFetch(uEnvCond, ivec2(mid, y), 0).r <= r2) lo = mid; else hi = mid;\n	}\n	int x = lo;\n	float c0 = texelFetch(uEnvCond, ivec2(x, y), 0).r;\n	float c1 = texelFetch(uEnvCond, ivec2(x + 1, y), 0).r;\n	float dx = (c1 > c0) ? (r2 - c0) / (c1 - c0) : 0.5;\n\n	float u = (float(x) + dx) / float(W);\n	float v = (float(y) + dy) / float(H);\n	float theta = v * PI;\n	float phi = (u - 0.5) * 2.0 * PI - uEnvRotation;\n	float sinT = sin(theta);\n	L = vec3(sinT * cos(phi), cos(theta), sinT * sin(phi));\n	float pm = (m1 - m0) * float(H);\n	float pc = (c1 - c0) * float(W);\n	pdf = (sinT > 1e-5) ? (pm * pc) / (2.0 * PI * PI * sinT) : 0.0;\n	return envRadiance(L);\n}\n\nvec3 sunRadianceFor(vec3 d) {\n	if (uSunEnable == 0) return vec3(0.0);\n	return dot(d, uSunDir) >= uSunCosRadius ? uSunRadiance : vec3(0.0);\n}\nfloat sunPdfFor(vec3 d) {\n	if (uSunEnable == 0) return 0.0;\n	return dot(d, uSunDir) >= uSunCosRadius ? (1.0 / uSunSolidAngle) : 0.0;\n}\nvec3 sunSampleDir(out float pdf) {\n	float cosT = mix(uSunCosRadius, 1.0, rnd());\n	float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));\n	float phi = 2.0 * PI * rnd();\n	vec3 t, b;\n	onb(uSunDir, t, b);\n	pdf = 1.0 / uSunSolidAngle;\n	return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + uSunDir * cosT);\n}\n\nfloat luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }\nfloat powerHeuristic(float a, float b) {\n	float aa = a * a, bb = b * b;\n	return aa / max(aa + bb, 1e-9);\n}\nfloat specProb(vec3 albedo, float metal) {\n	float ds = luma(albedo) * (1.0 - metal);\n	float ss = luma(mix(vec3(0.04), albedo, metal)) + metal * 0.5;\n	return clamp(ss / max(ds + ss, 1e-4), 0.12, 1.0);\n}\nfloat distGGX(vec3 N, vec3 H, float a) {\n	float a2 = a * a;\n	float NoH = max(dot(N, H), 0.0);\n	vec3 NxH = cross(N, H);\n	// Avoid cancellation and a flattened reflection peak at low roughness.\n	float d = dot(NxH, NxH) + a2 * NoH * NoH;\n	return a2 / max(PI * d * d, 1e-30);\n}\nfloat smithG(float NoV, float NoL, float a) {\n	float a2 = a * a;\n	float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);\n	float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);\n	return 0.5 / max(gv + gl, 1e-9);\n}\n\nfloat smithG1(float NoV, float a) {\n	return 2.0 * NoV / max(NoV + sqrt(a * a + (1.0 - a * a) * NoV * NoV), 1e-9);\n}\n\nvec3 bsdfEval(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, float metal, out float pdf) {\n	pdf = 0.0;\n	float NoL = dot(N, L);\n	float NoV = dot(N, V);\n	if (NoL <= 0.0 || NoV <= 0.0) return vec3(0.0);\n	vec3 H = normalize(V + L);\n	float VoH = max(dot(V, H), 1e-5);\n	float a = max(rough * rough, 1e-4);\n	vec3 f0 = mix(vec3(0.04), albedo, metal);\n	vec3 F = f0 + (1.0 - f0) * pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);\n	float D = distGGX(N, H, a);\n	float Vis = smithG(NoV, NoL, a);\n	vec3 spec = F * D * Vis;\n	vec3 diff = (1.0 - F) * albedo * (1.0 - metal) * INV_PI;\n	float ps = specProb(albedo, metal);\n	float pdfS = D * smithG1(NoV, a) / max(4.0 * NoV, 1e-9);\n	float pdfD = NoL * INV_PI;\n	pdf = mix(pdfD, pdfS, ps);\n	return (diff + spec) * NoL;\n}\n\nvec3 cosineSample(vec3 n, vec2 u) {\n	float r = sqrt(u.x);\n	float phi = 2.0 * PI * u.y;\n	vec3 t, b;\n	onb(n, t, b);\n	return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u.x)));\n}\n\n// Heitz 2018, Sampling the GGX Distribution of Visible Normals (JCGT 7(4)).\nvec3 ggxSampleH(vec3 n, vec3 V, float a, vec2 u) {\n	vec3 t, b;\n	onb(n, t, b);\n	vec3 localV = vec3(dot(V, t), dot(V, b), dot(V, n));\n	vec3 Vh = normalize(vec3(a * localV.xy, localV.z));\n	float lensq = dot(Vh.xy, Vh.xy);\n	vec3 T1 = lensq > 0.0 ? vec3(-Vh.y, Vh.x, 0.0) * inversesqrt(lensq) : vec3(1.0, 0.0, 0.0);\n	vec3 T2 = cross(Vh, T1);\n	float r = sqrt(u.x), phi = 2.0 * PI * u.y;\n	float p1 = r * cos(phi), p2 = r * sin(phi);\n	float s = 0.5 * (1.0 + Vh.z);\n	p2 = mix(sqrt(max(0.0, 1.0 - p1 * p1)), p2, s);\n	vec3 Nh = p1 * T1 + p2 * T2 + sqrt(max(0.0, 1.0 - p1 * p1 - p2 * p2)) * Vh;\n	vec3 H = normalize(vec3(a * Nh.xy, max(0.0, Nh.z)));\n	return normalize(t * H.x + b * H.y + n * H.z);\n}\n\nbool bsdfSample(vec3 N, vec3 V, vec3 albedo, float rough, float metal, out vec3 L, out vec3 weight, out float pdf) {\n	float ps = specProb(albedo, metal);\n	float a = max(rough * rough, 1e-4);\n	if (rnd() < ps) {\n		vec3 H = ggxSampleH(N, V, a, rnd2());\n		L = reflect(-V, H);\n	} else {\n		L = cosineSample(N, rnd2());\n	}\n	if (dot(N, L) <= 0.0) return false;\n	vec3 f = bsdfEval(N, V, L, albedo, rough, metal, pdf);\n	if (pdf <= 1e-8) return false;\n	weight = f / pdf;\n	return true;\n}\n\nfloat fresnelDielectric(float cosI, float eta) {\n	float s2 = eta * eta * (1.0 - cosI * cosI);\n	if (s2 > 1.0) return 1.0;\n	float cosT = sqrt(max(0.0, 1.0 - s2));\n	float rs = (eta * cosI - cosT) / (eta * cosI + cosT);\n	float rp = (cosI - eta * cosT) / (cosI + eta * cosT);\n	return 0.5 * (rs * rs + rp * rp);\n}\n\nbool anyHitBVH(vec3 ro, vec3 rd, float maxT) {\n	if (uTriCount == 0) return false;\n	vec3 invD = safeInvDir(rd);\n	int stack[32];\n	int sp = 0;\n	stack[sp++] = 0;\n	for (int guard = 0; guard < 4096; guard++) {\n		if (sp <= 0) break;\n		int node = stack[--sp];\n		vec4 a = fBVH(node * 2);\n		vec4 b = fBVH(node * 2 + 1);\n		if (!hitAABB(a.xyz, b.xyz, ro, invD, maxT)) continue;\n		int count = int(b.w + 0.5);\n		if (count > 0) {\n			int start = int(a.w + 0.5);\n			for (int i = 0; i < count; i++) {\n				Hit h;\n				h.t = maxT;\n				h.tri = -1;\n				h.bc = vec2(0.0);\n				triIntersect(start + i, ro, rd, h);\n				if (h.tri >= 0) {\n					if (isNegativeCubeTri(h.tri)) continue;\n					Mat hm = matOfTri(h.tri);\n					if (hm.amode == 0 || !alphaPassThrough(hm, alphaOfTri(h.tri, h.bc, hm))) return true;\n				}\n			}\n		} else if (sp <= 30) {\n			int left = int(a.w + 0.5);\n			stack[sp++] = left + 1;\n			stack[sp++] = left;\n		}\n	}\n	return false;\n}\n\nbool occluded(vec3 ro, vec3 rd, float maxT, bool skipGround) {\n	if (!skipGround && uGroundOn == 1) {\n		Hit gh;\n		gh.t = maxT;\n		gh.tri = -1;\n		gh.bc = vec2(0.0);\n		intersectGround(ro, rd, gh);\n		if (gh.tri == -2) return true;\n	}\n	return anyHitBVH(ro, rd, maxT);\n}\n\nstruct LightSample { vec3 dir; vec3 radiance; float pdf; float dist; };\n\nLightSample sampleTriLight(vec3 p) {\n	LightSample ls;\n	ls.dir = vec3(0.0, 1.0, 0.0);\n	ls.radiance = vec3(0.0);\n	ls.pdf = 0.0;\n	ls.dist = 0.0;\n	if (uLightCount == 0) return ls;\n\n	int li = min(int(rnd() * float(uLightCount)), uLightCount - 1);\n	int tri = int(texelFetch(uLightTex, ivec2(li - (li / uLightW) * uLightW, li / uLightW), 0).r + 0.5);\n	vec3 v0, v1, v2;\n	triVerts(tri, v0, v1, v2);\n	float su = sqrt(rnd());\n	float b0 = 1.0 - su;\n	float b1 = rnd() * su;\n	float b2 = max(0.0, 1.0 - b0 - b1);\n	vec3 q = v0 * b0 + v1 * b1 + v2 * b2;\n	vec3 cr = cross(v1 - v0, v2 - v0);\n	float area2 = length(cr);\n	if (area2 < 1e-9) return ls;\n	vec3 nl = cr / area2;\n	float area = 0.5 * area2;\n\n	vec3 dv = q - p;\n	float d2 = dot(dv, dv);\n	if (d2 < 1e-8) return ls;\n	float d = sqrt(d2);\n	ls.dir = dv / d;\n	ls.dist = d;\n	float cosL = abs(dot(nl, ls.dir));\n	if (cosL < 1e-5) return ls;\n	ls.pdf = d2 / (cosL * area * float(uLightCount));\n	ls.radiance = triEmission(tri, vec2(b1, b2));\n	return ls;\n}\n\nfloat triLightPdf(int tri, vec3 from, vec3 hitP) {\n	if (uLightCount == 0) return 0.0;\n	vec3 v0, v1, v2;\n	triVerts(tri, v0, v1, v2);\n	vec3 cr = cross(v1 - v0, v2 - v0);\n	float area2 = length(cr);\n	if (area2 < 1e-9) return 0.0;\n	vec3 nl = cr / area2;\n	vec3 dv = hitP - from;\n	float d2 = dot(dv, dv);\n	float d = sqrt(max(d2, 1e-12));\n	float cosL = abs(dot(nl, dv / d));\n	if (cosL < 1e-5) return 0.0;\n	return d2 / (cosL * 0.5 * area2 * float(uLightCount));\n}\n\nfloat shadowCatcherAlpha(vec3 p, vec3 n) {\n	float full = 0.0, vis = 0.0;\n	if (uSunEnable == 1) {\n		float pdf;\n		vec3 L = sunSampleDir(pdf);\n		float ndl = max(dot(n, L), 0.0);\n		if (ndl > 0.0 && pdf > 0.0) {\n			float c = luma(uSunRadiance) * ndl / pdf;\n			full += c;\n			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;\n		}\n	}\n	{\n		vec3 L;\n		float pdf;\n		vec3 Le = envSampleDir(L, pdf);\n		float ndl = max(dot(n, L), 0.0);\n		if (ndl > 0.0 && pdf > 1e-8) {\n			float c = luma(Le) * ndl / pdf;\n			full += c;\n			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;\n		}\n	}\n	if (full <= 1e-8) return 0.0;\n	return clamp(1.0 - vis / full, 0.0, 1.0);\n}\n\nvec3 tracePath(vec3 ro, vec3 rd, out float alphaOut, out vec3 gAlbedo, out vec3 gNormal, out float gDepth) {\n	vec3 radiance = vec3(0.0);\n	vec3 beta = vec3(1.0);\n	float lastPdf = 0.0;\n	bool specularPath = true;\n	alphaOut = 1.0;\n	gAlbedo = vec3(0.0);\n	gNormal = vec3(0.0);\n	gDepth = 1.0e6;\n	bool gWritten = false;\n	int bounce = 0;\n	vec3 prevPos = ro;\n\n	for (int iter = 0; iter < 96; iter++) {\n		Hit hit;\n		hit.t = TFAR;\n		hit.tri = -1;\n		hit.bc = vec2(0.0);\n		intersectScene(ro, rd, hit);\n		if (hit.tri >= 0 && isNegativeCubeTri(hit.tri)) {\n			if (bounce > 0 || (isInsideOnlyTri(hit.tri) && insideOnlyHitFromOutside(hit.tri, hit.bc, rd))) {\n				ro += rd * (hit.t + RAY_EPS);\n				continue;\n			}\n		}\n\n		if (hit.tri == -1) {\n			vec3 env = envRadiance(rd);\n			vec3 sun = sunRadianceFor(rd);\n			if (bounce == 0) {\n				if (uBgMode == 1) { radiance += uBgColor; gAlbedo = uBgColor; }\n				else if (uBgMode == 2) { alphaOut = 0.0; gAlbedo = vec3(0.0); }\n				else {\n					vec3 background = backgroundRadiance(rd);\n					radiance += background + sun;\n					gAlbedo = background;\n				}\n				gNormal = -rd;\n			} else {\n				float we = specularPath ? 1.0 : powerHeuristic(lastPdf, envPdfDir(rd));\n				float ws = specularPath ? 1.0 : powerHeuristic(lastPdf, sunPdfFor(rd));\n				radiance += beta * (env * we + sun * ws);\n			}\n			break;\n		}\n\n		Surface s = getSurface(hit, ro, rd);\n\n		bool passThrough = false;\n		if (s.amode == 1) passThrough = s.alpha < s.cutoff;\n		else if (s.amode == 2) passThrough = rnd() >= s.alpha;\n		if (passThrough) {\n			ro = s.pos + rd * RAY_EPS;\n			continue;\n		}\n\n		if (bounce == 0 && hit.tri == -2 && uGroundCatcher == 1) {\n			alphaOut = shadowCatcherAlpha(s.pos, s.ng);\n			gAlbedo = vec3(0.0);\n			gNormal = s.ng;\n			gDepth = hit.t;\n			break;\n		}\n\n		if (!gWritten) {\n			gAlbedo = s.albedo;\n			gNormal = s.ns;\n			gDepth = hit.t;\n			gWritten = true;\n		}\n\n		if (dot(s.emission, s.emission) > 0.0) {\n			float w = 1.0;\n			if (!specularPath && s.isLight) {\n				w = powerHeuristic(lastPdf, triLightPdf(hit.tri, prevPos, s.pos));\n			}\n			radiance += beta * s.emission * w;\n		}\n\n		if (bounce >= uMaxBounce) break;\n\n		vec3 V = -rd;\n\n		if (s.transm > 0.0 && rnd() < s.transm) {\n			bool entering = dot(rd, s.ng) < 0.0;\n			vec3 n = s.ng;\n			float eta = entering ? (1.0 / s.ior) : s.ior;\n			float cosI = clamp(dot(-rd, n), 0.0, 1.0);\n			float F = fresnelDielectric(cosI, eta);\n			vec3 newDir;\n			if (rnd() < F) {\n				newDir = reflect(rd, n);\n			} else {\n				newDir = refract(rd, n, eta);\n				if (dot(newDir, newDir) < 1e-8) newDir = reflect(rd, n);\n				else beta *= s.albedo;\n			}\n			ro = s.pos + newDir * RAY_EPS;\n			rd = normalize(newDir);\n			specularPath = true;\n			bounce++;\n			continue;\n		}\n\n		vec3 shadeOrigin = s.pos + s.ng * RAY_EPS;\n\n		int nLS = max(uLightSamples, 1);\n		float invLS = 1.0 / float(nLS);\n		for (int ls_i = 0; ls_i < nLS; ls_i++) {\n			vec3 L;\n			float pdfL;\n			vec3 Le = envSampleDir(L, pdfL);\n			if (pdfL > 1e-8 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0 && dot(Le, Le) > 0.0) {\n				float pdfB;\n				vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);\n				if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {\n					radiance += beta * f * Le * powerHeuristic(pdfL, pdfB) / pdfL * invLS;\n				}\n			}\n		}\n\n		if (uSunEnable == 1) {\n			for (int ls_i = 0; ls_i < nLS; ls_i++) {\n				float pdfL;\n				vec3 L = sunSampleDir(pdfL);\n				if (pdfL > 0.0 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0) {\n					float pdfB;\n					vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);\n					if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {\n						radiance += beta * f * uSunRadiance * powerHeuristic(pdfL, pdfB) / pdfL * invLS;\n					}\n				}\n			}\n		}\n\n		if (uLightCount > 0) {\n			for (int ls_i = 0; ls_i < nLS; ls_i++) {\n				LightSample ls = sampleTriLight(s.pos);\n				if (ls.pdf > 1e-8 && dot(ls.dir, s.ns) > 0.0 && dot(ls.dir, s.ng) > 0.0 && dot(ls.radiance, ls.radiance) > 0.0) {\n					float pdfB;\n					vec3 f = bsdfEval(s.ns, V, ls.dir, s.albedo, s.rough, s.metal, pdfB);\n					if (dot(f, f) > 0.0 && !occluded(shadeOrigin, ls.dir, ls.dist - RAY_EPS * 2.0, false)) {\n						radiance += beta * f * ls.radiance * powerHeuristic(ls.pdf, pdfB) / ls.pdf * invLS;\n					}\n				}\n			}\n		}\n\n		vec3 L, weight;\n		float pdfB;\n		if (!bsdfSample(s.ns, V, s.albedo, s.rough, s.metal, L, weight, pdfB)) break;\n		if (dot(L, s.ng) <= 0.0) break;\n\n		beta *= weight;\n		lastPdf = pdfB;\n		specularPath = false;\n		prevPos = s.pos;\n		ro = shadeOrigin;\n		rd = L;\n		bounce++;\n\n		if (bounce > 2) {\n			float q = clamp(max(beta.r, max(beta.g, beta.b)), 0.02, 0.95);\n			if (rnd() > q) break;\n			beta /= q;\n		}\n		if (dot(beta, beta) < 1e-12) break;\n	}\n\n	if (uClamp > 0.0) {\n		float m = max(radiance.r, max(radiance.g, radiance.b));\n		if (m > uClamp) radiance *= uClamp / m;\n	}\n	if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);\n	return radiance;\n}\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	ivec2 imagePx = px + ivec2(uTileOrigin);\n	g_rng = uint(imagePx.x) * 1973u + uint(imagePx.y) * 9277u + uint(uSeed) * 26699u;\n	g_rng = g_rng | 1u;\n	pcgNext();\n	pcgNext();\n\n	vec2 jitter = rnd2();\n	vec2 ndc = ((gl_FragCoord.xy + uTileOrigin - 0.5 + jitter) / uResolution) * 2.0 - 1.0;\n\n	vec3 ro, rd;\n	if (uOrtho == 1) {\n		ro = uCamPos + uCamRight * (ndc.x * uOrthoHalfHeight * uAspect) + uCamUp * (ndc.y * uOrthoHalfHeight);\n		rd = normalize(uCamForward);\n	} else {\n		rd = normalize(uCamForward + uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov));\n		ro = uCamPos;\n		if (uAperture > 0.0 && uFocusDist > 0.0) {\n			vec3 focal = ro + rd * (uFocusDist / max(dot(rd, normalize(uCamForward)), 1e-4));\n			float ang = 2.0 * PI * rnd();\n			float rad = uAperture * sqrt(rnd());\n			ro += uCamRight * (cos(ang) * rad) + uCamUp * (sin(ang) * rad);\n			rd = normalize(focal - ro);\n		}\n	}\n\n	float alpha, depth;\n	vec3 alb, nrm;\n	vec3 c = tracePath(ro, rd, alpha, alb, nrm, depth);\n	if (uFogMode != 0 && depth < 1.0e6 && alpha > 0.0) {\n		float fog = uFogMode == 1\n			? clamp((depth - uFogNear) / max(uFogFar - uFogNear, 1.0e-6), 0.0, 1.0)\n			: 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);\n		c = mix(c, uFogColor, fog);\n		alb = mix(alb, uFogColor, fog);\n	}\n#ifndef PTR_COLOR_ONLY\n	vec3 demod = c / max(alb, vec3(0.02));\n	float l = dot(demod, vec3(0.2126, 0.7152, 0.0722));\n#endif\n\n	vec4 prev = vec4(0.0);\n#ifndef PTR_COLOR_ONLY\n	vec4 prevA = vec4(0.0);\n	vec4 prevN = vec4(0.0);\n	vec4 prevM = vec4(0.0);\n#endif\n	if (uReset == 0) {\n		prev = texelFetch(uAccum, px, 0);\n#ifndef PTR_COLOR_ONLY\n		prevA = texelFetch(uAccumAlb, px, 0);\n		prevN = texelFetch(uAccumNrm, px, 0);\n		prevM = texelFetch(uAccumMom, px, 0);\n#endif\n	}\n	outColor = prev + vec4(c, alpha);\n#ifndef PTR_COLOR_ONLY\n	outAlbedo = prevA + vec4(alb, 1.0);\n	outNormal = prevN + vec4(nrm, 1.0);\n	outMoment = prevM + vec4(l, l * l, depth, 1.0);\n#endif\n}\n";

  // plugins/georenderer/src/shaders/denoise.frag.glsl
  var denoise_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uColorIn;\nuniform sampler2D uAlbedoTex;\nuniform sampler2D uNormalTex;\nuniform sampler2D uMomentTex;\nuniform sampler2D uVarianceIn;\nuniform int   uFirst;\nuniform float uInvSpp;\nuniform int   uStepSize;\nuniform float uPhiColorBase;\nuniform float uPhiNormal;\nuniform float uPhiDepth;\n\nlayout(location = 0) out vec4 fragColor;\nlayout(location = 1) out float outVariance;\n\nvec3 loadColor(ivec2 p, ivec2 size) {\n	p = clamp(p, ivec2(0), size - 1);\n	if (uFirst == 1) {\n		vec3 c = texelFetch(uColorIn, p, 0).rgb * uInvSpp;\n		vec3 a = max(texelFetch(uAlbedoTex, p, 0).rgb * uInvSpp, vec3(0.02));\n		return c / a;\n	}\n	return texelFetch(uColorIn, p, 0).rgb;\n}\n\nfloat loadVariance(ivec2 p, ivec2 size) {\n	p = clamp(p, ivec2(0), size - 1);\n	if (uFirst == 1) {\n		vec4 m = texelFetch(uMomentTex, p, 0) * uInvSpp;\n		float perSample = max(m.y - m.x * m.x, 0.0);\n		return perSample * uInvSpp;\n	}\n	return texelFetch(uVarianceIn, p, 0).r;\n}\n\nfloat loadDepth(ivec2 p, ivec2 size) {\n	p = clamp(p, ivec2(0), size - 1);\n	vec4 m = texelFetch(uMomentTex, p, 0);\n	return m.w > 0.0 ? m.z / m.w : 1.0e6;\n}\n\nfloat kern(int d) {\n	int i = d < 0 ? -d : d;\n	if (i == 2) return 0.0625;\n	if (i == 1) return 0.25;\n	return 0.375;\n}\n\nvoid main() {\n	ivec2 size = textureSize(uColorIn, 0);\n	ivec2 px = ivec2(gl_FragCoord.xy);\n\n	vec3 cp = loadColor(px, size);\n	float varP = loadVariance(px, size);\n	float depthP = loadDepth(px, size);\n	// Preserve background texture detail instead of smoothing it with the model denoiser.\n	if (depthP >= 999999.0) {\n		fragColor = vec4(cp, 1.0);\n		outVariance = varP;\n		return;\n	}\n	vec3 np = texelFetch(uNormalTex, px, 0).xyz;\n	vec3 ap = texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp;\n	float nl = length(np);\n	np = nl > 1e-6 ? np / nl : vec3(0.0, 1.0, 0.0);\n\n	float phiColor = uPhiColorBase * sqrt(max(varP, 0.0)) + 1e-4;\n\n	vec3 sum = vec3(0.0);\n	float wsum = 0.0;\n	float varSum = 0.0;\n	float varWsum = 0.0;\n	for (int dy = -2; dy <= 2; dy++) {\n		for (int dx = -2; dx <= 2; dx++) {\n			ivec2 q = px + ivec2(dx, dy) * uStepSize;\n			if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;\n			vec3 cq = loadColor(q, size);\n			float varQ = loadVariance(q, size);\n			float depthQ = loadDepth(q, size);\n			vec3 nq = texelFetch(uNormalTex, q, 0).xyz;\n			vec3 aq = texelFetch(uAlbedoTex, q, 0).rgb * uInvSpp;\n			float ql = length(nq);\n			nq = ql > 1e-6 ? nq / ql : vec3(0.0, 1.0, 0.0);\n\n			vec3 dc = cp - cq;\n			float wc = exp(-dot(dc, dc) / (phiColor * phiColor));\n			float nd = max(0.0, 1.0 - dot(np, nq));\n			float wn = exp(-nd * nd / max(uPhiNormal, 1e-5));\n			float dd = abs(depthP - depthQ);\n			float wd = (depthP > 1.0e5 || depthQ > 1.0e5) ? (dd < 1.0 ? 1.0 : 0.0)\n				: exp(-dd * dd / max(uPhiDepth * depthP * depthP + 1e-6, 1e-6));\n			// Material texture edges must remain boundaries even at high denoise strength.\n			vec3 da = ap - aq;\n			float wa = exp(-dot(da, da) / 0.0025);\n			float w = kern(dx) * kern(dy) * wc * wn * wd * wa;\n			sum += cq * w;\n			wsum += w;\n			varSum += varQ * w * w;\n			varWsum += w;\n		}\n	}\n	fragColor = vec4(wsum > 1e-8 ? sum / wsum : cp, 1.0);\n	outVariance = varWsum > 1e-8 ? varSum / (varWsum * varWsum) : varP;\n}\n";

  // plugins/georenderer/src/shaders/composite.frag.glsl
  var composite_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uAccumTex;\nuniform sampler2D uDenoisedTex;\nuniform sampler2D uAlbedoTex;\nuniform float uInvSpp;\nuniform int   uUseDenoise;\nuniform float uExposure;\n\nout vec4 fragColor;\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	vec4 acc = texelFetch(uAccumTex, px, 0);\n	vec3 color;\n	if (uUseDenoise == 1) {\n		vec3 alb = max(texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp, vec3(0.02));\n		color = texelFetch(uDenoisedTex, px, 0).rgb * alb;\n	} else {\n		color = acc.rgb * uInvSpp;\n	}\n	float alpha = clamp(acc.a * uInvSpp, 0.0, 1.0);\n	color = max(color, vec3(0.0)) * uExposure;\n	fragColor = vec4(color, alpha);\n}\n";

  // plugins/georenderer/src/shaders/bloom-bright.frag.glsl
  var bloom_bright_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uHDR;\nuniform float uThreshold;\n\nout vec4 fragColor;\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	vec3 c = texelFetch(uHDR, px, 0).rgb;\n	fragColor = vec4(max(c - vec3(uThreshold), 0.0), 1.0);\n}\n";

  // plugins/georenderer/src/shaders/bloom-blur.frag.glsl
  var bloom_blur_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uTex;\nuniform vec2 uDir;\nuniform float uRadius;\n\nout vec4 fragColor;\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	ivec2 size = textureSize(uTex, 0);\n	float sigma = max(uRadius, 0.5);\n	float step = max(sigma / 4.0, 1.0);\n	vec3 sum = vec3(0.0);\n	float wsum = 0.0;\n	for (int i = -8; i <= 8; i++) {\n		float fi = float(i);\n		float w = exp(-(fi * fi) / (2.0 * sigma * sigma));\n		ivec2 q = px + ivec2(uDir * fi * step);\n		q = clamp(q, ivec2(0), size - 1);\n		sum += texelFetch(uTex, q, 0).rgb * w;\n		wsum += w;\n	}\n	fragColor = vec4(wsum > 1e-6 ? sum / wsum : vec3(0.0), 1.0);\n}\n";

  // plugins/georenderer/src/shaders/tonemap.frag.glsl
  var tonemap_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uHDR;\nuniform sampler2D uBloomTex;\nuniform int   uUseBloom;\nuniform float uBloomIntensity;\nuniform float uContrast;\nuniform float uSaturation;\nuniform int   uToneMap;\nuniform int   uVignetteEnable;\nuniform float uVignetteStrength;\nuniform vec2  uResolution;\nuniform vec2  uTileOrigin;\n\nout vec4 fragColor;\n\nvec3 tmReinhard(vec3 c) { return c / (1.0 + c); }\n\nvec3 tmACES(vec3 x) {\n	const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;\n	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);\n}\n\nvec3 uncharted2(vec3 x) {\n	const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;\n	return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;\n}\nvec3 tmFilmic(vec3 c) {\n	vec3 w = uncharted2(vec3(11.2));\n	return clamp(uncharted2(c * 2.0) / w, 0.0, 1.0);\n}\n\nvec3 tmAgX(vec3 c) {\n	c = max(c, vec3(0.0));\n	const mat3 inSet = mat3(\n		0.842479062253094, 0.0423282422610123, 0.0423756549057051,\n		0.0784335999999992, 0.878468636469772, 0.0784336000000000,\n		0.0792237451477643, 0.0791661274605434, 0.879142973793104);\n	const mat3 outSet = mat3(\n		1.19687900512017, -0.0528968517574562, -0.0529716355144438,\n		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,\n		-0.0990297440797205, -0.0989611768448433, 1.15107367264116);\n	c = inSet * c;\n	c = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / (12.47393 + 4.026069), 0.0, 1.0);\n	vec3 x = c;\n	vec3 x2 = x * x;\n	vec3 x4 = x2 * x2;\n	c = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;\n	c = outSet * c;\n	return clamp(c, 0.0, 1.0);\n}\n\nvec3 linearToSRGB(vec3 c) {\n	c = clamp(c, 0.0, 1.0);\n	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));\n}\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	vec4 hdr = texelFetch(uHDR, px, 0);\n	vec3 color = hdr.rgb;\n	if (uUseBloom == 1) color += texelFetch(uBloomTex, px, 0).rgb * uBloomIntensity;\n\n	if (uToneMap == 1) color = tmReinhard(color);\n	else if (uToneMap == 2) color = tmACES(color);\n	else if (uToneMap == 3) color = tmFilmic(color);\n	else if (uToneMap == 4) color = tmAgX(color);\n	else color = clamp(color, 0.0, 1.0);\n\n	float l = dot(color, vec3(0.2126, 0.7152, 0.0722));\n	color = mix(vec3(l), color, uSaturation);\n	color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);\n\n	if (uVignetteEnable == 1) {\n		vec2 uv = ((gl_FragCoord.xy + uTileOrigin) / uResolution) * 2.0 - 1.0;\n		float d = clamp(dot(uv, uv) * 0.5, 0.0, 1.0);\n		color *= clamp(1.0 - uVignetteStrength * d, 0.0, 1.0);\n	}\n\n	fragColor = vec4(linearToSRGB(color), hdr.a);\n}\n";

  // plugins/georenderer/src/shaders/final.frag.glsl
  var final_frag_default = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nuniform sampler2D uTex;\nuniform int   uSharpenEnable;\nuniform float uSharpenStrength;\nuniform int   uGrainEnable;\nuniform float uGrainStrength;\nuniform float uGrainSeed;\nuniform vec2 uTileOrigin;\n\nout vec4 fragColor;\n\nfloat hash(vec2 p) {\n	vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n	p3 += dot(p3, p3.yzx + 33.33);\n	return fract((p3.x + p3.y) * p3.z);\n}\n\nvoid main() {\n	ivec2 px = ivec2(gl_FragCoord.xy);\n	vec4 c = texelFetch(uTex, px, 0);\n	vec3 color = c.rgb;\n\n	if (uSharpenEnable == 1) {\n		ivec2 last = textureSize(uTex, 0) - 1;\n		vec3 n = texelFetch(uTex, clamp(px + ivec2(0, 1), ivec2(0), last), 0).rgb\n			+ texelFetch(uTex, clamp(px + ivec2(0, -1), ivec2(0), last), 0).rgb\n			+ texelFetch(uTex, clamp(px + ivec2(1, 0), ivec2(0), last), 0).rgb\n			+ texelFetch(uTex, clamp(px + ivec2(-1, 0), ivec2(0), last), 0).rgb;\n		vec3 lap = color * 4.0 - n;\n		color = clamp(color + uSharpenStrength * lap, 0.0, 1.0);\n	}\n\n	if (uGrainEnable == 1) {\n		float n = hash(gl_FragCoord.xy + uTileOrigin + uGrainSeed) - 0.5;\n		color = clamp(color + n * uGrainStrength, 0.0, 1.0);\n	}\n\n	fragColor = vec4(color, c.a);\n}\n";

  // plugins/georenderer/src/gpu/shaders.js
  var FS_PATHTRACE_COLOR_ONLY = pathtrace_frag_default.replace(
    "#version 300 es\n",
    "#version 300 es\n#define PTR_COLOR_ONLY 1\n"
  );

  // plugins/georenderer/src/gpu/webgl.js
  function compileShader(gl, type, source, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error("[PathTracer] shader compile failed: " + label + "\n" + log);
      console.error(source.split("\n").map((l, i) => i + 1 + ": " + l).join("\n"));
      gl.deleteShader(sh);
      throw new Error("Shader compile error (" + label + "): " + log);
    }
    return sh;
  }
  function createProgram(gl, vsSource, fsSource, label) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, label + ".vert");
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, label + ".frag");
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error("Program link error (" + label + "): " + log);
    }
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, "");
      uniforms[name] = gl.getUniformLocation(prog, name);
    }
    return { program: prog, uniforms };
  }
  function createDataTexture(gl, data, texelCount, width) {
    const w = width || DATA_TEX_WIDTH;
    const h = Math.max(1, Math.ceil(texelCount / w));
    const buf = new Float32Array(w * h * 4);
    if (data) buf.set(data.subarray(0, Math.min(data.length, buf.length)));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, buf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture: tex, width: w, height: h };
  }
  function createR32FTexture(gl, data, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  function createAtlasTexture(gl, pixels, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  function createEnvTexture(gl, data, w, h, mipmaps = false) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  function createRenderTexture(gl, w, h, internalFormat) {
    const tex = gl.createTexture();
    if (!tex) throw new Error("GPU 无法分配渲染纹理");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fmt = internalFormat || gl.RGBA32F;
    const uploadFormat = fmt === gl.R32F ? gl.RED : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, uploadFormat, fmt === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.FLOAT, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      gl.deleteTexture(tex);
      throw new Error("GPU 渲染缓冲分配失败（0x" + error.toString(16) + "），请降低预览比例或输出尺寸");
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  function createFBO(gl, attachments) {
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("GPU 无法分配渲染帧缓冲");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const bufs = [];
    attachments.forEach((tex, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.drawBuffers(bufs);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      throw new Error("Framebuffer incomplete: 0x" + status.toString(16));
    }
    return fbo;
  }

  // plugins/georenderer/src/gpu/render-buffers.js
  var RenderBuffers = class {
    constructor(gl, width, height) {
      this.gl = gl;
      this.width = width;
      this.height = height;
      this.groups = /* @__PURE__ */ new Map();
      try {
        const group = this.group("base");
        const makeSet = () => ({
          color: this.texture(gl.RGBA32F, group),
          albedo: this.texture(gl.RGBA32F, group),
          normal: this.texture(gl.RGBA32F, group),
          moment: this.texture(gl.RGBA32F, group)
        });
        this.a = makeSet();
        this.b = makeSet();
        this.fboA = this.framebuffer(Object.values(this.a), group);
        this.fboB = this.framebuffer(Object.values(this.b), group);
        this.fboColorA = this.framebuffer([this.a.color], group);
        this.fboColorB = this.framebuffer([this.b.color], group);
        this.hdr = this.texture(gl.RGBA16F, group);
        this.tonemapOut = this.texture(gl.RGBA8, group);
        this.fboHDR = this.framebuffer([this.hdr], group);
        this.fboTonemap = this.framebuffer([this.tonemapOut], group);
      } catch (err) {
        this.dispose();
        throw err;
      }
    }
    group(name) {
      const group = { textures: [], framebuffers: [], bytes: 0 };
      this.groups.set(name, group);
      return group;
    }
    texture(format, group) {
      const texture = createRenderTexture(this.gl, this.width, this.height, format);
      group.textures.push(texture);
      const bytes = format === this.gl.RGBA32F ? 16 : format === this.gl.RGBA16F ? 8 : 4;
      group.bytes += this.width * this.height * bytes;
      return texture;
    }
    framebuffer(attachments, group) {
      const framebuffer = createFBO(this.gl, attachments);
      group.framebuffers.push(framebuffer);
      return framebuffer;
    }
    syncEffects(denoise, bloom) {
      for (const [name, enabled] of [["denoise", denoise], ["bloom", bloom]]) {
        if (!enabled) {
          this.disposeGroup(name);
          continue;
        }
        if (this.groups.has(name)) continue;
        const group = this.group(name);
        try {
          const gl = this.gl;
          if (name === "denoise") {
            this.d0 = this.texture(gl.RGBA16F, group);
            this.d1 = this.texture(gl.RGBA16F, group);
            this.v0 = this.texture(gl.R32F, group);
            this.v1 = this.texture(gl.R32F, group);
            this.fboD0 = this.framebuffer([this.d0, this.v0], group);
            this.fboD1 = this.framebuffer([this.d1, this.v1], group);
          } else {
            this.bloomA = this.texture(gl.RGBA16F, group);
            this.bloomB = this.texture(gl.RGBA16F, group);
            this.fboBloomA = this.framebuffer([this.bloomA], group);
            this.fboBloomB = this.framebuffer([this.bloomB], group);
          }
        } catch (err) {
          this.disposeGroup(name);
          throw err;
        }
      }
    }
    get byteLength() {
      return [...this.groups.values()].reduce((sum, group) => sum + group.bytes, 0);
    }
    disposeGroup(name) {
      const group = this.groups.get(name);
      if (!group) return;
      for (const framebuffer of group.framebuffers) this.gl.deleteFramebuffer(framebuffer);
      for (const texture of group.textures) this.gl.deleteTexture(texture);
      this.groups.delete(name);
    }
    dispose() {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      for (const name of this.groups.keys()) this.disposeGroup(name);
    }
  };

  // plugins/georenderer/src/scene/bvh.js
  function buildBVH(positions, triCount) {
    if (triCount === 0) {
      const nodes2 = new Float32Array(8);
      nodes2[3] = 0;
      nodes2[7] = 0;
      return { nodes: nodes2, nodeCount: 1, order: new Uint32Array(0) };
    }
    const bmin = new Float32Array(triCount * 3);
    const bmax = new Float32Array(triCount * 3);
    const cent = new Float32Array(triCount * 3);
    for (let i = 0; i < triCount; i++) {
      const o = i * 9;
      for (let a = 0; a < 3; a++) {
        const p0 = positions[o + a], p1 = positions[o + 3 + a], p2 = positions[o + 6 + a];
        const lo = Math.min(p0, p1, p2), hi = Math.max(p0, p1, p2);
        bmin[i * 3 + a] = lo;
        bmax[i * 3 + a] = hi;
        cent[i * 3 + a] = (lo + hi) * 0.5;
      }
    }
    const order = new Uint32Array(triCount);
    for (let i = 0; i < triCount; i++) order[i] = i;
    const maxNodes = Math.max(4, triCount * 2);
    const nodes = new Float32Array(maxNodes * 8);
    let nodeCount = 1;
    const stack = [[0, 0, triCount]];
    const tmp = new Uint32Array(triCount);
    while (stack.length) {
      const [nodeIdx, start, count] = stack.pop();
      let nx = Infinity, ny = Infinity, nz = Infinity;
      let xx = -Infinity, xy = -Infinity, xz = -Infinity;
      let cnx = Infinity, cny = Infinity, cnz = Infinity;
      let cxx = -Infinity, cxy = -Infinity, cxz = -Infinity;
      for (let i = start; i < start + count; i++) {
        const t = order[i], t3 = t * 3;
        if (bmin[t3] < nx) nx = bmin[t3];
        if (bmin[t3 + 1] < ny) ny = bmin[t3 + 1];
        if (bmin[t3 + 2] < nz) nz = bmin[t3 + 2];
        if (bmax[t3] > xx) xx = bmax[t3];
        if (bmax[t3 + 1] > xy) xy = bmax[t3 + 1];
        if (bmax[t3 + 2] > xz) xz = bmax[t3 + 2];
        if (cent[t3] < cnx) cnx = cent[t3];
        if (cent[t3 + 1] < cny) cny = cent[t3 + 1];
        if (cent[t3 + 2] < cnz) cnz = cent[t3 + 2];
        if (cent[t3] > cxx) cxx = cent[t3];
        if (cent[t3 + 1] > cxy) cxy = cent[t3 + 1];
        if (cent[t3 + 2] > cxz) cxz = cent[t3 + 2];
      }
      const no = nodeIdx * 8;
      nodes[no] = nx;
      nodes[no + 1] = ny;
      nodes[no + 2] = nz;
      nodes[no + 4] = xx;
      nodes[no + 5] = xy;
      nodes[no + 6] = xz;
      const makeLeaf = () => {
        nodes[no + 3] = start;
        nodes[no + 7] = count;
      };
      if (count <= 2) {
        makeLeaf();
        continue;
      }
      const ext = [cxx - cnx, cxy - cny, cxz - cnz];
      let axis = 0;
      if (ext[1] > ext[axis]) axis = 1;
      if (ext[2] > ext[axis]) axis = 2;
      if (ext[axis] < 1e-9) {
        makeLeaf();
        continue;
      }
      const cMin = [cnx, cny, cnz][axis];
      const scale = SAH_BINS / ext[axis];
      const binCount = new Int32Array(SAH_BINS);
      const binBounds = new Float32Array(SAH_BINS * 6);
      for (let b = 0; b < SAH_BINS; b++) {
        binBounds[b * 6] = binBounds[b * 6 + 1] = binBounds[b * 6 + 2] = Infinity;
        binBounds[b * 6 + 3] = binBounds[b * 6 + 4] = binBounds[b * 6 + 5] = -Infinity;
      }
      for (let i = start; i < start + count; i++) {
        const t = order[i], t3 = t * 3;
        let b = Math.floor((cent[t3 + axis] - cMin) * scale);
        if (b < 0) b = 0;
        else if (b >= SAH_BINS) b = SAH_BINS - 1;
        binCount[b]++;
        const bo = b * 6;
        for (let a = 0; a < 3; a++) {
          if (bmin[t3 + a] < binBounds[bo + a]) binBounds[bo + a] = bmin[t3 + a];
          if (bmax[t3 + a] > binBounds[bo + 3 + a]) binBounds[bo + 3 + a] = bmax[t3 + a];
        }
      }
      const leftArea = new Float32Array(SAH_BINS);
      const leftCount = new Int32Array(SAH_BINS);
      let al = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let acc = 0;
      for (let b = 0; b < SAH_BINS; b++) {
        if (binCount[b] > 0) {
          const bo = b * 6;
          for (let a = 0; a < 3; a++) {
            if (binBounds[bo + a] < al[a]) al[a] = binBounds[bo + a];
            if (binBounds[bo + 3 + a] > al[3 + a]) al[3 + a] = binBounds[bo + 3 + a];
          }
        }
        acc += binCount[b];
        leftCount[b] = acc;
        leftArea[b] = surfaceArea(al);
      }
      let bestCost = Infinity, bestBin = -1;
      let ar = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let accR = 0;
      for (let b = SAH_BINS - 1; b > 0; b--) {
        if (binCount[b] > 0) {
          const bo = b * 6;
          for (let a = 0; a < 3; a++) {
            if (binBounds[bo + a] < ar[a]) ar[a] = binBounds[bo + a];
            if (binBounds[bo + 3 + a] > ar[3 + a]) ar[3 + a] = binBounds[bo + 3 + a];
          }
        }
        accR += binCount[b];
        const lc = leftCount[b - 1], rc = accR;
        if (lc === 0 || rc === 0) continue;
        const cost = leftArea[b - 1] * lc + surfaceArea(ar) * rc;
        if (cost < bestCost) {
          bestCost = cost;
          bestBin = b;
        }
      }
      const parentArea = surfaceArea([nx, ny, nz, xx, xy, xz]);
      const leafCost = parentArea * count;
      if (bestBin < 0 || bestCost >= leafCost && count <= MAX_LEAF_TRIS) {
        makeLeaf();
        continue;
      }
      let w = 0;
      for (let i = start; i < start + count; i++) {
        const t = order[i];
        let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
        if (b < 0) b = 0;
        else if (b >= SAH_BINS) b = SAH_BINS - 1;
        if (b < bestBin) tmp[w++] = t;
      }
      const leftN = w;
      for (let i = start; i < start + count; i++) {
        const t = order[i];
        let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
        if (b < 0) b = 0;
        else if (b >= SAH_BINS) b = SAH_BINS - 1;
        if (b >= bestBin) tmp[w++] = t;
      }
      for (let i = 0; i < count; i++) order[start + i] = tmp[i];
      if (leftN === 0 || leftN === count) {
        makeLeaf();
        continue;
      }
      const leftIdx = nodeCount;
      const rightIdx = nodeCount + 1;
      nodeCount += 2;
      if (rightIdx * 8 + 8 > nodes.length) {
        makeLeaf();
        nodeCount -= 2;
        continue;
      }
      nodes[no + 3] = leftIdx;
      nodes[no + 7] = 0;
      stack.push([rightIdx, start + leftN, count - leftN]);
      stack.push([leftIdx, start, leftN]);
    }
    return { nodes, nodeCount, order };
  }
  function surfaceArea(b) {
    const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
    if (dx < 0 || dy < 0 || dz < 0) return 0;
    return 2 * (dx * dy + dy * dz + dz * dx);
  }

  // plugins/georenderer/src/scene/environment.js
  function parseHDR(buffer) {
    const bytes = new Uint8Array(buffer);
    let pos = 0;
    function readLine() {
      let line2 = "";
      while (pos < bytes.length) {
        const c = bytes[pos++];
        if (c === 10) break;
        line2 += String.fromCharCode(c);
      }
      return line2;
    }
    const magic = readLine();
    if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error("不是有效的 Radiance HDR 文件");
    let line;
    while ((line = readLine()).length > 0) {
    }
    const dims = readLine().trim().match(/^-Y\s+(\d+)\s+\+X\s+(\d+)$/);
    if (!dims) throw new Error("不支持的 HDR 扫描线顺序（仅支持 -Y +X）");
    const height = parseInt(dims[1], 10);
    const width = parseInt(dims[2], 10);
    const rgbe = new Uint8Array(width * height * 4);
    const scanline = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
      if (pos + 4 > bytes.length) throw new Error("HDR 数据意外结束");
      const b0 = bytes[pos], b1 = bytes[pos + 1], b2 = bytes[pos + 2], b3 = bytes[pos + 3];
      const isRLE = b0 === 2 && b1 === 2 && (b2 << 8 | b3) === width && width >= 8 && width < 32768;
      if (!isRLE) {
        for (let x = 0; x < width; x++) {
          const o = (y * width + x) * 4;
          rgbe[o] = bytes[pos++];
          rgbe[o + 1] = bytes[pos++];
          rgbe[o + 2] = bytes[pos++];
          rgbe[o + 3] = bytes[pos++];
        }
        continue;
      }
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let count = bytes[pos++];
          if (count > 128) {
            count -= 128;
            const value = bytes[pos++];
            for (let i = 0; i < count; i++) scanline[x++ * 4 + c] = value;
          } else {
            for (let i = 0; i < count; i++) scanline[x++ * 4 + c] = bytes[pos++];
          }
        }
      }
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        rgbe[o] = scanline[x * 4];
        rgbe[o + 1] = scanline[x * 4 + 1];
        rgbe[o + 2] = scanline[x * 4 + 2];
        rgbe[o + 3] = scanline[x * 4 + 3];
      }
    }
    const data = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const e = rgbe[i * 4 + 3];
      const scale = e ? Math.pow(2, e - 136) : 0;
      data[i * 4] = rgbe[i * 4] * scale;
      data[i * 4 + 1] = rgbe[i * 4 + 1] * scale;
      data[i * 4 + 2] = rgbe[i * 4 + 2] * scale;
      data[i * 4 + 3] = 1;
    }
    return { width, height, data };
  }
  function resampleEquirect(src, w, h) {
    const out = new Float32Array(w * h * 4);
    const sw = src.width, sh = src.height;
    for (let y = 0; y < h; y++) {
      const sy = (y + 0.5) / h * sh - 0.5;
      const y0 = Math.floor(sy);
      const fy = sy - y0;
      const ya = clamp(y0, 0, sh - 1), yb = clamp(y0 + 1, 0, sh - 1);
      for (let x = 0; x < w; x++) {
        const sx = (x + 0.5) / w * sw - 0.5;
        const x0 = Math.floor(sx);
        const fx = sx - x0;
        const xa = (x0 % sw + sw) % sw, xb = ((x0 + 1) % sw + sw) % sw;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v00 = src.data[(ya * sw + xa) * 4 + c];
          const v10 = src.data[(ya * sw + xb) * 4 + c];
          const v01 = src.data[(yb * sw + xa) * 4 + c];
          const v11 = src.data[(yb * sw + xb) * 4 + c];
          out[o + c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
        }
        out[o + 3] = 1;
      }
    }
    for (let i = 0; i < out.length; i++) if (out[i] > 6e4) out[i] = 6e4;
    return out;
  }
  function generateSkyPixels(settings2, w = ENV_W, h = ENV_H) {
    const out = new Float32Array(w * h * 4);
    const mode = settings2.env_mode;
    const zen = hexToLinear(settings2.sky_zenith);
    const hor = hexToLinear(settings2.sky_horizon);
    const gnd = hexToLinear(settings2.sky_ground);
    const gTop = hexToLinear(settings2.grad_top);
    const gBot = hexToLinear(settings2.grad_bottom);
    const solid = hexToLinear(settings2.solid_color);
    const sunCol = hexToLinear(settings2.sun_color);
    const haze = clamp(settings2.sky_haze, 0, 1);
    const sun = sunDirection(settings2);
    const glowPower = 8 + 260 * (1 - haze);
    const glowStrength = 0.35 + 2.5 * haze;
    const daylight = clamp((Math.sin(((settings2.time_of_day ?? 12) - 6) * Math.PI / 12) + 0.2) / 1.2, 0, 1);
    const skyExposure = mode === "sky" ? 0.08 + daylight * 0.92 : 1;
    for (let y = 0; y < h; y++) {
      const theta = (y + 0.5) / h * Math.PI;
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      for (let x = 0; x < w; x++) {
        const phi = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
        const dx = sinT * Math.cos(phi);
        const dy = cosT;
        const dz = sinT * Math.sin(phi);
        const o = (y * w + x) * 4;
        let r = 0, g = 0, b = 0;
        if (mode === "solid") {
          r = solid[0];
          g = solid[1];
          b = solid[2];
        } else if (mode === "gradient") {
          const t = clamp(dy * 0.5 + 0.5, 0, 1);
          r = gBot[0] + (gTop[0] - gBot[0]) * t;
          g = gBot[1] + (gTop[1] - gBot[1]) * t;
          b = gBot[2] + (gTop[2] - gBot[2]) * t;
        } else {
          if (dy >= 0) {
            const t = Math.pow(dy, 0.55);
            r = hor[0] + (zen[0] - hor[0]) * t;
            g = hor[1] + (zen[1] - hor[1]) * t;
            b = hor[2] + (zen[2] - hor[2]) * t;
          } else {
            const t = Math.pow(-dy, 0.4);
            r = hor[0] * 0.55 + (gnd[0] - hor[0] * 0.55) * t;
            g = hor[1] * 0.55 + (gnd[1] - hor[1] * 0.55) * t;
            b = hor[2] * 0.55 + (gnd[2] - hor[2] * 0.55) * t;
          }
          const cosA = dx * sun[0] + dy * sun[1] + dz * sun[2];
          if (cosA > 0 && settings2.sun_enable && settings2.sun_intensity > 0) {
            const glow = Math.pow(cosA, glowPower) * glowStrength;
            r += sunCol[0] * glow;
            g += sunCol[1] * glow;
            b += sunCol[2] * glow;
          }
        }
        out[o] = r * skyExposure;
        out[o + 1] = g * skyExposure;
        out[o + 2] = b * skyExposure;
        out[o + 3] = 1;
      }
    }
    return out;
  }
  function sunDirection(settings2) {
    const el2 = settings2.sun_elevation * Math.PI / 180;
    const az = settings2.sun_azimuth * Math.PI / 180;
    const ce = Math.cos(el2);
    return vNorm([ce * Math.cos(az), Math.sin(el2), ce * Math.sin(az)]);
  }
  function buildEnvDistribution(pixels, w, h) {
    const DW = ENV_DIST_W, DH = ENV_DIST_H;
    const bx = Math.max(1, Math.floor(w / DW));
    const by = Math.max(1, Math.floor(h / DH));
    const lum = new Float32Array(DW * DH);
    let total = 0;
    for (let y = 0; y < DH; y++) {
      const theta = (y + 0.5) / DH * Math.PI;
      const sinT = Math.max(Math.sin(theta), 1e-4);
      for (let x = 0; x < DW; x++) {
        let acc = 0, n = 0;
        for (let sy = 0; sy < by; sy++) {
          const py = Math.min(h - 1, y * by + sy);
          for (let sx = 0; sx < bx; sx++) {
            const px = Math.min(w - 1, x * bx + sx);
            const o = (py * w + px) * 4;
            acc += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
            n++;
          }
        }
        const v = acc / Math.max(n, 1) * sinT;
        lum[y * DW + x] = v;
        total += v;
      }
    }
    const mean = total / (DW * DH);
    const eps = Math.max(mean * 0.06, 1e-8);
    total = 0;
    for (let i = 0; i < lum.length; i++) {
      lum[i] += eps;
      total += lum[i];
    }
    if (total <= 0) {
      for (let i = 0; i < lum.length; i++) lum[i] = 1;
      total = lum.length;
    }
    const cond = new Float32Array((DW + 1) * DH);
    const rowSum = new Float32Array(DH);
    for (let y = 0; y < DH; y++) {
      let acc = 0;
      for (let x = 0; x < DW; x++) acc += lum[y * DW + x];
      rowSum[y] = acc;
      const base = y * (DW + 1);
      let run2 = 0;
      cond[base] = 0;
      for (let x = 0; x < DW; x++) {
        run2 += lum[y * DW + x];
        cond[base + x + 1] = acc > 0 ? run2 / acc : (x + 1) / DW;
      }
      cond[base + DW] = 1;
    }
    const marg = new Float32Array(DH + 1);
    let sum = 0;
    for (let y = 0; y < DH; y++) sum += rowSum[y];
    let run = 0;
    marg[0] = 0;
    for (let y = 0; y < DH; y++) {
      run += rowSum[y];
      marg[y + 1] = sum > 0 ? run / sum : (y + 1) / DH;
    }
    marg[DH] = 1;
    return { cond, marg, width: DW, height: DH };
  }

  // plugins/georenderer/src/scene/blockbench-scene.js
  var convertedCubemap = null;
  var convertedEnvironment = null;
  var linearByte = Float32Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
  var loadingScenes = /* @__PURE__ */ new WeakMap();
  var selectedSceneId = "";
  var sceneSelectionRequest = 0;
  var previewModelOverrides = {};
  function restoreBlockbenchPreviewModelOverrides(overrides) {
    previewModelOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
  }
  function setBlockbenchPreviewModelEnabled(id, enabled) {
    const model = typeof PreviewModel !== "undefined" ? PreviewModel.models?.[id] : null;
    const nativeEnabled = !!(model && PreviewModel.getActiveModels?.().includes(model));
    if (!!enabled === nativeEnabled) delete previewModelOverrides[id];
    else previewModelOverrides[id] = !!enabled;
    if (enabled && model && !model.enabled) model.update?.();
    return { ...previewModelOverrides };
  }
  function sceneOwnedModels() {
    return new Set(
      Object.values(typeof PreviewScene !== "undefined" ? PreviewScene.scenes || {} : {}).flatMap((item) => item.preview_models || [])
    );
  }
  function listBlockbenchPreviewModels() {
    const owned = sceneOwnedModels();
    const active = new Set(typeof PreviewModel !== "undefined" && PreviewModel.getActiveModels ? PreviewModel.getActiveModels() : []);
    return Object.values(typeof PreviewModel !== "undefined" ? PreviewModel.models || {} : {}).filter((model) => !model.internal && !owned.has(model) && model.model_3d?.isObject3D).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      enabled: Object.hasOwn(previewModelOverrides, model.id) ? !!previewModelOverrides[model.id] : active.has(model)
    }));
  }
  function getBlockbenchScene(id) {
    return typeof PreviewScene !== "undefined" ? PreviewScene.scenes?.[id] || null : null;
  }
  function restoreBlockbenchSceneSelection(id) {
    sceneSelectionRequest++;
    selectedSceneId = getBlockbenchScene(id)?.id || "";
    return activeBlockbenchScene();
  }
  async function prepareScene(scene, includeModels = true) {
    if (scene.require_minecraft_eula) {
      if (typeof MinecraftEULA === "undefined" || !await MinecraftEULA.promptUser("preview_scenes")) return false;
    }
    if (loadingScenes.has(scene)) {
      await loadingScenes.get(scene);
    } else if (!scene.loaded && scene.lazyLoadFromWeb) {
      const pending = scene.lazyLoadFromWeb();
      loadingScenes.set(scene, pending);
      try {
        await pending;
      } catch (err) {
        scene.loaded = false;
        throw err;
      } finally {
        loadingScenes.delete(scene);
      }
    }
    for (const model of includeModels ? scene.preview_models || [] : []) {
      if (!model.enabled) model.update?.();
    }
    return true;
  }
  function cubeFace(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) return x > 0 ? [0, -z / ax, -y / ax] : [1, z / ax, -y / ax];
    if (ay >= ax && ay >= az) return y > 0 ? [2, x / ay, z / ay] : [3, x / ay, -z / ay];
    return z > 0 ? [4, x / az, -y / az] : [5, -x / az, -y / az];
  }
  function cubemapToEquirect(cubemap, width, height) {
    const faces = cubemap && cubemap.image;
    if (!Array.isArray(faces) || faces.length !== 6) return null;
    const faceSize = Math.max(...faces.map((face) => (face?.image || face)?.width || 0));
    width = width || Math.min(MAX_ENV_IMAGE_SIZE, Math.max(512, 4 * faceSize));
    height = height || Math.round(width / 2);
    const faceData = Array.from({ length: 6 }, (_, index) => {
      const face = faces[index];
      const image = face && (face.image || face);
      if (!image || !image.width || !image.height) throw new Error("Blockbench 环境贴图尚未加载完成");
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    });
    const data = new Float32Array(width * height * 4);
    const longitudes = Array.from({ length: width }, (_, x) => {
      const longitude = 2 * Math.PI * ((x + 0.5) / width - 0.5);
      return [Math.cos(longitude), Math.sin(longitude)];
    });
    for (let y = 0; y < height; y++) {
      const latitude = Math.PI * (0.5 - (y + 0.5) / height);
      const cosLatitude = Math.cos(latitude), sinLatitude = Math.sin(latitude);
      for (let x = 0; x < width; x++) {
        const [index, u, v] = cubeFace(cosLatitude * longitudes[x][0], sinLatitude, cosLatitude * longitudes[x][1]);
        const face = faceData[index];
        const fx = Math.max(0, Math.min(face.width - 1, (u + 1) * 0.5 * face.width - 0.5));
        const fy = Math.max(0, Math.min(face.height - 1, (v + 1) * 0.5 * face.height - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(face.width - 1, x0 + 1), y1 = Math.min(face.height - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const p00 = (y0 * face.width + x0) * 4, p10 = (y0 * face.width + x1) * 4;
        const p01 = (y1 * face.width + x0) * 4, p11 = (y1 * face.width + x1) * 4;
        const destination = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const top = linearByte[face.data[p00 + channel]] * (1 - tx) + linearByte[face.data[p10 + channel]] * tx;
          const bottom = linearByte[face.data[p01 + channel]] * (1 - tx) + linearByte[face.data[p11 + channel]] * tx;
          data[destination + channel] = top * (1 - ty) + bottom * ty;
        }
        data[destination + 3] = 1;
      }
    }
    return { width, height, data };
  }
  function cubemapReady(cubemap) {
    const faces = cubemap?.image;
    return Array.isArray(faces) && faces.length === 6 && Array.from({ length: 6 }, (_, index) => faces[index]).every((face) => {
      const image = face?.image || face;
      return image && image.width > 0 && image.height > 0 && (!("complete" in image) || image.complete && image.naturalWidth > 0);
    });
  }
  async function waitForCubemap(cubemap, timeout = 15e3) {
    const deadline = Date.now() + timeout;
    while (!cubemapReady(cubemap)) {
      if (Date.now() >= deadline) throw new Error("Blockbench 场景立方体贴图加载超时");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function loadBlockbenchScene(id, { includeModels = true } = {}) {
    const scene = getBlockbenchScene(id);
    if (!scene) return null;
    if (!await prepareScene(scene, includeModels)) return null;
    if (!scene.cubemap) return { cubemap: null, environment: null };
    const cubemap = scene.cubemap;
    await waitForCubemap(cubemap);
    if (convertedCubemap !== cubemap) {
      convertedEnvironment = cubemapToEquirect(cubemap);
      convertedCubemap = cubemap;
    }
    return { cubemap, environment: convertedEnvironment };
  }
  function activeBlockbenchPreviewModels() {
    const scene = activeBlockbenchScene();
    const sceneModels = scene?.preview_models || [];
    const owned = sceneOwnedModels();
    const nativeActive = typeof PreviewModel !== "undefined" && PreviewModel.getActiveModels ? PreviewModel.getActiveModels().filter((model) => !owned.has(model)) : [];
    const independent = new Set(nativeActive);
    for (const model of Object.values(typeof PreviewModel !== "undefined" ? PreviewModel.models || {} : {})) {
      if (owned.has(model) || !Object.hasOwn(previewModelOverrides, model.id)) continue;
      if (previewModelOverrides[model.id]) independent.add(model);
      else independent.delete(model);
    }
    return [.../* @__PURE__ */ new Set([...sceneModels, ...independent])].filter((model) => model?.model_3d?.isObject3D);
  }
  function listBlockbenchScenes() {
    if (typeof PreviewScene === "undefined") return [];
    return Object.values(PreviewScene.scenes || {}).map((scene) => ({
      id: scene.id,
      name: scene.name || scene.id,
      category: scene.category || "other"
    }));
  }
  function activeBlockbenchScene() {
    return getBlockbenchScene(selectedSceneId);
  }
  async function selectBlockbenchScene(id) {
    const request = ++sceneSelectionRequest;
    if (!id) {
      selectedSceneId = "";
      return true;
    }
    const scene = getBlockbenchScene(id);
    if (!scene) return false;
    if (!await prepareScene(scene)) return false;
    if (request !== sceneSelectionRequest) return false;
    selectedSceneId = id;
    return true;
  }

  // plugins/georenderer/src/scene/group-overrides.js
  function groupChainForElement(element) {
    const chain = [];
    let parent = element && element.parent;
    while (parent && typeof parent === "object") {
      if (parent.uuid) chain.push(parent.uuid);
      parent = parent.parent;
    }
    return chain;
  }
  function materialKey(texture, groupChain = []) {
    return (texture ? texture.uuid : "__none__") + "|" + groupChain.join("/");
  }
  function resolveMaterialOverride(texture, groupChain, textureOverrides, groupOverrides) {
    const result = { ...texture && textureOverrides && textureOverrides[texture.uuid] || {} };
    for (let i = groupChain.length - 1; i >= 0; i--) {
      Object.assign(result, groupOverrides && groupOverrides[groupChain[i]] || {});
    }
    return result;
  }

  // plugins/georenderer/src/scene/geometry.js
  var MF_HAS_COLOR = 1;
  var MF_HAS_MER = 2;
  var MF_HAS_NORMAL = 4;
  var MF_FULLBRIGHT = 8;
  var MF_WRAP_REPEAT = 16;
  var MF_ADDITIVE = 32;
  var MF_HAS_EMISSIVE_MAP = 64;
  var MF_EMIS_MAIN_COLOR = 128;
  var MF_EMIS_CUSTOM_COLOR = 256;
  function getMaterialSide(tex, override) {
    if (override === "double") return "double";
    if (override === "front") return "front";
    try {
      if (tex && tex.render_sides === "front") return "front";
      if (tex && tex.render_sides === "double") return "double";
      const global = typeof settings !== "undefined" && settings.render_sides ? settings.render_sides.value : "auto";
      if (global === "front") return "front";
      if (global === "auto") {
        if (typeof Format !== "undefined" && Format && Format.render_sides) {
          const v = typeof Format.render_sides === "function" ? Format.render_sides() : Format.render_sides;
          if (v === "front") return "front";
          if (v === "back") return "back";
          if (v === "double") return "double";
        }
      }
    } catch (err) {
    }
    return "double";
  }
  function textureSource(tex) {
    if (!tex) return null;
    if (tex.canvas && tex.canvas.width > 1 && tex.canvas.height > 1) return tex.canvas;
    if (tex.img && tex.img.naturalWidth) return tex.img;
    return null;
  }
  function faceKeysPerTriangle(element, triCount) {
    try {
      if (element instanceof Cube) {
        const list = element.mesh && element.mesh.geometry && element.mesh.geometry.faces;
        if (list && list.length) {
          const out = new Array(triCount);
          for (let t = 0; t < triCount; t++) out[t] = list[Math.floor(t / 2)];
          return out;
        }
        const keys = [];
        (Canvas.face_order || ["east", "west", "up", "down", "south", "north"]).forEach((fkey) => {
          if (element.faces[fkey] && element.faces[fkey].texture !== null) {
            keys.push(fkey, fkey);
          }
        });
        return keys;
      }
      if (typeof Mesh !== "undefined" && element instanceof Mesh) {
        const keys = [];
        for (const fkey in element.faces) {
          const face = element.faces[fkey];
          if (!face.vertices || face.vertices.length < 3) continue;
          keys.push(fkey);
          if (face.vertices.length === 4) keys.push(fkey);
        }
        return keys;
      }
    } catch (err) {
      console.warn("[PathTracer] faceKeysPerTriangle failed", err);
    }
    return null;
  }
  function buildMaterialLookup() {
    const map = /* @__PURE__ */ new Map();
    try {
      (Texture.all || []).forEach((tex) => {
        if (tex.material) map.set(tex.material, tex);
      });
      if (typeof TextureGroup !== "undefined") {
        (TextureGroup.all || []).forEach((group) => {
          if (!group.is_material) return;
          const mat = group.material;
          if (!mat) return;
          const color = group.getTextures().find((t) => t.pbr_channel === "color") || group.getTextures()[0];
          if (color) map.set(mat, color);
        });
      }
    } catch (err) {
    }
    return map;
  }
  function collectGeometry() {
    const positions = [];
    const normals = [];
    const uvs = [];
    const texRefs = [];
    const groupRefs = [];
    const flips = [];
    const negativeCube = [];
    const insideOnly = [];
    const pendingImages = /* @__PURE__ */ new Set();
    let previewTriCount = 0;
    let sceneTriCount = 0;
    if (typeof Canvas !== "undefined" && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
    const matLookup = buildMaterialLookup();
    const defaultTexture = typeof Texture !== "undefined" && Texture.getDefault ? Texture.getDefault() : null;
    const elements = typeof Outliner !== "undefined" && Outliner.elements ? Outliner.elements : [];
    elements.forEach((element) => {
      if (!element || element.visibility === false) return;
      const mesh = element.mesh;
      const groupChain = groupChainForElement(element);
      if (!mesh || !mesh.geometry || mesh.visible === false) return;
      const geo = mesh.geometry;
      const posAttr = geo.attributes && geo.attributes.position;
      if (!posAttr || !posAttr.array || posAttr.count < 3) return;
      const uvAttr = geo.attributes.uv;
      const nrmAttr = geo.attributes.normal;
      const index = geo.index;
      const triCount = index ? Math.floor(index.count / 3) : Math.floor(posAttr.count / 3);
      if (triCount <= 0) return;
      mesh.updateWorldMatrix(true, false);
      const m = mesh.matrixWorld.elements;
      const nm = normalMatrix3(m);
      const mirrored = mat3Determinant(m) < 0 ? 1 : 0;
      const fkeys = faceKeysPerTriangle(element, triCount);
      const hasNegativeSize = element instanceof Cube && element.from && element.to && element.to.some((v, axis) => v < element.from[axis]);
      let fallbackTexture = defaultTexture;
      if (mesh.material && !Array.isArray(mesh.material) && matLookup.has(mesh.material)) {
        fallbackTexture = matLookup.get(mesh.material);
      }
      const pa = posAttr.array;
      const na = nrmAttr ? nrmAttr.array : null;
      const ua = uvAttr ? uvAttr.array : null;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.array[t * 3] : t * 3;
        const i1 = index ? index.array[t * 3 + 1] : t * 3 + 1;
        const i2 = index ? index.array[t * 3 + 2] : t * 3 + 2;
        const idx = [i0, i1, i2];
        const cubeNormal = hasNegativeSize && fkeys ? CUBE_FACE_NORMALS[fkeys[t]] : null;
        const insideOnlyFace = !!(cubeNormal && triangleFacesInward(idx, pa, cubeNormal));
        const wp = [];
        for (let k = 0; k < 3; k++) {
          const o = idx[k] * 3;
          wp.push(transformPoint(m, pa[o], pa[o + 1], pa[o + 2]));
        }
        const e1 = vSub(wp[1], wp[0]);
        const e2 = vSub(wp[2], wp[0]);
        const cr = vCross(e1, e2);
        if (vDot(cr, cr) < 1e-14) continue;
        for (let k = 0; k < 3; k++) positions.push(wp[k][0], wp[k][1], wp[k][2]);
        if (cubeNormal) {
          const n = vNorm(transformDir(nm, cubeNormal[0], cubeNormal[1], cubeNormal[2]));
          for (let k = 0; k < 3; k++) normals.push(n[0], n[1], n[2]);
        } else if (na) {
          for (let k = 0; k < 3; k++) {
            const o = idx[k] * 3;
            const n = vNorm(transformDir(nm, na[o], na[o + 1], na[o + 2]));
            normals.push(n[0], n[1], n[2]);
          }
        } else {
          const gn = vNorm(cr);
          for (let k = 0; k < 3; k++) normals.push(gn[0], gn[1], gn[2]);
        }
        if (ua) {
          for (let k = 0; k < 3; k++) {
            const o = idx[k] * 2;
            uvs.push(ua[o], ua[o + 1]);
          }
        } else {
          uvs.push(0, 0, 1, 0, 0, 1);
        }
        let tex = fallbackTexture;
        const fkey = fkeys ? fkeys[t] : null;
        if (fkey != null && element.faces && element.faces[fkey]) {
          try {
            const ft = element.faces[fkey].getTexture();
            if (ft) tex = ft;
            else if (element.faces[fkey].texture === null) tex = null;
          } catch (err) {
          }
        }
        texRefs.push(tex || null);
        groupRefs.push(groupChain);
        flips.push(mirrored);
        negativeCube.push(!!hasNegativeSize);
        insideOnly.push(insideOnlyFace);
      }
    });
    const activeScene = activeBlockbenchScene();
    const previewMaterials = /* @__PURE__ */ new Map();
    const previewModels = activeBlockbenchPreviewModels();
    for (const model of previewModels) {
      const root = model.model_3d;
      root.updateWorldMatrix(true, true);
      const isSceneModel = !!activeScene?.preview_models?.includes(model);
      const visit = (object, visible) => {
        if (!visible || object.visible === false) return;
        if (object.isMesh && object.geometry) {
          const geo = object.geometry;
          const pos = geo.attributes?.position;
          const nrm = geo.attributes?.normal;
          const uv = geo.attributes?.uv;
          const index = geo.index;
          if (pos?.array && pos.count >= 3) {
            const m = object.matrixWorld.elements;
            const nm = normalMatrix3(m);
            const mirrored = mat3Determinant(m) < 0 ? 1 : 0;
            const triCount = Math.floor((index ? index.count : pos.count) / 3);
            const groups2 = geo.groups || [];
            for (let t = 0; t < triCount; t++) {
              const offset = t * 3;
              const group = groups2.find((item) => offset >= item.start && offset + 2 < item.start + item.count);
              const sourceMaterial = Array.isArray(object.material) ? object.material[group?.materialIndex || 0] : object.material;
              if (!sourceMaterial || sourceMaterial.visible === false) continue;
              const idx = [0, 1, 2].map((k) => index ? index.array[offset + k] : offset + k);
              const wp = idx.map((i) => transformPoint(m, pos.array[i * pos.itemSize], pos.array[i * pos.itemSize + 1], pos.array[i * pos.itemSize + 2]));
              const cr = vCross(vSub(wp[1], wp[0]), vSub(wp[2], wp[0]));
              if (vDot(cr, cr) < 1e-14) continue;
              for (const point of wp) positions.push(...point);
              for (const i of idx) {
                const normal = nrm?.array ? vNorm(transformDir(nm, nrm.array[i * nrm.itemSize], nrm.array[i * nrm.itemSize + 1], nrm.array[i * nrm.itemSize + 2])) : vNorm(cr);
                normals.push(...normal);
                uvs.push(uv?.array ? uv.array[i * uv.itemSize] : 0, uv?.array ? uv.array[i * uv.itemSize + 1] : 0);
              }
              let ref = previewMaterials.get(sourceMaterial);
              if (!ref) {
                ref = { uuid: `__bb_preview_${sourceMaterial.uuid || previewMaterials.size}`, previewMaterial: sourceMaterial };
                previewMaterials.set(sourceMaterial, ref);
                const image = sourceMaterial.map?.image;
                if (image?.addEventListener && (!image.complete || !image.naturalWidth)) pendingImages.add(image);
              }
              texRefs.push(ref);
              groupRefs.push([]);
              flips.push(mirrored);
              negativeCube.push(false);
              insideOnly.push(false);
              previewTriCount++;
              if (isSceneModel) sceneTriCount++;
            }
          }
        }
        for (const child of object.children || []) visit(child, true);
      };
      visit(root, true);
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      texRefs,
      groupRefs,
      flips,
      negativeCube,
      insideOnly,
      triCount: texRefs.length,
      previewTriCount,
      sceneTriCount,
      fog: activeScene?.fog || null,
      pendingImages: [...pendingImages]
    };
  }
  function mat3Determinant(m) {
    const a = m[0], b = m[1], c = m[2];
    const d = m[4], e = m[5], f = m[6];
    const g = m[8], h = m[9], i = m[10];
    return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  }
  function transformPoint(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }
  function transformDir(nm, x, y, z) {
    return [
      nm[0] * x + nm[3] * y + nm[6] * z,
      nm[1] * x + nm[4] * y + nm[7] * z,
      nm[2] * x + nm[5] * y + nm[8] * z
    ];
  }
  function normalMatrix3(m) {
    const a = m[0], b = m[1], c = m[2];
    const d = m[4], e = m[5], f = m[6];
    const g = m[8], h = m[9], i = m[10];
    const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const id = 1 / det;
    const inv = [
      (e * i - f * h) * id,
      -(b * i - c * h) * id,
      (b * f - c * e) * id,
      -(d * i - f * g) * id,
      (a * i - c * g) * id,
      -(a * f - c * d) * id,
      (d * h - e * g) * id,
      -(a * h - b * g) * id,
      (a * e - b * d) * id
    ];
    return [
      inv[0],
      inv[3],
      inv[6],
      inv[1],
      inv[4],
      inv[7],
      inv[2],
      inv[5],
      inv[8]
    ];
  }

  // plugins/georenderer/src/scene/atlas.js
  function tryPackShelf(entries, size) {
    let x = 0, y = 0, shelfH = 0;
    const rects = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.w > size || e.h > size) return null;
      if (x + e.w > size) {
        x = 0;
        y += shelfH;
        shelfH = 0;
      }
      if (y + e.h > size) return null;
      rects[e.order] = { x, y, w: e.w, h: e.h };
      x += e.w;
      if (e.h > shelfH) shelfH = e.h;
    }
    return rects;
  }
  function packAtlas(sizes, maxSize) {
    const entries = sizes.map((s, i) => ({ w: s[0], h: s[1], order: i }));
    entries.sort((a, b) => b.h - a.h || b.w - a.w);
    let size = 64;
    while (size <= maxSize) {
      const rects = tryPackShelf(entries, size);
      if (rects) return { size, rects };
      size *= 2;
    }
    return null;
  }

  // plugins/georenderer/src/scene/materials.js
  function buildMaterials(gl, texRefs, groupRefs, settings2, overrides, groupOverrides) {
    const slotList = [];
    const slotOfKey = /* @__PURE__ */ new Map();
    for (let i = 0; i < texRefs.length; i++) {
      const tex = texRefs[i];
      const groupChain = groupRefs[i] || [];
      const key = materialKey(tex, groupChain);
      if (!slotOfKey.has(key)) {
        slotOfKey.set(key, slotList.length);
        slotList.push({ texture: tex, uuid: tex ? tex.uuid : "__none__", groupChain });
      }
    }
    let groundSlot = -1;
    if (settings2.ground_texture_uuid && typeof Texture !== "undefined") {
      const groundTexture = (Texture.all || []).find((texture) => texture.uuid === settings2.ground_texture_uuid);
      if (groundTexture) {
        const key = materialKey(groundTexture, []);
        if (!slotOfKey.has(key)) {
          slotOfKey.set(key, slotList.length);
          slotList.push({ texture: groundTexture, uuid: groundTexture.uuid, groupChain: [] });
        }
        groundSlot = slotOfKey.get(key);
      }
    }
    const maxTexSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096, 8192);
    const sizes = [];
    const atlasIndex = /* @__PURE__ */ new Map();
    const addAtlasSource = (slot, key, width, height) => {
      if (!atlasIndex.has(key)) {
        atlasIndex.set(key, sizes.length);
        sizes.push([width, height]);
      }
      slot.atlasIndex = atlasIndex.get(key);
    };
    slotList.forEach((slot) => {
      const tex = slot.texture;
      slot.color = null;
      slot.mer = null;
      slot.normal = null;
      slot.side = "double";
      if (!tex) {
        addAtlasSource(slot, "__none__", 1, 1);
        return;
      }
      if (tex.previewMaterial) {
        const material = tex.previewMaterial;
        const image = material.map?.image;
        slot.color = image && image.width > 0 && image.height > 0 ? image : null;
        slot.previewMaterial = material;
        slot.side = material.side === 0 ? "front" : material.side === 1 ? "back" : "double";
        addAtlasSource(slot, tex.uuid, slot.color?.width || 1, slot.color?.height || 1);
        return;
      }
      let group = null;
      try {
        group = tex.getGroup ? tex.getGroup() : null;
      } catch (err) {
        group = null;
      }
      let colorTex = tex, merTex = null, nrmTex = null;
      if (group && group.is_material) {
        const list = group.getTextures();
        colorTex = list.find((t) => t.pbr_channel === "color") || tex;
        merTex = list.find((t) => t.pbr_channel === "mer") || null;
        nrmTex = list.find((t) => t.pbr_channel === "normal") || null;
      }
      slot.color = textureSource(colorTex);
      slot.mer = textureSource(merTex);
      slot.normal = textureSource(nrmTex);
      slot.colorTex = colorTex;
      slot.group = group;
      slot.side = getMaterialSide(colorTex || tex, settings2.render_sides);
      const slotOv = resolveMaterialOverride(tex, slot.groupChain, overrides, groupOverrides);
      let emisTex = null;
      if (slotOv.emissive_map) {
        const allTex = (typeof Texture !== "undefined" ? Texture.all : []) || [];
        emisTex = allTex.find((t) => t.uuid === slotOv.emissive_map) || null;
      }
      slot.emissiveMap = textureSource(emisTex);
      slot.emissiveColorMain = slotOv.emissive_color_source === "main";
      slot.emissiveColorCustom = slotOv.emissive_color_source === "custom";
      let w = slot.color ? slot.color.width : 1;
      let h = slot.color ? slot.color.height : 1;
      if (slot.mer) {
        w = Math.max(w, slot.mer.width);
        h = Math.max(h, slot.mer.height);
      }
      if (slot.normal) {
        w = Math.max(w, slot.normal.width);
        h = Math.max(h, slot.normal.height);
      }
      if (slot.emissiveMap) {
        w = Math.max(w, slot.emissiveMap.width);
        h = Math.max(h, slot.emissiveMap.height);
      }
      w = clamp(w | 0, 1, maxTexSize);
      h = clamp(h | 0, 1, maxTexSize);
      addAtlasSource(slot, tex.uuid + "|" + (slotOv.emissive_map || ""), w, h);
    });
    const packed = packAtlas(sizes, maxTexSize);
    if (!packed) throw new Error("纹理图集打包失败：贴图总面积超出 GPU 上限。");
    const S = packed.size;
    const mk = () => {
      const c = document.createElement("canvas");
      c.width = S;
      c.height = S;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      return { canvas: c, ctx, used: false };
    };
    const atlasC = mk(), atlasM = mk(), atlasN = mk(), atlasE = mk();
    atlasN.ctx.fillStyle = "#8080ff";
    atlasN.ctx.fillRect(0, 0, S, S);
    atlasM.ctx.fillStyle = "#000000";
    atlasM.ctx.fillRect(0, 0, S, S);
    atlasE.ctx.fillStyle = "#000000";
    atlasE.ctx.fillRect(0, 0, S, S);
    atlasC.ctx.clearRect(0, 0, S, S);
    const drawnSources = /* @__PURE__ */ new Set();
    slotList.forEach((slot) => {
      const r = packed.rects[slot.atlasIndex];
      slot.rect = r;
      if (drawnSources.has(slot.atlasIndex)) return;
      drawnSources.add(slot.atlasIndex);
      try {
        if (slot.color) {
          atlasC.ctx.clearRect(r.x, r.y, r.w, r.h);
          atlasC.ctx.drawImage(slot.color, r.x, r.y, r.w, r.h);
          atlasC.used = true;
        }
        if (slot.mer) {
          atlasM.ctx.drawImage(slot.mer, r.x, r.y, r.w, r.h);
          atlasM.used = true;
        }
        if (slot.normal) {
          atlasN.ctx.drawImage(slot.normal, r.x, r.y, r.w, r.h);
          atlasN.used = true;
        }
        if (slot.emissiveMap) {
          atlasE.ctx.drawImage(slot.emissiveMap, r.x, r.y, r.w, r.h);
          atlasE.used = true;
        }
      } catch (err) {
        console.warn("[PathTracer] 绘制图集失败", err);
      }
    });
    const emissiveSlots = /* @__PURE__ */ new Set();
    if (atlasM.used) {
      const merData = atlasM.ctx.getImageData(0, 0, S, S).data;
      slotList.forEach((slot, i) => {
        if (!slot.mer) return;
        const r = slot.rect;
        let found = false;
        for (let y = r.y; y < r.y + r.h && !found; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            if (merData[(y * S + x) * 4 + 1] > 4) {
              found = true;
              break;
            }
          }
        }
        if (found) emissiveSlots.add(i);
      });
    }
    const emissiveMapSlots = /* @__PURE__ */ new Set();
    if (atlasE.used) {
      const emsData = atlasE.ctx.getImageData(0, 0, S, S).data;
      slotList.forEach((slot, i) => {
        if (!slot.emissiveMap) return;
        const r = slot.rect;
        let found = false;
        for (let y = r.y; y < r.y + r.h && !found; y++) {
          for (let x = r.x; x < r.x + r.w; x++) {
            const o4 = (y * S + x) * 4;
            if (emsData[o4] > 4 || emsData[o4 + 1] > 4 || emsData[o4 + 2] > 4) {
              found = true;
              break;
            }
          }
        }
        if (found) emissiveMapSlots.add(i);
      });
    }
    const texColor = createAtlasTexture(gl, atlasC.ctx.getImageData(0, 0, S, S).data, S, S);
    const texMER = atlasM.used ? createAtlasTexture(gl, atlasM.ctx.getImageData(0, 0, S, S).data, S, S) : null;
    const texNRM = atlasN.used ? createAtlasTexture(gl, atlasN.ctx.getImageData(0, 0, S, S).data, S, S) : null;
    const texEMS = atlasE.used ? createAtlasTexture(gl, atlasE.ctx.getImageData(0, 0, S, S).data, S, S) : null;
    const matData = new Float32Array(slotList.length * MAT_TEXELS * 4);
    slotList.forEach((slot, i) => {
      const o = i * MAT_TEXELS * 4;
      const tex = slot.texture;
      const preview = slot.previewMaterial;
      if (preview) {
        const tint2 = preview.color || { r: 1, g: 1, b: 1 };
        const basic = !!preview.isMeshBasicMaterial;
        const emissive = preview.emissive || { r: 0, g: 0, b: 0 };
        const emissivePower = Math.max(emissive.r, emissive.g, emissive.b) * (preview.emissiveIntensity ?? 1);
        const emits = basic || emissivePower > 0;
        let flags2 = slot.color ? MF_HAS_COLOR : 0;
        if (preview.map?.wrapS === 1e3 || preview.map?.wrapT === 1e3) flags2 |= MF_WRAP_REPEAT;
        if (emits) flags2 |= 512;
        matData.set([tint2.r, tint2.g, tint2.b, flags2], o);
        matData.set([slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h], o + 4);
        matData.set([preview.roughness ?? 1, preview.metalness ?? 0, basic ? 1 : preview.emissiveIntensity ?? 1, 1.5], o + 8);
        matData.set([0, preview.alphaTest || 0, 1, preview.transparent ? 2 : preview.alphaTest > 0 ? 1 : 0], o + 12);
        matData.set([basic ? 1 : emissive.r, basic ? 1 : emissive.g, basic ? 1 : emissive.b, preview.opacity ?? 1], o + 16);
        slot.emissive = emits;
        return;
      }
      const ov = resolveMaterialOverride(tex, slot.groupChain, overrides, groupOverrides);
      const hasMER = !!slot.mer;
      const hasEmissiveMap = !!slot.emissiveMap;
      const fullbrightTex = !!(tex && (tex.render_mode === "emissive" || tex.render_mode === "additive"));
      const defEmis = hasMER || hasEmissiveMap || fullbrightTex ? 1 : 0;
      const emisVal = (ov.emissive != null ? ov.emissive : defEmis) * settings2.emissive_strength;
      let flags = 0;
      if (slot.color) flags |= MF_HAS_COLOR;
      if (hasMER) flags |= MF_HAS_MER;
      if (slot.normal) flags |= MF_HAS_NORMAL;
      if (!hasMER && hasEmissiveMap) flags |= MF_HAS_EMISSIVE_MAP;
      if (slot.emissiveColorMain) flags |= MF_EMIS_MAIN_COLOR;
      if (slot.emissiveColorCustom) flags |= MF_EMIS_CUSTOM_COLOR;
      if (!hasMER && !hasEmissiveMap && emisVal > 0) flags |= MF_FULLBRIGHT;
      if (ov.roughness != null) flags |= 1024;
      if (ov.metalness != null) flags |= 2048;
      if (tex && tex.render_mode === "additive") flags |= MF_ADDITIVE;
      if (!tex || tex.wrap_mode !== "clamp") flags |= MF_WRAP_REPEAT;
      const tint = ov.color ? hexToLinear(ov.color) : slot.color ? [1, 1, 1] : [0.8, 0.8, 0.8];
      matData[o] = tint[0];
      matData[o + 1] = tint[1];
      matData[o + 2] = tint[2];
      matData[o + 3] = flags;
      matData[o + 4] = slot.rect.x;
      matData[o + 5] = slot.rect.y;
      matData[o + 6] = slot.rect.w;
      matData[o + 7] = slot.rect.h;
      matData[o + 8] = ov.roughness != null ? ov.roughness : settings2.def_roughness;
      matData[o + 9] = ov.metalness != null ? ov.metalness : settings2.def_metalness;
      matData[o + 10] = emisVal;
      matData[o + 11] = ov.ior != null ? ov.ior : 1.5;
      matData[o + 12] = ov.transmission != null ? ov.transmission : 0;
      matData[o + 13] = ov.alpha_cutoff != null ? ov.alpha_cutoff : settings2.alpha_cutoff;
      matData[o + 14] = ov.normal_scale != null ? ov.normal_scale : 1;
      const amode = ov.alpha_mode || settings2.alpha_mode || "cutout";
      matData[o + 15] = amode === "blend" ? 2 : amode === "opaque" ? 0 : 1;
      const emisColor = ov.emissive_color ? hexToLinear(ov.emissive_color) : [1, 1, 1];
      matData[o + 16] = emisColor[0];
      matData[o + 17] = emisColor[1];
      matData[o + 18] = emisColor[2];
      matData[o + 19] = 1;
      if (emisVal <= 0) slot.emissive = false;
      else if (hasMER) slot.emissive = emissiveSlots.has(i);
      else if (hasEmissiveMap) slot.emissive = emissiveMapSlots.has(i);
      else slot.emissive = true;
    });
    return {
      slotList,
      slotOfKey,
      groundRect: groundSlot >= 0 && slotList[groundSlot].color ? slotList[groundSlot].rect : null,
      matData,
      matCount: slotList.length,
      textureCount: new Set(texRefs.filter(Boolean).map((texture) => texture.uuid)).size,
      atlasColor: texColor,
      atlasMER: texMER,
      atlasNormal: texNRM,
      atlasEmissive: texEMS,
      atlasSize: S
    };
  }

  // plugins/georenderer/src/gpu/path-tracer.js
  var PathTracer = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = null;
      this.width = 1;
      this.height = 1;
      this.spp = 0;
      this.scene = null;
      this.env = null;
      this.camera = { pos: [0, 20, 60], target: [0, 8, 0], fov: 45, ortho: false, orthoHalfHeight: 20 };
      this.textures = {};
      this.buffers = null;
      this.ping = 0;
      this.disposed = false;
      this.appleGpuDetected = false;
      this.appleGpuOptimization = false;
      this.colorOnlyPass = false;
      this.colorOnlyProgramFailed = false;
      this.renderWindow = null;
      this.frameSync = null;
    }
    init() {
      const gl = this.canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance"
      });
      if (!gl) throw new Error("无法创建 WebGL2 上下文，路径追踪需要支持 WebGL2 的显卡/驱动。");
      this.gl = gl;
      this.extFloat = gl.getExtension("EXT_color_buffer_float");
      if (!this.extFloat) throw new Error("缺少 EXT_color_buffer_float 扩展，无法进行浮点累积渲染。");
      gl.getExtension("OES_texture_float_linear");
      let renderer = "";
      try {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      } catch (err) {
      }
      this.appleGpuDetected = /\bApple\b/i.test(String(renderer || ""));
      this.discardAttachments = [
        [gl.COLOR_ATTACHMENT0],
        [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1],
        [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]
      ];
      this.progPT = createProgram(gl, fullscreen_vert_default, pathtrace_frag_default, "pathtrace");
      if (this.appleGpuDetected) {
        try {
          this.progPTColorOnly = createProgram(gl, fullscreen_vert_default, FS_PATHTRACE_COLOR_ONLY, "pathtrace_color_only");
        } catch (err) {
          this.colorOnlyProgramFailed = true;
          console.warn("[GeoRenderer] Apple GPU 预览着色器不可用，已使用标准着色器", err);
        }
      }
      this.progDN = createProgram(gl, fullscreen_vert_default, denoise_frag_default, "denoise");
      this.progCM = createProgram(gl, fullscreen_vert_default, composite_frag_default, "composite");
      this.progBB = createProgram(gl, fullscreen_vert_default, bloom_bright_frag_default, "bloom_bright");
      this.progBL = createProgram(gl, fullscreen_vert_default, bloom_blur_frag_default, "bloom_blur");
      this.progTM = createProgram(gl, fullscreen_vert_default, tonemap_frag_default, "tonemap");
      this.progFN = createProgram(gl, fullscreen_vert_default, final_frag_default, "final");
      this.vao = gl.createVertexArray();
      this.dummy2D = createAtlasTexture(gl, new Uint8Array([255, 255, 255, 255]), 1, 1);
      this.dummyF = createDataTexture(gl, new Float32Array(4), 1, 1);
      this.dummyR = createR32FTexture(gl, new Float32Array([0]), 1, 1);
      this.dummyEnv = createEnvTexture(gl, new Float32Array([0, 0, 0, 1]), 1, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      return this;
    }
    buildScene(settings2, overrides, groupOverrides) {
      const gl = this.gl;
      const t0 = performance.now();
      this.disposeScene();
      const geo = collectGeometry();
      const mats = buildMaterials(gl, geo.texRefs, geo.groupRefs, settings2, overrides, groupOverrides);
      const bvh = buildBVH(geo.positions, geo.triCount);
      const n = geo.triCount;
      const triPos = new Float32Array(n * TRI_POS_TEXELS * 4);
      const triAttr = new Float32Array(n * TRI_ATTR_TEXELS * 4);
      const lightList = [];
      for (let k = 0; k < n; k++) {
        const t = bvh.order[k];
        const tex = geo.texRefs[t];
        const slot = mats.slotOfKey.get(materialKey(tex, geo.groupRefs[t])) || 0;
        const isLight = mats.slotList[slot] && mats.slotList[slot].emissive ? 1 : 0;
        if (isLight && lightList.length < 4096) lightList.push(k);
        const po = k * TRI_POS_TEXELS * 4;
        const so = t * 9;
        triPos[po + 0] = geo.positions[so + 0];
        triPos[po + 1] = geo.positions[so + 1];
        triPos[po + 2] = geo.positions[so + 2];
        triPos[po + 3] = slot;
        const side = mats.slotList[slot] ? mats.slotList[slot].side : "double";
        let cull = side === "front" ? 1 : side === "back" ? 2 : 0;
        if (cull !== 0 && geo.flips[t]) cull = 3 - cull;
        if (geo.negativeCube[t]) cull = geo.insideOnly[t] && side !== "double" ? 6 : cull + 3;
        triPos[po + 4] = geo.positions[so + 3];
        triPos[po + 5] = geo.positions[so + 4];
        triPos[po + 6] = geo.positions[so + 5];
        triPos[po + 7] = cull;
        triPos[po + 8] = geo.positions[so + 6];
        triPos[po + 9] = geo.positions[so + 7];
        triPos[po + 10] = geo.positions[so + 8];
        const ao = k * TRI_ATTR_TEXELS * 4;
        const no = t * 9;
        const uo = t * 6;
        triAttr[ao + 0] = geo.normals[no + 0];
        triAttr[ao + 1] = geo.normals[no + 1];
        triAttr[ao + 2] = geo.normals[no + 2];
        triAttr[ao + 3] = geo.uvs[uo + 0];
        triAttr[ao + 4] = geo.normals[no + 3];
        triAttr[ao + 5] = geo.normals[no + 4];
        triAttr[ao + 6] = geo.normals[no + 5];
        triAttr[ao + 7] = geo.uvs[uo + 1];
        triAttr[ao + 8] = geo.normals[no + 6];
        triAttr[ao + 9] = geo.normals[no + 7];
        triAttr[ao + 10] = geo.normals[no + 8];
        triAttr[ao + 11] = geo.uvs[uo + 2];
        triAttr[ao + 12] = geo.uvs[uo + 3];
        triAttr[ao + 13] = geo.uvs[uo + 4];
        triAttr[ao + 14] = geo.uvs[uo + 5];
        triAttr[ao + 15] = isLight;
      }
      const texTriPos = createDataTexture(gl, triPos, n * TRI_POS_TEXELS);
      const texTriAttr = createDataTexture(gl, triAttr, n * TRI_ATTR_TEXELS);
      const texBVH = createDataTexture(gl, bvh.nodes.subarray(0, bvh.nodeCount * 8), bvh.nodeCount * BVH_TEXELS);
      const texMat = createDataTexture(gl, mats.matData, mats.matCount * MAT_TEXELS);
      let texLights = null, lightW = 1;
      if (lightList.length > 0) {
        lightW = Math.min(lightList.length, 1024);
        const lh = Math.ceil(lightList.length / lightW);
        const arr = new Float32Array(lightW * lh);
        for (let i = 0; i < lightList.length; i++) arr[i] = lightList[i];
        texLights = createR32FTexture(gl, arr, lightW, lh);
      }
      this.scene = {
        triCount: n,
        previewTriCount: geo.previewTriCount,
        sceneTriCount: geo.sceneTriCount,
        fog: geo.fog,
        pendingImages: geo.pendingImages,
        lightCount: lightList.length,
        lightW,
        texTriPos,
        texTriAttr,
        texBVH,
        texMat,
        texLights,
        atlasColor: mats.atlasColor,
        atlasMER: mats.atlasMER,
        atlasNormal: mats.atlasNormal,
        atlasEmissive: mats.atlasEmissive,
        groundRect: mats.groundRect,
        bounds: computeBounds(geo.positions, n),
        stats: {
          tris: n,
          textures: mats.textureCount,
          nodes: bvh.nodeCount,
          atlas: mats.atlasSize,
          lights: lightList.length,
          ms: Math.round(performance.now() - t0)
        }
      };
      this.spp = 0;
      return this.scene;
    }
    disposeScene() {
      const gl = this.gl;
      const s = this.scene;
      if (!s || !gl) {
        this.scene = null;
        return;
      }
      [s.texTriPos, s.texTriAttr, s.texBVH, s.texMat].forEach((t) => {
        if (t && t.texture) gl.deleteTexture(t.texture);
      });
      [s.texLights, s.atlasColor, s.atlasMER, s.atlasNormal, s.atlasEmissive].forEach((t) => {
        if (t) gl.deleteTexture(t);
      });
      this.scene = null;
    }
    setEnvironment(settings2, customImage) {
      const gl = this.gl;
      if (this.env) {
        if (this.env.tex) gl.deleteTexture(this.env.tex);
        if (this.env.cond) gl.deleteTexture(this.env.cond);
        if (this.env.marg) gl.deleteTexture(this.env.marg);
      }
      let pixels, w = ENV_W, h = ENV_H;
      if (settings2.env_mode === "image" && customImage) {
        const limit = Math.min(MAX_ENV_IMAGE_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        const scale = Math.min(1, limit / customImage.width, limit / customImage.height);
        w = Math.max(1, Math.round(customImage.width * scale));
        h = Math.max(1, Math.round(customImage.height * scale));
        pixels = resampleEquirect(customImage, w, h);
      } else {
        pixels = generateSkyPixels(settings2);
      }
      const distributionPixels = w === ENV_W && h === ENV_H ? pixels : resampleEquirect({ width: w, height: h, data: pixels }, ENV_W, ENV_H);
      const dist = buildEnvDistribution(distributionPixels, ENV_W, ENV_H);
      this.env = {
        tex: createEnvTexture(gl, pixels, w, h, true),
        width: w,
        height: h,
        cond: createR32FTexture(gl, dist.cond, dist.width + 1, dist.height),
        marg: createR32FTexture(gl, dist.marg, dist.height + 1, 1),
        distW: dist.width,
        distH: dist.height
      };
      this.spp = 0;
    }
    resize(w, h) {
      const gl = this.gl;
      w = Math.max(8, Math.round(w));
      h = Math.max(8, Math.round(h));
      const limit = Math.min(MAX_RENDER_BUFFER_SIDE, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w > limit || h > limit) {
        throw new Error("渲染缓冲超过显存预算，请使用分块渲染");
      }
      if (this.width === w && this.height === h && this.buffers) return;
      gl.finish();
      this.clearFrameSync();
      this.disposeBuffers();
      this.width = w;
      this.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.buffers = new RenderBuffers(gl, w, h);
      this.ping = 0;
      this.reset();
    }
    disposeBuffers() {
      this.buffers?.dispose();
      this.buffers = null;
    }
    clearFrameSync() {
      if (this.frameSync) this.gl.deleteSync(this.frameSync);
      this.frameSync = null;
    }
    isFrameReady() {
      if (!this.frameSync) return true;
      const gl = this.gl;
      const status = gl.clientWaitSync(this.frameSync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return false;
      if (status === gl.WAIT_FAILED) throw new Error("GPU 渲染同步失败");
      this.clearFrameSync();
      return true;
    }
    endFrame() {
      this.clearFrameSync();
      this.frameSync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!this.frameSync) throw new Error("无法同步 GPU 渲染任务");
      this.gl.flush();
    }
    reset() {
      const gl = this.gl;
      this.spp = 0;
      if (!this.buffers) return;
      gl.clearColor(0, 0, 0, 0);
      [this.buffers.fboA, this.buffers.fboB].forEach((fbo) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    setCamera(cam) {
      this.camera = cam;
      this.reset();
    }
    setCameraOnly(cam) {
      this.camera = cam;
    }
    useAppleGpuPath(settings2) {
      return settings2.gpu_profile === "apple" || settings2.gpu_profile !== "standard" && this.appleGpuDetected;
    }
    bindPassTarget(fbo, attachmentCount) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (this.appleGpuOptimization && gl.invalidateFramebuffer) {
        gl.invalidateFramebuffer(gl.FRAMEBUFFER, this.discardAttachments[attachmentCount === 4 ? 2 : attachmentCount === 2 ? 1 : 0]);
      }
    }
    bindTex(unit, tex, name, prog) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const loc = prog.uniforms[name];
      if (loc) gl.uniform1i(loc, unit);
    }
    beginFrame(settings2, interactive) {
      const gl = this.gl;
      if (!this.buffers || !this.scene || !this.env) return false;
      if (!this.isFrameReady()) return false;
      this.appleGpuOptimization = this.useAppleGpuPath(settings2);
      if (this.appleGpuOptimization && interactive && !this.progPTColorOnly && !this.colorOnlyProgramFailed) {
        try {
          this.progPTColorOnly = createProgram(gl, fullscreen_vert_default, FS_PATHTRACE_COLOR_ONLY, "pathtrace_color_only");
        } catch (err) {
          this.colorOnlyProgramFailed = true;
          console.warn("[GeoRenderer] Apple GPU 预览着色器不可用，已使用标准着色器", err);
        }
      }
      this.colorOnlyPass = this.appleGpuOptimization && !!interactive && !!this.progPTColorOnly;
      gl.bindVertexArray(this.vao);
      gl.viewport(0, 0, this.width, this.height);
      const p = this.colorOnlyPass ? this.progPTColorOnly : this.progPT;
      this.activePT = p;
      const u = p.uniforms;
      gl.useProgram(p.program);
      const s = this.scene;
      this.bindTex(0, s.texTriPos ? s.texTriPos.texture : this.dummyF.texture, "uTriPos", p);
      this.bindTex(1, s.texTriAttr ? s.texTriAttr.texture : this.dummyF.texture, "uTriAttr", p);
      this.bindTex(2, s.texBVH ? s.texBVH.texture : this.dummyF.texture, "uBVH", p);
      this.bindTex(3, s.texMat ? s.texMat.texture : this.dummyF.texture, "uMat", p);
      this.bindTex(4, s.atlasColor || this.dummy2D, "uAtlasC", p);
      this.bindTex(5, s.atlasMER || this.dummy2D, "uAtlasM", p);
      this.bindTex(6, s.atlasNormal || this.dummy2D, "uAtlasN", p);
      this.bindTex(7, s.texLights || this.dummyR, "uLightTex", p);
      this.bindTex(8, this.env.tex, "uEnv", p);
      this.bindTex(9, this.env.cond, "uEnvCond", p);
      this.bindTex(10, this.env.marg, "uEnvMarg", p);
      this.bindTex(15, s.atlasEmissive || this.dummy2D, "uAtlasE", p);
      const frame = this.renderWindow || { width: this.width, height: this.height, x: 0, y: 0 };
      gl.uniform2f(u.uResolution, frame.width, frame.height);
      gl.uniform2f(u.uTileOrigin, frame.x, frame.y);
      gl.uniform1i(u.uMaxBounce, settings2.max_bounce | 0);
      gl.uniform1i(u.uLightSamples, settings2.light_samples | 0);
      gl.uniform1f(u.uClamp, settings2.clamp_value);
      gl.uniform1i(u.uFilterLinear, settings2.filter_linear ? 1 : 0);
      gl.uniform1i(u.uTriPosW, s.texTriPos ? s.texTriPos.width : 1);
      gl.uniform1i(u.uTriAttrW, s.texTriAttr ? s.texTriAttr.width : 1);
      gl.uniform1i(u.uBVHW, s.texBVH ? s.texBVH.width : 1);
      gl.uniform1i(u.uMatW, s.texMat ? s.texMat.width : 1);
      gl.uniform1i(u.uLightW, s.lightW || 1);
      gl.uniform1i(u.uTriCount, s.triCount);
      gl.uniform1i(u.uLightCount, s.lightCount);
      const cam = this.camera;
      const fwd = vNorm(vSub(cam.target, cam.pos));
      let right = vCross(fwd, [0, 1, 0]);
      if (vDot(right, right) < 1e-8) right = vCross(fwd, [0, 0, 1]);
      right = vNorm(right);
      const up = vNorm(vCross(right, fwd));
      gl.uniform3f(u.uCamPos, cam.pos[0], cam.pos[1], cam.pos[2]);
      gl.uniform3f(u.uCamRight, right[0], right[1], right[2]);
      gl.uniform3f(u.uCamUp, up[0], up[1], up[2]);
      gl.uniform3f(u.uCamForward, fwd[0], fwd[1], fwd[2]);
      gl.uniform1f(u.uTanHalfFov, Math.tan(cam.fov * Math.PI / 360));
      gl.uniform1f(u.uAspect, frame.width / frame.height);
      gl.uniform1i(u.uOrtho, cam.ortho ? 1 : 0);
      gl.uniform1f(u.uOrthoHalfHeight, cam.orthoHalfHeight || 20);
      let focus = settings2.focus_distance;
      if (settings2.auto_focus || !focus) {
        focus = Math.hypot(cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]);
      }
      gl.uniform1f(u.uAperture, settings2.aperture);
      gl.uniform1f(u.uFocusDist, focus);
      gl.uniform2i(u.uEnvDist, this.env.distW, this.env.distH);
      gl.uniform1f(u.uEnvIntensity, settings2.env_intensity);
      gl.uniform1f(u.uEnvRotation, settings2.env_rotation * Math.PI / 180);
      const maxBackgroundLod = Math.max(0, Math.log2(Math.max(this.env.width, this.env.height)) - 3);
      gl.uniform1f(u.uBackgroundLod, clamp(Number(settings2.background_blur) || 0, 0, 100) / 100 * maxBackgroundLod);
      gl.uniform1i(u.uBgMode, settings2.bg_mode === "color" ? 1 : settings2.bg_mode === "transparent" ? 2 : 0);
      const bg = hexToLinear(settings2.bg_color);
      gl.uniform3f(u.uBgColor, bg[0], bg[1], bg[2]);
      const sunOn = settings2.sun_enable && settings2.sun_intensity > 0;
      gl.uniform1i(u.uSunEnable, sunOn ? 1 : 0);
      if (sunOn) {
        const dir = sunDirection(settings2);
        const radius = Math.max(settings2.sun_angle, 0.25) * Math.PI / 360;
        const cosR = Math.cos(radius);
        const solid = Math.max(2 * Math.PI * (1 - cosR), 1e-7);
        const col = hexToLinear(settings2.sun_color);
        const scale = settings2.sun_intensity / solid;
        gl.uniform3f(u.uSunDir, dir[0], dir[1], dir[2]);
        gl.uniform1f(u.uSunCosRadius, cosR);
        gl.uniform1f(u.uSunSolidAngle, solid);
        gl.uniform3f(u.uSunRadiance, col[0] * scale, col[1] * scale, col[2] * scale);
      } else {
        gl.uniform3f(u.uSunDir, 0, 1, 0);
        gl.uniform1f(u.uSunCosRadius, 2);
        gl.uniform1f(u.uSunSolidAngle, 1);
        gl.uniform3f(u.uSunRadiance, 0, 0, 0);
      }
      gl.uniform1i(u.uGroundOn, settings2.ground_on && !s.sceneTriCount ? 1 : 0);
      const fog = s.fog;
      gl.uniform1i(u.uFogMode, fog ? fog.isFogExp2 ? 2 : 1 : 0);
      gl.uniform3f(u.uFogColor, fog?.color?.r || 0, fog?.color?.g || 0, fog?.color?.b || 0);
      gl.uniform1f(u.uFogNear, fog?.near || 0);
      gl.uniform1f(u.uFogFar, fog?.far || 1);
      gl.uniform1f(u.uFogDensity, fog?.density || 0);
      gl.uniform1i(u.uGroundCatcher, settings2.ground_catcher ? 1 : 0);
      gl.uniform1f(u.uGroundY, settings2.ground_y);
      gl.uniform1f(u.uGroundRough, clamp(settings2.ground_rough, 0.02, 1));
      gl.uniform1f(u.uGroundMetal, clamp(settings2.ground_metal, 0, 1));
      gl.uniform1f(u.uGroundRadius, settings2.ground_radius);
      const gc = hexToLinear(settings2.ground_color);
      gl.uniform3f(u.uGroundColor, gc[0], gc[1], gc[2]);
      const groundRect = s.groundRect;
      gl.uniform1i(u.uGroundTexOn, groundRect ? 1 : 0);
      gl.uniform4f(u.uGroundRect, groundRect ? groundRect.x : 0, groundRect ? groundRect.y : 0, groundRect ? groundRect.w : 1, groundRect ? groundRect.h : 1);
      gl.uniform1f(u.uGroundTexScale, Math.max(0.01, settings2.ground_texture_scale || 1));
      return true;
    }
    renderPass() {
      const gl = this.gl;
      if (!this.buffers || !this.scene || !this.env) return;
      const src = this.ping === 0 ? this.buffers.b : this.buffers.a;
      const dstFBO = this.colorOnlyPass ? this.ping === 0 ? this.buffers.fboColorA : this.buffers.fboColorB : this.ping === 0 ? this.buffers.fboA : this.buffers.fboB;
      this.bindPassTarget(dstFBO, this.colorOnlyPass ? 1 : 4);
      const p = this.activePT;
      const u = p.uniforms;
      this.bindTex(11, src.color, "uAccum", p);
      if (!this.colorOnlyPass) {
        this.bindTex(12, src.albedo, "uAccumAlb", p);
        this.bindTex(13, src.normal, "uAccumNrm", p);
        this.bindTex(14, src.moment, "uAccumMom", p);
      }
      gl.uniform1i(u.uSeed, this.spp * 9781 + 1 | 0);
      gl.uniform1i(u.uReset, this.spp === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.ping = 1 - this.ping;
      this.spp++;
    }
    currentSet() {
      return this.ping === 0 ? this.buffers.b : this.buffers.a;
    }
    present(settings2) {
      const gl = this.gl;
      if (!this.buffers || this.spp === 0) return;
      this.appleGpuOptimization = this.useAppleGpuPath(settings2);
      const cur = this.currentSet();
      const invSpp = 1 / this.spp;
      gl.bindVertexArray(this.vao);
      let denoised = null;
      const useDenoise = settings2.denoise && !this.colorOnlyPass && settings2.denoise_strength > 0;
      this.buffers.syncEffects(useDenoise, !!settings2.bloom_enable);
      if (useDenoise) {
        const p = this.progDN;
        gl.useProgram(p.program);
        const phiColorBase = 3.2 * settings2.denoise_strength;
        const steps = [1, 2, 4, 8];
        let inputTex = cur.color;
        let varTex = null;
        let first = 1;
        for (let i = 0; i < steps.length; i++) {
          const targetFBO = i % 2 === 0 ? this.buffers.fboD0 : this.buffers.fboD1;
          const targetTex = i % 2 === 0 ? this.buffers.d0 : this.buffers.d1;
          const targetVar = i % 2 === 0 ? this.buffers.v0 : this.buffers.v1;
          this.bindPassTarget(targetFBO, 2);
          gl.viewport(0, 0, this.width, this.height);
          this.bindTex(0, inputTex, "uColorIn", p);
          this.bindTex(1, cur.albedo, "uAlbedoTex", p);
          this.bindTex(2, cur.normal, "uNormalTex", p);
          this.bindTex(3, cur.moment, "uMomentTex", p);
          this.bindTex(4, varTex || cur.moment, "uVarianceIn", p);
          gl.uniform1i(p.uniforms.uFirst, first);
          gl.uniform1f(p.uniforms.uInvSpp, invSpp);
          gl.uniform1i(p.uniforms.uStepSize, steps[i]);
          gl.uniform1f(p.uniforms.uPhiColorBase, phiColorBase);
          gl.uniform1f(p.uniforms.uPhiNormal, 0.08);
          gl.uniform1f(p.uniforms.uPhiDepth, 0.01);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          inputTex = targetTex;
          varTex = targetVar;
          denoised = targetTex;
          first = 0;
        }
      }
      const buf = this.buffers;
      this.bindPassTarget(buf.fboHDR, 1);
      gl.viewport(0, 0, this.width, this.height);
      {
        const p = this.progCM;
        gl.useProgram(p.program);
        this.bindTex(0, cur.color, "uAccumTex", p);
        this.bindTex(1, denoised || cur.color, "uDenoisedTex", p);
        this.bindTex(2, cur.albedo, "uAlbedoTex", p);
        gl.uniform1f(p.uniforms.uInvSpp, invSpp);
        gl.uniform1i(p.uniforms.uUseDenoise, useDenoise && denoised ? 1 : 0);
        gl.uniform1f(p.uniforms.uExposure, settings2.exposure);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      const useBloom = !!settings2.bloom_enable;
      if (useBloom) {
        {
          const p = this.progBB;
          this.bindPassTarget(buf.fboBloomA, 1);
          gl.useProgram(p.program);
          this.bindTex(0, buf.hdr, "uHDR", p);
          gl.uniform1f(p.uniforms.uThreshold, settings2.bloom_threshold);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        const radius = Math.max(settings2.bloom_radius, 0.1) * ((this.renderWindow?.width || this.width) / 1280);
        {
          const p = this.progBL;
          gl.useProgram(p.program);
          gl.uniform1f(p.uniforms.uRadius, radius);
          this.bindPassTarget(buf.fboBloomB, 1);
          this.bindTex(0, buf.bloomA, "uTex", p);
          gl.uniform2f(p.uniforms.uDir, 1, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          this.bindPassTarget(buf.fboBloomA, 1);
          this.bindTex(0, buf.bloomB, "uTex", p);
          gl.uniform2f(p.uniforms.uDir, 0, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
      this.bindPassTarget(buf.fboTonemap, 1);
      gl.viewport(0, 0, this.width, this.height);
      {
        const p = this.progTM;
        gl.useProgram(p.program);
        this.bindTex(0, buf.hdr, "uHDR", p);
        this.bindTex(1, useBloom ? buf.bloomA : buf.hdr, "uBloomTex", p);
        gl.uniform1i(p.uniforms.uUseBloom, useBloom ? 1 : 0);
        gl.uniform1f(p.uniforms.uBloomIntensity, settings2.bloom_intensity);
        gl.uniform1f(p.uniforms.uContrast, settings2.contrast);
        gl.uniform1f(p.uniforms.uSaturation, settings2.saturation);
        const tmMap = { none: 0, reinhard: 1, aces: 2, filmic: 3, agx: 4 };
        gl.uniform1i(p.uniforms.uToneMap, tmMap[settings2.tone_mapping] != null ? tmMap[settings2.tone_mapping] : 2);
        gl.uniform1i(p.uniforms.uVignetteEnable, settings2.vignette_enable ? 1 : 0);
        gl.uniform1f(p.uniforms.uVignetteStrength, settings2.vignette_strength);
        gl.uniform2f(p.uniforms.uResolution, this.renderWindow?.width || this.width, this.renderWindow?.height || this.height);
        gl.uniform2f(p.uniforms.uTileOrigin, this.renderWindow?.x || 0, this.renderWindow?.y || 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      {
        const p = this.progFN;
        gl.useProgram(p.program);
        this.bindTex(0, buf.tonemapOut, "uTex", p);
        gl.uniform2f(p.uniforms.uTileOrigin, this.renderWindow?.x || 0, this.renderWindow?.y || 0);
        gl.uniform1i(p.uniforms.uSharpenEnable, settings2.sharpen_enable ? 1 : 0);
        gl.uniform1f(p.uniforms.uSharpenStrength, settings2.sharpen_strength);
        gl.uniform1i(p.uniforms.uGrainEnable, settings2.grain_enable ? 1 : 0);
        gl.uniform1f(p.uniforms.uGrainStrength, settings2.grain_strength);
        gl.uniform1f(p.uniforms.uGrainSeed, this.spp * 37.13 % 1e3);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindVertexArray(null);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      const gl = this.gl;
      if (!gl) return;
      this.clearFrameSync();
      this.disposeScene();
      this.disposeBuffers();
      if (this.env) {
        gl.deleteTexture(this.env.tex);
        gl.deleteTexture(this.env.cond);
        gl.deleteTexture(this.env.marg);
        this.env = null;
      }
      [this.progPT, this.progPTColorOnly, this.progDN, this.progCM, this.progBB, this.progBL, this.progTM, this.progFN].forEach((p) => {
        if (p) gl.deleteProgram(p.program);
      });
      if (this.dummy2D) gl.deleteTexture(this.dummy2D);
      if (this.dummyF) gl.deleteTexture(this.dummyF.texture);
      if (this.dummyR) gl.deleteTexture(this.dummyR);
      if (this.dummyEnv) gl.deleteTexture(this.dummyEnv);
      if (this.vao) gl.deleteVertexArray(this.vao);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      this.gl = null;
    }
  };
  function computeBounds(positions, triCount) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < triCount * 9; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = positions[i + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 16 };
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(1e-3, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
    return { min, max, center, radius };
  }

  // plugins/georenderer/src/gpu/tiled-render.js
  function makeTilePlan(width, height, settings2, maxSide = MAX_RENDER_BUFFER_SIDE) {
    const denoisePadding = settings2.denoise && settings2.denoise_strength > 0 ? 2 * (1 + 2 + 4 + 8) : 0;
    const bloomRadius = Math.max(settings2.bloom_radius || 0, 0.1) * width / 1280;
    const bloomPadding = settings2.bloom_enable ? Math.ceil(8 * Math.max(bloomRadius / 4, 1)) : 0;
    const padding = denoisePadding + bloomPadding + (settings2.sharpen_enable ? 1 : 0);
    const side = Math.min(FINAL_TILE_SIDE, maxSide - 2 * padding);
    if (side < 8) throw new Error("后期滤镜范围超过当前 GPU 的分块上限");
    const bufferWidth = Math.min(width, side + 2 * padding);
    const bufferHeight = Math.min(height, side + 2 * padding);
    const tiles = [];
    for (let top = 0; top < height; top += side) for (let x = 0; x < width; x += side) {
      const w = Math.min(side, width - x), h = Math.min(side, height - top);
      const y = height - top - h;
      const originX = Math.max(0, Math.min(x - padding, width - bufferWidth));
      const originY = Math.max(0, Math.min(y - padding, height - bufferHeight));
      tiles.push({
        x,
        y,
        top,
        width: w,
        height: h,
        originX,
        originY,
        cropX: x - originX,
        cropTop: bufferHeight - (y - originY) - h
      });
    }
    return { width, height, bufferWidth, bufferHeight, padding, tiles };
  }
  var TiledRender = class {
    constructor(canvas, width, height, settings2, maxSide) {
      this.canvas = canvas;
      this.plan = makeTilePlan(width, height, settings2, maxSide);
      this.sampleTarget = Math.max(1, settings2.final_samples);
      this.index = 0;
      this.completed = false;
      canvas.width = width;
      canvas.height = height;
      this.context = canvas.getContext("2d", { willReadFrequently: true });
      if (!this.context) {
        this.dispose();
        throw new Error("无法创建最终图片缓冲");
      }
      this.context.imageSmoothingEnabled = false;
    }
    startTile(tracer) {
      const tile = this.plan.tiles[this.index];
      tracer.renderWindow = { width: this.plan.width, height: this.plan.height, x: tile.originX, y: tile.originY };
      tracer.reset();
    }
    copyTile(source) {
      const tile = this.plan.tiles[this.index];
      this.context.clearRect(tile.x, tile.top, tile.width, tile.height);
      this.context.drawImage(
        source,
        tile.cropX,
        tile.cropTop,
        tile.width,
        tile.height,
        tile.x,
        tile.top,
        tile.width,
        tile.height
      );
    }
    finishTile(tracer) {
      this.copyTile(tracer.canvas);
      this.index++;
      this.completed = this.index === this.plan.tiles.length;
      if (!this.completed) this.startTile(tracer);
    }
    updateSamples(samples, tracer) {
      if (samples === this.sampleTarget) return;
      this.sampleTarget = Math.max(1, samples);
      this.restart(tracer);
    }
    restart(tracer) {
      this.index = 0;
      this.completed = false;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.startTile(tracer);
    }
    progress(spp) {
      return (this.index + (this.completed ? 0 : Math.min(spp / this.sampleTarget, 1))) / this.plan.tiles.length;
    }
    dispose() {
      this.canvas.width = this.canvas.height = 1;
    }
  };

  // plugins/georenderer/src/ui/dom.js
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "style" && typeof attrs[k] === "object") Object.assign(node.style, attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (k === "text") node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => {
      if (c) node.appendChild(c);
    });
    return node;
  }

  // plugins/georenderer/src/ui/controls.js
  function makeRow(label, ctrls) {
    return el("div", { class: "ptr_row" }, [
      el("label", { text: label, title: label }),
      el("div", { class: "ptr_ctrl" }, ctrls)
    ]);
  }
  function register(key, setter) {
    PTR.controls.push({ key, set: setter });
  }
  function syncControls() {
    PTR.controls.forEach((c) => {
      try {
        c.set(PTR.settings[c.key]);
      } catch (err) {
      }
    });
  }
  function rowSlider(label, key, min, max, step, digits) {
    const s = PTR.settings;
    const range = el("input", { type: "range", min, max, step, value: s[key] });
    const num = el("input", { type: "number", min, max, step, value: s[key] });
    const apply = (raw, src) => {
      let v = parseFloat(raw);
      if (isNaN(v)) return;
      v = clamp(v, min, max);
      s[key] = v;
      if (src !== "r") range.value = v;
      if (src !== "n") num.value = digits != null ? +v.toFixed(digits) : v;
      onSettingChanged(key);
    };
    range.addEventListener("input", () => apply(range.value, "r"));
    num.addEventListener("change", () => apply(num.value, "n"));
    register(key, (v) => {
      range.value = v;
      num.value = digits != null ? +Number(v).toFixed(digits) : v;
    });
    return makeRow(label, [range, num]);
  }
  function rowNumber(label, key, min, max, step) {
    const s = PTR.settings;
    const num = el("input", { type: "number", min, max, step, value: s[key] });
    num.addEventListener("change", () => {
      let v = parseFloat(num.value);
      if (isNaN(v)) return;
      v = clamp(v, min, max);
      s[key] = v;
      num.value = v;
      onSettingChanged(key);
    });
    register(key, (v) => {
      num.value = v;
    });
    return makeRow(label, [num]);
  }
  function rowCheck(label, key) {
    const s = PTR.settings;
    const box = el("input", { type: "checkbox" });
    box.checked = !!s[key];
    box.addEventListener("change", () => {
      s[key] = box.checked;
      onSettingChanged(key);
    });
    register(key, (v) => {
      box.checked = !!v;
    });
    return makeRow(label, [box]);
  }
  function rowText(label, key, placeholder) {
    const s = PTR.settings;
    const inp = el("input", { type: "text", value: s[key] || "" });
    if (placeholder) inp.setAttribute("placeholder", placeholder);
    inp.addEventListener("input", () => {
      s[key] = inp.value;
      onSettingChanged(key);
    });
    register(key, (v) => {
      inp.value = v || "";
    });
    return makeRow(label, [inp]);
  }
  function rowColor(label, key) {
    const s = PTR.settings;
    const inp = el("input", { type: "color", value: s[key] });
    inp.addEventListener("input", () => {
      s[key] = inp.value;
      onSettingChanged(key);
    });
    register(key, (v) => {
      inp.value = v;
    });
    return makeRow(label, [inp]);
  }
  function rowSelect(label, key, options) {
    const s = PTR.settings;
    const sel = el("select");
    for (const val in options) {
      const o = el("option", { value: val, text: options[val] });
      sel.appendChild(o);
    }
    sel.value = s[key];
    sel.addEventListener("change", () => {
      s[key] = sel.value;
      onSettingChanged(key);
    });
    register(key, (v) => {
      sel.value = v;
    });
    return makeRow(label, [sel]);
  }
  function card(title, icon, children) {
    const head = el("div", { class: "ptr_card_head" }, [
      el("i", { class: "material-icons", text: icon }),
      el("span", { text: title })
    ]);
    return el("div", { class: "ptr_card" }, [head].concat(children));
  }
  function buildStages(stages) {
    const wrap = el("div", { id: "ptr_sidebar" });
    const panes = el("div", { class: "ptr_stagepanes" });
    PTR.nodes.stagePanes = {};
    stages.forEach((stage) => {
      const pane = el("section", { class: "ptr_stagepane", "data-step": stage.id }, stage.cards);
      pane.hidden = stage.id !== PTR.step;
      PTR.nodes.stagePanes[stage.id] = pane;
      panes.appendChild(pane);
    });
    wrap.appendChild(panes);
    return wrap;
  }
  function onSettingChanged(key) {
    if (PTR.onSettingChanged) PTR.onSettingChanged(key);
    saveSettings();
    const kind = CHANGE_KIND[key] || "reset";
    if (kind === "scene" || key === "filter_linear") refreshRasterMaterials();
    const t = PTR.tracer;
    if (!t) return;
    if (!PTR.open) {
      PTR.needsRebuild = true;
      return;
    }
    if (kind === "post") {
      PTR.needsPresent = true;
      try {
        if (t.isFrameReady()) {
          t.present(PTR.settings);
          t.endFrame();
          PTR.needsPresent = false;
        }
      } catch (err) {
        showError(err);
        PTR.paused = true;
      }
      updateStatus();
      return;
    }
    if (kind === "resize") {
      applyResolution();
      return;
    }
    if (kind === "env") {
      try {
        t.setEnvironment(PTR.settings, PTR.customEnv);
      } catch (err) {
        showError(err);
        return;
      }
    }
    if (kind === "scene") {
      clearTimeout(PTR.rebuildTimer);
      PTR.rebuildTimer = setTimeout(() => rebuildScene(), 220);
      return;
    }
    t.reset();
  }

  // plugins/georenderer/src/ui/io.js
  function loadEnvFile(file) {
    const request = ++PTR.backgroundPresetRequest;
    PTR.sceneCubemap = null;
    PTR.backgroundScene = null;
    const name = file.name || "";
    const reader = new FileReader();
    reader.onerror = () => {
      if (request === PTR.backgroundPresetRequest) showError(new Error("读取文件失败"));
    };
    if (/\.hdr$/i.test(name)) {
      reader.onload = () => {
        if (request !== PTR.backgroundPresetRequest) return;
        try {
          PTR.customEnv = parseHDR(reader.result);
          PTR.customEnvName = name;
          PTR.customEnvSource = "file";
          PTR.settings.background_preset = "";
          PTR.refreshPreviewBackgrounds?.();
          PTR.settings.env_mode = "image";
          syncControls();
          PTR.nodes.envName.textContent = name + "  (" + PTR.customEnv.width + "×" + PTR.customEnv.height + ")";
          if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
          else if (PTR.tracer) PTR.needsRebuild = true;
          saveSettings();
        } catch (err) {
          showError(err);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        if (request !== PTR.backgroundPresetRequest) return;
        const img = new Image();
        img.onload = () => {
          if (request !== PTR.backgroundPresetRequest) return;
          try {
            const c = document.createElement("canvas");
            const maxW = 4096;
            const sc = Math.min(1, maxW / img.naturalWidth);
            c.width = Math.max(2, Math.round(img.naturalWidth * sc));
            c.height = Math.max(2, Math.round(img.naturalHeight * sc));
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, c.width, c.height);
            const src = ctx.getImageData(0, 0, c.width, c.height).data;
            const data = new Float32Array(c.width * c.height * 4);
            for (let i = 0; i < c.width * c.height; i++) {
              data[i * 4] = srgbToLinear(src[i * 4] / 255);
              data[i * 4 + 1] = srgbToLinear(src[i * 4 + 1] / 255);
              data[i * 4 + 2] = srgbToLinear(src[i * 4 + 2] / 255);
              data[i * 4 + 3] = 1;
            }
            PTR.customEnv = { width: c.width, height: c.height, data };
            PTR.customEnvName = name;
            PTR.customEnvSource = "file";
            PTR.settings.background_preset = "";
            PTR.refreshPreviewBackgrounds?.();
            PTR.settings.env_mode = "image";
            syncControls();
            PTR.nodes.envName.textContent = name + "  (" + c.width + "×" + c.height + ")";
            if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
            else if (PTR.tracer) PTR.needsRebuild = true;
            saveSettings();
          } catch (err) {
            showError(err);
          }
        };
        img.onerror = () => {
          if (request === PTR.backgroundPresetRequest) showError(new Error("无法解码图片"));
        };
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
    ctx.font = size + "px sans-serif";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.globalAlpha = clamp(s.watermark_opacity, 0, 1);
    ctx.fillStyle = s.watermark_color;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = Math.max(2, size * 0.12);
    const pad = Math.max(4, size * 0.35);
    ctx.fillText(s.watermark_text, pad, h - pad);
    ctx.restore();
  }
  function renderOutputCanvas() {
    const t = PTR.tracer;
    const completed = PTR.finalRender ? PTR.finalRender.completed : !t?.frameSync;
    if (!t || !canExport(PTR.step, PTR.finalStarted, t.spp, PTR.settings.final_samples, completed)) {
      Blockbench.showQuickMessage("请等待最终渲染完成", 1500);
      return null;
    }
    if (!PTR.finalRender) t.present(PTR.settings);
    const source = PTR.finalRender?.canvas || t.canvas;
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(source, 0, 0);
    drawWatermark(ctx, out.width, out.height);
    return out;
  }
  function saveImage() {
    try {
      const canvas = renderOutputCanvas();
      if (!canvas) return;
      Blockbench.export({
        type: "PNG",
        extensions: ["png"],
        name: (Project && Project.name ? Project.name : "render") + "_georenderer",
        content: canvas.toDataURL("image/png"),
        savetype: "image"
      });
    } catch (err) {
      showError(err);
    }
  }
  async function copyImage() {
    try {
      const canvas = renderOutputCanvas();
      if (!canvas) return;
      if (typeof clipboard !== "undefined" && typeof nativeImage !== "undefined") {
        clipboard.writeImage(nativeImage.createFromDataURL(canvas.toDataURL("image/png")));
      } else if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法编码 PNG")), "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        throw new Error("当前环境不支持图片剪贴板");
      }
      Blockbench.showQuickMessage("渲染图片已复制到剪贴板", 1800);
    } catch (err) {
      showError(err);
    }
  }
  function openBlockbenchScreenshot() {
    try {
      const canvas = renderOutputCanvas();
      if (!canvas) return;
      if (typeof Screencam === "undefined" || !Screencam.returnScreenshot) throw new Error("Blockbench 截图面板不可用");
      Screencam.returnScreenshot(canvas.toDataURL("image/png"));
    } catch (err) {
      showError(err);
    }
  }

  // plugins/georenderer/src/ui/material-panel.js
  function buildMaterialList() {
    const host = PTR.nodes.matlist;
    if (!host) return;
    host.innerHTML = "";
    const t = PTR.tracer;
    const all = (typeof Texture !== "undefined" ? Texture.all : []) || [];
    const textures = all.filter((tex) => {
      try {
        const g = tex.getGroup && tex.getGroup();
        if (g && g.is_material) return tex.pbr_channel === "color";
      } catch (err) {
      }
      return true;
    });
    if (!textures.length) {
      host.appendChild(el("div", { class: "ptr_note", text: "当前项目没有纹理。" }));
      return;
    }
    textures.forEach((tex) => {
      const ov = PTR.overrides[tex.uuid] || (PTR.overrides[tex.uuid] = {});
      let hasMer = false;
      try {
        const g = tex.getGroup && tex.getGroup();
        if (g && g.is_material) hasMer = !!g.getTextures().find((x) => x.pbr_channel === "mer");
      } catch (err) {
      }
      const defEmis = hasMer || tex.render_mode === "emissive" || tex.render_mode === "additive" ? 1 : 0;
      const box = el("div", { class: "ptr_mat" });
      const head = el("div", { class: "ptr_mat_head" });
      try {
        const img = el("img");
        img.src = tex.source || (tex.canvas ? tex.canvas.toDataURL() : "");
        head.appendChild(img);
      } catch (err) {
      }
      head.appendChild(el("span", { text: tex.name || "(未命名)" }));
      box.appendChild(head);
      const mk = (label, key, min, max, step, def) => {
        const range = el("input", { type: "range", min, max, step, value: ov[key] != null ? ov[key] : def });
        const num = el("input", { type: "number", min, max, step, value: ov[key] != null ? ov[key] : def });
        const apply = (raw, src) => {
          let v = parseFloat(raw);
          if (isNaN(v)) return;
          v = clamp(v, min, max);
          ov[key] = v;
          if (src !== "r") range.value = v;
          if (src !== "n") num.value = v;
          saveSettings();
          refreshRasterMaterials();
          clearTimeout(PTR.rebuildTimer);
          PTR.rebuildTimer = setTimeout(() => rebuildScene(), 250);
        };
        range.addEventListener("input", () => apply(range.value, "r"));
        num.addEventListener("change", () => apply(num.value, "n"));
        box.appendChild(makeRow(label, [range, num]));
      };
      mk("粗糙度", "roughness", 0, 1, 0.01, PTR.settings.def_roughness);
      mk("金属度", "metalness", 0, 1, 0.01, PTR.settings.def_metalness);
      mk("自发光", "emissive", 0, 20, 0.1, defEmis);
      mk("透射", "transmission", 0, 1, 0.01, 0);
      mk("Alpha 阈值", "alpha_cutoff", 0, 1, 0.01, PTR.settings.alpha_cutoff);
      const emisMapSel = el("select");
      emisMapSel.appendChild(el("option", { value: "", text: "无（跟随全局自发光）" }));
      textures.forEach((t2) => {
        const label = t2.uuid === tex.uuid ? (t2.name || "(未命名)") + "（自身）" : t2.name || "(未命名)";
        emisMapSel.appendChild(el("option", { value: t2.uuid, text: label }));
      });
      emisMapSel.value = ov.emissive_map || "";
      const emisColorSel = el("select");
      [["map", "跟随发光贴图颜色"], ["main", "跟随主贴图颜色"], ["custom", "手动选择颜色"]].forEach((pair) => {
        emisColorSel.appendChild(el("option", { value: pair[0], text: pair[1] }));
      });
      const emisColorSrc = ov.emissive_color_source === "main" ? "main" : ov.emissive_color_source === "custom" ? "custom" : "map";
      emisColorSel.value = emisColorSrc;
      emisColorSel.disabled = !ov.emissive_map;
      const emisColorPicker = el("input", { type: "color", value: ov.emissive_color || "#ffffff" });
      const emisColorRow = makeRow("发光颜色", [emisColorPicker]);
      emisColorRow.style.display = emisColorSrc === "custom" ? "" : "none";
      emisMapSel.addEventListener("change", () => {
        if (emisMapSel.value) ov.emissive_map = emisMapSel.value;
        else delete ov.emissive_map;
        emisColorSel.disabled = !ov.emissive_map;
        saveSettings();
        refreshRasterMaterials();
        clearTimeout(PTR.rebuildTimer);
        PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
      });
      emisColorSel.addEventListener("change", () => {
        ov.emissive_color_source = emisColorSel.value;
        emisColorRow.style.display = emisColorSel.value === "custom" ? "" : "none";
        saveSettings();
        refreshRasterMaterials();
        clearTimeout(PTR.rebuildTimer);
        PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
      });
      emisColorPicker.addEventListener("input", () => {
        ov.emissive_color = emisColorPicker.value;
        saveSettings();
        refreshRasterMaterials();
        clearTimeout(PTR.rebuildTimer);
        PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
      });
      box.appendChild(makeRow("发光贴图", [emisMapSel]));
      box.appendChild(makeRow("发光颜色来源", [emisColorSel]));
      box.appendChild(emisColorRow);
      if (hasMer) {
        box.appendChild(el("div", { class: "ptr_note", text: "该材质带 MER 通道，发光贴图设置会被 MER 的自发光通道覆盖。" }));
      }
      const amodeSel = el("select");
      [["", "跟随全局"], ["cutout", "裁剪"], ["blend", "混合"], ["opaque", "忽略透明"]].forEach((pair) => {
        amodeSel.appendChild(el("option", { value: pair[0], text: pair[1] }));
      });
      amodeSel.value = ov.alpha_mode || "";
      amodeSel.addEventListener("change", () => {
        if (amodeSel.value) ov.alpha_mode = amodeSel.value;
        else delete ov.alpha_mode;
        saveSettings();
        refreshRasterMaterials();
        clearTimeout(PTR.rebuildTimer);
        PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
      });
      box.appendChild(makeRow("Alpha 模式", [amodeSel]));
      const reset = el("button", { class: "ptr_btn", text: "重置此纹理" });
      reset.addEventListener("click", () => {
        delete PTR.overrides[tex.uuid];
        saveSettings();
        refreshRasterMaterials();
        buildMaterialList();
        rebuildScene();
      });
      box.appendChild(reset);
      host.appendChild(box);
    });
  }

  // plugins/georenderer/src/ui/group-panel.js
  function groups() {
    return typeof Group !== "undefined" && Group.all || [];
  }
  function isGroup(node) {
    return typeof Group !== "undefined" && node instanceof Group;
  }
  var nameOrder = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  function orderedGroups(nodes) {
    return (nodes || []).filter(isGroup).sort(
      (a, b) => nameOrder.compare(a.name || "", b.name || "") || String(a.uuid).localeCompare(String(b.uuid))
    );
  }
  function groupUuidForElement(element, allGroups = groups()) {
    const chain = groupChainForElement(element);
    return chain.find((uuid) => allGroups.some((group) => group.uuid === uuid)) || null;
  }
  function selectGroupForElement(element) {
    selectGroup(groupUuidForElement(element));
  }
  function selectGroup(uuid) {
    const group = groups().find((item) => item.uuid === uuid);
    PTR.selectedGroupUuid = group ? group.uuid : null;
    let parent = group && group.parent;
    while (parent && typeof parent === "object") {
      if (parent.uuid) PTR.collapsedGroups.delete(parent.uuid);
      parent = parent.parent;
    }
    if (PTR.raster) PTR.raster.highlightGroup(PTR.selectedGroupUuid);
    buildGroupList();
    if (group && PTR.nodes.materialSettings) PTR.nodes.materialSettings.scrollTop = 0;
    const selectedRow = PTR.nodes.groupList?.querySelector(`[data-group-uuid="${PTR.selectedGroupUuid}"]`);
    selectedRow?.scrollIntoView?.({ block: "nearest" });
  }
  function changed(group, reset) {
    reset.disabled = false;
    const row = PTR.nodes.groupList?.querySelector(`[data-group-uuid="${group.uuid}"]`);
    if (row) row.classList.add("modified");
    saveSettings();
    refreshRasterMaterials();
    if (PTR.tracer) {
      clearTimeout(PTR.rebuildTimer);
      PTR.rebuildTimer = setTimeout(rebuildScene, 180);
    }
  }
  function numberRow(label, key, min, max, step, fallback, group, reset) {
    const effective = resolveMaterialOverride(null, groupChainForElement({ parent: group }), null, PTR.groupOverrides);
    const value = effective[key] ?? fallback;
    const range = el("input", { type: "range", min, max, step, value });
    const number = el("input", { type: "number", min, max, step, value });
    const apply = (raw) => {
      var _a, _b;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      const next = clamp(parsed, min, max);
      ((_a = PTR.groupOverrides)[_b = group.uuid] || (_a[_b] = {}))[key] = next;
      range.value = next;
      number.value = next;
      changed(group, reset);
    };
    range.addEventListener("input", () => apply(range.value));
    number.addEventListener("change", () => apply(number.value));
    return makeRow(label, [range, number]);
  }
  function buildInspector(group) {
    const panel = el("div", { class: "ptr_group_inspector" });
    if (!group) {
      panel.appendChild(el("div", { class: "ptr_note", text: "点击左侧模型部件，或在下方大纲中选择组，即可编辑该组材质。" }));
      return panel;
    }
    const head = el("div", { class: "ptr_group_inspector_head" }, [
      el("strong", { text: group.name || "未命名组" })
    ]);
    const reset = el("button", { type: "button", class: "ptr_btn", text: "重置此组" });
    reset.disabled = !PTR.groupOverrides[group.uuid];
    reset.addEventListener("click", () => {
      delete PTR.groupOverrides[group.uuid];
      changed(group, reset);
      buildGroupList();
    });
    head.appendChild(reset);
    panel.appendChild(head);
    panel.appendChild(el("div", { class: "ptr_note", text: "只修改当前组；未修改的属性继承父组或默认值。" }));
    panel.appendChild(numberRow("粗糙度", "roughness", 0, 1, 0.01, PTR.settings.def_roughness, group, reset));
    panel.appendChild(numberRow("金属度", "metalness", 0, 1, 0.01, PTR.settings.def_metalness, group, reset));
    panel.appendChild(numberRow("自发光强度", "emissive", 0, 20, 0.1, 0, group, reset));
    const effective = resolveMaterialOverride(null, groupChainForElement({ parent: group }), null, PTR.groupOverrides);
    const source = el("select");
    for (const [value, label] of [["", "继承纹理 / 父组"], ["main", "使用表面颜色"], ["custom", "使用指定颜色"], ["map", "使用发光贴图颜色"]]) {
      source.appendChild(el("option", { value, text: label }));
    }
    source.value = effective.emissive_color_source || "";
    source.addEventListener("change", () => {
      var _a, _b;
      const override = (_a = PTR.groupOverrides)[_b = group.uuid] || (_a[_b] = {});
      if (source.value) override.emissive_color_source = source.value;
      else delete override.emissive_color_source;
      changed(group, reset);
      buildGroupList();
    });
    panel.appendChild(makeRow("发光颜色来源", [source]));
    const color = el("input", { type: "color", value: effective.emissive_color || "#ffffff" });
    color.addEventListener("input", () => {
      var _a, _b;
      const override = (_a = PTR.groupOverrides)[_b = group.uuid] || (_a[_b] = {});
      override.emissive_color = color.value;
      override.emissive_color_source = "custom";
      source.value = "custom";
      changed(group, reset);
    });
    panel.appendChild(makeRow("发光颜色", [color]));
    panel.appendChild(el("div", { class: "ptr_note", text: "强度保留发光贴图的遮罩；指定颜色可独立于表面颜色。光晕由“预览渲染”中的辉光控制。" }));
    return panel;
  }
  function appendOutline(host, nodes, depth) {
    for (const node of orderedGroups(nodes)) {
      const open = !PTR.collapsedGroups.has(node.uuid);
      const childGroups = orderedGroups(node.children);
      const branch = el("div", { class: "ptr_outline_branch" });
      const selected = PTR.selectedGroupUuid === node.uuid;
      const row = el("div", {
        class: `ptr_outline_row${selected ? " selected" : ""}`,
        role: "treeitem",
        "data-group-uuid": node.uuid,
        "aria-level": String(depth + 1),
        "aria-selected": String(selected)
      });
      if (childGroups.length) {
        const disclosure = el("button", { type: "button", class: "ptr_outline_disclosure", "aria-label": `${open ? "折叠" : "展开"} ${node.name || "未命名组"}`, "aria-expanded": String(open) }, [
          el("i", { class: "material-icons", text: open ? "expand_more" : "chevron_right" })
        ]);
        disclosure.addEventListener("click", () => {
          if (open) PTR.collapsedGroups.add(node.uuid);
          else PTR.collapsedGroups.delete(node.uuid);
          buildGroupList();
        });
        row.appendChild(disclosure);
      } else {
        row.appendChild(el("span", { class: "ptr_outline_spacer" }));
      }
      const button = el("button", { type: "button", class: `ptr_outline_item${selected ? " selected" : ""}` }, [
        el("i", { class: "material-icons", text: open && childGroups.length ? "folder_open" : "folder" }),
        el("span", { text: node.name || "未命名组" })
      ]);
      button.addEventListener("click", () => selectGroup(node.uuid));
      row.appendChild(button);
      if (PTR.groupOverrides[node.uuid]) row.classList.add("modified");
      branch.appendChild(row);
      if (open && childGroups.length) {
        const children = el("div", { class: "ptr_outline_children", role: "group" });
        appendOutline(children, childGroups, depth + 1);
        branch.appendChild(children);
      }
      host.appendChild(branch);
    }
  }
  function buildGroupList() {
    const host = PTR.nodes.groupList;
    const inspector = PTR.nodes.groupInspector;
    if (!host || !inspector) return;
    const all = groups();
    if (!all.some((group) => group.uuid === PTR.selectedGroupUuid)) PTR.selectedGroupUuid = null;
    const oldTree = host.querySelector(".ptr_outline");
    const scroll = oldTree ? oldTree.scrollTop : 0;
    host.replaceChildren();
    inspector.replaceChildren(buildInspector(all.find((group) => group.uuid === PTR.selectedGroupUuid)));
    if (!all.length) {
      host.appendChild(el("div", { class: "ptr_note", text: "当前模型没有组；请先在 Blockbench 大纲中建立组。" }));
      return;
    }
    const tree = el("div", { class: "ptr_outline", role: "tree", "aria-label": "模型组大纲" });
    const root = typeof Outliner !== "undefined" ? Outliner.root : [];
    appendOutline(tree, root, 0);
    if (!tree.childElementCount) appendOutline(tree, all.filter((group) => !isGroup(group.parent)), 0);
    host.appendChild(tree);
    tree.scrollTop = scroll;
  }

  // plugins/georenderer/src/ui/settings-actions.js
  function exportSettingsToClipboard() {
    try {
      const data = {};
      for (const k in DEFAULTS) data[k] = PTR.settings[k];
      const payload = { __pathtracer_settings: true, version: 1, data };
      const text = JSON.stringify(payload);
      if (typeof Clipbench !== "undefined" && Clipbench.setText) {
        Clipbench.setText(text);
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
      } else {
        throw new Error("当前环境不支持写入剪贴板");
      }
      Blockbench.showQuickMessage("渲染设置已复制到剪贴板", 2e3);
    } catch (err) {
      showError(err);
    }
  }
  function applyImportedSettings(payload) {
    if (!payload || !payload.__pathtracer_settings || !payload.data) {
      throw new Error("剪贴板内容不是有效的路径追踪渲染设置");
    }
    clearTimeout(PTR.rebuildTimer);
    const data = payload.data;
    PTR.scenePresetRequest++;
    PTR.backgroundPresetRequest++;
    PTR.sceneCubemap = null;
    for (const k in DEFAULTS) if (data[k] !== void 0) PTR.settings[k] = data[k];
    migrateBackgroundSelection(data);
    if (PTR.settings.background_preset) {
      PTR.customEnv = null;
      PTR.customEnvName = "";
      PTR.customEnvSource = "";
    }
    PTR.backgroundScene = null;
    PTR.settings.render_mode = "preview";
    PTR.finalStarted = false;
    if (PTR.settings.env_mode === "image" && !PTR.customEnv) {
      PTR.settings.env_mode = "sky";
    }
    syncControls();
    if (PTR.onSettingsLoaded) PTR.onSettingsLoaded();
    saveSettings();
    const t = PTR.tracer;
    if (t) {
      try {
        t.setEnvironment(PTR.settings, PTR.customEnv);
        applyResolution();
        rebuildScene();
        t.reset();
      } catch (err) {
        showError(err);
      }
    }
    Blockbench.showQuickMessage("已从剪贴板导入渲染设置", 2e3);
  }
  async function importSettingsFromClipboard() {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error("当前环境不支持读取剪贴板");
      }
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error("剪贴板为空");
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        throw new Error("剪贴板内容不是有效的 JSON");
      }
      applyImportedSettings(payload);
    } catch (err) {
      showError(err);
    }
  }
  function resetToDefaults() {
    if (!confirm("确定要将所有渲染设置重置为默认值吗？（不影响材质单独覆盖的参数）")) return;
    clearTimeout(PTR.rebuildTimer);
    for (const k in DEFAULTS) PTR.settings[k] = DEFAULTS[k];
    PTR.settings.render_mode = "preview";
    PTR.finalStarted = false;
    PTR.scenePresetRequest++;
    PTR.backgroundPresetRequest++;
    PTR.sceneCubemap = null;
    PTR.backgroundScene = null;
    PTR.customEnv = null;
    PTR.customEnvName = "";
    PTR.customEnvSource = "";
    if (PTR.nodes.envName) PTR.nodes.envName.textContent = "(未载入)";
    syncControls();
    if (PTR.onSettingsLoaded) PTR.onSettingsLoaded();
    saveSettings();
    const t = PTR.tracer;
    if (t) {
      try {
        t.setEnvironment(PTR.settings, null);
        applyResolution();
        rebuildScene();
      } catch (err) {
        showError(err);
      }
    }
  }

  // plugins/georenderer/src/scene/presets.js
  var SCENE_PRESETS = {
    studio: { label: "工作室", env_mode: "gradient", grad_top: "#dce2e8", grad_bottom: "#30343b", sky_horizon: "#bec8d2", ground_color: "#aab0b6", sun_color: "#ffffff", sun_intensity: 5, env_intensity: 1.2 },
    minecraft_overworld: { label: "主世界", env_mode: "sky", sky_zenith: "#4f8bd7", sky_horizon: "#c5e2fc", sky_ground: "#64765b", ground_color: "#6c8b55", sun_color: "#fff4cf", sun_intensity: 6, env_intensity: 1 },
    minecraft_end: { label: "末地", env_mode: "gradient", grad_top: "#19132c", grad_bottom: "#55456b", sky_horizon: "#60517a", ground_color: "#c9c5a2", sun_color: "#bba7ff", sun_intensity: 1.2, env_intensity: 0.6 },
    minecraft_nether: { label: "下界", env_mode: "gradient", grad_top: "#2d0b0b", grad_bottom: "#8a3020", sky_horizon: "#8a3020", ground_color: "#59332d", sun_color: "#ff7b38", sun_intensity: 2.5, env_intensity: 0.8 }
  };
  function applyTimeOfDay(settings2, hour) {
    const time = clamp(Number(hour) || 0, 0, 24);
    settings2.time_of_day = time;
    settings2.sun_azimuth = time * 15;
    settings2.sun_elevation = Math.sin((time - 6) * Math.PI / 12) * 70;
    settings2.sun_enable = time >= 5.5 && time <= 18.5;
    return time;
  }
  function formatClock(hour) {
    const minutes = Math.round(clamp(Number(hour) || 0, 0, 24) * 60);
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }

  // plugins/georenderer/src/ui/export-panel.js
  function buildExportPanel() {
    PTR.nodes.exportSummary = el("div", { class: "ptr_summary" });
    return [
      card("最终参数", "fact_check", [
        PTR.nodes.exportSummary,
        rowNumber("成片采样数", "final_samples", 1, 1e5, 1)
      ]),
      card("渲染与输出", "save_alt", [
        el("div", { class: "ptr_note", text: "左侧保留当前预览。确认后点击下方“开始最终渲染”；图片分块完成并保留设定尺寸。达到目标采样数后可复制图片、另存 PNG，或交给 Blockbench 截图面板。" })
      ])
    ];
  }
  function updateExportSummary() {
    const host = PTR.nodes.exportSummary;
    if (!host) return;
    const s = PTR.settings;
    const size = s.res_mode === "custom" ? `${s.res_width} × ${s.res_height}` : "适应预览窗口";
    const groups2 = Object.keys(PTR.groupOverrides).length;
    const scene = listBlockbenchScenes().find((item) => item.id === s.scene_preset)?.name || "无";
    const background = listBlockbenchScenes().find((item) => item.id === s.background_preset)?.name || "GeoRenderer 环境";
    const effects = [s.denoise && "降噪", s.bloom_enable && "泛光", s.vignette_enable && "暗角", s.sharpen_enable && "锐化", s.grain_enable && "颗粒"].filter(Boolean).join("、") || "无";
    const groundTexture = (typeof Texture !== "undefined" && Texture.all || []).find((texture) => texture.uuid === s.ground_texture_uuid);
    const lines = [
      `画面：${size}，${s.final_samples} spp`,
      `镜头：${s.ortho ? "正交" : `FOV ${s.fov}°`}，光圈 ${s.aperture}，${s.auto_focus ? "自动对焦" : `焦距 ${s.focus_distance}`}`,
      `材质：${groups2} 个组覆盖，默认粗糙度 ${s.def_roughness} / 金属度 ${s.def_metalness}`,
      `场景（地面）：${scene}；背景环境：${s.env_mode === "image" && PTR.customEnv ? PTR.customEnvSource === "scene" ? background : PTR.customEnvName || "自定义 HDR / 图片" : "GeoRenderer 环境"}，${formatClock(s.time_of_day)}`,
      `背景模糊度：${s.background_blur || 0} / 100`,
      `场景几何：${PTR.tracer?.scene?.previewTriCount || 0} 个三角形（含启用的预览模型）`,
      `追踪地面：${PTR.tracer?.scene?.sceneTriCount ? "使用场景几何" : s.ground_on ? "开启" : "关闭"}${!PTR.tracer?.scene?.sceneTriCount && groundTexture ? "（" + groundTexture.name + "）" : ""}`,
      `追踪：${s.max_bounce} 次反弹，${s.light_samples} 次光源采样`,
      `后期：${s.tone_mapping.toUpperCase()}，${effects}`
    ];
    host.replaceChildren(...lines.map((line) => el("div", { class: "ptr_summary_line", text: line })));
  }

  // plugins/georenderer/src/ui/sidebar.js
  function makeGroundTextureRow() {
    const select = el("select");
    PTR.refreshGroundTextures = () => {
      select.replaceChildren(el("option", { value: "", text: "纯色地面" }));
      for (const texture of typeof Texture !== "undefined" && Texture.all || []) {
        select.appendChild(el("option", { value: texture.uuid, text: texture.name || texture.uuid }));
      }
      select.value = PTR.settings.ground_texture_uuid || "";
    };
    PTR.refreshGroundTextures();
    select.addEventListener("change", () => {
      PTR.settings.ground_texture_uuid = select.value;
      saveSettings();
      if (PTR.raster) PTR.raster.setGroundTexture((typeof Texture !== "undefined" && Texture.all || []).find((texture) => texture.uuid === select.value));
      if (PTR.tracer) rebuildScene();
    });
    return makeRow("地面纹理", [select]);
  }
  async function syncBlockbenchScene() {
    const request = ++PTR.scenePresetRequest;
    const scene = activeBlockbenchScene();
    PTR.refreshPreviewScenes?.();
    if (PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = scene ? `正在读取「${scene.name}」的场景模型…` : "未选择 Blockbench 场景模型";
    if (scene && !await selectBlockbenchScene(scene.id)) {
      if (request === PTR.scenePresetRequest && PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = "场景模型未能加载，请检查场景资源或 Minecraft EULA 状态";
      return;
    }
    if (request !== PTR.scenePresetRequest) return;
    PTR.settings.scene_preset = scene?.id || "";
    PTR.refreshPreviewModels?.();
    if (PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = scene ? `使用「${scene.name}」的 ${scene.preview_models?.length || 0} 个 3D 场景模型` : "未选择 Blockbench 场景模型";
    if (PTR.tracer) rebuildScene();
    updateExportSummary();
    saveSettings();
  }
  async function syncBlockbenchBackground() {
    const request = ++PTR.backgroundPresetRequest;
    const scene = getBlockbenchScene(PTR.settings.background_preset);
    const previousEnv = PTR.customEnv;
    const previousMode = PTR.settings.env_mode;
    PTR.refreshPreviewBackgrounds?.();
    if (PTR.nodes.backgroundSource) PTR.nodes.backgroundSource.textContent = scene ? `正在读取「${scene.name}」的背景…` : "使用下方设置的 GeoRenderer 环境或自定义图片";
    try {
      const loaded = scene && PTR.customEnvSource !== "file" ? await loadBlockbenchScene(scene.id, { includeModels: false }) : null;
      if (request !== PTR.backgroundPresetRequest) return;
      if (scene && PTR.customEnvSource !== "file" && !loaded) throw new Error("背景未能加载，请检查 Minecraft EULA 状态");
      if (loaded && !loaded.environment && scene.id === "studio") {
        loaded.environment = { width: 512, height: 256, data: generateSkyPixels({ ...PTR.settings, ...SCENE_PRESETS.studio, sun_enable: false }, 512, 256) };
      }
      PTR.backgroundScene = loaded ? scene : null;
      PTR.sceneCubemap = loaded?.cubemap || null;
      if (loaded?.environment) {
        PTR.customEnv = loaded.environment;
        PTR.customEnvName = scene.name;
        PTR.customEnvSource = "scene";
        PTR.settings.env_mode = "image";
      } else if (PTR.customEnvSource !== "file" && (PTR.customEnv || PTR.settings.env_mode === "image")) {
        PTR.customEnv = null;
        PTR.customEnvName = "";
        PTR.customEnvSource = "";
        PTR.settings.env_mode = "sky";
      }
      if (PTR.nodes.backgroundSource) {
        PTR.nodes.backgroundSource.textContent = loaded?.environment ? `使用「${scene.name}」的${loaded.cubemap ? "天空盒" : "渐变背景"}，用于背景、环境光和反射` : scene ? `「${scene.name}」未提供背景贴图，使用 GeoRenderer 环境` : "使用下方设置的 GeoRenderer 环境或自定义图片";
      }
    } catch (err) {
      if (request !== PTR.backgroundPresetRequest) return;
      PTR.backgroundScene = null;
      PTR.sceneCubemap = null;
      if (PTR.customEnvSource !== "file" && (PTR.customEnv || PTR.settings.env_mode === "image")) {
        PTR.customEnv = null;
        PTR.customEnvName = "";
        PTR.customEnvSource = "";
        PTR.settings.env_mode = "sky";
      }
      if (PTR.nodes.backgroundSource) PTR.nodes.backgroundSource.textContent = `「${scene?.name || "所选背景"}」加载失败：${err.message}`;
    }
    if (PTR.nodes.envName) PTR.nodes.envName.textContent = PTR.customEnv ? `${PTR.customEnvName}（${PTR.customEnvSource === "scene" ? "背景预设" : "自定义文件"}）` : "(未载入)";
    syncControls();
    try {
      if (previousEnv !== PTR.customEnv || previousMode !== PTR.settings.env_mode) {
        if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
        else if (PTR.tracer) PTR.needsRebuild = true;
      }
    } catch (err) {
      showError(err);
    }
    updateExportSummary();
    saveSettings();
  }
  function buildSidebar() {
    PTR.controls = [];
    const resolutionCard = card("成片尺寸", "photo_size_select_large", [
      rowSelect("分辨率", "res_mode", { fit: "自适应窗口", custom: "自定义" }),
      rowNumber("宽度", "res_width", 32, 8192, 1),
      rowNumber("高度", "res_height", 32, 8192, 1),
      el("div", { class: "ptr_note", text: "画面左侧按最终长宽比取景；最终渲染使用这里的尺寸。" })
    ]);
    const renderCards = [
      card("预览质量", "preview", [
        rowSlider("预览比例", "preview_scale", 0.25, 1, 0.05, 2),
        rowNumber("预览采样数", "preview_samples", 1, 1e5, 1),
        el("div", { class: "ptr_note", text: "预览使用缩小后的目标尺寸；进入最终渲染时恢复成片尺寸。" })
      ]),
      card("光线追踪", "call_split", [
        rowSlider("最大反弹", "max_bounce", 1, 16, 1, 0),
        rowSlider("光源采样数", "light_samples", 1, 16, 1, 0),
        el("div", { class: "ptr_note", text: "每次反弹对灯光/太阳/环境光多次采样取平均，可显著降低噪点，但会增加相应倍数的渲染开销。" }),
        rowSlider("亮度截断", "clamp_value", 0, 100, 0.5, 1),
        el("div", { class: "ptr_note", text: "亮度截断可抑制萤火虫噪点，设为 0 表示关闭（更物理准确但收敛更慢）" })
      ]),
      card("性能", "speed", [
        rowSlider("交互降采样", "interactive_scale", 0.2, 1, 0.05, 2),
        rowSelect("GPU 模式", "gpu_profile", { auto: "自动检测", apple: "Apple GPU", standard: "标准" }),
        el("div", { class: "ptr_note", text: "自动检测不到 Apple GPU 时，可手动选择 Apple GPU。该模式优化拖动预览和全屏渲染缓冲。" }),
        rowCheck("平滑纹理（线性过滤）", "filter_linear"),
        el("div", { class: "ptr_note", text: "像素风格贴图建议关闭平滑纹理，以保留清晰的像素边界。" }),
        rowCheck("自动重载模型", "auto_follow")
      ])
    ];
    const camBtns = el("div", { class: "ptr_presets" });
    const btnSync = el("button", { class: "ptr_btn", text: "同步主视图" });
    btnSync.addEventListener("click", () => {
      if (PTR.cam.syncFromPreview()) {
        PTR.settings.fov = PTR.cam.fov;
        PTR.settings.ortho = PTR.cam.ortho;
        PTR.settings.camera_distance = PTR.cam.distance;
        syncControls();
        saveSettings();
        if (PTR.tracer) PTR.tracer.reset();
      }
    });
    const btnFrame = el("button", { class: "ptr_btn", text: "框选模型" });
    btnFrame.addEventListener("click", () => {
      if (PTR.tracer && PTR.tracer.scene) PTR.cam.frameBounds(PTR.tracer.scene.bounds);
      else if (PTR.raster && PTR.raster.model) {
        const bounds = new THREE.Box3().setFromObject(PTR.raster.model);
        if (!bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3());
          const size = bounds.getSize(new THREE.Vector3());
          PTR.cam.frameBounds({ center: center.toArray(), radius: size.length() / 2 });
        }
      }
      if (PTR.tracer) PTR.tracer.reset();
      PTR.settings.camera_distance = PTR.cam.distance;
      syncControls();
      saveSettings();
    });
    camBtns.appendChild(btnSync);
    camBtns.appendChild(btnFrame);
    const cameraCards = [
      card("取景说明", "lock", [
        el("div", { class: "ptr_note", text: "在左侧拖动、平移或缩放来确定镜头。进入第 4 步后镜头位置固定；要修改镜头请返回本步。" })
      ]),
      card("相机", "videocam", [
        camBtns,
        rowCheck("正交投影", "ortho"),
        rowSlider("FOV", "fov", 5, 120, 1, 0),
        rowSlider("镜头距离", "camera_distance", 0.5, 2e3, 0.5, 1),
        rowCheck("自动跟随主视图", "auto_sync")
      ]),
      card("景深", "filter_center_focus", [
        rowSlider("光圈", "aperture", 0, 8, 0.05, 2),
        rowCheck("自动对焦", "auto_focus"),
        rowNumber("对焦距离", "focus_distance", 0, 1e4, 0.5)
      ])
    ];
    const sceneSelect = el("select", { "aria-label": "场景（地面）" });
    PTR.refreshPreviewScenes = () => {
      const active = activeBlockbenchScene();
      sceneSelect.replaceChildren(el("option", { value: "", text: "无预览场景" }));
      for (const scene of listBlockbenchScenes()) {
        sceneSelect.appendChild(el("option", { value: scene.id, text: scene.name }));
      }
      sceneSelect.value = active?.id || "";
    };
    PTR.refreshPreviewScenes();
    const backgroundSelect = el("select", { "aria-label": "背景预设" });
    PTR.refreshPreviewBackgrounds = () => {
      backgroundSelect.replaceChildren(el("option", { value: "", text: "GeoRenderer 环境 / 自定义图片" }));
      for (const scene of listBlockbenchScenes()) {
        backgroundSelect.appendChild(el("option", { value: scene.id, text: scene.name }));
      }
      backgroundSelect.value = PTR.settings.background_preset || "";
    };
    PTR.refreshPreviewBackgrounds();
    backgroundSelect.addEventListener("change", async () => {
      backgroundSelect.disabled = true;
      PTR.settings.background_preset = backgroundSelect.value;
      PTR.customEnvSource = "";
      try {
        await syncBlockbenchBackground();
      } catch (err) {
        showError(err);
      } finally {
        backgroundSelect.disabled = false;
        if (PTR.dialog?.object?.isConnected) PTR.dialog.focus();
      }
    });
    const previewModelList = el("div", { class: "ptr_preview_model_list" });
    PTR.refreshPreviewModels = () => {
      previewModelList.replaceChildren();
      const models = listBlockbenchPreviewModels();
      if (!models.length) {
        previewModelList.appendChild(el("div", { class: "ptr_note", text: "没有可用的独立参照模型" }));
        return;
      }
      for (const model of models) {
        const box = el("input", { type: "checkbox", "aria-label": model.name });
        box.checked = model.enabled;
        box.addEventListener("change", () => {
          PTR.settings.preview_model_overrides = setBlockbenchPreviewModelEnabled(model.id, box.checked);
          if (PTR.tracer) rebuildScene();
          saveSettings();
        });
        previewModelList.appendChild(makeRow(model.name, [box]));
      }
    };
    PTR.refreshPreviewModels();
    sceneSelect.addEventListener("change", async () => {
      sceneSelect.disabled = true;
      try {
        if (!await selectBlockbenchScene(sceneSelect.value)) {
          PTR.nodes.sceneSource.textContent = "预览场景未能加载，请检查场景资源或 Minecraft EULA 状态";
          PTR.refreshPreviewScenes();
          return;
        }
        await syncBlockbenchScene();
      } catch (err) {
        showError(err);
        PTR.refreshPreviewScenes();
      } finally {
        sceneSelect.disabled = false;
        if (PTR.dialog?.object?.isConnected) PTR.dialog.focus();
      }
    });
    const refreshScenes = el("button", { class: "ptr_btn", text: "刷新场景列表" });
    refreshScenes.addEventListener("click", () => {
      PTR.refreshPreviewScenes();
      PTR.refreshPreviewBackgrounds();
      syncBlockbenchScene().catch(showError);
      syncBlockbenchBackground().catch(showError);
    });
    PTR.nodes.sceneSource = el("div", { class: "ptr_note", text: "读取场景模型…" });
    PTR.nodes.backgroundSource = el("div", { class: "ptr_note", text: "读取背景预设…" });
    PTR.nodes.timeDisplay = el("strong", { class: "ptr_time", text: formatClock(PTR.settings.time_of_day) });
    const envFile = el("input", { type: "file", accept: ".hdr,.png,.jpg,.jpeg,.webp", style: { display: "none" } });
    envFile.addEventListener("change", () => {
      const f = envFile.files && envFile.files[0];
      if (f) loadEnvFile(f);
      envFile.value = "";
    });
    const envBtns = el("div", { class: "ptr_presets" }, [envFile]);
    const btnLoad = el("button", { class: "ptr_btn", text: "载入 HDR / 图片" });
    btnLoad.addEventListener("click", () => envFile.click());
    const btnClear = el("button", { class: "ptr_btn", text: "清除" });
    btnClear.addEventListener("click", () => {
      PTR.backgroundPresetRequest++;
      PTR.customEnv = null;
      PTR.customEnvName = "";
      PTR.customEnvSource = "";
      PTR.sceneCubemap = null;
      PTR.backgroundScene = null;
      PTR.settings.background_preset = "";
      PTR.refreshPreviewBackgrounds();
      PTR.nodes.backgroundSource.textContent = "使用下方设置的 GeoRenderer 环境或自定义图片";
      PTR.nodes.envName.textContent = "(未载入)";
      if (PTR.settings.env_mode === "image") {
        PTR.settings.env_mode = "sky";
        syncControls();
      }
      try {
        if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, null);
        else if (PTR.tracer) PTR.needsRebuild = true;
      } catch (err) {
        showError(err);
      }
      updateExportSummary();
      saveSettings();
    });
    envBtns.appendChild(btnLoad);
    envBtns.appendChild(btnClear);
    PTR.nodes.envName = el("span", { class: "ptr_note", text: "(未载入)" });
    const envCards = [
      card("场景与背景", "public", [
        makeRow("场景（地面）", [sceneSelect]),
        makeRow("背景预设", [backgroundSelect]),
        refreshScenes,
        PTR.nodes.sceneSource,
        PTR.nodes.backgroundSource,
        el("div", { class: "ptr_note", text: "场景与背景独立选择，例如“平原地面 + 工作室背景”或“平原地面 + 下界背景”。这些设置只应用于 GeoRenderer。" }),
        el("div", { class: "ptr_note", text: "第 3～5 步沿用此组合；第 4、5 步追踪所选场景的几何与纹理，并使用所选背景的环境光。有场景几何时自动隐藏额外的 GeoRenderer 地面。" })
      ]),
      card("时间", "schedule", [
        rowSlider("当前时间", "time_of_day", 0, 24, 0.25, 2),
        PTR.nodes.timeDisplay,
        el("div", { class: "ptr_note", text: "时间会联动 GeoRenderer 的太阳光；背景预设的贴图保持原样。" })
      ]),
      card("独立参照模型", "accessibility_new", [
        previewModelList,
        el("div", { class: "ptr_note", text: "这些开关只影响 GeoRenderer 预览和渲染，不改变 Blockbench 主视图。" })
      ]),
      card("环境光", "wb_sunny", [
        rowSelect("环境类型", "env_mode", { sky: "程序化天空", gradient: "渐变", solid: "纯色", image: "背景预设 / HDR / 图片" }),
        envBtns,
        PTR.nodes.envName,
        rowSlider("环境强度", "env_intensity", 0, 20, 0.05, 2),
        rowSlider("环境旋转", "env_rotation", -180, 180, 1, 0),
        rowSelect("背景显示", "bg_mode", { env: "显示环境", color: "纯色", transparent: "透明" }),
        rowColor("背景颜色", "bg_color")
      ]),
      card("太阳", "brightness_high", [
        rowCheck("启用太阳", "sun_enable"),
        rowSlider("太阳高度", "sun_elevation", -90, 90, 0.5, 1),
        rowSlider("太阳方位", "sun_azimuth", 0, 360, 1, 0),
        rowSlider("太阳角直径", "sun_angle", 0.25, 45, 0.05, 2),
        rowSlider("太阳强度", "sun_intensity", 0, 40, 0.1, 2),
        rowColor("太阳颜色", "sun_color")
      ]),
      card("天空颜色", "gradient", [
        rowColor("天顶色", "sky_zenith"),
        rowColor("地平线色", "sky_horizon"),
        rowColor("地面色", "sky_ground"),
        rowSlider("雾霾", "sky_haze", 0, 1, 0.01, 2),
        rowColor("渐变-上", "grad_top"),
        rowColor("渐变-下", "grad_bottom"),
        rowColor("纯色环境", "solid_color")
      ]),
      card("地面", "landscape", [
        rowCheck("启用地面", "ground_on"),
        rowCheck("阴影捕捉（透明）", "ground_catcher"),
        rowNumber("地面高度", "ground_y", -1e3, 1e3, 0.5),
        rowColor("颜色", "ground_color"),
        makeGroundTextureRow(),
        rowSlider("纹理尺寸", "ground_texture_scale", 0.25, 64, 0.25, 2),
        rowSlider("粗糙度", "ground_rough", 0.02, 1, 0.01, 2),
        rowSlider("金属度", "ground_metal", 0, 1, 0.01, 2),
        rowNumber("半径（0=无限）", "ground_radius", 0, 1e5, 1),
        el("div", { class: "ptr_note", text: "阴影捕捉模式下地面本身不着色，只在背景中输出阴影的 alpha，配合“背景=透明”可导出带投影的透明 PNG" })
      ])
    ];
    PTR.nodes.matlist = el("div", { id: "ptr_matlist" });
    PTR.nodes.groupList = el("div", { id: "ptr_grouplist" });
    PTR.nodes.groupInspector = el("div", { id: "ptr_groupinspector" });
    const materialSettings = el("div", { class: "ptr_material_settings" }, [
      card("选中组的渲染参数", "tune", [PTR.nodes.groupInspector]),
      card("材质默认值", "palette", [
        rowSlider("默认粗糙度", "def_roughness", 0, 1, 0.01, 2),
        rowSlider("默认金属度", "def_metalness", 0, 1, 0.01, 2),
        rowSlider("全局自发光倍率", "emissive_strength", 0, 40, 0.1, 2),
        el("div", { class: "ptr_note", text: "部位与纹理的自发光强度都会乘以此倍率；0 会关闭所有自发光，1 保持设置的强度。" }),
        rowSelect("渲染面", "render_sides", { auto: "跟随 Blockbench", double: "强制双面", front: "强制单面" }),
        el("div", { class: "ptr_note", text: "跟随 Blockbench 时会按格式/纹理做背面剔除（Java 方块模型为单面），负尺寸方块因此只显示内部贴图，与视图一致。" }),
        rowSelect("Alpha 模式", "alpha_mode", { cutout: "裁剪（Minecraft）", blend: "混合（半透明）", opaque: "忽略透明" }),
        rowSlider("默认 Alpha 阈值", "alpha_cutoff", 0, 1, 0.01, 2),
        el("div", { class: "ptr_note", text: "裁剪: alpha 低于阈值的像素完全不可见(树叶/栅栏)。混合: 按 alpha 随机穿透，可渲染染色玻璃等半透明材质。" }),
        el("div", { class: "ptr_note", text: "带 MER 通道的材质组会自动使用金属/自发光/粗糙贴图；纹理“发光”渲染模式会被当作自发光光源。" })
      ]),
      card("逐纹理覆盖", "texture_add", [
        PTR.nodes.matlist
      ])
    ]);
    PTR.nodes.materialSettings = materialSettings;
    const outlineCard = card("模型组大纲", "account_tree", [
      el("div", { class: "ptr_note", text: "文件夹表示模型组；点击左侧模型也会定位到对应组。" }),
      PTR.nodes.groupList
    ]);
    outlineCard.classList.add("ptr_material_outline");
    const materialCards = [materialSettings, outlineCard];
    const postCards = [
      card("背景清晰度", "blur_on", [
        rowSlider("背景模糊度", "background_blur", 0, 100, 1, 0),
        el("div", { class: "ptr_note", text: "0 保留背景贴图的清晰度，数值越大越柔化。用于预览与最终渲染的环境背景，不改变环境照明与材质反射。光圈仍会产生景深虚化。" })
      ]),
      card("色调映射", "tune", [
        rowSelect("色调映射", "tone_mapping", { none: "无", reinhard: "Reinhard", aces: "ACES", filmic: "Filmic", agx: "AgX" }),
        rowSlider("曝光", "exposure", 0.05, 8, 0.01, 2),
        rowSlider("对比度", "contrast", 0.2, 3, 0.01, 2),
        rowSlider("饱和度", "saturation", 0, 3, 0.01, 2)
      ]),
      card("降噪", "blur_linear", [
        rowCheck("降噪", "denoise"),
        rowSlider("降噪强度", "denoise_strength", 0, 8, 0.05, 2)
      ]),
      card("后处理效果", "star", [
        rowCheck("泛光 Bloom", "bloom_enable"),
        rowSlider("泛光阈值", "bloom_threshold", 0, 10, 0.05, 2),
        rowSlider("泛光强度", "bloom_intensity", 0, 5, 0.01, 2),
        rowSlider("泛光半径", "bloom_radius", 0.2, 10, 0.1, 1),
        rowCheck("暗角 Vignette", "vignette_enable"),
        rowSlider("暗角强度", "vignette_strength", 0, 1.5, 0.01, 2),
        rowCheck("锐化 Sharpen", "sharpen_enable"),
        rowSlider("锐化强度", "sharpen_strength", 0, 2, 0.01, 2),
        rowCheck("胶片颗粒", "grain_enable"),
        rowSlider("颗粒强度", "grain_strength", 0, 0.3, 5e-3, 3)
      ]),
      card("水印", "text_format", [
        rowCheck("启用水印", "watermark_enable"),
        rowText("水印文本", "watermark_text", "例如：© 你的名字"),
        rowSlider("字号", "watermark_size", 8, 96, 1, 0),
        rowSlider("不透明度", "watermark_opacity", 0, 1, 0.01, 2),
        rowColor("颜色", "watermark_color"),
        el("div", { class: "ptr_note", text: "水印会显示在画面左下角，并包含在“保存 PNG”导出的图片中。" })
      ])
    ];
    const stages = buildStages([
      { id: "materials", cards: materialCards },
      { id: "scene", cards: envCards },
      { id: "camera", cards: [resolutionCard, ...cameraCards] },
      { id: "preview", cards: [...renderCards, ...postCards] },
      { id: "export", cards: buildExportPanel() }
    ]);
    buildGroupList();
    buildMaterialList();
    updateExportSummary();
    return stages;
  }

  // plugins/georenderer/src/ui/raster-materials.js
  function linearColor(color, value) {
    color.setRGB(...hexToLinear(value));
  }
  var RasterMaterials = class {
    constructor(settings2, overrides, groupOverrides) {
      this.settings = settings2;
      this.overrides = overrides;
      this.groupOverrides = groupOverrides;
      this.materials = [];
      this.textures = /* @__PURE__ */ new Map();
      this.imageTextures = /* @__PURE__ */ new Map();
      this.lookup = /* @__PURE__ */ new Map();
      for (const texture of typeof Texture !== "undefined" && Texture.all || []) {
        const material = texture.getMaterial?.() || texture.material;
        if (material) this.lookup.set(material, texture);
      }
      for (const group of typeof TextureGroup !== "undefined" && TextureGroup.all || []) {
        if (!group.is_material || !group.material) continue;
        this.lookup.set(group.material, group.getTextures().find((t) => t.pbr_channel === "color"));
      }
    }
    texture(image, encoding = THREE.sRGBEncoding, source = null) {
      if (!image) return null;
      const byEncoding = this.imageTextures.get(image) || /* @__PURE__ */ new Map();
      const cached = byEncoding.get(encoding);
      if (cached) return cached;
      const copy = source?.clone ? source.clone() : new THREE.Texture(image);
      copy.image = image;
      copy.encoding = encoding;
      copy.magFilter = this.settings.filter_linear ? THREE.LinearFilter : THREE.NearestFilter;
      copy.minFilter = copy.magFilter;
      copy.generateMipmaps = false;
      copy.needsUpdate = true;
      byEncoding.set(encoding, copy);
      this.imageTextures.set(image, byEncoding);
      this.textures.set(copy, copy);
      return copy;
    }
    merMaps(texture, colorImage) {
      const image = textureSource(texture);
      if (!image) return {};
      const key = `mer:${texture.uuid}`;
      if (this.textures.has(key)) return this.textures.get(key);
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const emission = document.createElement("canvas");
      emission.width = canvas.width;
      emission.height = canvas.height;
      const ec = emission.getContext("2d", { willReadFrequently: true });
      if (colorImage) ec.drawImage(colorImage, 0, 0, canvas.width, canvas.height);
      else {
        ec.fillStyle = "#ffffff";
        ec.fillRect(0, 0, canvas.width, canvas.height);
      }
      const ed = ec.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const metal = data.data[i], power = data.data[i + 1] / 255, rough = data.data[i + 2];
        data.data[i + 1] = rough;
        data.data[i + 2] = metal;
        for (let c = 0; c < 3; c++) ed.data[i + c] = Math.round(srgbToLinear(ed.data[i + c] / 255) * power * 255);
      }
      ctx.putImageData(data, 0, 0);
      ec.putImageData(ed, 0, 0);
      const maps = { surface: this.texture(canvas, THREE.LinearEncoding), emission: this.texture(emission, THREE.LinearEncoding) };
      this.textures.set(key, maps);
      return maps;
    }
    create(source, groupChain) {
      const texture = this.lookup.get(source);
      const ov = resolveMaterialOverride(texture, groupChain, this.overrides, this.groupOverrides);
      const settings2 = this.settings;
      const group = texture?.getGroup?.();
      const channels = group?.is_material ? group.getTextures() : [];
      const colorImage = textureSource(channels.find((t) => t.pbr_channel === "color") || texture);
      const sourceMap = source.uniforms?.map?.value || source.map;
      const map = this.texture(colorImage || sourceMap?.image, THREE.sRGBEncoding, sourceMap);
      const material = ov.transmission > 0 ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
      material.map = map;
      if (ov.color) linearColor(material.color, ov.color);
      else if (!map && source.color) material.color.copy(source.color);
      else material.color.set(map ? "#ffffff" : "#cccccc");
      material.roughness = ov.roughness ?? settings2.def_roughness;
      material.metalness = ov.metalness ?? settings2.def_metalness;
      material.side = texture ? { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide }[getMaterialSide(texture, settings2.render_sides)] : source.side;
      material.visible = source.visible !== false;
      material.skinning = !!source.skinning;
      material.morphTargets = !!source.morphTargets;
      material.morphNormals = !!source.morphNormals;
      material.flatShading = !!source.flatShading;
      const alphaMode = ov.alpha_mode || settings2.alpha_mode;
      material.transparent = alphaMode === "blend";
      material.depthWrite = !material.transparent;
      material.alphaTest = alphaMode === "cutout" ? ov.alpha_cutoff ?? settings2.alpha_cutoff : 0;
      material.opacity = source.opacity ?? 1;
      material.vertexColors = !!source.vertexColors;
      const mer = channels.find((t) => t.pbr_channel === "mer");
      const maps = this.merMaps(mer, colorImage || sourceMap?.image);
      if (maps.surface) {
        if (ov.roughness == null) {
          material.roughnessMap = maps.surface;
          material.roughness = 1;
        }
        if (ov.metalness == null) {
          material.metalnessMap = maps.surface;
          material.metalness = 1;
        }
      }
      const normal = channels.find((t) => t.pbr_channel === "normal");
      material.normalMap = this.texture(textureSource(normal), THREE.LinearEncoding) || source.normalMap || null;
      material.normalScale.setScalar(ov.normal_scale ?? 1);
      const emissiveDefault = mer || texture?.render_mode === "emissive" || texture?.render_mode === "additive" ? 1 : 0;
      material.emissiveIntensity = (ov.emissive ?? emissiveDefault) * settings2.emissive_strength;
      linearColor(material.emissive, ov.emissive != null ? ov.emissive_color || "#ffffff" : "#ffffff");
      material.emissive.multiply(material.color);
      material.emissiveMap = ov.emissive != null ? map : maps.emission || map;
      if (ov.emissive == null && !mer && ov.emissive_map) {
        const image = textureSource((typeof Texture !== "undefined" && Texture.all || []).find((t) => t.uuid === ov.emissive_map));
        material.emissiveMap = this.texture(image);
      }
      if (ov.transmission > 0) {
        material.transmission = ov.transmission;
        material.ior = ov.ior ?? 1.5;
      }
      this.materials.push(material);
      return material;
    }
    dispose() {
      for (const material of this.materials) material.dispose();
      for (const texture of this.textures.values()) if (texture.isTexture) texture.dispose();
      this.materials = [];
      this.textures.clear();
      this.imageTextures.clear();
    }
  };

  // plugins/georenderer/src/ui/raster-environment.js
  var ENV_KEYS = ["env_mode", "env_rotation", "time_of_day", "sky_zenith", "sky_horizon", "sky_ground", "sky_haze", "grad_top", "grad_bottom", "solid_color", "sun_enable", "sun_elevation", "sun_azimuth", "sun_angle", "sun_intensity", "sun_color"];
  function rotatePixels(data, width, height, rotation) {
    const rotated = new Float32Array(data.length);
    const shift = Math.round((rotation || 0) / 360 * width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = ((x + shift) % width + width) % width;
      rotated.set(data.subarray((y * width + sx) * 4, (y * width + sx) * 4 + 4), (y * width + x) * 4);
    }
    return rotated;
  }
  var RasterEnvironment = class {
    constructor(renderer) {
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.maxTextureSize = renderer.capabilities?.maxTextureSize || MAX_ENV_IMAGE_SIZE;
      this.target = null;
      this.key = "";
      this.source = null;
      this.background = null;
    }
    sync(settings2, customEnv) {
      const source = settings2.env_mode === "image" ? customEnv : null;
      const key = JSON.stringify(ENV_KEYS.map((k) => settings2[k]));
      if (this.target && this.key === key && this.source === source) return this.target.texture;
      const w = 256, h = 128;
      const data = source ? resampleEquirect(source, w, h) : generateSkyPixels(settings2, w, h);
      const rotated = rotatePixels(data, w, h, settings2.env_rotation);
      const texture = new THREE.DataTexture(rotated, w, h, THREE.RGBAFormat, THREE.FloatType);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.flipY = true;
      texture.needsUpdate = true;
      let target;
      try {
        target = this.pmrem.fromEquirectangular(texture);
      } finally {
        texture.dispose();
      }
      this.target?.dispose();
      this.background?.dispose();
      const bgWidth = source ? Math.min(MAX_ENV_IMAGE_SIZE, this.maxTextureSize, source.width) : w;
      const bgHeight = source ? Math.max(1, Math.round(bgWidth * source.height / source.width)) : h;
      const bgData = source ? rotatePixels(resampleEquirect(source, bgWidth, bgHeight), bgWidth, bgHeight, settings2.env_rotation) : rotated;
      this.background = new THREE.DataTexture(bgData, bgWidth, bgHeight, THREE.RGBAFormat, THREE.FloatType);
      this.background.mapping = THREE.EquirectangularReflectionMapping;
      this.background.magFilter = THREE.LinearFilter;
      this.background.minFilter = THREE.LinearFilter;
      this.background.flipY = true;
      this.background.needsUpdate = true;
      this.target = target;
      this.key = key;
      this.source = source;
      return target.texture;
    }
    release() {
      this.target?.dispose();
      this.background?.dispose();
      this.target = this.background = this.source = null;
      this.key = "";
    }
    dispose() {
      this.release();
      this.pmrem.dispose();
    }
  };

  // plugins/georenderer/src/ui/raster-preview.js
  var RasterPreview = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.environment = new RasterEnvironment(this.renderer);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e5);
      this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1e5);
      this.raycaster = new THREE.Raycaster();
      this.pointer = new THREE.Vector2();
      this.activeCamera = this.camera;
      this.ambient = new THREE.AmbientLight(16777215, 1.2);
      this.sun = new THREE.DirectionalLight(16777215, 1.5);
      this.scene.add(this.ambient, this.sun);
      this.grid = new THREE.GridHelper(256, 32, 5990516, 3489096);
      this.scene.add(this.grid);
      this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2e3, 2e3), new THREE.MeshStandardMaterial({ color: 11053224, roughness: 0.9 }));
      this.groundMap = null;
      this.floor.rotation.x = -Math.PI / 2;
      this.scene.add(this.floor);
      this.groundDisk = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.floor.material);
      this.groundDisk.rotation.x = -Math.PI / 2;
      this.scene.add(this.groundDisk);
      this.model = new THREE.Group();
      this.previewModels = new THREE.Group();
      this.previewModelSources = [];
      this.previewModelKey = "";
      this.selectionHelper = null;
      this.ownedMaterials = [];
      this.scene.add(this.previewModels, this.model);
      this.raf = 0;
      this.running = false;
      this.refreshModel();
    }
    refreshModel() {
      this.model.clear();
      this.materials?.dispose();
      this.materials = new RasterMaterials(PTR.settings, PTR.overrides, PTR.groupOverrides);
      this.ownedMaterials = this.materials.materials;
      if (typeof Canvas !== "undefined" && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
      const elements = typeof Outliner !== "undefined" && Outliner.elements || [];
      for (const element of elements) {
        const mesh = element && element.mesh;
        if (!mesh || element.visibility === false || mesh.visible === false) continue;
        const clone = mesh.clone(true);
        clone.userData.georendererSourceMesh = mesh;
        const groupChain = groupChainForElement(element);
        clone.traverse((object) => {
          object.userData.georendererGroupChain = groupChain;
        });
        clone.traverse((object) => {
          if (!object.isMesh || !object.material) return;
          const customize = (material) => this.materials.create(material, groupChain);
          object.material = Array.isArray(object.material) ? object.material.map(customize) : customize(object.material);
        });
        clone.matrix.copy(mesh.matrixWorld);
        clone.matrixAutoUpdate = false;
        this.model.add(clone);
      }
      this.model.updateMatrixWorld(true);
      this.highlightGroup(PTR.selectedGroupUuid);
    }
    syncModelPose() {
      if (typeof Canvas !== "undefined" && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
      for (const clone of this.model.children) {
        const source = clone.userData.georendererSourceMesh;
        if (!source) continue;
        clone.visible = source.visible;
        clone.matrix.copy(source.matrixWorld);
      }
      this.model.updateMatrixWorld(true);
    }
    pickGroupAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      this.pointer.set(
        (clientX - rect.left) / rect.width * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointer, this.activeCamera);
      for (const hit of this.raycaster.intersectObjects(this.model.children, true)) {
        const chain = hit.object.userData.georendererGroupChain;
        if (chain?.length) return chain[0];
      }
      return null;
    }
    highlightGroup(uuid) {
      if (this.selectionHelper) {
        this.scene.remove(this.selectionHelper);
        this.selectionHelper.geometry.dispose();
        this.selectionHelper.material.dispose();
        this.selectionHelper = null;
      }
      if (!uuid) return;
      const bounds = new THREE.Box3();
      for (const clone of this.model.children) {
        if (clone.userData.georendererGroupChain?.includes(uuid)) bounds.expandByObject(clone);
      }
      if (bounds.isEmpty()) return;
      this.selectionHelper = new THREE.Box3Helper(bounds, new THREE.Color("#ffb74d"));
      this.scene.add(this.selectionHelper);
    }
    setGroundTexture(texture) {
      if (this.groundMap) this.groundMap.dispose();
      const image = texture && (texture.canvas || texture.img);
      this.groundMap = image ? new THREE.Texture(image) : null;
      if (this.groundMap) {
        this.groundMap.wrapS = THREE.RepeatWrapping;
        this.groundMap.wrapT = THREE.RepeatWrapping;
        this.groundMap.needsUpdate = true;
      }
      this.floor.material.map = this.groundMap;
      this.floor.material.needsUpdate = true;
    }
    syncPreviewModels() {
      const models = activeBlockbenchPreviewModels();
      const key = models.map((model) => {
        const root = model.model_3d;
        return `${root.uuid}:${root.children.map((child) => child.uuid).join(",")}`;
      }).join("|");
      if (key !== this.previewModelKey) {
        this.previewModels.clear();
        this.previewModelSources = models.map((model) => {
          const clone = model.model_3d.clone(true);
          clone.matrixAutoUpdate = false;
          this.previewModels.add(clone);
          return { source: model.model_3d, clone };
        });
        this.previewModelKey = key;
      }
      for (const { source, clone } of this.previewModelSources) {
        source.updateWorldMatrix(true, false);
        clone.matrix.copy(source.matrixWorld);
        clone.visible = source.visible;
      }
      this.previewModels.updateMatrixWorld(true);
      return models;
    }
    draw() {
      this.syncModelPose();
      const width = Math.max(1, this.canvas.clientWidth);
      const height = Math.max(1, this.canvas.clientHeight);
      if (this.width !== width || this.height !== height) {
        this.width = width;
        this.height = height;
        this.renderer.setSize(width, height, false);
      }
      const settings2 = PTR.settings;
      this.renderer.toneMapping = { none: THREE.NoToneMapping, reinhard: THREE.ReinhardToneMapping, filmic: THREE.CineonToneMapping }[settings2.tone_mapping] ?? THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = settings2.exposure;
      for (const material of this.ownedMaterials) material.envMapIntensity = settings2.env_intensity;
      if (settings2.auto_sync && PTR.step === "camera" && PTR.cam.syncFromPreview()) {
        if (settings2.fov !== PTR.cam.fov || settings2.ortho !== PTR.cam.ortho || settings2.camera_distance !== PTR.cam.distance) {
          settings2.fov = PTR.cam.fov;
          settings2.ortho = PTR.cam.ortho;
          settings2.camera_distance = PTR.cam.distance;
          syncControls();
          saveSettings();
        }
      }
      const inspection = PTR.step === "materials" || PTR.step === "scene";
      const blockbenchScene = PTR.step === "materials" ? null : activeBlockbenchScene();
      const backgroundScene = PTR.step !== "materials" && settings2.env_mode === "image" && PTR.customEnvSource === "scene" ? PTR.backgroundScene : null;
      const cam = (inspection ? PTR.inspectionCam : PTR.cam).state();
      if (PTR.step === "scene" && blockbenchScene?.fov && !cam.ortho) cam.fov = blockbenchScene.fov;
      const target = cam.ortho ? this.orthoCamera : this.camera;
      if (cam.ortho) {
        const halfH = cam.orthoHalfHeight;
        target.left = -halfH * width / height;
        target.right = halfH * width / height;
        target.top = halfH;
        target.bottom = -halfH;
      } else {
        target.fov = cam.fov;
        target.aspect = width / height;
      }
      target.updateProjectionMatrix();
      target.position.set(...cam.pos);
      target.lookAt(...cam.target);
      target.updateMatrixWorld(true);
      this.activeCamera = target;
      this.previewModels.visible = PTR.step !== "materials";
      const previewModels = this.previewModels.visible ? this.syncPreviewModels() : [];
      this.grid.visible = PTR.step === "materials";
      const hasSceneGeometry = blockbenchScene?.preview_models?.some((model) => previewModels.includes(model));
      const showGround = !this.grid.visible && !hasSceneGeometry;
      this.floor.visible = showGround && !!settings2.ground_on && !(settings2.ground_radius > 0);
      this.groundDisk.visible = showGround && !!settings2.ground_on && settings2.ground_radius > 0;
      this.floor.position.y = settings2.ground_y;
      this.groundDisk.position.y = settings2.ground_y;
      if (this.groundDisk.visible) this.groundDisk.scale.setScalar(settings2.ground_radius);
      this.floor.material.color.set(settings2.ground_color);
      this.floor.material.roughness = settings2.ground_rough;
      this.floor.material.metalness = settings2.ground_metal;
      this.floor.material.transparent = !!settings2.ground_catcher;
      this.floor.material.opacity = settings2.ground_catcher ? 0.25 : 1;
      if (this.groundMap) {
        const repeat = 2e3 / Math.max(0.01, settings2.ground_texture_scale || 1);
        this.groundMap.repeat.set(repeat, repeat);
      }
      const daylight = Math.max(0.1, Math.min(1, (Math.sin((settings2.time_of_day - 6) * Math.PI / 12) + 0.2) / 1.2));
      this.ambient.intensity = 0.2 + daylight * Math.max(0, settings2.env_intensity);
      this.ambient.color.copy(backgroundScene?.light_color || new THREE.Color(16777215));
      this.sun.visible = !!settings2.sun_enable;
      const dir = sunDirection(settings2);
      this.sun.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
      this.sun.intensity = Math.max(0, settings2.sun_intensity / 4);
      this.sun.color.set(settings2.sun_color);
      this.scene.fog = backgroundScene?.fog || null;
      this.scene.environment = this.environment.sync(settings2, PTR.customEnv);
      this.scene.background = this.grid.visible ? new THREE.Color("#20242b") : settings2.bg_mode === "transparent" ? null : settings2.bg_mode === "color" ? new THREE.Color(settings2.bg_color) : this.environment.background;
      this.renderer.render(this.scene, target);
    }
    start() {
      if (this.running) return;
      this.running = true;
      const frame = () => {
        if (!this.running) return;
        if (this.canvas.isConnected) this.draw();
        this.raf = requestAnimationFrame(frame);
      };
      frame();
    }
    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.scene.environment = this.scene.background = null;
      this.environment.release();
    }
    dispose() {
      this.stop();
      this.highlightGroup(null);
      this.model.clear();
      this.previewModels.clear();
      this.previewModelSources = [];
      this.materials?.dispose();
      this.ownedMaterials = [];
      this.environment.dispose();
      this.floor.geometry.dispose();
      this.groundDisk.geometry.dispose();
      this.floor.material.dispose();
      if (this.groundMap) this.groundMap.dispose();
      this.renderer.dispose();
    }
  };

  // plugins/georenderer/src/ui/window.js
  function attachViewportEvents(canvas) {
    let dragging = 0;
    let lastX = 0, lastY = 0;
    let startX = 0, startY = 0, moved = false;
    const activeCamera = () => canMoveCamera(PTR.step) ? PTR.cam : PTR.inspectionCam;
    const endDrag = () => {
      dragging = 0;
      canvas.classList.remove("dragging");
      if (canMoveCamera(PTR.step)) {
        clearTimeout(PTR.interactTimer);
        PTR.interactTimer = setTimeout(() => setInteracting(false), 200);
      }
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (!canNavigatePreview(PTR.step) || e.button > 2) return;
      dragging = e.button === 0 && !e.shiftKey && !e.ctrlKey ? 1 : 2;
      lastX = startX = e.clientX;
      lastY = startY = e.clientY;
      moved = false;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
      if (!moved) return;
      canvas.classList.add("dragging");
      if (canMoveCamera(PTR.step)) {
        clearTimeout(PTR.interactTimer);
        setInteracting(true);
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const camera = activeCamera();
      if (dragging === 1) camera.orbit(dx, dy);
      else camera.pan(dx / Math.max(canvas.clientWidth, 1), dy / Math.max(canvas.clientHeight, 1), 1);
      if (canMoveCamera(PTR.step) && PTR.tracer) PTR.tracer.reset();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (dragging && !moved && PTR.step === "materials" && e.button === 0) {
        const uuid = PTR.raster?.pickGroupAt(e.clientX, e.clientY);
        if (uuid) selectGroup(uuid);
      }
      endDrag();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
      }
    });
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
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
    const canvas = el("canvas", { id: "ptr_canvas" });
    const rasterCanvas = el("canvas", { id: "ptr_raster_canvas" });
    const finalCanvas = el("canvas", { id: "ptr_final_canvas", style: { display: "none" } });
    const overlay = el("div", { id: "ptr_overlay", text: "准备中（首次加载可能会较为卡顿）…" });
    const watermark = el("div", { id: "ptr_watermark" });
    const frame = el("div", { id: "ptr_frame" }, [rasterCanvas, canvas, finalCanvas, overlay, watermark]);
    frame.dataset.textureFilter = PTR.settings.filter_linear ? "linear" : "nearest";
    const viewport = el("div", { id: "ptr_viewport" }, [frame]);
    const sidebar = buildSidebar();
    const root = el("div", { id: "ptr_root" }, [viewport, sidebar]);
    const nav = el("nav", { id: "ptr_step_nav", "aria-label": "渲染流程" });
    PTR.nodes.navButtons = {};
    for (const [index, step] of STEPS.entries()) {
      const button = el("button", { type: "button", class: "ptr_step", title: step.label }, [
        el("span", { class: "ptr_step_number", text: String(index + 1) }),
        el("span", { text: step.label })
      ]);
      button.addEventListener("click", () => setStep(step.id));
      PTR.nodes.navButtons[step.id] = button;
      nav.appendChild(button);
    }
    const bar = el("div");
    const progress = el("div", { id: "ptr_progress" }, [bar]);
    const status = el("div", { id: "ptr_status", text: "" });
    const btnPauseIcon = el("i", { class: "material-icons", text: "pause" });
    const btnPauseLabel = el("span", { text: "暂停" });
    const btnPause = el("button", { class: "ptr_btn" }, [btnPauseIcon, btnPauseLabel]);
    btnPause.addEventListener("click", () => {
      PTR.paused = !PTR.paused;
      PTR.lastFrame = performance.now();
      updateStatus();
    });
    const btnStart = el("button", { class: "ptr_btn accent", text: "开始最终渲染" });
    btnStart.addEventListener("click", startFinal);
    const iconBtn = (icon, title, onClick) => {
      const b = el("button", { class: "ptr_iconbtn", title }, [el("i", { class: "material-icons", text: icon })]);
      b.addEventListener("click", onClick);
      return b;
    };
    const btnRestart = iconBtn("replay", "重新开始", () => {
      if (PTR.tracer) PTR.tracer.reset();
    });
    const btnReload = iconBtn("refresh", "重载模型", () => rebuildScene());
    const btnDefault = iconBtn("undo", "重置为默认参数", () => resetToDefaults());
    const btnExport = iconBtn("file_upload", "导出配置（不含材质单独设置）到剪贴板", () => exportSettingsToClipboard());
    const btnImport = iconBtn("file_download", "从剪贴板导入配置（不含材质单独设置）", () => importSettingsFromClipboard());
    const btnSave = el("button", { class: "ptr_btn accent" }, [
      el("i", { class: "material-icons", text: "save" }),
      el("span", { text: "保存 PNG" })
    ]);
    btnSave.addEventListener("click", saveImage);
    const btnCopy = el("button", { class: "ptr_btn", text: "复制图片" });
    btnCopy.addEventListener("click", copyImage);
    const btnBlockbench = el("button", { class: "ptr_btn", text: "Blockbench 截图" });
    btnBlockbench.addEventListener("click", openBlockbenchScreenshot);
    const toolGroup = el("div", { style: { display: "flex", alignItems: "center", gap: "2px" } }, [
      btnRestart,
      btnReload,
      btnDefault,
      btnExport,
      btnImport
    ]);
    const footer = el("div", { id: "ptr_footer" }, [
      status,
      progress,
      btnStart,
      btnPause,
      toolGroup,
      btnCopy,
      btnSave,
      btnBlockbench
    ]);
    const wrapper = el("div", {
      style: { display: "flex", flexDirection: "column", height: "100%", minHeight: "420px" }
    }, [nav, root, footer]);
    PTR.nodes = Object.assign(PTR.nodes || {}, {
      canvas,
      rasterCanvas,
      finalCanvas,
      frame,
      overlay,
      viewport,
      sidebar,
      status,
      bar,
      wrapper,
      btnPause,
      btnPauseIcon,
      btnPauseLabel,
      watermark,
      btnStart,
      btnCopy,
      btnSave,
      btnBlockbench,
      toolGroup,
      footer
    });
    root.style.flex = "1 1 auto";
    root.style.minHeight = "0";
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
    frame.style.width = Math.floor(w) + "px";
    frame.style.height = Math.floor(w / aspect) + "px";
  }
  function syncSettingsToView() {
    if (PTR.nodes.frame) PTR.nodes.frame.dataset.textureFilter = PTR.settings.filter_linear ? "linear" : "nearest";
    restoreBlockbenchSceneSelection(PTR.settings.scene_preset);
    restoreBlockbenchPreviewModelOverrides(PTR.settings.preview_model_overrides);
    syncBlockbenchScene().catch(showError);
    syncBlockbenchBackground().catch(showError);
    PTR.cam.fov = PTR.settings.fov;
    PTR.cam.ortho = !!PTR.settings.ortho;
    PTR.cam.distance = PTR.settings.camera_distance;
    if (PTR.raster) PTR.raster.setGroundTexture((typeof Texture !== "undefined" && Texture.all || []).find((texture) => texture.uuid === PTR.settings.ground_texture_uuid));
    if (PTR.nodes.timeDisplay) PTR.nodes.timeDisplay.textContent = formatClock(PTR.settings.time_of_day);
    fitFrame();
    updateExportSummary();
  }
  function showRenderDialog() {
    if (PTR.dialog) return;
    PTR.dialog = new Dialog("georenderer_dialog", {
      title: "几何渲染器",
      width: 1180,
      resizable: true,
      darken: false,
      cancel_on_click_outside: false,
      buttons: [],
      lines: [PTR.nodes.wrapper],
      onCancel() {
        closeWindow();
        return false;
      },
      onResize() {
        clearTimeout(PTR.interactTimer);
        setInteracting(true);
        PTR.interactTimer = setTimeout(() => setInteracting(false), 250);
      }
    });
    PTR.dialog.show();
    PTR.dialog.object?.classList.add("ptr_dialog_root");
    if (PTR.dialog.object && !PTR.dialog.object.style.height) {
      const h = Math.round(clamp(window.innerHeight * 0.72, 420, window.innerHeight - 60));
      PTR.dialog.object.style.height = h + "px";
    }
    if (!PTR.frameResizeObs && typeof ResizeObserver !== "undefined") {
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
    PTR.raster.setGroundTexture((typeof Texture !== "undefined" && Texture.all || []).find((texture) => texture.uuid === PTR.settings.ground_texture_uuid));
  }
  function updateExportActions() {
    PTR.nodes.btnPauseIcon.textContent = PTR.paused ? "play_arrow" : "pause";
    PTR.nodes.btnPauseLabel.textContent = PTR.paused ? "继续" : "暂停";
    const completed = PTR.finalRender ? PTR.finalRender.completed : !PTR.tracer?.frameSync;
    const ready = canExport(PTR.step, PTR.finalStarted, PTR.tracer ? PTR.tracer.spp : 0, PTR.settings.final_samples, completed);
    for (const button of [PTR.nodes.btnCopy, PTR.nodes.btnSave, PTR.nodes.btnBlockbench]) button.disabled = !ready;
    PTR.nodes.btnStart.disabled = !PTR.tracer || PTR.finalStarted && !ready;
    PTR.nodes.btnStart.textContent = ready ? "重新渲染" : PTR.finalStarted ? "渲染中…" : "开始最终渲染";
  }
  function setStep(id) {
    if (stepIndex(id) < 0 || !PTR.dialog) return;
    if (id !== "export") clearFinalRender();
    const wasTrace = isTraceStep(PTR.step);
    const trace = isTraceStep(id);
    if (id === "camera" || trace) initializeCamera();
    if (trace && !wasTrace) {
      PTR.lockedCamera = PTR.cam.state();
      PTR.interacting = false;
    }
    PTR.step = id;
    PTR.nodes.frame.dataset.step = id;
    for (const step of STEPS) {
      const active = step.id === id;
      PTR.nodes.navButtons[step.id].classList.toggle("active", active);
      PTR.nodes.navButtons[step.id].setAttribute("aria-current", active ? "step" : "false");
      PTR.nodes.stagePanes[step.id].hidden = !active;
    }
    PTR.nodes.canvas.style.display = trace && !PTR.finalRender ? "block" : "none";
    if (PTR.nodes.finalCanvas) PTR.nodes.finalCanvas.style.display = trace && PTR.finalRender ? "block" : "none";
    PTR.nodes.rasterCanvas.style.display = trace ? "none" : "block";
    PTR.nodes.overlay.style.display = trace ? "" : "none";
    PTR.nodes.watermark.style.display = trace ? "" : "none";
    PTR.nodes.footer.style.display = trace ? "flex" : "none";
    PTR.nodes.btnStart.style.display = id === "export" ? "" : "none";
    PTR.nodes.btnSave.style.display = id === "export" ? "" : "none";
    PTR.nodes.btnCopy.style.display = id === "export" ? "" : "none";
    PTR.nodes.btnBlockbench.style.display = id === "export" ? "" : "none";
    PTR.nodes.btnPause.style.display = id === "preview" || PTR.finalStarted ? "" : "none";
    PTR.nodes.toolGroup.style.display = id === "preview" ? "flex" : "none";
    if (trace) {
      if (PTR.raster) PTR.raster.stop();
      if (!PTR.tracer) {
        PTR.settings.render_mode = "preview";
        PTR.finalStarted = false;
        try {
          startRenderer();
        } catch (err) {
          showError(err);
        }
      } else {
        if (!wasTrace) PTR.tracer.setCamera(PTR.lockedCamera);
        if (!PTR.open) resumeRenderer();
        if (id === "preview" || !PTR.finalStarted) {
          if (PTR.settings.render_mode !== "preview") PTR.tracer.reset();
          PTR.settings.render_mode = "preview";
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
    if (PTR.step !== "export" || !PTR.tracer) return;
    const rect = PTR.nodes.frame.getBoundingClientRect();
    const target = resolveRenderSize(PTR.settings, "export", true, rect, false);
    const gl = PTR.tracer.gl;
    const sizeError = validateFinalSize(target.width, target.height, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (sizeError) {
      showError(new Error(sizeError));
      return;
    }
    try {
      clearFinalRender();
      const limit = Math.min(MAX_RENDER_BUFFER_SIDE, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const job = new TiledRender(PTR.nodes.finalCanvas, target.width, target.height, PTR.settings, limit);
      PTR.finalRender = job;
      if (PTR.tracer.spp > 0) job.context.drawImage(PTR.tracer.canvas, 0, 0, target.width, target.height);
      PTR.tracer.resize(job.plan.bufferWidth, job.plan.bufferHeight);
      job.startTile(PTR.tracer);
      PTR.finalStarted = true;
      PTR.settings.render_mode = "final";
      PTR.paused = false;
      PTR.passesPerFrame = 1;
      PTR.spsEma = 0;
      PTR.lastPasses = 0;
      PTR.nodes.canvas.style.display = "none";
      PTR.nodes.finalCanvas.style.display = "block";
      PTR.nodes.btnPause.style.display = "";
      PTR.lastFrame = performance.now();
      updateStatus();
      updateExportActions();
      saveSettings();
    } catch (err) {
      clearFinalRender();
      PTR.finalStarted = false;
      PTR.settings.render_mode = "preview";
      PTR.nodes.canvas.style.display = "block";
      try {
        applyResolution();
      } catch (recoveryError) {
        showError(recoveryError);
      }
      showError(err);
    }
  }
  function clearFinalRender() {
    PTR.finalRender?.dispose();
    PTR.finalRender = null;
    if (PTR.tracer) PTR.tracer.renderWindow = null;
    if (PTR.nodes.finalCanvas) PTR.nodes.finalCanvas.style.display = "none";
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
          if (PTR.settings.res_mode === "fit") applyResolution();
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
  function openWindow() {
    if (typeof Dialog === "undefined") return;
    if (PTR.dialog) closeWindow();
    try {
      PTR.step = "materials";
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
      syncBlockbenchBackground().catch(showError);
      if (!PTR.inspectionCam.syncFromPreview()) {
        const bounds = new THREE.Box3().setFromObject(PTR.raster.model);
        if (!bounds.isEmpty()) {
          const center = bounds.getCenter(new THREE.Vector3());
          const size = bounds.getSize(new THREE.Vector3());
          PTR.inspectionCam.frameBounds({ center: center.toArray(), radius: size.length() / 2 });
        }
      }
      if (typeof Group !== "undefined" && Group.first_selected) selectGroup(Group.first_selected.uuid);
      PTR.onSettingChanged = (key) => {
        if (key === "final_samples" && PTR.finalRender) {
          PTR.finalRender.updateSamples(PTR.settings.final_samples, PTR.tracer);
          updateExportActions();
        }
        if (key === "filter_linear") PTR.nodes.frame.dataset.textureFilter = PTR.settings.filter_linear ? "linear" : "nearest";
        if (key === "res_width" || key === "res_height") fitFrame();
        if (key === "fov") PTR.cam.fov = PTR.settings.fov;
        if (key === "ortho") PTR.cam.ortho = !!PTR.settings.ortho;
        if (key === "camera_distance") PTR.cam.distance = PTR.settings.camera_distance;
        if (key === "time_of_day") {
          applyTimeOfDay(PTR.settings, PTR.settings.time_of_day);
          if (PTR.nodes.timeDisplay) PTR.nodes.timeDisplay.textContent = formatClock(PTR.settings.time_of_day);
          syncControls();
        }
        if (key === "ground_texture_uuid" && PTR.raster) PTR.raster.setGroundTexture((Texture.all || []).find((texture) => texture.uuid === PTR.settings.ground_texture_uuid));
        updateExportSummary();
      };
      PTR.onRenderStatus = updateExportActions;
      PTR.onSettingsLoaded = syncSettingsToView;
      setStep("materials");
    } catch (err) {
      showError(err);
      closeWindow();
    }
  }
  function closeWindow() {
    PTR.scenePresetRequest++;
    PTR.backgroundPresetRequest++;
    clearTimeout(PTR.interactTimer);
    clearTimeout(PTR.rebuildTimer);
    clearTimeout(PTR.rasterRefreshTimer);
    clearFinalRender();
    closeRenderer();
    if (PTR.raster) {
      PTR.raster.dispose();
      PTR.raster = null;
    }
    if (PTR.frameResizeObs) {
      PTR.frameResizeObs.disconnect();
      PTR.frameResizeObs = null;
    }
    if (PTR.dialog) {
      try {
        PTR.dialog.hide();
        PTR.dialog.delete();
      } catch (err) {
      }
      PTR.dialog = null;
    }
    PTR.onSettingChanged = null;
    PTR.onRenderStatus = null;
    PTR.onSettingsLoaded = null;
    PTR.needsRebuild = false;
    PTR.refreshMaterialList = null;
    PTR.refreshGroundTextures = null;
    PTR.refreshPreviewScenes = null;
    PTR.refreshPreviewBackgrounds = null;
    PTR.refreshPreviewModels = null;
    PTR.lockedCamera = null;
    PTR.cameraInitialized = false;
    PTR.needsPresent = false;
    PTR.selectedGroupUuid = null;
    PTR.controls = [];
    PTR.nodes = {};
  }

  // plugins/georenderer/src/assets/georenderer.css
  var georenderer_default = `
#ptr_root { display: flex; height: 100%; min-height: 480px; gap: 0; }
#ptr_root * { box-sizing: border-box; }
#ptr_step_nav { display: flex; gap: 6px; padding: 9px 12px; background: var(--color-ui); border-bottom: 1px solid var(--color-border); }
.ptr_step { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 7px 5px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-back); color: var(--color-text); cursor: pointer; font-size: 12px; }
.ptr_step:hover { background: var(--color-selected); }
.ptr_step.active { border-color: var(--color-accent); color: var(--color-light); box-shadow: inset 0 -2px var(--color-accent); }
.ptr_step_number { display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 21px; flex: 0 0 21px; border-radius: 50%; background: var(--color-selected); font-weight: 700; }
.ptr_step.active .ptr_step_number { background: var(--color-accent); color: var(--color-accent_text); }
#ptr_viewport {
	flex: 1 1 auto; position: relative; background: #101014;
	display: flex; align-items: center; justify-content: center; overflow: hidden;
	min-width: 240px;
}
#ptr_frame { position: relative; flex: 0 0 auto; background: #20242b; overflow: hidden; }
#ptr_frame canvas {
	width: 100%; height: 100%; object-fit: contain;
	image-rendering: auto; cursor: grab;
	background-image: linear-gradient(45deg, #2a2a30 25%, transparent 25%),
		linear-gradient(-45deg, #2a2a30 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #2a2a30 75%),
		linear-gradient(-45deg, transparent 75%, #2a2a30 75%);
	background-size: 16px 16px;
	background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}
#ptr_raster_canvas { position: absolute; inset: 0; }
#ptr_frame[data-step="materials"] #ptr_raster_canvas:not(.dragging) { cursor: pointer; }
#ptr_canvas, #ptr_final_canvas { position: absolute; inset: 0; }
#ptr_final_canvas { cursor: default !important; }
#ptr_frame[data-texture-filter="nearest"] #ptr_canvas { image-rendering: pixelated; }
#ptr_frame[data-step="preview"] #ptr_canvas,
#ptr_frame[data-step="export"] #ptr_canvas { cursor: default; }
#ptr_viewport canvas.dragging { cursor: grabbing; }
#ptr_overlay {
	position: absolute; left: 8px; top: 8px; pointer-events: none;
	font-size: 11px; color: #fff; text-shadow: 0 1px 3px #000;
	background: rgba(0,0,0,0.45); padding: 3px 7px; border-radius: 3px;
}
#ptr_watermark {
	position: absolute; left: 12px; bottom: 10px; pointer-events: none;
	font-family: sans-serif; line-height: 1; white-space: nowrap;
	text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}
#ptr_sidebar {
	width: 360px; flex: 0 0 360px; display: flex; min-height: 0;
	background: var(--color-ui); border-left: 1px solid var(--color-border);
}
.ptr_stagepanes { flex: 1 1 auto; overflow: hidden; padding: 10px; min-width: 0; }
.ptr_stagepane { height: 100%; overflow-y: auto; }
.ptr_stagepane[data-step="materials"] { display: flex; flex-direction: column; overflow: hidden; }
.ptr_stagepane[hidden] { display: none; }
.ptr_material_settings { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px; }
.ptr_material_outline { flex: 0 0 32%; min-height: 150px; max-height: 260px; margin-bottom: 0; display: flex; flex-direction: column; }
#ptr_grouplist { flex: 1 1 auto; min-height: 0; display: flex; }
.ptr_summary { display: grid; gap: 6px; margin: 4px 0 10px; }
.ptr_summary_line { padding: 6px 8px; border-radius: 4px; background: var(--color-ui); font-size: 11px; line-height: 1.4; color: var(--color-text); }
.ptr_time { display: block; padding: 2px 0 2px 104px; color: var(--color-light); font-variant-numeric: tabular-nums; }
.ptr_btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ptr_tabs {
	flex: 0 0 42px; display: flex; flex-direction: column; align-items: stretch;
	padding: 6px 0; gap: 2px; background: var(--color-back);
	border-right: 1px solid var(--color-border); overflow-y: auto;
}
.ptr_tab {
	width: 100%; min-width: 0; height: 38px; display: flex; align-items: center; justify-content: center;
	background: transparent; border: none; cursor: pointer; position: relative;
	color: var(--color-subtle_text); padding: 0; box-shadow: none;
}
.ptr_tab .material-icons { font-size: 19px; max-width: 19px; }
.ptr_tab:hover { color: var(--color-text); background: var(--color-selected); }
.ptr_tab.active { color: var(--color-light); background: var(--color-selected); }
.ptr_tab.active::before {
	content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px;
	background: var(--color-accent); border-radius: 0 2px 2px 0;
}
.ptr_tabpanes { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 10px; min-width: 0; }
.ptr_tabpane { display: none; }
.ptr_tabpane.active { display: block; }
.ptr_card {
	background: var(--color-back); border: 1px solid var(--color-border);
	border-radius: 6px; padding: 9px 10px 10px; margin-bottom: 10px;
}
.ptr_card_head {
	display: flex; align-items: center; gap: 6px; margin-bottom: 7px;
	font-size: 12px; font-weight: 600; color: var(--color-light);
}
.ptr_card_head .material-icons { font-size: 16px; max-width: 16px; opacity: 0.85; }
.ptr_row {
	display: flex; align-items: center; gap: 6px; margin: 5px 0; min-height: 22px;
}
.ptr_row > label { flex: 0 0 96px; font-size: 12px; color: var(--color-text); }
.ptr_row > .ptr_ctrl { flex: 1 1 auto; display: flex; align-items: center; gap: 5px; min-width: 0; }
.ptr_row input[type=range] { flex: 1 1 auto; min-width: 40px; }
.ptr_row input[type=number] {
	width: 56px; flex: 0 0 56px; background: var(--color-ui);
	color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px;
	padding: 1px 3px; font-size: 11px;
}
.ptr_row input[type=color] { width: 32px; height: 20px; padding: 0; border: 1px solid var(--color-border); background: none; border-radius: 3px; }
.ptr_row input[type=text] {
	flex: 1 1 auto; min-width: 0; background: var(--color-ui);
	color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px;
	padding: 2px 6px; font-size: 12px;
}
.ptr_row select {
	flex: 1 1 auto; min-width: 0; background: var(--color-ui); color: var(--color-text);
	border: 1px solid var(--color-border); border-radius: 3px; padding: 2px; font-size: 12px;
}
.ptr_note { font-size: 11px; color: var(--color-subtle_text); margin: 4px 2px 2px; line-height: 1.4; }
#ptr_footer {
	display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 8px;
	border-top: 1px solid var(--color-border); background: var(--color-ui);
}
#ptr_progress { flex: 1 1 auto; height: 6px; background: var(--color-back); border-radius: 3px; overflow: hidden; margin: 0 8px; }
#ptr_progress > div { height: 100%; width: 0%; background: var(--color-accent); transition: width .1s linear; }
#ptr_status { width: 100%; font-size: 11px; color: var(--color-subtle_text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ptr_btn {
	background: var(--color-button); color: var(--color-text); border: 1px solid var(--color-border);
	border-radius: 4px; padding: 4px 11px; cursor: pointer; font-size: 12px; white-space: nowrap;
	display: inline-flex; align-items: center; gap: 5px;
}
.ptr_btn .material-icons { font-size: 15px; max-width: 15px; }
.ptr_btn:hover { background: var(--color-selected); }
.ptr_btn.accent { background: var(--color-accent); color: var(--color-accent_text); border-color: var(--color-accent); }
.ptr_iconbtn {
	width: 27px; min-width: 0; height: 27px; flex: 0 0 27px; display: flex; align-items: center; justify-content: center;
	background: transparent; color: var(--color-text); border: 1px solid transparent;
	border-radius: 4px; cursor: pointer; padding: 0; box-shadow: none;
}
.ptr_iconbtn .material-icons { font-size: 17px; max-width: 17px; }
.ptr_iconbtn:hover { background: var(--color-selected); border-color: var(--color-border); }
.ptr_presets { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
.ptr_presets .ptr_btn { padding: 2px 7px; font-size: 11px; }
.ptr_dialog_root .dialog_content { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: 100% !important; max-height: none !important; box-sizing: border-box; }
.ptr_dialog_root .dialog_wrapper { min-height: 0; }
.ptr_dialog_root .dialog_handle { cursor: move; }
#ptr_matlist { margin-top: 4px; }
#ptr_grouplist .ptr_outline { flex: 1 1 auto; min-height: 0; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 4px; padding: 0; background: var(--color-ui); }
#ptr_grouplist .ptr_outline_children { margin-left: 8px; padding-left: 0; border-left: 1px solid var(--color-border); }
#ptr_grouplist .ptr_outline_row { display: flex; align-items: center; justify-content: flex-start; height: 19px; min-height: 19px; margin: 0; padding: 0; }
#ptr_grouplist .ptr_outline_disclosure { display: flex; flex: 0 0 15px !important; align-items: center; justify-content: flex-start !important; width: 15px !important; min-width: 0 !important; height: 19px; min-height: 0; margin: 0 !important; padding: 0 !important; border: 0; border-radius: 0; box-shadow: none; background: transparent; color: var(--color-text); cursor: pointer; }
#ptr_grouplist .ptr_outline_disclosure .material-icons { font-size: 15px; line-height: 19px; }
#ptr_grouplist .ptr_outline_spacer { flex: 0 0 15px; width: 15px; }
#ptr_grouplist .ptr_outline_item { display: flex; flex: 1 1 auto !important; align-items: center; justify-content: flex-start !important; gap: 2px; width: auto; min-width: 0 !important; height: 19px; min-height: 0; margin: 0 !important; padding: 0 !important; border: 0; border-radius: 0; box-shadow: none; background: transparent; color: var(--color-text); text-align: left !important; cursor: pointer; font-size: 12px; line-height: 19px; }
#ptr_grouplist .ptr_outline_item > span { flex: 0 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }
#ptr_grouplist .ptr_outline_item .material-icons { font-size: 13px; width: 14px; flex: 0 0 14px; color: var(--color-subtle_text); }
#ptr_grouplist .ptr_outline_row:hover, #ptr_grouplist .ptr_outline_row.selected { background: var(--color-selected); }
#ptr_grouplist .ptr_outline_item:hover, #ptr_grouplist .ptr_outline_item.selected { background: transparent; }
#ptr_grouplist .ptr_outline_row.modified .ptr_outline_item::after { content: '●'; color: var(--color-accent); margin-left: auto; font-size: 9px; }
.ptr_group_inspector { margin: 0; padding: 0; }
.ptr_group_inspector_head { display: flex; align-items: center; justify-content: space-between; gap: 7px; margin-bottom: 6px; font-size: 12px; }
.ptr_mat {
	border: 1px solid var(--color-border); border-radius: 6px; margin: 6px 0; padding: 6px 8px;
	background: var(--color-ui);
}
.ptr_mat > .ptr_mat_head { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 3px; font-weight: 600; }
.ptr_mat > .ptr_mat_head img { width: 20px; height: 20px; image-rendering: pixelated; background: #0006; border-radius: 3px; }
`;

  // plugins/georenderer/src/index.js
  var action = null;
  var cssHandle = null;
  var eventHandler = null;
  var selectionHandler = null;
  Plugin.register(PLUGIN_ID, {
    title: "几何渲染器",
    icon: "auto_awesome",
    author: "600_liang",
    description: "在独立五步窗口中配置材质、场景与镜头，并使用 GPU 路径追踪渲染模型",
    about: [
      "在 **视图 → 几何渲染器** 中打开",
      "",
      "- 五步都在独立窗口中完成；前两步可检查模型，第 3 步确定最终镜头",
      "- 组大纲按名称排序；点击模型部件可定位并编辑所属组",
      "- 可载入 `.hdr` 或普通图片作为环境贴图",
      "- “阴影捕捉 + 背景透明” 可导出带投影的透明 PNG",
      "",
      "需要支持 WebGL2 与 `EXT_color_buffer_float` 的显卡",
      "",
      "项目与更新：https://github.com/MentonLiu/GeoRenderer"
    ].join("\n"),
    version: "0.1.4",
    min_version: "4.8.0",
    variant: "both",
    tags: ["Rendering", "Preview"],
    onload() {
      loadSettings();
      try {
        cssHandle = Blockbench.addCSS(georenderer_default);
      } catch (err) {
        console.warn("[PathTracer] addCSS 失败", err);
      }
      action = new Action("georenderer_open", {
        name: "几何渲染器",
        description: "在独立窗口配置场景并渲染当前模型",
        icon: "auto_awesome",
        category: "view",
        condition: () => typeof Project !== "undefined" && !!Project,
        click() {
          openWindow();
        }
      });
      try {
        MenuBar.addAction(action, "view");
      } catch (err) {
      }
      try {
        MenuBar.addAction(action, "tools");
      } catch (err) {
      }
      eventHandler = () => {
        if (PTR.raster) PTR.raster.refreshModel();
        if (PTR.refreshGroundTextures) PTR.refreshGroundTextures();
        if (PTR.nodes.groupList) buildGroupList();
        if (PTR.nodes.matlist) buildMaterialList();
        if (!PTR.open || !PTR.tracer) {
          PTR.needsRebuild = true;
          return;
        }
        if (PTR.settings.auto_follow) {
          clearTimeout(PTR.rebuildTimer);
          PTR.rebuildTimer = setTimeout(() => rebuildScene(), 400);
        } else {
          PTR.stale = true;
          updateStatus();
        }
      };
      try {
        Blockbench.on("finished_edit", eventHandler);
        Blockbench.on("undo", eventHandler);
        Blockbench.on("redo", eventHandler);
        selectionHandler = () => {
          if (!PTR.nodes.groupList) return;
          if (typeof Group !== "undefined" && Group.first_selected) selectGroup(Group.first_selected.uuid);
          else if (typeof Outliner !== "undefined" && Outliner.selected?.[0]) selectGroupForElement(Outliner.selected[0]);
        };
        Blockbench.on("update_selection", selectionHandler);
      } catch (err) {
      }
    },
    onunload() {
      closeWindow();
      if (PTR.dialog) {
        try {
          PTR.dialog.delete();
        } catch (e) {
        }
        PTR.dialog = null;
      }
      if (action) {
        action.delete();
        action = null;
      }
      if (cssHandle && cssHandle.delete) cssHandle.delete();
      cssHandle = null;
      if (eventHandler) {
        try {
          Blockbench.removeListener("finished_edit", eventHandler);
          Blockbench.removeListener("undo", eventHandler);
          Blockbench.removeListener("redo", eventHandler);
        } catch (err) {
        }
        eventHandler = null;
      }
      if (selectionHandler) {
        try {
          Blockbench.removeListener("update_selection", selectionHandler);
        } catch (err) {
        }
        selectionHandler = null;
      }
    }
  });
})();
