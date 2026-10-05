	let action = null;
	let cssHandle = null;
	let eventHandler = null;

	if (typeof window !== 'undefined' && window.__PATHTRACER_TEST__) {
		window.__PATHTRACER_INTERNALS__ = {
			VS_FULLSCREEN, FS_PATHTRACE, FS_DENOISE,
			FS_COMPOSITE, FS_BLOOM_BRIGHT, FS_BLOOM_BLUR, FS_TONEMAP, FS_FINAL,
			PathTracer, buildBVH, buildMaterials, collectGeometry,
			generateSkyPixels, buildEnvDistribution, parseHDR, packAtlas,
			DEFAULTS,
		};
	}

	BBPlugin.register(PLUGIN_ID, {
		title: 'GeoRenderer',
		icon: 'auto_awesome',
		author: 'PuddingKC',
		description: '使用 GPU 路径追踪实时预览并渲染当前模型',
		about: [
			'在 **视图 → GeoRenderer** 中打开',
			'',
			'- 左键拖拽旋转，右键/Shift+左键平移，滚轮缩放',
			'- 可载入 `.hdr` 或普通图片作为环境贴图',
			'- “阴影捕捉 + 背景透明” 可导出带投影的透明 PNG',
			'',
			'需要支持 WebGL2 与 `EXT_color_buffer_float` 的显卡',
			'',
			'官方更新地址：https://github.com/Null-K/blockbench-plugins'
		].join('\n'),
		version: '1.5.1',
		min_version: '4.8.0',
		variant: 'both',
		tags: ['Rendering', 'Preview'],

		onload() {
			loadSettings();
			try { cssHandle = Blockbench.addCSS(CSS); } catch (err) { console.warn('[PathTracer] addCSS 失败', err); }

			action = new Action('georenderer_open', {
				name: 'GeoRenderer',
				description: '在独立窗口中用路径追踪渲染当前模型',
				icon: 'auto_awesome',
				category: 'view',
				condition: () => typeof Project !== 'undefined' && !!Project,
				click() { openWindow(); },
			});

			try { MenuBar.addAction(action, 'view'); } catch (err) { }
			try { MenuBar.addAction(action, 'tools'); } catch (err) { }

			eventHandler = () => {
				if (!PTR.open || !PTR.tracer) return;
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
			} catch (err) { }
		},

		onunload() {
			closeRenderer();
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
		},
	});
