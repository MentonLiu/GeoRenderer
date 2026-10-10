import { createFBO, createRenderTexture } from './webgl.js';

// 每次分配都归属于一个资源组，即使构造中途失败也能按组释放已创建资源。
export class RenderBuffers {
	// 创建路径追踪、去噪、Bloom 和色调映射所需的基础 GPU 资源。
	constructor(gl, width, height) {
		this.gl = gl;
		this.width = width;
		this.height = height;
		this.groups = new Map();
		try {
			// 基础组必须完整建立，后续可选效果组则按设置延迟创建。
			const group = this.group('base');
			const makeSet = () => ({
				color: this.texture(gl.RGBA32F, group),
				albedo: this.texture(gl.RGBA32F, group),
				normal: this.texture(gl.RGBA32F, group),
				moment: this.texture(gl.RGBA32F, group),
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
		// 创建独立资源组，便于单独统计显存并在效果关闭时释放。
		const group = { textures: [], framebuffers: [], bytes: 0 };
		this.groups.set(name, group);
		return group;
	}

	texture(format, group) {
		// 创建并登记纹理，同时按像素格式估算资源占用。
		const texture = createRenderTexture(this.gl, this.width, this.height, format);
		group.textures.push(texture);
		const bytes = format === this.gl.RGBA32F ? 16 : format === this.gl.RGBA16F ? 8 : 4;
		group.bytes += this.width * this.height * bytes;
		return texture;
	}

	framebuffer(attachments, group) {
		// 创建并登记绑定指定颜色附件的帧缓冲。
		const framebuffer = createFBO(this.gl, attachments);
		group.framebuffers.push(framebuffer);
		return framebuffer;
	}

	syncEffects(denoise, bloom) {
		// 让可选后处理资源与当前开关同步，关闭效果时立即回收对应组。
		for (const [name, enabled] of [['denoise', denoise], ['bloom', bloom]]) {
			if (!enabled) { this.disposeGroup(name); continue; }
			if (this.groups.has(name)) continue;
			const group = this.group(name);
			try {
				const gl = this.gl;
				if (name === 'denoise') {
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
		// 汇总所有资源组的估算字节数，用于显存状态显示和上限判断。
		return [...this.groups.values()].reduce((sum, group) => sum + group.bytes, 0);
	}

	disposeGroup(name) {
		// 释放指定组中的帧缓冲和纹理，并移除组记录。
		const group = this.groups.get(name);
		if (!group) return;
		for (const framebuffer of group.framebuffers) this.gl.deleteFramebuffer(framebuffer);
		for (const texture of group.textures) this.gl.deleteTexture(texture);
		this.groups.delete(name);
	}

	dispose() {
		// 释放全部 GPU 资源，并先解除当前帧缓冲绑定。
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		for (const name of this.groups.keys()) this.disposeGroup(name);
	}
}
