// 从元素向上收集父级组 UUID，结果顺序为直接父级到最外层父级。
export function groupChainForElement(element) {
	const chain = [];
	let parent = element && element.parent;
	// 沿父级链向上遍历，忽略没有 UUID 的非组对象。
	while (parent && typeof parent === 'object') {
		if (parent.uuid) chain.push(parent.uuid);
		parent = parent.parent;
	}
	return chain;
}

// 组合纹理和组链生成材质去重键，避免同纹理的不同组覆盖相互污染。
export function materialKey(texture, groupChain = []) {
	return (texture ? texture.uuid : '__none__') + '|' + groupChain.join('/');
}

// 按纹理覆盖和组层级合并材质参数，越靠近元素的组拥有更高优先级。
export function resolveMaterialOverride(texture, groupChain, textureOverrides, groupOverrides) {
	const result = { ...((texture && textureOverrides && textureOverrides[texture.uuid]) || {}) };
	// 从最外层到最内层覆盖，保证内层组的设置最终生效。
	for (let i = groupChain.length - 1; i >= 0; i--) {
		Object.assign(result, (groupOverrides && groupOverrides[groupChain[i]]) || {});
	}
	return result;
}

// 解析发光强度：部件级发光使用绝对值，其余材质继承全局倍率。
export function resolveEmissionStrength(override, groupChain, groupOverrides, settings, fallback) {
	const perPart = groupChain.some(id => groupOverrides?.[id]?.emissive != null);
	// 部件滑块与粗糙度/金属度滑块一样使用绝对强度。
	// 没有部件级覆盖时保留原型中的全局倍率和纹理默认发光控制。
	return Math.max(0, (override.emissive ?? fallback) * (perPart ? 1 : settings.emissive_strength));
}
