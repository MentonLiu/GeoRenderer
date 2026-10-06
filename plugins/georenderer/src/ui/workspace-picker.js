import { groupUuidForElement, selectGroup } from './group-panel.js';
import { PTR } from './state.js';

export function attachWorkspacePicker(root = document) {
	let down = null;
	const onDown = event => {
		if (PTR.step !== 'materials' || event.button !== 0 || typeof Preview === 'undefined') return;
		const preview = (Preview.all || []).find(item => item.node?.contains(event.target));
		down = preview ? { preview, x: event.clientX, y: event.clientY } : null;
	};
	const onUp = event => {
		if (!down || PTR.step !== 'materials' || event.button !== 0) return;
		const click = Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4;
		const preview = down.preview;
		down = null;
		if (!click || !preview.node?.contains(event.target)) return;
		try {
			const hit = preview.raycast(event);
			if (hit?.element) selectGroup(groupUuidForElement(hit.element));
		} catch (err) { console.warn('[GeoRenderer] 主视图拾取失败', err); }
	};
	root.addEventListener('pointerdown', onDown, true);
	root.addEventListener('pointerup', onUp, true);
	return () => {
		root.removeEventListener('pointerdown', onDown, true);
		root.removeEventListener('pointerup', onUp, true);
	};
}
