# Apple GPU 优化分支

优化最初在 `perf/apple-gpu` 分支实现，现已迁入模块化插件工程。优化仍运行在 Blockbench 的 WebGL2 上，不依赖原生 Metal API。Apple 将其 GPU 描述为基于 tile 的延迟渲染架构；减少无需保留的渲染附件内容，有机会降低片上与外部内存之间的传输。这里把这条原则用于插件的全屏渲染流程。参考：[Apple GPU 的 tile 渲染说明](https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering)、[GPU 内存带宽分析](https://developer.apple.com/documentation/xcode/measuring-the-gpus-use-of-memory-bandwidth)。这是从 Metal 架构资料推导出的 WebGL2 优化方向，尚未测得实际提速。

## 改动

1. 在“渲染 → 性能”加入 GPU 模式：自动检测、Apple GPU、标准。自动检测读取 WebGL 渲染器名称；浏览器隐藏该名称时可手动选择。标准模式保持原流程。
2. 交互预览使用单颜色附件的路径追踪着色器，省去反照率、法线和亮度矩三个附件的读写。交互时本就关闭降噪，结束交互会重置累积，因此这些数据不参与最终图像。正常采样继续使用原有四附件路径。
3. Apple 路径在每次全屏覆盖 FBO 前调用 `invalidateFramebuffer`，声明旧附件内容无需加载；降噪 FBO 的颜色和方差附件都纳入提示。
4. 单颜色着色器编译失败时保留四附件标准路径，插件仍能工作。

按纹理格式计算，原采样路径每像素四附件写入量为 48 字节（RGBA32F 颜色 16、RGBA16F 反照率 8、RGBA16F 法线 8、RGBA32F 矩 16）；交互路径降至 16 字节。相应历史数据读取也从 48 降至 16 字节。此为逻辑附件负载，实际显存流量受缓存、驱动和 tile 实现影响。

## 验证

`npm run check` 覆盖设置选择、单颜色与标准路径的附件绑定、构建和原有算法。实际性能应在 Apple Silicon 的 Blockbench 中，对同一模型、分辨率、采样数和相机动作比较“Apple GPU”与“标准”模式的采样速率和交互流畅度；同时检查预览、成片、降噪及 PNG 导出。当前尚无实机对比结果。
