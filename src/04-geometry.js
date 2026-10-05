	const MF_HAS_COLOR = 1;
	const MF_HAS_MER = 2;
	const MF_HAS_NORMAL = 4;
	const MF_FULLBRIGHT = 8;
	const MF_WRAP_REPEAT = 16;
	const MF_ADDITIVE = 32;
	const MF_HAS_EMISSIVE_MAP = 64;
	const MF_EMIS_MAIN_COLOR = 128;
	const MF_EMIS_CUSTOM_COLOR = 256;

	function getMaterialSide(tex, override) {
		if (override === 'double') return 'double';
		if (override === 'front') return 'front';
		try {
			if (tex && tex.render_sides === 'front') return 'front';
			if (tex && tex.render_sides === 'double') return 'double';
			const global = (typeof settings !== 'undefined' && settings.render_sides)
				? settings.render_sides.value : 'auto';
			if (global === 'front') return 'front';
			if (global === 'auto') {
				if (typeof Format !== 'undefined' && Format && Format.render_sides) {
					const v = typeof Format.render_sides === 'function' ? Format.render_sides() : Format.render_sides;
					if (v === 'front') return 'front';
					if (v === 'back') return 'back';
					if (v === 'double') return 'double';
				}
			}
		} catch (err) { }
		return 'double';
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
				(Canvas.face_order || ['east', 'west', 'up', 'down', 'south', 'north']).forEach(fkey => {
					if (element.faces[fkey] && element.faces[fkey].texture !== null) {
						keys.push(fkey, fkey);
					}
				});
				return keys;
			}
			if (typeof Mesh !== 'undefined' && element instanceof Mesh) {
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
			console.warn('[PathTracer] faceKeysPerTriangle failed', err);
		}
		return null;
	}

	function buildMaterialLookup() {
		const map = new Map();
		try {
			(Texture.all || []).forEach(tex => {
				if (tex.material) map.set(tex.material, tex);
			});
			if (typeof TextureGroup !== 'undefined') {
				(TextureGroup.all || []).forEach(group => {
					if (!group.is_material) return;
					const mat = group.material;
					if (!mat) return;
					const color = group.getTextures().find(t => t.pbr_channel === 'color') || group.getTextures()[0];
					if (color) map.set(mat, color);
				});
			}
		} catch (err) { }
		return map;
	}

	function collectGeometry() {
		const positions = [];
		const normals = [];
		const uvs = [];
		const texRefs = [];
		const flips = [];
		const negativeCube = [];
		const insideOnly = [];

		if (typeof Canvas !== 'undefined' && Canvas.scene) Canvas.scene.updateMatrixWorld(true);

		const matLookup = buildMaterialLookup();
		const defaultTexture = (typeof Texture !== 'undefined' && Texture.getDefault) ? Texture.getDefault() : null;

		const elements = (typeof Outliner !== 'undefined' && Outliner.elements) ? Outliner.elements : [];

		elements.forEach(element => {
			if (!element || element.visibility === false) return;
			const mesh = element.mesh;
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
			const hasNegativeSize = element instanceof Cube && element.from && element.to
				&& element.to.some((v, axis) => v < element.from[axis]);
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
					} catch (err) { }
				}
				texRefs.push(tex || null);
				flips.push(mirrored);
				negativeCube.push(!!hasNegativeSize);
				insideOnly.push(insideOnlyFace);
			}
		});

		return {
			positions: new Float32Array(positions),
			normals: new Float32Array(normals),
			uvs: new Float32Array(uvs),
			texRefs: texRefs,
			flips: flips,
			negativeCube: negativeCube,
			insideOnly: insideOnly,
			triCount: texRefs.length,
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
			m[2] * x + m[6] * y + m[10] * z + m[14],
		];
	}

	function transformDir(nm, x, y, z) {
		return [
			nm[0] * x + nm[3] * y + nm[6] * z,
			nm[1] * x + nm[4] * y + nm[7] * z,
			nm[2] * x + nm[5] * y + nm[8] * z,
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
			(e * i - f * h) * id, -(b * i - c * h) * id, (b * f - c * e) * id,
			-(d * i - f * g) * id, (a * i - c * g) * id, -(a * f - c * d) * id,
			(d * h - e * g) * id, -(a * h - b * g) * id, (a * e - b * d) * id,
		];
		return [
			inv[0], inv[3], inv[6],
			inv[1], inv[4], inv[7],
			inv[2], inv[5], inv[8],
		];
	}


	function tryPackShelf(entries, size) {
		let x = 0, y = 0, shelfH = 0;
		const rects = new Array(entries.length);
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			if (e.w > size || e.h > size) return null;
			if (x + e.w > size) { x = 0; y += shelfH; shelfH = 0; }
			if (y + e.h > size) return null;
			rects[e.order] = { x: x, y: y, w: e.w, h: e.h };
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
			if (rects) return { size: size, rects: rects };
			size *= 2;
		}
		return null;
	}

