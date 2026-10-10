

// 创建 DOM 元素并统一处理属性、样式、事件监听器和子节点。
export function el(tag, attrs, children) {
	const node = document.createElement(tag);
	if (attrs) {
		// 遍历属性对象；style、on 开头事件和 text 是约定的快捷写法。
		for (const k in attrs) {
			if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
			else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
			else if (k === 'text') node.textContent = attrs[k];
			else node.setAttribute(k, attrs[k]);
		}
	}
	// 按调用方传入的顺序追加有效子节点，保持面板布局稳定。
	(children || []).forEach(c => { if (c) node.appendChild(c); });
	return node;
}
