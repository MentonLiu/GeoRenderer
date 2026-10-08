import { hexToLinear, srgbToLinear } from '../core/math.js';
import { getMaterialSide, textureSource } from '../scene/geometry.js';
import { resolveMaterialOverride } from '../scene/group-overrides.js';

function linearColor(color, value) {
	color.setRGB(...hexToLinear(value));
}

// Own GPU texture copies so color encoding never changes Blockbench's textures.
export class RasterMaterials {
	constructor(settings, overrides, groupOverrides) {
		this.settings = settings;
		this.overrides = overrides;
		this.groupOverrides = groupOverrides;
		this.materials = [];
		this.textures = new Map();
		this.imageTextures = new Map();
		this.lookup = new Map();
		for (const texture of (typeof Texture !== 'undefined' && Texture.all) || []) {
			const material = texture.getMaterial?.() || texture.material;
			if (material) this.lookup.set(material, texture);
		}
		for (const group of (typeof TextureGroup !== 'undefined' && TextureGroup.all) || []) {
			if (!group.is_material || !group.material) continue;
			this.lookup.set(group.material, group.getTextures().find(t => t.pbr_channel === 'color'));
		}
	}

	texture(image, encoding = THREE.sRGBEncoding, source = null) {
		if (!image) return null;
		const byEncoding = this.imageTextures.get(image) || new Map();
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
		const canvas = document.createElement('canvas');
		canvas.width = image.width; canvas.height = image.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(image, 0, 0);
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const emission = document.createElement('canvas');
		emission.width = canvas.width; emission.height = canvas.height;
		const ec = emission.getContext('2d', { willReadFrequently: true });
		if (colorImage) ec.drawImage(colorImage, 0, 0, canvas.width, canvas.height);
		else { ec.fillStyle = '#ffffff'; ec.fillRect(0, 0, canvas.width, canvas.height); }
		const ed = ec.getImageData(0, 0, canvas.width, canvas.height);
		for (let i = 0; i < data.data.length; i += 4) {
			const metal = data.data[i], power = data.data[i + 1] / 255, rough = data.data[i + 2];
			data.data[i + 1] = rough; data.data[i + 2] = metal;
			for (let c = 0; c < 3; c++) ed.data[i + c] = Math.round(srgbToLinear(ed.data[i + c] / 255) * power * 255);
		}
		ctx.putImageData(data, 0, 0); ec.putImageData(ed, 0, 0);
		const maps = { surface: this.texture(canvas, THREE.LinearEncoding), emission: this.texture(emission, THREE.LinearEncoding) };
		this.textures.set(key, maps);
		return maps;
	}

	create(source, groupChain) {
		const texture = this.lookup.get(source);
		const ov = resolveMaterialOverride(texture, groupChain, this.overrides, this.groupOverrides);
		const settings = this.settings;
		const group = texture?.getGroup?.();
		const channels = group?.is_material ? group.getTextures() : [];
		const colorImage = textureSource(channels.find(t => t.pbr_channel === 'color') || texture);
		const sourceMap = source.uniforms?.map?.value || source.map;
		const map = this.texture(colorImage || sourceMap?.image, THREE.sRGBEncoding, sourceMap);
		const material = ov.transmission > 0 ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
		material.map = map;
		if (ov.color) linearColor(material.color, ov.color);
		else if (!map && source.color) material.color.copy(source.color);
		else material.color.set(map ? '#ffffff' : '#cccccc');
		material.roughness = ov.roughness ?? settings.def_roughness;
		material.metalness = ov.metalness ?? settings.def_metalness;
		material.side = texture ? { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide }[getMaterialSide(texture, settings.render_sides)] : source.side;
		material.visible = source.visible !== false;
		material.skinning = !!source.skinning;
		material.morphTargets = !!source.morphTargets;
		material.morphNormals = !!source.morphNormals;
		material.flatShading = !!source.flatShading;
		const alphaMode = ov.alpha_mode || settings.alpha_mode;
		material.transparent = alphaMode === 'blend';
		material.depthWrite = !material.transparent;
		material.alphaTest = alphaMode === 'cutout' ? (ov.alpha_cutoff ?? settings.alpha_cutoff) : 0;
		material.opacity = source.opacity ?? 1;
		material.vertexColors = !!source.vertexColors;
		const mer = channels.find(t => t.pbr_channel === 'mer');
		const maps = this.merMaps(mer, colorImage || sourceMap?.image);
		if (maps.surface) {
			if (ov.roughness == null) { material.roughnessMap = maps.surface; material.roughness = 1; }
			if (ov.metalness == null) { material.metalnessMap = maps.surface; material.metalness = 1; }
		}
		const normal = channels.find(t => t.pbr_channel === 'normal');
		material.normalMap = this.texture(textureSource(normal), THREE.LinearEncoding) || source.normalMap || null;
		material.normalScale.setScalar(ov.normal_scale ?? 1);
		const emissiveDefault = mer || texture?.render_mode === 'emissive' || texture?.render_mode === 'additive' ? 1 : 0;
		material.emissiveIntensity = (ov.emissive ?? emissiveDefault) * settings.emissive_strength;
		linearColor(material.emissive, ov.emissive != null ? (ov.emissive_color || '#ffffff') : '#ffffff');
		material.emissive.multiply(material.color);
		material.emissiveMap = ov.emissive != null ? map : maps.emission || map;
		if (ov.emissive == null && !mer && ov.emissive_map) {
			const image = textureSource(((typeof Texture !== 'undefined' && Texture.all) || []).find(t => t.uuid === ov.emissive_map));
			material.emissiveMap = this.texture(image);
		}
		if (ov.transmission > 0) { material.transmission = ov.transmission; material.ior = ov.ior ?? 1.5; }
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
}
