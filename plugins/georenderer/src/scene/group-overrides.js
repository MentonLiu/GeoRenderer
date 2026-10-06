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
