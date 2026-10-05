	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

	function hexToLinear(hex) {
		let h = (hex || '#000000').replace('#', '');
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
	function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
	function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
	function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
	function vCross(a, b) {
		return [
			a[1] * b[2] - a[2] * b[1],
			a[2] * b[0] - a[0] * b[2],
			a[0] * b[1] - a[1] * b[0],
		];
	}
	function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
	const CUBE_FACE_NORMALS = {
		east: [1, 0, 0], west: [-1, 0, 0],
		up: [0, 1, 0], down: [0, -1, 0],
		south: [0, 0, 1], north: [0, 0, -1],
	};
	function triangleFacesInward(indices, positions, normal) {
		const a = indices[0] * 3, b = indices[1] * 3, c = indices[2] * 3;
		const geometric = vCross(
			[positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]],
			[positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
		);
		return vDot(geometric, normal) < 0;
	}
	function nextPow2(n) {
		let p = 1;
		while (p < n) p *= 2;
		return p;
	}

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

	function createProgram(gl, vsSource, fsSource, label) {
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
		for (let i = 0; i < count; i++) {
			const info = gl.getActiveUniform(prog, i);
			const name = info.name.replace(/\[0\]$/, '');
			uniforms[name] = gl.getUniformLocation(prog, name);
		}
		return { program: prog, uniforms: uniforms };
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

	function createEnvTexture(gl, data, w, h) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, data);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createRenderTexture(gl, w, h, internalFormat) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		const fmt = internalFormat || gl.RGBA32F;
		const uploadFormat = fmt === gl.R32F ? gl.RED : gl.RGBA;
		gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, uploadFormat, gl.FLOAT, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return tex;
	}

	function createFBO(gl, attachments) {
		const fbo = gl.createFramebuffer();
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
			throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
		}
		return fbo;
	}


