import { DATA_TEX_WIDTH } from '../core/config.js';

// 编译单个 GLSL 着色器，并在失败时输出带行号的源码。
function compileShader(gl, type, source, label) {
	const sh = gl.createShader(type);
	gl.shaderSource(sh, source);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh);
		console.error('[PathTracer] shader compile failed: ' + label + '\n' + log);
		console.error(source.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
		gl.deleteShader(sh);
		throw new Error('Shader compile error (' + label + '): ' + log);
	}
	return sh;
}

// 编译并链接一组顶点/片元着色器，同时缓存所有活动 uniform 的位置。
export function createProgram(gl, vsSource, fsSource, label) {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, label + '.vert');
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, label + '.frag');
	const prog = gl.createProgram();
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(prog);
		gl.deleteProgram(prog);
		throw new Error('Program link error (' + label + '): ' + log);
	}

	const uniforms = {};
	const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
	// 遍历 GPU 实际暴露的 uniform，避免手动维护名称和位置映射。
	for (let i = 0; i < count; i++) {
		const info = gl.getActiveUniform(prog, i);
		const name = info.name.replace(/\[0\]$/, '');
		uniforms[name] = gl.getUniformLocation(prog, name);
	}
	return { program: prog, uniforms: uniforms };
}

// 创建 nearest 采样的浮点数据纹理，用于向片元着色器传递结构化数组。
export function createDataTexture(gl, data, texelCount, width) {
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

// 创建单通道浮点纹理，主要承载光源索引或环境分布 CDF。
export function createR32FTexture(gl, data, w, h) {
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

// 创建不翻转 Y 轴的 RGBA8 图集纹理，保持 Canvas 图像坐标约定。
export function createAtlasTexture(gl, pixels, w, h) {
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

// 创建可线性过滤和水平重复的浮点环境纹理。
export function createEnvTexture(gl, data, w, h, mipmaps = false) {
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

// 创建后处理使用的渲染目标，并把 GPU 分配错误转换为可读提示。
export function createRenderTexture(gl, w, h, internalFormat) {
	const tex = gl.createTexture();
	if (!tex) throw new Error('GPU 无法分配渲染纹理');
	gl.bindTexture(gl.TEXTURE_2D, tex);
	const fmt = internalFormat || gl.RGBA32F;
	const uploadFormat = fmt === gl.R32F ? gl.RED : gl.RGBA;
	gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, uploadFormat, fmt === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.FLOAT, null);
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		gl.deleteTexture(tex);
		throw new Error('GPU 渲染缓冲分配失败（0x' + error.toString(16) + '），请降低预览比例或输出尺寸');
	}
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return tex;
}

// 将一个或多个颜色纹理挂载到帧缓冲，并验证其完整性。
export function createFBO(gl, attachments) {
	const fbo = gl.createFramebuffer();
	if (!fbo) throw new Error('GPU 无法分配渲染帧缓冲');
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	const bufs = [];
	// 附件序号必须和渲染 pass 写入的 COLOR_ATTACHMENT 序号保持一致。
	attachments.forEach((tex, i) => {
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
		bufs.push(gl.COLOR_ATTACHMENT0 + i);
	});
	gl.drawBuffers(bufs);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		gl.deleteFramebuffer(fbo);
		throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
	}
	return fbo;
}
