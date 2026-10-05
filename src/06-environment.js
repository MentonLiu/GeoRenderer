	function parseHDR(buffer) {
		const bytes = new Uint8Array(buffer);
		let pos = 0;

		function readLine() {
			let line = '';
			while (pos < bytes.length) {
				const c = bytes[pos++];
				if (c === 0x0a) break;
				line += String.fromCharCode(c);
			}
			return line;
		}

		const magic = readLine();
		if (!/^#\?(RADIANCE|RGBE)/.test(magic)) throw new Error('不是有效的 Radiance HDR 文件');

		let line;
		while ((line = readLine()).length > 0) { }

		const dims = readLine().trim().match(/^-Y\s+(\d+)\s+\+X\s+(\d+)$/);
		if (!dims) throw new Error('不支持的 HDR 扫描线顺序（仅支持 -Y +X）');
		const height = parseInt(dims[1], 10);
		const width = parseInt(dims[2], 10);

		const rgbe = new Uint8Array(width * height * 4);
		const scanline = new Uint8Array(width * 4);

		for (let y = 0; y < height; y++) {
			if (pos + 4 > bytes.length) throw new Error('HDR 数据意外结束');
			const b0 = bytes[pos], b1 = bytes[pos + 1], b2 = bytes[pos + 2], b3 = bytes[pos + 3];
			const isRLE = (b0 === 2 && b1 === 2 && ((b2 << 8) | b3) === width && width >= 8 && width < 32768);

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
						for (let i = 0; i < count; i++) scanline[(x++) * 4 + c] = value;
					} else {
						for (let i = 0; i < count; i++) scanline[(x++) * 4 + c] = bytes[pos++];
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
		return { width: width, height: height, data: data };
	}

	function resampleEquirect(src, w, h) {
		const out = new Float32Array(w * h * 4);
		const sw = src.width, sh = src.height;
		for (let y = 0; y < h; y++) {
			const sy = ((y + 0.5) / h) * sh - 0.5;
			const y0 = Math.floor(sy);
			const fy = sy - y0;
			const ya = clamp(y0, 0, sh - 1), yb = clamp(y0 + 1, 0, sh - 1);
			for (let x = 0; x < w; x++) {
				const sx = ((x + 0.5) / w) * sw - 0.5;
				const x0 = Math.floor(sx);
				const fx = sx - x0;
				const xa = ((x0 % sw) + sw) % sw, xb = ((x0 + 1) % sw + sw) % sw;
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
		for (let i = 0; i < out.length; i++) if (out[i] > 60000) out[i] = 60000;
		return out;
	}

	function generateSkyPixels(settings) {
		const w = ENV_W, h = ENV_H;
		const out = new Float32Array(w * h * 4);
		const mode = settings.env_mode;

		const zen = hexToLinear(settings.sky_zenith);
		const hor = hexToLinear(settings.sky_horizon);
		const gnd = hexToLinear(settings.sky_ground);
		const gTop = hexToLinear(settings.grad_top);
		const gBot = hexToLinear(settings.grad_bottom);
		const solid = hexToLinear(settings.solid_color);
		const sunCol = hexToLinear(settings.sun_color);
		const haze = clamp(settings.sky_haze, 0, 1);
		const sun = sunDirection(settings);
		const glowPower = 8 + 260 * (1 - haze);
		const glowStrength = 0.35 + 2.5 * haze;

		for (let y = 0; y < h; y++) {
			const theta = ((y + 0.5) / h) * Math.PI;
			const sinT = Math.sin(theta), cosT = Math.cos(theta);
			for (let x = 0; x < w; x++) {
				const phi = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
				const dx = sinT * Math.cos(phi);
				const dy = cosT;
				const dz = sinT * Math.sin(phi);
				const o = (y * w + x) * 4;
				let r = 0, g = 0, b = 0;

				if (mode === 'solid') {
					r = solid[0]; g = solid[1]; b = solid[2];
				} else if (mode === 'gradient') {
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
					if (cosA > 0 && settings.sun_enable && settings.sun_intensity > 0) {
						const glow = Math.pow(cosA, glowPower) * glowStrength;
						r += sunCol[0] * glow;
						g += sunCol[1] * glow;
						b += sunCol[2] * glow;
					}
				}

				out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 1;
			}
		}
		return out;
	}

	function sunDirection(settings) {
		const el = settings.sun_elevation * Math.PI / 180;
		const az = settings.sun_azimuth * Math.PI / 180;
		const ce = Math.cos(el);
		return vNorm([ce * Math.cos(az), Math.sin(el), ce * Math.sin(az)]);
	}

	function buildEnvDistribution(pixels, w, h) {
		const DW = ENV_DIST_W, DH = ENV_DIST_H;
		const bx = Math.max(1, Math.floor(w / DW));
		const by = Math.max(1, Math.floor(h / DH));

		const lum = new Float32Array(DW * DH);
		let total = 0;
		for (let y = 0; y < DH; y++) {
			const theta = ((y + 0.5) / DH) * Math.PI;
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
				const v = (acc / Math.max(n, 1)) * sinT;
				lum[y * DW + x] = v;
				total += v;
			}
		}

		const mean = total / (DW * DH);
		const eps = Math.max(mean * 0.06, 1e-8);
		total = 0;
		for (let i = 0; i < lum.length; i++) { lum[i] += eps; total += lum[i]; }
		if (total <= 0) { for (let i = 0; i < lum.length; i++) lum[i] = 1; total = lum.length; }

		const cond = new Float32Array((DW + 1) * DH);
		const rowSum = new Float32Array(DH);
		for (let y = 0; y < DH; y++) {
			let acc = 0;
			for (let x = 0; x < DW; x++) acc += lum[y * DW + x];
			rowSum[y] = acc;
			const base = y * (DW + 1);
			let run = 0;
			cond[base] = 0;
			for (let x = 0; x < DW; x++) {
				run += lum[y * DW + x];
				cond[base + x + 1] = acc > 0 ? run / acc : (x + 1) / DW;
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

		return { cond: cond, marg: marg, width: DW, height: DH };
	}


