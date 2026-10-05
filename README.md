# GeoRenderer

这是 Blockbench 路径追踪插件 GeoRenderer。逆向时使用的原文件保存在 [`reference/pathtracer.js`](reference/pathtracer.js)；可编辑的实现按职责拆在 [`src/`](src/)；根目录的 [`georenderer.js`](georenderer.js) 是 Blockbench 加载的单文件插件。

## 构建与检查

需要 Node.js。项目没有第三方构建依赖。

```sh
npm run build
npm run check
```

`build` 按编号合并 `src/*.js`，包在原有 IIFE 中，生成根目录的插件文件。`check` 检查构建产物、JavaScript 语法、原始参考文件完整性和关键逻辑。修改源码后重新运行 `npm run build`。Blockbench 应加载根目录的 `georenderer.js`；插件入口会在“视图”及“工具”菜单注册“GeoRenderer”。

## 源码导航

| 文件 | 职责 |
| --- | --- |
| `01-config.js` | 插件 ID、GPU 数据常量、默认设置 |
| `02-gl-utils.js` | 向量运算、着色器编译、纹理与 FBO 创建 |
| `03-bvh.js` | 三角形 BVH 的分箱 SAH 构建 |
| `04-geometry.js` | Blockbench 场景几何采集、坐标变换、图集排布 |
| `05-materials.js` | 颜色/MER/法线/自发光图集和材质记录 |
| `06-environment.js` | HDR 解析、环境图生成及重要性采样分布 |
| `07-shaders.js` | WebGL2 路径追踪、降噪和后处理 GLSL |
| `08-renderer.js` | GPU 资源、场景上传、逐帧渲染与清理 |
| `09-styles.js`–`13-controls.js` | 界面样式、DOM、相机、设置状态与通用控件 |
| `14-app.js`–`18-window.js` | 渲染循环、材质面板、侧栏、导入导出与窗口交互 |
| `19-plugin.js` | Blockbench 注册、菜单动作、事件和卸载 |

这些文件按顺序共享同一个 IIFE 词法作用域，因此单独运行某个 `src` 文件不会注册插件。更详细的逆向说明见 [`REVERSE_ENGINEERING.md`](REVERSE_ENGINEERING.md)。

## 当前验证范围

自动检查覆盖构建一致性、注册/卸载、BVH、纹理图集、HDR 解码和环境采样分布。实际的 WebGL2 着色器编译与画面效果需要在支持 `EXT_color_buffer_float` 的 Blockbench 环境里确认。

原插件元数据中的作者、版本和更新地址均保留。`pathtracer_preview_settings` 存储键也继续沿用，以读取已有设置。

Apple GPU 分支的改动与验证方式见 [`APPLE_GPU.md`](APPLE_GPU.md)。
