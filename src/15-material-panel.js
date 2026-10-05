	function buildMaterialList() {
		const host = PTR.nodes.matlist;
		if (!host) return;
		host.innerHTML = '';
		const t = PTR.tracer;
		const all = (typeof Texture !== 'undefined' ? Texture.all : []) || [];
		const textures = all.filter(tex => {
			try {
				const g = tex.getGroup && tex.getGroup();
				if (g && g.is_material) return tex.pbr_channel === 'color';
			} catch (err) { }
			return true;
		});
		if (!textures.length) {
			host.appendChild(el('div', { class: 'ptr_note', text: '当前项目没有纹理。' }));
			return;
		}
		textures.forEach(tex => {
			const ov = PTR.overrides[tex.uuid] || (PTR.overrides[tex.uuid] = {});
			let hasMer = false;
			try {
				const g = tex.getGroup && tex.getGroup();
				if (g && g.is_material) hasMer = !!g.getTextures().find(x => x.pbr_channel === 'mer');
			} catch (err) { }
			const defEmis = (hasMer || tex.render_mode === 'emissive' || tex.render_mode === 'additive') ? 1 : 0;
			const box = el('div', { class: 'ptr_mat' });
			const head = el('div', { class: 'ptr_mat_head' });
			try {
				const img = el('img');
				img.src = tex.source || (tex.canvas ? tex.canvas.toDataURL() : '');
				head.appendChild(img);
			} catch (err) { }
			head.appendChild(el('span', { text: tex.name || '(未命名)' }));
			box.appendChild(head);

			const mk = (label, key, min, max, step, def) => {
				const range = el('input', { type: 'range', min: min, max: max, step: step, value: ov[key] != null ? ov[key] : def });
				const num = el('input', { type: 'number', min: min, max: max, step: step, value: ov[key] != null ? ov[key] : def });
				const apply = (raw, src) => {
					let v = parseFloat(raw);
					if (isNaN(v)) return;
					v = clamp(v, min, max);
					ov[key] = v;
					if (src !== 'r') range.value = v;
					if (src !== 'n') num.value = v;
					saveSettings();
					clearTimeout(PTR.rebuildTimer);
					PTR.rebuildTimer = setTimeout(() => rebuildScene(), 250);
				};
				range.addEventListener('input', () => apply(range.value, 'r'));
				num.addEventListener('change', () => apply(num.value, 'n'));
				box.appendChild(makeRow(label, [range, num]));
			};
			mk('粗糙度', 'roughness', 0, 1, 0.01, PTR.settings.def_roughness);
			mk('金属度', 'metalness', 0, 1, 0.01, PTR.settings.def_metalness);
			mk('自发光', 'emissive', 0, 20, 0.1, defEmis);
			mk('透射', 'transmission', 0, 1, 0.01, 0);
			mk('Alpha 阈值', 'alpha_cutoff', 0, 1, 0.01, PTR.settings.alpha_cutoff);

			const emisMapSel = el('select');
			emisMapSel.appendChild(el('option', { value: '', text: '无（跟随全局自发光）' }));
			textures.forEach(t2 => {
				const label = t2.uuid === tex.uuid ? (t2.name || '(未命名)') + '（自身）' : (t2.name || '(未命名)');
				emisMapSel.appendChild(el('option', { value: t2.uuid, text: label }));
			});
			emisMapSel.value = ov.emissive_map || '';

			const emisColorSel = el('select');
			[['map', '跟随发光贴图颜色'], ['main', '跟随主贴图颜色'], ['custom', '手动选择颜色']].forEach(pair => {
				emisColorSel.appendChild(el('option', { value: pair[0], text: pair[1] }));
			});
			const emisColorSrc = ov.emissive_color_source === 'main' ? 'main' : (ov.emissive_color_source === 'custom' ? 'custom' : 'map');
			emisColorSel.value = emisColorSrc;
			emisColorSel.disabled = !ov.emissive_map;

			const emisColorPicker = el('input', { type: 'color', value: ov.emissive_color || '#ffffff' });
			const emisColorRow = makeRow('发光颜色', [emisColorPicker]);
			emisColorRow.style.display = emisColorSrc === 'custom' ? '' : 'none';

			emisMapSel.addEventListener('change', () => {
				if (emisMapSel.value) ov.emissive_map = emisMapSel.value;
				else delete ov.emissive_map;
				emisColorSel.disabled = !ov.emissive_map;
				saveSettings();
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
			});
			emisColorSel.addEventListener('change', () => {
				ov.emissive_color_source = emisColorSel.value;
				emisColorRow.style.display = emisColorSel.value === 'custom' ? '' : 'none';
				saveSettings();
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
			});
			emisColorPicker.addEventListener('input', () => {
				ov.emissive_color = emisColorPicker.value;
				saveSettings();
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
			});
			box.appendChild(makeRow('发光贴图', [emisMapSel]));
			box.appendChild(makeRow('发光颜色来源', [emisColorSel]));
			box.appendChild(emisColorRow);
			if (hasMer) {
				box.appendChild(el('div', { class: 'ptr_note', text: '该材质带 MER 通道，发光贴图设置会被 MER 的自发光通道覆盖。' }));
			}

			const amodeSel = el('select');
			[['', '跟随全局'], ['cutout', '裁剪'], ['blend', '混合'], ['opaque', '忽略透明']].forEach(pair => {
				amodeSel.appendChild(el('option', { value: pair[0], text: pair[1] }));
			});
			amodeSel.value = ov.alpha_mode || '';
			amodeSel.addEventListener('change', () => {
				if (amodeSel.value) ov.alpha_mode = amodeSel.value;
				else delete ov.alpha_mode;
				saveSettings();
				clearTimeout(PTR.rebuildTimer);
				PTR.rebuildTimer = setTimeout(() => rebuildScene(), 120);
			});
			box.appendChild(makeRow('Alpha 模式', [amodeSel]));

			const reset = el('button', { class: 'ptr_btn', text: '重置此纹理' });
			reset.addEventListener('click', () => {
				delete PTR.overrides[tex.uuid];
				saveSettings();
				buildMaterialList();
				rebuildScene();
			});
			box.appendChild(reset);
			host.appendChild(box);
		});
	}

