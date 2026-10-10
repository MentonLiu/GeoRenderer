import { FINAL_TILE_SIDE, MAX_RENDER_BUFFER_SIDE } from '../core/config.js';

// 根据后处理滤镜所需的边缘范围，规划最终图像的分块和裁剪坐标。
export function makeTilePlan(width, height, settings, maxSide = MAX_RENDER_BUFFER_SIDE) {
	// 分块必须包含完整滤镜支持范围，复制回最终画布时再裁掉这部分边缘。
	const denoisePadding = settings.denoise && settings.denoise_strength > 0 ? 2 * (1 + 2 + 4 + 8) : 0;
	const bloomRadius = Math.max(settings.bloom_radius || 0, 0.1) * width / 1280;
	const bloomPadding = settings.bloom_enable ? Math.ceil(8 * Math.max(bloomRadius / 4, 1)) : 0;
	const padding = denoisePadding + bloomPadding + (settings.sharpen_enable ? 1 : 0);
	const side = Math.min(FINAL_TILE_SIDE, maxSide - 2 * padding);
	if (side < 8) throw new Error('后期滤镜范围超过当前 GPU 的分块上限');
	const bufferWidth = Math.min(width, side + 2 * padding);
	const bufferHeight = Math.min(height, side + 2 * padding);
	const tiles = [];
	// 外层按画布顶部坐标逐行遍历，内层按左侧坐标逐列遍历。
	for (let top = 0; top < height; top += side) for (let x = 0; x < width; x += side) {
		const w = Math.min(side, width - x), h = Math.min(side, height - top);
		// UI/Canvas 使用左上角原点，而 WebGL 读回使用左下角原点；两个坐标都保留，避免裁剪换算含义混淆。
		const y = height - top - h;
		const originX = Math.max(0, Math.min(x - padding, width - bufferWidth));
		const originY = Math.max(0, Math.min(y - padding, height - bufferHeight));
		tiles.push({
			x, y, top, width: w, height: h, originX, originY,
			cropX: x - originX, cropTop: bufferHeight - (y - originY) - h
		});
	}
	return { width, height, bufferWidth, bufferHeight, padding, tiles };
}

export class TiledRender {
	// 管理最终渲染的分块累积、滤镜缓冲和结果拼接。
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
		// 每个分块都重新开始样本累积，但后处理完成后只把未填充的中心区域复制回最终画布。
		tracer.renderWindow = { width: this.plan.width, height: this.plan.height, x: tile.originX, y: tile.originY };
		tracer.reset();
	}

	copyTile(source) {
		// 从带滤镜边缘的源画布中截取当前分块的中心区域。
		const tile = this.plan.tiles[this.index];
		this.context.clearRect(tile.x, tile.top, tile.width, tile.height);
		this.context.drawImage(source, tile.cropX, tile.cropTop, tile.width, tile.height,
			tile.x, tile.top, tile.width, tile.height);
	}

	finishTile(tracer) {
		// 保存当前分块并切换到下一个分块；最后一个分块完成时标记整个任务结束。
		this.copyTile(tracer.canvas);
		this.index++;
		this.completed = this.index === this.plan.tiles.length;
		if (!this.completed) this.startTile(tracer);
	}

	updateSamples(samples, tracer) {
		// 样本目标变化会使旧的累积结果失效，因此必须从第一个分块重新开始。
		if (samples === this.sampleTarget) return;
		this.sampleTarget = Math.max(1, samples);
		this.restart(tracer);
	}

	restart(tracer) {
		// 清空已经拼接的结果，并重置分块索引和路径追踪器的累积缓冲。
		this.index = 0;
		this.completed = false;
		this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.startTile(tracer);
	}

	progress(spp) {
		// 将已完成分块和当前分块的样本进度合并为 0 到 1 的任务进度。
		return (this.index + (this.completed ? 0 : Math.min(spp / this.sampleTarget, 1))) / this.plan.tiles.length;
	}

	dispose() {
		// 缩小画布释放其 2D 绘图缓冲，避免最终导出资源继续占用内存。
		this.canvas.width = this.canvas.height = 1;
	}
}
