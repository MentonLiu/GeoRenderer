	class OrbitCam {
		constructor() {
			this.target = [0, 12, 0];
			this.distance = 70;
			this.theta = Math.PI * 0.25;
			this.phi = Math.PI * 0.42;
			this.fov = 45;
			this.ortho = false;
		}
		position() {
			const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
			return [
				this.target[0] + this.distance * sp * Math.sin(this.theta),
				this.target[1] + this.distance * cp,
				this.target[2] + this.distance * sp * Math.cos(this.theta),
			];
		}
		state() {
			return {
				pos: this.position(),
				target: this.target.slice(),
				fov: this.fov,
				ortho: this.ortho,
				orthoHalfHeight: this.distance * Math.tan(this.fov * Math.PI / 360),
			};
		}
		orbit(dx, dy) {
			this.theta -= dx * 0.008;
			this.phi = clamp(this.phi - dy * 0.008, 0.02, Math.PI - 0.02);
		}
		pan(dx, dy, aspectScale) {
			const pos = this.position();
			const fwd = vNorm(vSub(this.target, pos));
			let right = vCross(fwd, [0, 1, 0]);
			if (vDot(right, right) < 1e-8) right = [1, 0, 0];
			right = vNorm(right);
			const up = vNorm(vCross(right, fwd));
			const scale = this.distance * Math.tan(this.fov * Math.PI / 360) * 2 * aspectScale;
			this.target = vAdd(this.target, vAdd(vScale(right, -dx * scale), vScale(up, dy * scale)));
		}
		zoom(delta) {
			this.distance = clamp(this.distance * Math.exp(delta * 0.0012), 0.5, 20000);
		}
		frameBounds(bounds) {
			if (!bounds) return;
			this.target = bounds.center.slice();
			this.distance = Math.max(bounds.radius * 2.6, 4);
		}
		syncFromPreview() {
			try {
				const prev = (typeof Preview !== 'undefined') ? Preview.selected : null;
				if (!prev || !prev.camera) return false;
				const c = prev.camera;
				c.updateMatrixWorld(true);
				const e = c.matrixWorld.elements;
				const pos = [e[12], e[13], e[14]];
				const tgt = prev.controls && prev.controls.target
					? [prev.controls.target.x, prev.controls.target.y, prev.controls.target.z]
					: [0, 0, 0];
				const d = vSub(pos, tgt);
				const dist = Math.hypot(d[0], d[1], d[2]);
				if (!(dist > 1e-4)) return false;
				this.target = tgt;
				this.distance = dist;
				this.phi = clamp(Math.acos(clamp(d[1] / dist, -1, 1)), 0.02, Math.PI - 0.02);
				this.theta = Math.atan2(d[0], d[2]);
				if (typeof c.fov === 'number') this.fov = c.fov;
				this.ortho = !!prev.isOrtho;
				return true;
			} catch (err) {
				console.warn('[PathTracer] 同步相机失败', err);
				return false;
			}
		}
	}


