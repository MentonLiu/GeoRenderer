import { FINAL_TILE_SIDE, MAX_RENDER_BUFFER_SIDE } from '../core/config.js';

export function makeTilePlan(width, height, settings, maxSide = MAX_RENDER_BUFFER_SIDE) {
	// Include the complete filter support around each tile, then crop it away.
	const denoisePadding = settings.denoise && settings.denoise_strength > 0 ? 2 * (1 + 2 + 4 + 8) : 0;
	const bloomRadius = Math.max(settings.bloom_radius || 0, 0.1) * width / 1280;
	const bloomPadding = settings.bloom_enable ? Math.ceil(8 * Math.max(bloomRadius / 4, 1)) : 0;
	const padding = denoisePadding + bloomPadding + (settings.sharpen_enable ? 1 : 0);
	const side = Math.min(FINAL_TILE_SIDE, maxSide - 2 * padding);
	if (side < 8) throw new Error('后期滤镜范围超过当前 GPU 的分块上限');
	const bufferWidth = Math.min(width, side + 2 * padding);
	const bufferHeight = Math.min(height, side + 2 * padding);
	const tiles = [];
	for (let top = 0; top < height; top += side) for (let x = 0; x < width; x += side) {
		const w = Math.min(side, width - x), h = Math.min(side, height - top);
		const y = height - top - h;
		const originX = Math.max(0, Math.min(x - padding, width - bufferWidth));
		const originY = Math.max(0, Math.min(y - padding, height - bufferHeight));
		tiles.push({ x, y, top, width: w, height: h, originX, originY,
			cropX: x - originX, cropTop: bufferHeight - (y - originY) - h });
	}
	return { width, height, bufferWidth, bufferHeight, padding, tiles };
}

export class TiledRender {
	constructor(canvas, width, height, settings, maxSide) {
		this.canvas = canvas;
		this.plan = makeTilePlan(width, height, settings, maxSide);
		this.sampleTarget = Math.max(1, settings.final_samples);
		this.index = 0;
		this.completed = false;
		canvas.width = width;
		canvas.height = height;
		this.context = canvas.getContext('2d', { willReadFrequently: true });
		if (!this.context) {
			this.dispose();
			throw new Error('无法创建最终图片缓冲');
		}
		this.context.imageSmoothingEnabled = false;
	}

	startTile(tracer) {
		const tile = this.plan.tiles[this.index];
		tracer.renderWindow = { width: this.plan.width, height: this.plan.height, x: tile.originX, y: tile.originY };
		tracer.reset();
	}

	copyTile(source) {
		const tile = this.plan.tiles[this.index];
		this.context.clearRect(tile.x, tile.top, tile.width, tile.height);
		this.context.drawImage(source, tile.cropX, tile.cropTop, tile.width, tile.height,
			tile.x, tile.top, tile.width, tile.height);
	}

	finishTile(tracer) {
		this.copyTile(tracer.canvas);
		this.index++;
		this.completed = this.index === this.plan.tiles.length;
		if (!this.completed) this.startTile(tracer);
	}

	updateSamples(samples, tracer) {
		if (samples === this.sampleTarget) return;
		this.sampleTarget = Math.max(1, samples);
		this.restart(tracer);
	}

	restart(tracer) {
		this.index = 0;
		this.completed = false;
		this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.startTile(tracer);
	}

	progress(spp) {
		return (this.index + (this.completed ? 0 : Math.min(spp / this.sampleTarget, 1))) / this.plan.tiles.length;
	}

	dispose() {
		this.canvas.width = this.canvas.height = 1;
	}
}
