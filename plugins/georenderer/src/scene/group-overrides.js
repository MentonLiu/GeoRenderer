export function groupChainForElement(element) {
	const chain = [];
	let parent = element && element.parent;
	while (parent && typeof parent === 'object') {
		if (parent.uuid) chain.push(parent.uuid);
		parent = parent.parent;
	}
	return chain;
}

export function materialKey(texture, groupChain = []) {
	return (texture ? texture.uuid : '__none__') + '|' + groupChain.join('/');
}

export function resolveMaterialOverride(texture, groupChain, textureOverrides, groupOverrides) {
	const result = { ...((texture && textureOverrides && textureOverrides[texture.uuid]) || {}) };
	for (let i = groupChain.length - 1; i >= 0; i--) {
		Object.assign(result, (groupOverrides && groupOverrides[groupChain[i]]) || {});
	}
	return result;
}

export function resolveEmissionStrength(override, groupChain, groupOverrides, settings, fallback) {
	const perPart = groupChain.some(id => groupOverrides?.[id]?.emissive != null);
	// Part sliders set an absolute strength, just as their roughness/metalness sliders do.
	// Preserve the prototype's multiplier for native emission and per-texture controls.
	return Math.max(0, (override.emissive ?? fallback) * (perPart ? 1 : settings.emissive_strength));
}
