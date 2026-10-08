import { srgbToLinear } from '../core/math.js';

function cubeFace(direction) {
	const [x, y, z] = direction;
	const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
	if (ax >= ay && ax >= az) return x > 0 ? [0, -z / ax, -y / ax] : [1, z / ax, -y / ax];
	if (ay >= ax && ay >= az) return y > 0 ? [2, x / ay, z / ay] : [3, x / ay, -z / ay];
	return z > 0 ? [4, x / az, -y / az] : [5, -x / az, -y / az];
}

export function cubemapToEquirect(cubemap, width = 512, height = 256) {
	const faces = cubemap && cubemap.image;
	if (!Array.isArray(faces) || faces.length !== 6) return null;
	const faceData = faces.map(face => {
		const image = face && (face.image || face);
		if (!image || !image.width || !image.height) throw new Error('Blockbench 环境贴图尚未加载完成');
		const canvas = document.createElement('canvas');
		canvas.width = image.width; canvas.height = image.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		context.drawImage(image, 0, 0);
		return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
	});
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const latitude = Math.PI * (0.5 - (y + 0.5) / height);
		for (let x = 0; x < width; x++) {
			const longitude = 2 * Math.PI * ((x + 0.5) / width - 0.5);
			const direction = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
			const [index, u, v] = cubeFace(direction);
			const face = faceData[index];
			const fx = Math.max(0, Math.min(face.width - 1, Math.floor((u + 1) * 0.5 * face.width)));
			const fy = Math.max(0, Math.min(face.height - 1, Math.floor((v + 1) * 0.5 * face.height)));
			const source = (fy * face.width + fx) * 4;
			const destination = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) data[destination + channel] = srgbToLinear(face.data[source + channel] / 255);
			data[destination + 3] = 1;
		}
	}
	return { width, height, data };
}

export async function loadBlockbenchScene(id) {
	if (typeof PreviewScene === 'undefined') return null;
	const scene = PreviewScene.scenes && PreviewScene.scenes[id];
	if (!scene || (scene.require_minecraft_eula && !scene.loaded)) return null;
	if (!scene.loaded && scene.lazyLoadFromWeb) await scene.lazyLoadFromWeb();
	if (!scene.cubemap) return null;
	return { cubemap: scene.cubemap, environment: cubemapToEquirect(scene.cubemap) };
}
