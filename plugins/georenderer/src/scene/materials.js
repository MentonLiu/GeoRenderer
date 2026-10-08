import { MAT_TEXELS } from '../core/config.js';
import { clamp, hexToLinear } from '../core/math.js';
import { createAtlasTexture } from '../gpu/webgl.js';
import { packAtlas } from './atlas.js';
import { MF_ADDITIVE, MF_EMIS_CUSTOM_COLOR, MF_EMIS_MAIN_COLOR, MF_FULLBRIGHT, MF_HAS_COLOR, MF_HAS_EMISSIVE_MAP, MF_HAS_MER, MF_HAS_NORMAL, MF_WRAP_REPEAT, getMaterialSide, textureSource } from './geometry.js';
import { materialKey, resolveMaterialOverride } from './group-overrides.js';

export function buildMaterials(gl, texRefs, groupRefs, settings, overrides, groupOverrides) {
	const slotList = [];
	const slotOfKey = new Map();
	for (let i = 0; i < texRefs.length; i++) {
		const tex = texRefs[i];
		const groupChain = groupRefs[i] || [];
		const key = materialKey(tex, groupChain);
		if (!slotOfKey.has(key)) {
			slotOfKey.set(key, slotList.length);
			slotList.push({ texture: tex, uuid: tex ? tex.uuid : '__none__', groupChain });
		}
	}
	let groundSlot = -1;
	if (settings.ground_texture_uuid && typeof Texture !== 'undefined') {
		const groundTexture = (Texture.all || []).find(texture => texture.uuid === settings.ground_texture_uuid);
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
	const atlasIndex = new Map();
	const addAtlasSource = (slot, key, width, height) => {
		if (!atlasIndex.has(key)) {
			atlasIndex.set(key, sizes.length);
			sizes.push([width, height]);
		}
		slot.atlasIndex = atlasIndex.get(key);
	};
	slotList.forEach(slot => {
		const tex = slot.texture;
		slot.color = null; slot.mer = null; slot.normal = null;
		slot.side = 'double';
		if (!tex) { addAtlasSource(slot, '__none__', 1, 1); return; }
		if (tex.previewMaterial) {
			const material = tex.previewMaterial;
			const image = material.map?.image;
			slot.color = image && image.width > 0 && image.height > 0 ? image : null;
			slot.previewMaterial = material;
			slot.side = material.side === 0 ? 'front' : material.side === 1 ? 'back' : 'double';
			addAtlasSource(slot, tex.uuid, slot.color?.width || 1, slot.color?.height || 1);
			return;
		}

		let group = null;
		try { group = tex.getGroup ? tex.getGroup() : null; } catch (err) { group = null; }

		let colorTex = tex, merTex = null, nrmTex = null;
		if (group && group.is_material) {
			const list = group.getTextures();
			colorTex = list.find(t => t.pbr_channel === 'color') || tex;
			merTex = list.find(t => t.pbr_channel === 'mer') || null;
			nrmTex = list.find(t => t.pbr_channel === 'normal') || null;
		}

		slot.color = textureSource(colorTex);
		slot.mer = textureSource(merTex);
		slot.normal = textureSource(nrmTex);
		slot.colorTex = colorTex;
		slot.group = group;
		slot.side = getMaterialSide(colorTex || tex, settings.render_sides);

		const slotOv = resolveMaterialOverride(tex, slot.groupChain, overrides, groupOverrides);
		let emisTex = null;
		if (slotOv.emissive_map) {
			const allTex = (typeof Texture !== 'undefined' ? Texture.all : []) || [];
			emisTex = allTex.find(t => t.uuid === slotOv.emissive_map) || null;
		}
		slot.emissiveMap = textureSource(emisTex);
		slot.emissiveColorMain = slotOv.emissive_color_source === 'main';
		slot.emissiveColorCustom = slotOv.emissive_color_source === 'custom';

		let w = slot.color ? slot.color.width : 1;
		let h = slot.color ? slot.color.height : 1;
		if (slot.mer) { w = Math.max(w, slot.mer.width); h = Math.max(h, slot.mer.height); }
		if (slot.normal) { w = Math.max(w, slot.normal.width); h = Math.max(h, slot.normal.height); }
		if (slot.emissiveMap) { w = Math.max(w, slot.emissiveMap.width); h = Math.max(h, slot.emissiveMap.height); }
		w = clamp(w | 0, 1, maxTexSize);
		h = clamp(h | 0, 1, maxTexSize);
		addAtlasSource(slot, tex.uuid + '|' + (slotOv.emissive_map || ''), w, h);
	});

	const packed = packAtlas(sizes, maxTexSize);
	if (!packed) throw new Error('纹理图集打包失败：贴图总面积超出 GPU 上限。');

	const S = packed.size;
	const mk = () => {
		const c = document.createElement('canvas');
		c.width = S; c.height = S;
		const ctx = c.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		return { canvas: c, ctx: ctx, used: false };
	};
	const atlasC = mk(), atlasM = mk(), atlasN = mk(), atlasE = mk();
	atlasN.ctx.fillStyle = '#8080ff';
	atlasN.ctx.fillRect(0, 0, S, S);
	atlasM.ctx.fillStyle = '#000000';
	atlasM.ctx.fillRect(0, 0, S, S);
	atlasE.ctx.fillStyle = '#000000';
	atlasE.ctx.fillRect(0, 0, S, S);
	atlasC.ctx.clearRect(0, 0, S, S);

	const drawnSources = new Set();
	slotList.forEach(slot => {
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
			if (slot.mer) { atlasM.ctx.drawImage(slot.mer, r.x, r.y, r.w, r.h); atlasM.used = true; }
			if (slot.normal) { atlasN.ctx.drawImage(slot.normal, r.x, r.y, r.w, r.h); atlasN.used = true; }
			if (slot.emissiveMap) { atlasE.ctx.drawImage(slot.emissiveMap, r.x, r.y, r.w, r.h); atlasE.used = true; }
		} catch (err) {
			console.warn('[PathTracer] 绘制图集失败', err);
		}
	});

	const emissiveSlots = new Set();
	if (atlasM.used) {
		const merData = atlasM.ctx.getImageData(0, 0, S, S).data;
		slotList.forEach((slot, i) => {
			if (!slot.mer) return;
			const r = slot.rect;
			let found = false;
			for (let y = r.y; y < r.y + r.h && !found; y++) {
				for (let x = r.x; x < r.x + r.w; x++) {
					if (merData[(y * S + x) * 4 + 1] > 4) { found = true; break; }
				}
			}
			if (found) emissiveSlots.add(i);
		});
	}

	const emissiveMapSlots = new Set();
	if (atlasE.used) {
		const emsData = atlasE.ctx.getImageData(0, 0, S, S).data;
		slotList.forEach((slot, i) => {
			if (!slot.emissiveMap) return;
			const r = slot.rect;
			let found = false;
			for (let y = r.y; y < r.y + r.h && !found; y++) {
				for (let x = r.x; x < r.x + r.w; x++) {
					const o4 = (y * S + x) * 4;
					if (emsData[o4] > 4 || emsData[o4 + 1] > 4 || emsData[o4 + 2] > 4) { found = true; break; }
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
			const tint = preview.color || { r: 1, g: 1, b: 1 };
			const basic = !!preview.isMeshBasicMaterial;
			const emissive = preview.emissive || { r: 0, g: 0, b: 0 };
			const emissivePower = Math.max(emissive.r, emissive.g, emissive.b) * (preview.emissiveIntensity ?? 1);
			const emits = basic || emissivePower > 0;
			let flags = slot.color ? MF_HAS_COLOR : 0;
			if (preview.map?.wrapS === 1000 || preview.map?.wrapT === 1000) flags |= MF_WRAP_REPEAT;
			if (emits) flags |= 512;
			matData.set([tint.r, tint.g, tint.b, flags], o);
			matData.set([slot.rect.x, slot.rect.y, slot.rect.w, slot.rect.h], o + 4);
			matData.set([preview.roughness ?? 1, preview.metalness ?? 0, basic ? 1 : (preview.emissiveIntensity ?? 1), 1.5], o + 8);
			matData.set([0, preview.alphaTest || 0, 1, preview.transparent ? 2 : preview.alphaTest > 0 ? 1 : 0], o + 12);
			matData.set([basic ? 1 : emissive.r, basic ? 1 : emissive.g, basic ? 1 : emissive.b, preview.opacity ?? 1], o + 16);
			slot.emissive = emits;
			return;
		}
		const ov = resolveMaterialOverride(tex, slot.groupChain, overrides, groupOverrides);

		const hasMER = !!slot.mer;
		const hasEmissiveMap = !!slot.emissiveMap;
		const fullbrightTex = !!(tex && (tex.render_mode === 'emissive' || tex.render_mode === 'additive'));
		const defEmis = (hasMER || hasEmissiveMap || fullbrightTex) ? 1 : 0;
		const emisVal = (ov.emissive != null ? ov.emissive : defEmis) * settings.emissive_strength;

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
		if (tex && tex.render_mode === 'additive') flags |= MF_ADDITIVE;
		if (!tex || tex.wrap_mode !== 'clamp') flags |= MF_WRAP_REPEAT;

		const tint = ov.color ? hexToLinear(ov.color) : (slot.color ? [1, 1, 1] : [0.8, 0.8, 0.8]);
		matData[o] = tint[0];
		matData[o + 1] = tint[1];
		matData[o + 2] = tint[2];
		matData[o + 3] = flags;

		matData[o + 4] = slot.rect.x;
		matData[o + 5] = slot.rect.y;
		matData[o + 6] = slot.rect.w;
		matData[o + 7] = slot.rect.h;

		matData[o + 8] = ov.roughness != null ? ov.roughness : settings.def_roughness;
		matData[o + 9] = ov.metalness != null ? ov.metalness : settings.def_metalness;
		matData[o + 10] = emisVal;
		matData[o + 11] = ov.ior != null ? ov.ior : 1.5;

		matData[o + 12] = ov.transmission != null ? ov.transmission : 0;
		matData[o + 13] = ov.alpha_cutoff != null ? ov.alpha_cutoff : settings.alpha_cutoff;
		matData[o + 14] = ov.normal_scale != null ? ov.normal_scale : 1;
		const amode = ov.alpha_mode || settings.alpha_mode || 'cutout';
		matData[o + 15] = amode === 'blend' ? 2 : (amode === 'opaque' ? 0 : 1);

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
		slotList: slotList,
		slotOfKey: slotOfKey,
		groundRect: groundSlot >= 0 && slotList[groundSlot].color ? slotList[groundSlot].rect : null,
		matData: matData,
		matCount: slotList.length,
		textureCount: new Set(texRefs.filter(Boolean).map(texture => texture.uuid)).size,
		atlasColor: texColor,
		atlasMER: texMER,
		atlasNormal: texNRM,
		atlasEmissive: texEMS,
		atlasSize: S,
	};
}
