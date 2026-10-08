import { BVH_TEXELS, ENV_H, ENV_W, MAT_TEXELS, TRI_ATTR_TEXELS, TRI_POS_TEXELS } from '../core/config.js';
import { clamp, hexToLinear, vCross, vDot, vNorm, vSub } from '../core/math.js';
import { FS_BLOOM_BLUR, FS_BLOOM_BRIGHT, FS_COMPOSITE, FS_DENOISE, FS_FINAL, FS_PATHTRACE, FS_PATHTRACE_COLOR_ONLY, FS_TONEMAP, VS_FULLSCREEN } from './shaders.js';
import { createAtlasTexture, createDataTexture, createEnvTexture, createFBO, createProgram, createR32FTexture, createRenderTexture } from './webgl.js';
import { buildBVH } from '../scene/bvh.js';
import { buildEnvDistribution, generateSkyPixels, resampleEquirect, sunDirection } from '../scene/environment.js';
import { collectGeometry } from '../scene/geometry.js';
import { buildMaterials } from '../scene/materials.js';
import { materialKey } from '../scene/group-overrides.js';

export class PathTracer {
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
	}

	init() {
		const gl = this.canvas.getContext('webgl2', {
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true,
			powerPreference: 'high-performance',
		});
		if (!gl) throw new Error('无法创建 WebGL2 上下文，路径追踪需要支持 WebGL2 的显卡/驱动。');
		this.gl = gl;

		this.extFloat = gl.getExtension('EXT_color_buffer_float');
		if (!this.extFloat) throw new Error('缺少 EXT_color_buffer_float 扩展，无法进行浮点累积渲染。');
		gl.getExtension('OES_texture_float_linear');
		let renderer = '';
		try {
			const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
			renderer = debugInfo
				? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
				: gl.getParameter(gl.RENDERER);
		} catch (err) { }
		this.appleGpuDetected = /\bApple\b/i.test(String(renderer || ''));
		this.discardAttachments = [
			[gl.COLOR_ATTACHMENT0],
			[gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1],
			[gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3],
		];

		this.progPT = createProgram(gl, VS_FULLSCREEN, FS_PATHTRACE, 'pathtrace');
		if (this.appleGpuDetected) {
			try {
				this.progPTColorOnly = createProgram(gl, VS_FULLSCREEN, FS_PATHTRACE_COLOR_ONLY, 'pathtrace_color_only');
			} catch (err) {
				this.colorOnlyProgramFailed = true;
				console.warn('[GeoRenderer] Apple GPU 预览着色器不可用，已使用标准着色器', err);
			}
		}
		this.progDN = createProgram(gl, VS_FULLSCREEN, FS_DENOISE, 'denoise');
		this.progCM = createProgram(gl, VS_FULLSCREEN, FS_COMPOSITE, 'composite');
		this.progBB = createProgram(gl, VS_FULLSCREEN, FS_BLOOM_BRIGHT, 'bloom_bright');
		this.progBL = createProgram(gl, VS_FULLSCREEN, FS_BLOOM_BLUR, 'bloom_blur');
		this.progTM = createProgram(gl, VS_FULLSCREEN, FS_TONEMAP, 'tonemap');
		this.progFN = createProgram(gl, VS_FULLSCREEN, FS_FINAL, 'final');

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

	buildScene(settings, overrides, groupOverrides, options) {
		const gl = this.gl;
		const t0 = performance.now();

		this.disposeScene();

		const geo = collectGeometry(options);
		const mats = buildMaterials(gl, geo.texRefs, geo.groupRefs, settings, overrides, groupOverrides);
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
			const side = mats.slotList[slot] ? mats.slotList[slot].side : 'double';
			let cull = side === 'front' ? 1 : (side === 'back' ? 2 : 0);
			if (cull !== 0 && geo.flips[t]) cull = 3 - cull;
			// 剔除标志值 3-5 用于标记半透明的负尺寸方块，6 同时标记朝内的面
			if (geo.negativeCube[t]) cull = geo.insideOnly[t] && side !== 'double' ? 6 : cull + 3;

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
			lightW: lightW,
			texTriPos: texTriPos,
			texTriAttr: texTriAttr,
			texBVH: texBVH,
			texMat: texMat,
			texLights: texLights,
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
				ms: Math.round(performance.now() - t0),
			},
		};
		this.spp = 0;
		return this.scene;
	}

	disposeScene() {
		const gl = this.gl;
		const s = this.scene;
		if (!s || !gl) { this.scene = null; return; }
		[s.texTriPos, s.texTriAttr, s.texBVH, s.texMat].forEach(t => { if (t && t.texture) gl.deleteTexture(t.texture); });
		[s.texLights, s.atlasColor, s.atlasMER, s.atlasNormal, s.atlasEmissive].forEach(t => { if (t) gl.deleteTexture(t); });
		this.scene = null;
	}

	setEnvironment(settings, customImage) {
		const gl = this.gl;
		if (this.env) {
			if (this.env.tex) gl.deleteTexture(this.env.tex);
			if (this.env.cond) gl.deleteTexture(this.env.cond);
			if (this.env.marg) gl.deleteTexture(this.env.marg);
		}
		let pixels, w = ENV_W, h = ENV_H;
		if (settings.env_mode === 'image' && customImage) {
			pixels = resampleEquirect(customImage, w, h);
		} else {
			pixels = generateSkyPixels(settings);
		}
		const dist = buildEnvDistribution(pixels, w, h);
		this.env = {
			tex: createEnvTexture(gl, pixels, w, h),
			cond: createR32FTexture(gl, dist.cond, dist.width + 1, dist.height),
			marg: createR32FTexture(gl, dist.marg, dist.height + 1, 1),
			distW: dist.width,
			distH: dist.height,
		};
		this.spp = 0;
	}

	resize(w, h) {
		const gl = this.gl;
		w = Math.max(8, Math.round(w));
		h = Math.max(8, Math.round(h));
		if (this.width === w && this.height === h && this.buffers) return;
		this.width = w;
		this.height = h;
		this.canvas.width = w;
		this.canvas.height = h;
		this.disposeBuffers();

		const mk = () => ({
			color: createRenderTexture(gl, w, h, gl.RGBA32F),
			albedo: createRenderTexture(gl, w, h, gl.RGBA16F),
			normal: createRenderTexture(gl, w, h, gl.RGBA16F),
			moment: createRenderTexture(gl, w, h, gl.RGBA32F),
		});
		const a = mk(), b = mk();
		this.buffers = {
			a: a, b: b,
			fboA: createFBO(gl, [a.color, a.albedo, a.normal, a.moment]),
			fboB: createFBO(gl, [b.color, b.albedo, b.normal, b.moment]),
			fboColorA: createFBO(gl, [a.color]),
			fboColorB: createFBO(gl, [b.color]),
			d0: createRenderTexture(gl, w, h, gl.RGBA16F),
			d1: createRenderTexture(gl, w, h, gl.RGBA16F),
			v0: createRenderTexture(gl, w, h, gl.R32F),
			v1: createRenderTexture(gl, w, h, gl.R32F),
			hdr: createRenderTexture(gl, w, h, gl.RGBA16F),
			bloomA: createRenderTexture(gl, w, h, gl.RGBA16F),
			bloomB: createRenderTexture(gl, w, h, gl.RGBA16F),
			tonemapOut: createRenderTexture(gl, w, h, gl.RGBA16F),
		};
		this.buffers.fboD0 = createFBO(gl, [this.buffers.d0, this.buffers.v0]);
		this.buffers.fboD1 = createFBO(gl, [this.buffers.d1, this.buffers.v1]);
		this.buffers.fboHDR = createFBO(gl, [this.buffers.hdr]);
		this.buffers.fboBloomA = createFBO(gl, [this.buffers.bloomA]);
		this.buffers.fboBloomB = createFBO(gl, [this.buffers.bloomB]);
		this.buffers.fboTonemap = createFBO(gl, [this.buffers.tonemapOut]);
		this.ping = 0;
		this.reset();
	}

	disposeBuffers() {
		const gl = this.gl;
		const b = this.buffers;
		if (!b || !gl) return;
		[b.a, b.b].forEach(set => {
			gl.deleteTexture(set.color);
			gl.deleteTexture(set.albedo);
			gl.deleteTexture(set.normal);
			gl.deleteTexture(set.moment);
		});
		gl.deleteTexture(b.d0);
		gl.deleteTexture(b.d1);
		gl.deleteTexture(b.hdr);
		gl.deleteTexture(b.bloomA);
		gl.deleteTexture(b.bloomB);
		gl.deleteTexture(b.tonemapOut);
		gl.deleteFramebuffer(b.fboHDR);
		gl.deleteFramebuffer(b.fboBloomA);
		gl.deleteFramebuffer(b.fboBloomB);
		gl.deleteFramebuffer(b.fboTonemap);
		gl.deleteTexture(b.v0);
		gl.deleteTexture(b.v1);
		gl.deleteFramebuffer(b.fboA);
		gl.deleteFramebuffer(b.fboB);
		gl.deleteFramebuffer(b.fboColorA);
		gl.deleteFramebuffer(b.fboColorB);
		gl.deleteFramebuffer(b.fboD0);
		gl.deleteFramebuffer(b.fboD1);
		this.buffers = null;
	}

	reset() {
		const gl = this.gl;
		this.spp = 0;
		if (!this.buffers) return;
		gl.clearColor(0, 0, 0, 0);
		[this.buffers.fboA, this.buffers.fboB].forEach(fbo => {
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

	useAppleGpuPath(settings) {
		return settings.gpu_profile === 'apple'
			|| (settings.gpu_profile !== 'standard' && this.appleGpuDetected);
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

	beginFrame(settings, interactive) {
		const gl = this.gl;
		if (!this.buffers || !this.scene || !this.env) return false;
		this.appleGpuOptimization = this.useAppleGpuPath(settings);
		if (this.appleGpuOptimization && interactive && !this.progPTColorOnly && !this.colorOnlyProgramFailed) {
			try {
				this.progPTColorOnly = createProgram(gl, VS_FULLSCREEN, FS_PATHTRACE_COLOR_ONLY, 'pathtrace_color_only');
			} catch (err) {
				this.colorOnlyProgramFailed = true;
				console.warn('[GeoRenderer] Apple GPU 预览着色器不可用，已使用标准着色器', err);
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
		this.bindTex(0, s.texTriPos ? s.texTriPos.texture : this.dummyF.texture, 'uTriPos', p);
		this.bindTex(1, s.texTriAttr ? s.texTriAttr.texture : this.dummyF.texture, 'uTriAttr', p);
		this.bindTex(2, s.texBVH ? s.texBVH.texture : this.dummyF.texture, 'uBVH', p);
		this.bindTex(3, s.texMat ? s.texMat.texture : this.dummyF.texture, 'uMat', p);
		this.bindTex(4, s.atlasColor || this.dummy2D, 'uAtlasC', p);
		this.bindTex(5, s.atlasMER || this.dummy2D, 'uAtlasM', p);
		this.bindTex(6, s.atlasNormal || this.dummy2D, 'uAtlasN', p);
		this.bindTex(7, s.texLights || this.dummyR, 'uLightTex', p);
		this.bindTex(8, this.env.tex, 'uEnv', p);
		this.bindTex(9, this.env.cond, 'uEnvCond', p);
		this.bindTex(10, this.env.marg, 'uEnvMarg', p);
		this.bindTex(15, s.atlasEmissive || this.dummy2D, 'uAtlasE', p);

		gl.uniform2f(u.uResolution, this.width, this.height);
		gl.uniform1i(u.uMaxBounce, settings.max_bounce | 0);
		gl.uniform1i(u.uLightSamples, settings.light_samples | 0);
		gl.uniform1f(u.uClamp, settings.clamp_value);
		gl.uniform1i(u.uFilterLinear, settings.filter_linear ? 1 : 0);

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
		gl.uniform1f(u.uAspect, this.width / this.height);
		gl.uniform1i(u.uOrtho, cam.ortho ? 1 : 0);
		gl.uniform1f(u.uOrthoHalfHeight, cam.orthoHalfHeight || 20);

		let focus = settings.focus_distance;
		if (settings.auto_focus || !focus) {
			focus = Math.hypot(cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]);
		}
		gl.uniform1f(u.uAperture, settings.aperture);
		gl.uniform1f(u.uFocusDist, focus);

		gl.uniform2i(u.uEnvDist, this.env.distW, this.env.distH);
		gl.uniform1f(u.uEnvIntensity, settings.env_intensity);
		gl.uniform1f(u.uEnvRotation, settings.env_rotation * Math.PI / 180);
		gl.uniform1i(u.uBgMode, settings.bg_mode === 'color' ? 1 : (settings.bg_mode === 'transparent' ? 2 : 0));
		const bg = hexToLinear(settings.bg_color);
		gl.uniform3f(u.uBgColor, bg[0], bg[1], bg[2]);

		const sunOn = settings.sun_enable && settings.sun_intensity > 0;
		gl.uniform1i(u.uSunEnable, sunOn ? 1 : 0);
		if (sunOn) {
			const dir = sunDirection(settings);
			const radius = Math.max(settings.sun_angle, 0.25) * Math.PI / 360;
			const cosR = Math.cos(radius);
			const solid = Math.max(2 * Math.PI * (1 - cosR), 1e-7);
			const col = hexToLinear(settings.sun_color);
			const scale = settings.sun_intensity / solid;
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

		gl.uniform1i(u.uGroundOn, settings.ground_on && !s.sceneTriCount ? 1 : 0);
		const fog = s.fog;
		gl.uniform1i(u.uFogMode, fog ? (fog.isFogExp2 ? 2 : 1) : 0);
		gl.uniform3f(u.uFogColor, fog?.color?.r || 0, fog?.color?.g || 0, fog?.color?.b || 0);
		gl.uniform1f(u.uFogNear, fog?.near || 0);
		gl.uniform1f(u.uFogFar, fog?.far || 1);
		gl.uniform1f(u.uFogDensity, fog?.density || 0);
		gl.uniform1i(u.uGroundCatcher, settings.ground_catcher ? 1 : 0);
		gl.uniform1f(u.uGroundY, settings.ground_y);
		gl.uniform1f(u.uGroundRough, clamp(settings.ground_rough, 0.02, 1));
		gl.uniform1f(u.uGroundMetal, clamp(settings.ground_metal, 0, 1));
		gl.uniform1f(u.uGroundRadius, settings.ground_radius);
		const gc = hexToLinear(settings.ground_color);
		gl.uniform3f(u.uGroundColor, gc[0], gc[1], gc[2]);
		const groundRect = s.groundRect;
		gl.uniform1i(u.uGroundTexOn, groundRect ? 1 : 0);
		gl.uniform4f(u.uGroundRect, groundRect ? groundRect.x : 0, groundRect ? groundRect.y : 0, groundRect ? groundRect.w : 1, groundRect ? groundRect.h : 1);
		gl.uniform1f(u.uGroundTexScale, Math.max(0.01, settings.ground_texture_scale || 1));

		return true;
	}

	renderPass() {
		const gl = this.gl;
		if (!this.buffers || !this.scene || !this.env) return;

		const src = this.ping === 0 ? this.buffers.b : this.buffers.a;
		const dstFBO = this.colorOnlyPass
			? (this.ping === 0 ? this.buffers.fboColorA : this.buffers.fboColorB)
			: (this.ping === 0 ? this.buffers.fboA : this.buffers.fboB);

		this.bindPassTarget(dstFBO, this.colorOnlyPass ? 1 : 4);

		const p = this.activePT;
		const u = p.uniforms;
		this.bindTex(11, src.color, 'uAccum', p);
		if (!this.colorOnlyPass) {
			this.bindTex(12, src.albedo, 'uAccumAlb', p);
			this.bindTex(13, src.normal, 'uAccumNrm', p);
			this.bindTex(14, src.moment, 'uAccumMom', p);
		}

		gl.uniform1i(u.uSeed, (this.spp * 9781 + 1) | 0);
		gl.uniform1i(u.uReset, this.spp === 0 ? 1 : 0);

		gl.drawArrays(gl.TRIANGLES, 0, 3);

		this.ping = 1 - this.ping;
		this.spp++;
	}

	currentSet() {
		return this.ping === 0 ? this.buffers.b : this.buffers.a;
	}

	present(settings) {
		const gl = this.gl;
		if (!this.buffers || this.spp === 0) return;
		this.appleGpuOptimization = this.useAppleGpuPath(settings);
		const cur = this.currentSet();
		const invSpp = 1 / this.spp;
		gl.bindVertexArray(this.vao);

		let denoised = null;
		const useDenoise = settings.denoise && !this.colorOnlyPass && this.spp < 4096 && settings.denoise_strength > 0;

		if (useDenoise) {
			const p = this.progDN;
			gl.useProgram(p.program);
			const phiColorBase = 3.2 * settings.denoise_strength;
			const steps = [1, 2, 4, 8];
			let inputTex = cur.color;
			let varTex = null;
			let first = 1;
			for (let i = 0; i < steps.length; i++) {
				const targetFBO = (i % 2 === 0) ? this.buffers.fboD0 : this.buffers.fboD1;
				const targetTex = (i % 2 === 0) ? this.buffers.d0 : this.buffers.d1;
				const targetVar = (i % 2 === 0) ? this.buffers.v0 : this.buffers.v1;
				this.bindPassTarget(targetFBO, 2);
				gl.viewport(0, 0, this.width, this.height);
				this.bindTex(0, inputTex, 'uColorIn', p);
				this.bindTex(1, cur.albedo, 'uAlbedoTex', p);
				this.bindTex(2, cur.normal, 'uNormalTex', p);
				this.bindTex(3, cur.moment, 'uMomentTex', p);
				this.bindTex(4, varTex || cur.moment, 'uVarianceIn', p);
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
			this.bindTex(0, cur.color, 'uAccumTex', p);
			this.bindTex(1, denoised || cur.color, 'uDenoisedTex', p);
			this.bindTex(2, cur.albedo, 'uAlbedoTex', p);
			gl.uniform1f(p.uniforms.uInvSpp, invSpp);
			gl.uniform1i(p.uniforms.uUseDenoise, useDenoise && denoised ? 1 : 0);
			gl.uniform1f(p.uniforms.uExposure, settings.exposure);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		const useBloom = !!settings.bloom_enable;
		if (useBloom) {
			{
				const p = this.progBB;
				this.bindPassTarget(buf.fboBloomA, 1);
				gl.useProgram(p.program);
				this.bindTex(0, buf.hdr, 'uHDR', p);
				gl.uniform1f(p.uniforms.uThreshold, settings.bloom_threshold);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
			const radius = Math.max(settings.bloom_radius, 0.1) * (this.width / 1280);
			{
				const p = this.progBL;
				gl.useProgram(p.program);
				gl.uniform1f(p.uniforms.uRadius, radius);
				this.bindPassTarget(buf.fboBloomB, 1);
				this.bindTex(0, buf.bloomA, 'uTex', p);
				gl.uniform2f(p.uniforms.uDir, 1, 0);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				this.bindPassTarget(buf.fboBloomA, 1);
				this.bindTex(0, buf.bloomB, 'uTex', p);
				gl.uniform2f(p.uniforms.uDir, 0, 1);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
		}

		this.bindPassTarget(buf.fboTonemap, 1);
		gl.viewport(0, 0, this.width, this.height);
		{
			const p = this.progTM;
			gl.useProgram(p.program);
			this.bindTex(0, buf.hdr, 'uHDR', p);
			this.bindTex(1, useBloom ? buf.bloomA : buf.hdr, 'uBloomTex', p);
			gl.uniform1i(p.uniforms.uUseBloom, useBloom ? 1 : 0);
			gl.uniform1f(p.uniforms.uBloomIntensity, settings.bloom_intensity);
			gl.uniform1f(p.uniforms.uContrast, settings.contrast);
			gl.uniform1f(p.uniforms.uSaturation, settings.saturation);
			const tmMap = { none: 0, reinhard: 1, aces: 2, filmic: 3, agx: 4 };
			gl.uniform1i(p.uniforms.uToneMap, tmMap[settings.tone_mapping] != null ? tmMap[settings.tone_mapping] : 2);
			gl.uniform1i(p.uniforms.uVignetteEnable, settings.vignette_enable ? 1 : 0);
			gl.uniform1f(p.uniforms.uVignetteStrength, settings.vignette_strength);
			gl.uniform2f(p.uniforms.uResolution, this.width, this.height);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.width, this.height);
		{
			const p = this.progFN;
			gl.useProgram(p.program);
			this.bindTex(0, buf.tonemapOut, 'uTex', p);
			gl.uniform1i(p.uniforms.uSharpenEnable, settings.sharpen_enable ? 1 : 0);
			gl.uniform1f(p.uniforms.uSharpenStrength, settings.sharpen_strength);
			gl.uniform1i(p.uniforms.uGrainEnable, settings.grain_enable ? 1 : 0);
			gl.uniform1f(p.uniforms.uGrainStrength, settings.grain_strength);
			gl.uniform1f(p.uniforms.uGrainSeed, (this.spp * 37.13) % 1000.0);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}
		gl.bindVertexArray(null);
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		const gl = this.gl;
		if (!gl) return;
		this.disposeScene();
		this.disposeBuffers();
		if (this.env) {
			gl.deleteTexture(this.env.tex);
			gl.deleteTexture(this.env.cond);
			gl.deleteTexture(this.env.marg);
			this.env = null;
		}
		[this.progPT, this.progPTColorOnly, this.progDN, this.progCM, this.progBB, this.progBL, this.progTM, this.progFN].forEach(p => { if (p) gl.deleteProgram(p.program); });
		if (this.dummy2D) gl.deleteTexture(this.dummy2D);
		if (this.dummyF) gl.deleteTexture(this.dummyF.texture);
		if (this.dummyR) gl.deleteTexture(this.dummyR);
		if (this.dummyEnv) gl.deleteTexture(this.dummyEnv);
		if (this.vao) gl.deleteVertexArray(this.vao);
		const lose = gl.getExtension('WEBGL_lose_context');
		if (lose) lose.loseContext();
		this.gl = null;
	}
}

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
	return { min: min, max: max, center: center, radius: radius };
}
