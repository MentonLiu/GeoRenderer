

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

export function packAtlas(sizes, maxSize) {
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
