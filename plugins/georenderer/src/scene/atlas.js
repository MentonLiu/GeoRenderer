

// 使用货架算法尝试把按高度排序的贴图放入指定尺寸的正方形图集。
function tryPackShelf(entries, size) {
	let x = 0, y = 0, shelfH = 0;
	const rects = new Array(entries.length);
	// 依次放置贴图；横向放不下时换到下一层货架。
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

// 从 64 像素开始逐步扩大图集，返回按原始输入索引排列的矩形区域。
export function packAtlas(sizes, maxSize) {
	const entries = sizes.map((s, i) => ({ w: s[0], h: s[1], order: i }));
	// 大图优先放置可以减少货架碎片，但这不是全局最优装箱算法。
	entries.sort((a, b) => b.h - a.h || b.w - a.w);
	let size = 64;
	// 每次扩大一倍，直到找到能容纳全部贴图的 GPU 纹理尺寸。
	while (size <= maxSize) {
		const rects = tryPackShelf(entries, size);
		if (rects) return { size: size, rects: rects };
		size *= 2;
	}
	return null;
}
