# GeoRenderer

GeoRenderer 是一个 Blockbench 路径追踪插件。本仓库是独立的插件开发工程；Blockbench 加载的文件是 [`plugins/georenderer/georenderer.js`](plugins/georenderer/georenderer.js)，插件 ID 和文件名均为 `georenderer`。原始参考插件保存在 [`reference/pathtracer.js`](reference/pathtracer.js)。

当前版本为 **0.1.4**。第 2 步使用 Blockbench 预览场景及其中的 3D 模型和立方体贴图。最终渲染会按 GPU 缓冲尺寸逐块生成大画幅，并为降噪、泛光等滤镜保留分块边缘；降噪也会保护背景、镜面反射和材质边界的细节。完整记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 开发

需要 Node.js 20 或更新版本。

```sh
npm ci
npm run build
npm run check
```

`npm run dev` 会监视源码并重新构建。Blockbench 不会自动重新加载本地插件，修改后需要在 Blockbench 中重新加载 `plugins/georenderer/georenderer.js`。`npm run check` 对构建产物、语法、插件注册/卸载和核心算法执行检查。

## 五步工作流

1. **材质**：在独立窗口中检查模型。上方调整选中组和材质参数，下方是固定可见的组大纲。大纲按名称自然排序，紧凑展示父子组，不列出 cube；点击模型部件会定位到最近的父组。
2. **场景**：从 Blockbench 已注册的预览场景中选择，在同一窗口查看其 3D 环境、天空盒、雾及独立启用的参照模型，同时调整时间与光照。通过 Preview Scene Customiser 导入自定义 `.bbscene` 后可刷新列表；参照模型仍由 Blockbench 的「视图 → 预览模型」单独控制。
3. **相机**：确定最终画幅、相机位置、投影方式与景深。进入预览后相机固定，需要返回本步才能调整。
4. **预览渲染**：在可调的预览比例下进行 WebGL2 路径追踪，调整采样、光线反弹、降噪和滤镜。
5. **最终导出**：先核对左侧预览与参数摘要，再开始按最终分辨率分块渲染。达到目标采样数后可复制图片、另存 PNG，或使用 Blockbench 截图面板。

顶部导航允许随时跳转。前两步使用独立的检查视角，不会修改最终相机；第 3 步设置渲染镜头，第 4、5 步启动路径追踪。返回设置步骤时路径追踪暂停。

第 3 步保留场景模型和参照物供取景；第 4、5 步将已启用的预览模型纳入路径追踪，并使用场景立方体贴图和雾。手动载入 HDR 或图片后，以该文件作为环境光。有场景几何时会隐藏额外的 GeoRenderer 地面。

场景时间控制会联动太阳方位、太阳光、天空或 HDR 环境及雾的日夜变化。最终分块会带上滤镜所需的边缘范围，再裁切合成为完整画面。

## 项目结构

```text
plugins/georenderer/
├── georenderer.js          Blockbench 加载的单文件构建产物
├── about.md                插件介绍
└── src/
    ├── index.js            Plugin.register 入口和生命周期
    ├── core/               默认设置、数学工具
    ├── scene/              几何采集、BVH、纹理图集、材质、环境光
    ├── gpu/                WebGL2 资源、渲染器、着色器导入
    ├── shaders/            可独立编辑的 GLSL 源码
    ├── assets/             CSS
    └── ui/                 相机、设置、窗口和交互界面
scripts/build.mjs           esbuild 构建与监视
test/                       模块与插件产物检查
reference/                  原插件，仅用于参考
```

源码使用 ES 模块的 `import` / `export` 组织，构建时打包成 Blockbench 所需的单个 IIFE JavaScript 文件。GLSL 与 CSS 作为文本嵌入构建产物；不需要在 Blockbench 中加载其他文件。开发时请修改 `plugins/georenderer/src/`，不要直接编辑生成的 `georenderer.js`。

逆向得到的渲染流程见 [`REVERSE_ENGINEERING.md`](REVERSE_ENGINEERING.md)。Apple GPU 分支的优化说明见 [`APPLE_GPU.md`](APPLE_GPU.md)。当前自动检查不替代 Blockbench 内的 WebGL2 画面与性能测试。

本项目正在将参考插件重写为独立渲染插件，原始脚本仅存放在 `reference/`，不会打包进构建产物。组大纲和模型拾取参考 Blockbench 动画编辑器的交互方式；实现代码由本项目独立编写。设置继续使用原来的 `pathtracer_preview_settings` 存储键，以读取已有配置。
