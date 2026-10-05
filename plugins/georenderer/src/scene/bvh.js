import { MAX_LEAF_TRIS, SAH_BINS } from '../core/config.js';

export function buildBVH(positions, triCount) {
	if (triCount === 0) {
		const nodes = new Float32Array(8);
		nodes[3] = 0; nodes[7] = 0;
		return { nodes: nodes, nodeCount: 1, order: new Uint32Array(0) };
	}

	const bmin = new Float32Array(triCount * 3);
	const bmax = new Float32Array(triCount * 3);
	const cent = new Float32Array(triCount * 3);
	for (let i = 0; i < triCount; i++) {
		const o = i * 9;
		for (let a = 0; a < 3; a++) {
			const p0 = positions[o + a], p1 = positions[o + 3 + a], p2 = positions[o + 6 + a];
			const lo = Math.min(p0, p1, p2), hi = Math.max(p0, p1, p2);
			bmin[i * 3 + a] = lo;
			bmax[i * 3 + a] = hi;
			cent[i * 3 + a] = (lo + hi) * 0.5;
		}
	}

	const order = new Uint32Array(triCount);
	for (let i = 0; i < triCount; i++) order[i] = i;

	const maxNodes = Math.max(4, triCount * 2);
	const nodes = new Float32Array(maxNodes * 8);
	let nodeCount = 1;

	const stack = [[0, 0, triCount]];
	const tmp = new Uint32Array(triCount);

	while (stack.length) {
		const [nodeIdx, start, count] = stack.pop();

		let nx = Infinity, ny = Infinity, nz = Infinity;
		let xx = -Infinity, xy = -Infinity, xz = -Infinity;
		let cnx = Infinity, cny = Infinity, cnz = Infinity;
		let cxx = -Infinity, cxy = -Infinity, cxz = -Infinity;
		for (let i = start; i < start + count; i++) {
			const t = order[i], t3 = t * 3;
			if (bmin[t3] < nx) nx = bmin[t3];
			if (bmin[t3 + 1] < ny) ny = bmin[t3 + 1];
			if (bmin[t3 + 2] < nz) nz = bmin[t3 + 2];
			if (bmax[t3] > xx) xx = bmax[t3];
			if (bmax[t3 + 1] > xy) xy = bmax[t3 + 1];
			if (bmax[t3 + 2] > xz) xz = bmax[t3 + 2];
			if (cent[t3] < cnx) cnx = cent[t3];
			if (cent[t3 + 1] < cny) cny = cent[t3 + 1];
			if (cent[t3 + 2] < cnz) cnz = cent[t3 + 2];
			if (cent[t3] > cxx) cxx = cent[t3];
			if (cent[t3 + 1] > cxy) cxy = cent[t3 + 1];
			if (cent[t3 + 2] > cxz) cxz = cent[t3 + 2];
		}

		const no = nodeIdx * 8;
		nodes[no] = nx; nodes[no + 1] = ny; nodes[no + 2] = nz;
		nodes[no + 4] = xx; nodes[no + 5] = xy; nodes[no + 6] = xz;

		const makeLeaf = () => {
			nodes[no + 3] = start;
			nodes[no + 7] = count;
		};

		if (count <= 2) { makeLeaf(); continue; }

		const ext = [cxx - cnx, cxy - cny, cxz - cnz];
		let axis = 0;
		if (ext[1] > ext[axis]) axis = 1;
		if (ext[2] > ext[axis]) axis = 2;
		if (ext[axis] < 1e-9) { makeLeaf(); continue; }

		const cMin = [cnx, cny, cnz][axis];
		const scale = SAH_BINS / ext[axis];

		const binCount = new Int32Array(SAH_BINS);
		const binBounds = new Float32Array(SAH_BINS * 6);
		for (let b = 0; b < SAH_BINS; b++) {
			binBounds[b * 6] = binBounds[b * 6 + 1] = binBounds[b * 6 + 2] = Infinity;
			binBounds[b * 6 + 3] = binBounds[b * 6 + 4] = binBounds[b * 6 + 5] = -Infinity;
		}
		for (let i = start; i < start + count; i++) {
			const t = order[i], t3 = t * 3;
			let b = Math.floor((cent[t3 + axis] - cMin) * scale);
			if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
			binCount[b]++;
			const bo = b * 6;
			for (let a = 0; a < 3; a++) {
				if (bmin[t3 + a] < binBounds[bo + a]) binBounds[bo + a] = bmin[t3 + a];
				if (bmax[t3 + a] > binBounds[bo + 3 + a]) binBounds[bo + 3 + a] = bmax[t3 + a];
			}
		}

		const leftArea = new Float32Array(SAH_BINS);
		const leftCount = new Int32Array(SAH_BINS);
		let al = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		let acc = 0;
		for (let b = 0; b < SAH_BINS; b++) {
			if (binCount[b] > 0) {
				const bo = b * 6;
				for (let a = 0; a < 3; a++) {
					if (binBounds[bo + a] < al[a]) al[a] = binBounds[bo + a];
					if (binBounds[bo + 3 + a] > al[3 + a]) al[3 + a] = binBounds[bo + 3 + a];
				}
			}
			acc += binCount[b];
			leftCount[b] = acc;
			leftArea[b] = surfaceArea(al);
		}
		let bestCost = Infinity, bestBin = -1;
		let ar = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		let accR = 0;
		for (let b = SAH_BINS - 1; b > 0; b--) {
			if (binCount[b] > 0) {
				const bo = b * 6;
				for (let a = 0; a < 3; a++) {
					if (binBounds[bo + a] < ar[a]) ar[a] = binBounds[bo + a];
					if (binBounds[bo + 3 + a] > ar[3 + a]) ar[3 + a] = binBounds[bo + 3 + a];
				}
			}
			accR += binCount[b];
			const lc = leftCount[b - 1], rc = accR;
			if (lc === 0 || rc === 0) continue;
			const cost = leftArea[b - 1] * lc + surfaceArea(ar) * rc;
			if (cost < bestCost) { bestCost = cost; bestBin = b; }
		}

		const parentArea = surfaceArea([nx, ny, nz, xx, xy, xz]);
		const leafCost = parentArea * count;
		if (bestBin < 0 || (bestCost >= leafCost && count <= MAX_LEAF_TRIS)) {
			makeLeaf();
			continue;
		}

		let w = 0;
		for (let i = start; i < start + count; i++) {
			const t = order[i];
			let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
			if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
			if (b < bestBin) tmp[w++] = t;
		}
		const leftN = w;
		for (let i = start; i < start + count; i++) {
			const t = order[i];
			let b = Math.floor((cent[t * 3 + axis] - cMin) * scale);
			if (b < 0) b = 0; else if (b >= SAH_BINS) b = SAH_BINS - 1;
			if (b >= bestBin) tmp[w++] = t;
		}
		for (let i = 0; i < count; i++) order[start + i] = tmp[i];

		if (leftN === 0 || leftN === count) { makeLeaf(); continue; }

		const leftIdx = nodeCount;
		const rightIdx = nodeCount + 1;
		nodeCount += 2;
		if (rightIdx * 8 + 8 > nodes.length) { makeLeaf(); nodeCount -= 2; continue; }

		nodes[no + 3] = leftIdx;
		nodes[no + 7] = 0;

		stack.push([rightIdx, start + leftN, count - leftN]);
		stack.push([leftIdx, start, leftN]);
	}

	return { nodes: nodes, nodeCount: nodeCount, order: order };
}

function surfaceArea(b) {
	const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
	if (dx < 0 || dy < 0 || dz < 0) return 0;
	return 2 * (dx * dy + dy * dz + dz * dx);
}
