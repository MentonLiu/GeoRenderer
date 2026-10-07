import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGroupList, groupUuidForElement, selectGroup } from '../plugins/georenderer/src/ui/group-panel.js';
import { RasterPreview } from '../plugins/georenderer/src/ui/raster-preview.js';
import { PTR } from '../plugins/georenderer/src/ui/state.js';

class Node {
	constructor(tag) {
		this.tag = tag;
		this.children = [];
		this.attributes = {};
		this.events = {};
		this.style = {};
		this.className = '';
		this.scrollIntoView = () => { this.scrolled = true; };
		this.classList = { add: name => { this.className += ` ${name}`; } };
	}
	setAttribute(name, value) {
		this.attributes[name] = String(value);
		if (name === 'class') this.className = String(value);
		if (name === 'value') this.value = String(value);
		if (name === 'text') this.textContent = String(value);
	}
	appendChild(child) { this.children.push(child); return child; }
	append(...children) { children.forEach(child => this.appendChild(child)); }
	replaceChildren(...children) { this.children = children; }
	addEventListener(name, handler) { this.events[name] = handler; }
	click() { this.events.click?.({}); }
	querySelector(selector) {
		const matches = node => selector.startsWith('.')
			? node.className.split(' ').includes(selector.slice(1))
			: node.attributes['data-group-uuid'] === selector.match(/"(.*)"/)?.[1];
		const visit = node => {
			for (const child of node.children) {
				if (matches(child)) return child;
				const nested = visit(child);
				if (nested) return nested;
			}
			return null;
		};
		return visit(this) || null;
	}
	get childElementCount() { return this.children.length; }
}

function descendants(node, predicate) {
	return node.children.flatMap(child => [
		...(predicate(child) ? [child] : []),
		...descendants(child, predicate),
	]);
}

test('animation-style outline contains groups only and preview picks their nearest group', t => {
	const previous = { document: globalThis.document, Group: globalThis.Group, Outliner: globalThis.Outliner, step: PTR.step };
	t.after(() => {
		globalThis.document = previous.document;
		globalThis.Group = previous.Group;
		globalThis.Outliner = previous.Outliner;
		PTR.step = previous.step;
		clearTimeout(PTR.rasterRefreshTimer);
		PTR.raster = null;
		PTR.nodes = {};
		PTR.selectedGroupUuid = null;
		PTR.groupOverrides = {};
	});
	globalThis.document = { createElement: tag => new Node(tag) };
	class Group {
		constructor(uuid, name, parent = null) {
			this.uuid = uuid;
			this.name = name;
			this.parent = parent;
			this.children = [];
			if (parent) parent.children.push(this);
		}
	}
	const parent = new Group('parent', 'Parent');
	const child = new Group('child', 'Child', parent);
	child.children.push({ name: 'Cube' });
	Group.all = [parent, child];
	globalThis.Group = Group;
	globalThis.Outliner = { root: [parent] };
	PTR.nodes = { groupList: new Node('div') };
	PTR.groupOverrides = {};
	PTR.collapsedGroups.clear();
	PTR.selectedGroupUuid = null;
	PTR.raster = { highlightGroup() {}, refreshModel() {} };

	buildGroupList();
	assert.equal(descendants(PTR.nodes.groupList, node => node.className.includes('ptr_outline_row')).length, 2);
	selectGroup('child');
	assert.equal(PTR.selectedGroupUuid, 'child');
	assert.equal(PTR.nodes.groupList.querySelector('[data-group-uuid="child"]').scrolled, true);
	assert.equal(descendants(PTR.nodes.groupList, node => node.className.split(' ').includes('ptr_group_inspector')).length, 1);
	assert.equal(descendants(PTR.nodes.groupList, node => node.tag === 'strong')[0].textContent, 'Child');
	const roughness = descendants(PTR.nodes.groupList, node => node.tag === 'input' && node.attributes.type === 'number')[0];
	roughness.value = '0.28';
	roughness.events.change();
	assert.equal(PTR.groupOverrides.child.roughness, 0.28);
	assert.equal(PTR.groupOverrides.parent, undefined);
	const reset = descendants(PTR.nodes.groupList, node => node.tag === 'button' && node.textContent === '重置此组')[0];
	reset.click();
	assert.equal(PTR.groupOverrides.child, undefined);
	assert.equal(groupUuidForElement({ parent: child }), 'child');

	const ray = { pointer: null, camera: null, setFromCamera(pointer, camera) { this.pointer = [...pointer.xy]; this.camera = camera; }, intersectObjects() { return [{ object: { userData: { georendererGroupChain: ['child', 'parent'] } } }]; } };
	const preview = {
		canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) },
		pointer: { xy: [], set(x, y) { this.xy = [x, y]; } },
		activeCamera: { id: 'inspection' }, raycaster: ray, model: { children: [{}] },
	};
	const picked = RasterPreview.prototype.pickGroupAt.call(preview, 110, 70);
	assert.equal(picked, 'child');
	assert.deepEqual(ray.pointer, [0, 0]);
	selectGroup(picked);
	assert.equal(PTR.selectedGroupUuid, 'child');
	assert.equal(PTR.nodes.groupList.querySelector('[data-group-uuid="child"]').scrolled, true);
});
