import { PLUGIN_ID } from './core/config.js';
import { rebuildScene, updateStatus } from './ui/render-loop.js';
import { PTR, loadSettings } from './ui/state.js';
import { closeWindow, openWindow } from './ui/window.js';
import { buildGroupList, selectGroup, selectGroupForElement } from './ui/group-panel.js';
import { buildMaterialList } from './ui/material-panel.js';
import CSS from './assets/georenderer.css';

let action = null;
let cssHandle = null;
let eventHandler = null;
let selectionHandler = null;

Plugin.register(PLUGIN_ID, {
	title: '几何渲染器',
	icon: 'auto_awesome',
	author: 'PuddingKC',
	description: '在独立五步窗口中配置材质、场景与镜头，并使用 GPU 路径追踪渲染模型',
	about: [
		'在 **视图 → 几何渲染器** 中打开',
		'',
		'- 五步都在独立窗口中完成；前两步可检查模型，第 3 步确定最终镜头',
		'- 组大纲按名称排序；点击模型部件可定位并编辑所属组',
		'- 可载入 `.hdr` 或普通图片作为环境贴图',
		'- “阴影捕捉 + 背景透明” 可导出带投影的透明 PNG',
		'',
		'需要支持 WebGL2 与 `EXT_color_buffer_float` 的显卡',
		'',
		'项目与更新：https://github.com/MentonLiu/GeoRenderer'
	].join('\n'),
	version: '0.1.4',
	min_version: '4.8.0',
	variant: 'both',
	tags: ['Rendering', 'Preview'],

	onload() {
		loadSettings();
		try { cssHandle = Blockbench.addCSS(CSS); } catch (err) { console.warn('[PathTracer] addCSS 失败', err); }

		action = new Action('georenderer_open', {
			name: '几何渲染器',
			description: '在独立窗口配置场景并渲染当前模型',
			icon: 'auto_awesome',
			category: 'view',
			condition: () => typeof Project !== 'undefined' && !!Project,
			click() { openWindow(); },
		});

		try { MenuBar.addAction(action, 'view'); } catch (err) { }
		try { MenuBar.addAction(action, 'tools'); } catch (err) { }

		eventHandler = () => {
			if (PTR.raster) PTR.raster.refreshModel();
			if (PTR.refreshGroundTextures) PTR.refreshGroundTextures();
			if (PTR.nodes.groupList) buildGroupList();
			if (PTR.nodes.matlist) buildMaterialList();
			if (!PTR.open || !PTR.tracer) { PTR.needsRebuild = true; return; }
			if (PTR.settings.auto_follow) {
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 400);
			} else {
				PTR.stale = true;
				updateStatus();
			}
		};
		try {
			Blockbench.on('finished_edit', eventHandler);
			Blockbench.on('undo', eventHandler);
			Blockbench.on('redo', eventHandler);
			selectionHandler = () => {
				if (!PTR.nodes.groupList) return;
				if (typeof Group !== 'undefined' && Group.first_selected) selectGroup(Group.first_selected.uuid);
				else if (typeof Outliner !== 'undefined' && Outliner.selected?.[0]) selectGroupForElement(Outliner.selected[0]);
			};
			Blockbench.on('update_selection', selectionHandler);
		} catch (err) { }
	},

	onunload() {
		closeWindow();
		if (PTR.dialog) { try { PTR.dialog.delete(); } catch (e) { } PTR.dialog = null; }
		if (action) { action.delete(); action = null; }
		if (cssHandle && cssHandle.delete) cssHandle.delete();
		cssHandle = null;
		if (eventHandler) {
			try {
				Blockbench.removeListener('finished_edit', eventHandler);
				Blockbench.removeListener('undo', eventHandler);
				Blockbench.removeListener('redo', eventHandler);
			} catch (err) { }
			eventHandler = null;
		}
		if (selectionHandler) {
			try { Blockbench.removeListener('update_selection', selectionHandler); } catch (err) { }
			selectionHandler = null;
		}
	},
});
