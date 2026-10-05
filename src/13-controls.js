	function makeRow(label, ctrls) {
		return el('div', { class: 'ptr_row' }, [
			el('label', { text: label, title: label }),
			el('div', { class: 'ptr_ctrl' }, ctrls),
		]);
	}

	function register(key, setter) {
		PTR.controls.push({ key: key, set: setter });
	}

	function syncControls() {
		PTR.controls.forEach(c => {
			try { c.set(PTR.settings[c.key]); } catch (err) { }
		});
	}

	function rowSlider(label, key, min, max, step, digits) {
		const s = PTR.settings;
		const range = el('input', { type: 'range', min: min, max: max, step: step, value: s[key] });
		const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
		const apply = (raw, src) => {
			let v = parseFloat(raw);
			if (isNaN(v)) return;
			v = clamp(v, min, max);
			s[key] = v;
			if (src !== 'r') range.value = v;
			if (src !== 'n') num.value = digits != null ? +v.toFixed(digits) : v;
			onSettingChanged(key);
		};
		range.addEventListener('input', () => apply(range.value, 'r'));
		num.addEventListener('change', () => apply(num.value, 'n'));
		register(key, v => { range.value = v; num.value = digits != null ? +Number(v).toFixed(digits) : v; });
		return makeRow(label, [range, num]);
	}

	function rowNumber(label, key, min, max, step) {
		const s = PTR.settings;
		const num = el('input', { type: 'number', min: min, max: max, step: step, value: s[key] });
		num.addEventListener('change', () => {
			let v = parseFloat(num.value);
			if (isNaN(v)) return;
			v = clamp(v, min, max);
			s[key] = v;
			num.value = v;
			onSettingChanged(key);
		});
		register(key, v => { num.value = v; });
		return makeRow(label, [num]);
	}

	function rowCheck(label, key) {
		const s = PTR.settings;
		const box = el('input', { type: 'checkbox' });
		box.checked = !!s[key];
		box.addEventListener('change', () => { s[key] = box.checked; onSettingChanged(key); });
		register(key, v => { box.checked = !!v; });
		return makeRow(label, [box]);
	}

	function rowText(label, key, placeholder) {
		const s = PTR.settings;
		const inp = el('input', { type: 'text', value: s[key] || '' });
		if (placeholder) inp.setAttribute('placeholder', placeholder);
		inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
		register(key, v => { inp.value = v || ''; });
		return makeRow(label, [inp]);
	}

	function rowColor(label, key) {
		const s = PTR.settings;
		const inp = el('input', { type: 'color', value: s[key] });
		inp.addEventListener('input', () => { s[key] = inp.value; onSettingChanged(key); });
		register(key, v => { inp.value = v; });
		return makeRow(label, [inp]);
	}

	function rowSelect(label, key, options) {
		const s = PTR.settings;
		const sel = el('select');
		for (const val in options) {
			const o = el('option', { value: val, text: options[val] });
			sel.appendChild(o);
		}
		sel.value = s[key];
		sel.addEventListener('change', () => { s[key] = sel.value; onSettingChanged(key); });
		register(key, v => { sel.value = v; });
		return makeRow(label, [sel]);
	}

	function card(title, icon, children) {
		const head = el('div', { class: 'ptr_card_head' }, [
			el('i', { class: 'material-icons', text: icon }),
			el('span', { text: title }),
		]);
		return el('div', { class: 'ptr_card' }, [head].concat(children));
	}

	function buildTabs(tabs) {
		const wrap = el('div', { id: 'ptr_sidebar' });
		const strip = el('div', { class: 'ptr_tabs' });
		const panes = el('div', { class: 'ptr_tabpanes' });
		tabs.forEach((tab, i) => {
			const btn = el('button', { class: 'ptr_tab', title: tab.title }, [
				el('i', { class: 'material-icons', text: tab.icon }),
			]);
			const pane = el('div', { class: 'ptr_tabpane' }, tab.cards);
			btn.addEventListener('click', () => {
				strip.querySelectorAll('.ptr_tab').forEach(b => b.classList.remove('active'));
				panes.querySelectorAll('.ptr_tabpane').forEach(p => p.classList.remove('active'));
				btn.classList.add('active');
				pane.classList.add('active');
			});
			if (i === 0) { btn.classList.add('active'); pane.classList.add('active'); }
			strip.appendChild(btn);
			panes.appendChild(pane);
		});
		wrap.appendChild(strip);
		wrap.appendChild(panes);
		return wrap;
	}

	function onSettingChanged(key) {
		saveSettings();
		const kind = CHANGE_KIND[key] || 'reset';
		const t = PTR.tracer;
		if (!t) return;
		if (kind === 'post') { t.present(PTR.settings); updateStatus(); return; }
		if (kind === 'resize') { applyResolution(); return; }
		if (kind === 'env') {
			try { t.setEnvironment(PTR.settings, PTR.customEnv); } catch (err) { showError(err); return; }
		}
		if (kind === 'scene') {
			clearTimeout(PTR.rebuildTimer);
			PTR.rebuildTimer = setTimeout(() => rebuildScene(), 220);
			return;
		}
		t.reset();
	}

	function exportSettingsToClipboard() {
		try {
			const data = {};
			for (const k in DEFAULTS) data[k] = PTR.settings[k];
			const payload = { __pathtracer_settings: true, version: 1, data: data };
			const text = JSON.stringify(payload);
			if (typeof Clipbench !== 'undefined' && Clipbench.setText) {
				Clipbench.setText(text);
			} else if (navigator.clipboard) {
				navigator.clipboard.writeText(text);
			} else {
				throw new Error('当前环境不支持写入剪贴板');
			}
			Blockbench.showQuickMessage('渲染设置已复制到剪贴板', 2000);
		} catch (err) { showError(err); }
	}

	function applyImportedSettings(payload) {
		if (!payload || !payload.__pathtracer_settings || !payload.data) {
			throw new Error('剪贴板内容不是有效的路径追踪渲染设置');
		}
		clearTimeout(PTR.rebuildTimer);
		const data = payload.data;
		for (const k in DEFAULTS) if (data[k] !== undefined) PTR.settings[k] = data[k];
		if (PTR.settings.env_mode === 'image' && !PTR.customEnv) {
			PTR.settings.env_mode = 'sky';
		}
		syncControls();
		if (PTR.updateModeButton) PTR.updateModeButton();
		saveSettings();
		const t = PTR.tracer;
		if (t) {
			try {
				t.setEnvironment(PTR.settings, PTR.customEnv);
				applyResolution();
				rebuildScene();
				t.reset();
			} catch (err) { showError(err); }
		}
		Blockbench.showQuickMessage('已从剪贴板导入渲染设置', 2000);
	}

	async function importSettingsFromClipboard() {
		try {
			if (!navigator.clipboard || !navigator.clipboard.readText) {
				throw new Error('当前环境不支持读取剪贴板');
			}
			const text = await navigator.clipboard.readText();
			if (!text) throw new Error('剪贴板为空');
			let payload;
			try { payload = JSON.parse(text); } catch (err) { throw new Error('剪贴板内容不是有效的 JSON'); }
			applyImportedSettings(payload);
		} catch (err) { showError(err); }
	}

	function resetToDefaults() {
		if (!confirm('确定要将所有渲染设置重置为默认值吗？（不影响材质单独覆盖的参数）')) return;
		clearTimeout(PTR.rebuildTimer);
		for (const k in DEFAULTS) PTR.settings[k] = DEFAULTS[k];
		PTR.customEnv = null;
		PTR.customEnvName = '';
		if (PTR.nodes.envName) PTR.nodes.envName.textContent = '(未载入)';
		syncControls();
		if (PTR.updateModeButton) PTR.updateModeButton();
		saveSettings();
		const t = PTR.tracer;
		if (t) {
			try {
				t.setEnvironment(PTR.settings, null);
				applyResolution();
				rebuildScene();
			} catch (err) { showError(err); }
		}
	}

