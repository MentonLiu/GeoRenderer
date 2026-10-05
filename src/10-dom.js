	function el(tag, attrs, children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const k in attrs) {
				if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
				else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
				else if (k === 'text') node.textContent = attrs[k];
				else node.setAttribute(k, attrs[k]);
			}
		}
		(children || []).forEach(c => { if (c) node.appendChild(c); });
		return node;
	}

