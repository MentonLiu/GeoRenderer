# GeoRenderer

GeoRenderer 是一个 Blockbench 路径追踪插件。本仓库是独立的插件开发工程；Blockbench 加载的文件是 [`plugins/georenderer/georenderer.js`](plugins/georenderer/georenderer.js)，插件 ID 和文件名均为 `georenderer`。原始参考插件保存在 [`reference/pathtracer.js`](reference/pathtracer.js)。

## 开发

需要 Node.js 20 或更新版本。

```sh
npm ci
npm run build
npm run check
```

`npm run dev` 会监视源码并重新构建。Blockbench 不会自动重新加载本地插件，修改后需要在 Blockbench 中重新加载 `plugins/georenderer/georenderer.js`。`npm run check` 对构建产物、语法、插件注册/卸载和核心算法执行检查。

## 四步工作流

1. **镜头与材质**：左侧为独立的常规 3D 预览，不启动路径追踪。配置最终画幅、镜头、景深，以及按组或按纹理覆盖的材质参数。
2. **场景**：配置工作室、主世界、末地或下界氛围、00:00～24:00 时间、太阳方向、地面和地面纹理。优先读取 Blockbench 已加载的内置场景贴图；需要额外许可或未能读取时使用程序化氛围。
3. **预览渲染**：在可调的预览比例下进行 WebGL2 路径追踪，调整采样、光线反弹、降噪和滤镜。
4. **最终导出**：先核对左侧预览与参数摘要，再开始按最终分辨率渲染。达到目标采样数后可复制图片、另存 PNG，或使用 Blockbench 截图面板。

顶部导航允许随时跳转。返回前两步时路径追踪暂停；再次进入后会同步新的场景和设置。

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

原插件作者与版本信息保留。设置继续使用原来的 `pathtracer_preview_settings` 存储键，以读取已有配置。
