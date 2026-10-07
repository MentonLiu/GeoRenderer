import { clamp } from '../core/math.js';
import { groupChainForElement, resolveMaterialOverride } from '../scene/group-overrides.js';
import { el } from './dom.js';
import { makeRow } from './controls.js';
import { rebuildScene } from './render-loop.js';
import { PTR, saveSettings } from './state.js';

function groups() {
	return (typeof Group !== 'undefined' && Group.all) || [];
}

function isGroup(node) {
	return typeof Group !== 'undefined' && node instanceof Group;
}

export function groupUuidForElement(element, allGroups = groups()) {
	const chain = groupChainForElement(element);
	return chain.find(uuid => allGroups.some(group => group.uuid === uuid)) || null;
}

export function selectGroupForElement(element) {
	selectGroup(groupUuidForElement(element));
}

export function selectGroup(uuid) {
	const group = groups().find(item => item.uuid === uuid);
	PTR.selectedGroupUuid = group ? group.uuid : null;
	let parent = group && group.parent;
	while (parent && typeof parent === 'object') {
		if (parent.uuid) PTR.collapsedGroups.delete(parent.uuid);
		parent = parent.parent;
	}
	if (PTR.raster) PTR.raster.highlightGroup(PTR.selectedGroupUuid);
	buildGroupList();
	const selectedRow = PTR.nodes.groupList?.querySelector(`[data-group-uuid="${PTR.selectedGroupUuid}"]`);
	selectedRow?.scrollIntoView?.({ block: 'nearest' });
}

function changed(group, reset) {
	reset.disabled = false;
	const row = PTR.nodes.groupList?.querySelector(`[data-group-uuid="${group.uuid}"]`);
	if (row) row.classList.add('modified');
	saveSettings();
	clearTimeout(PTR.rasterRefreshTimer);
	if (PTR.raster) PTR.rasterRefreshTimer = setTimeout(() => PTR.raster?.refreshModel(), 60);
	if (PTR.tracer) {
		clearTimeout(PTR.rebuildTimer);
		PTR.rebuildTimer = setTimeout(rebuildScene, 180);
	}
}

function numberRow(label, key, min, max, step, fallback, group, reset) {
	const effective = resolveMaterialOverride(null, groupChainForElement({ parent: group }), null, PTR.groupOverrides);
	const value = effective[key] ?? fallback;
	const range = el('input', { type: 'range', min, max, step, value });
	const number = el('input', { type: 'number', min, max, step, value });
	const apply = raw => {
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return;
		const next = clamp(parsed, min, max);
		(PTR.groupOverrides[group.uuid] ||= {})[key] = next;
		range.value = next;
		number.value = next;
		changed(group, reset);
	};
	range.addEventListener('input', () => apply(range.value));
	number.addEventListener('change', () => apply(number.value));
	return makeRow(label, [range, number]);
}

function buildInspector(group) {
	const panel = el('div', { class: 'ptr_group_inspector' });
	if (!group) {
		panel.appendChild(el('div', { class: 'ptr_note', text: '在左侧模型上点击部件，或在上方大纲中选择组，即可编辑该组材质。' }));
		return panel;
	}
	const head = el('div', { class: 'ptr_group_inspector_head' }, [
		el('strong', { text: group.name || '未命名组' }),
	]);
	const reset = el('button', { type: 'button', class: 'ptr_btn', text: '重置此组' });
	reset.disabled = !PTR.groupOverrides[group.uuid];
	reset.addEventListener('click', () => {
		delete PTR.groupOverrides[group.uuid];
		changed(group, reset);
		buildGroupList();
	});
	head.appendChild(reset);
	panel.appendChild(head);
	panel.appendChild(el('div', { class: 'ptr_note', text: '只修改当前组；未修改的属性继承父组或默认值。' }));
	panel.appendChild(numberRow('粗糙度', 'roughness', 0, 1, 0.01, PTR.settings.def_roughness, group, reset));
	panel.appendChild(numberRow('金属度', 'metalness', 0, 1, 0.01, PTR.settings.def_metalness, group, reset));
	panel.appendChild(numberRow('自发光强度', 'emissive', 0, 20, 0.1, 0, group, reset));
	const effective = resolveMaterialOverride(null, groupChainForElement({ parent: group }), null, PTR.groupOverrides);
	const color = el('input', { type: 'color', value: effective.emissive_color || '#ffffff' });
	color.addEventListener('input', () => {
		(PTR.groupOverrides[group.uuid] ||= {}).emissive_color = color.value;
		changed(group, reset);
	});
	panel.appendChild(makeRow('发光颜色', [color]));
	return panel;
}

function appendOutline(host, nodes, depth) {
	for (const node of nodes || []) {
		if (!isGroup(node)) continue;
		const open = !PTR.collapsedGroups.has(node.uuid);
		const childGroups = (node.children || []).filter(isGroup);
		const row = el('div', {
			class: 'ptr_outline_row', role: 'treeitem',
			'data-group-uuid': node.uuid,
			'aria-level': String(depth + 1),
			'aria-selected': String(PTR.selectedGroupUuid === node.uuid),
			style: { paddingLeft: `${depth * 16}px` },
		});
		if (childGroups.length) {
			const disclosure = el('button', { type: 'button', class: 'ptr_outline_disclosure', 'aria-label': `${open ? '折叠' : '展开'} ${node.name || '未命名组'}`, 'aria-expanded': String(open), text: open ? '▾' : '▸' });
			disclosure.addEventListener('click', () => {
				if (open) PTR.collapsedGroups.add(node.uuid);
				else PTR.collapsedGroups.delete(node.uuid);
				buildGroupList();
			});
			row.appendChild(disclosure);
		} else {
			row.appendChild(el('span', { class: 'ptr_outline_spacer' }));
		}
		const selected = PTR.selectedGroupUuid === node.uuid;
		const button = el('button', { type: 'button', class: `ptr_outline_item${selected ? ' selected' : ''}` }, [
			el('i', { class: 'material-icons', text: open && childGroups.length ? 'folder_open' : 'folder' }),
			el('span', { text: node.name || '未命名组' }),
		]);
		button.addEventListener('click', () => selectGroup(node.uuid));
		row.appendChild(button);
		if (PTR.groupOverrides[node.uuid]) row.classList.add('modified');
		host.appendChild(row);
		if (open) appendOutline(host, childGroups, depth + 1);
	}
}

export function buildGroupList() {
	const host = PTR.nodes.groupList;
	if (!host) return;
	const all = groups();
	if (!all.some(group => group.uuid === PTR.selectedGroupUuid)) PTR.selectedGroupUuid = null;
	const oldTree = host.querySelector('.ptr_outline');
	const scroll = oldTree ? oldTree.scrollTop : 0;
	host.replaceChildren();
	if (!all.length) {
		host.appendChild(el('div', { class: 'ptr_note', text: '当前模型没有组；请先在 Blockbench 大纲中建立组。' }));
		return;
	}
	const tree = el('div', { class: 'ptr_outline', role: 'tree', 'aria-label': '模型组大纲' });
	const root = typeof Outliner !== 'undefined' ? Outliner.root : [];
	appendOutline(tree, root, 0);
	if (!tree.childElementCount) appendOutline(tree, all.filter(group => !isGroup(group.parent)), 0);
	host.appendChild(tree);
	tree.scrollTop = scroll;
	host.appendChild(buildInspector(all.find(group => group.uuid === PTR.selectedGroupUuid)));
}
