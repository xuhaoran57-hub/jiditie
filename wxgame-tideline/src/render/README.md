# render

这里放 Canvas 2D 渲染器和 Canvas UI。渲染器只读取 `core` 的游戏状态，不负责改变游戏规则，也不依赖微信 API、浏览器 DOM 或 CSS。

## 入口

- `GameRenderer.fromCanvas(canvas, width, height, dpr, insets, level)`：从小游戏 Canvas 创建渲染器，并配置物理像素尺寸；
- `renderer.render(state, level, options)`：绘制游戏、路线、暂停和结算画面；
- `renderGameFrame(context, state, level, options)`：在已有 `RenderContext` 上绘制一帧；
- `RenderContext.worldToScreen` / `screenToWorld`：供输入适配层进行坐标转换。

## 设计约束

- 逻辑视口默认为 `360 × 640` 的竖屏比例，实际尺寸通过安全区和 DPR 适配；
- 站台、角色、按钮和 HUD 当前使用 Canvas 几何图形，避免引入未登记的图片、字体和音效资源；
- `roundRect` 缺失时自动回退到 `quadraticCurveTo` 路径，低版本基础库仍可绘制；
- `GameRenderer` 不持有模拟器、不推进时间、不写入存档。平台层应在每个固定步长更新后显式传入最新快照。

## 调试与测试

桌面调试适配位于 `src/platform/debug/`：方向键/WASD 移动、Space 疏导、Esc 暂停、R 重开。`tests/render.test.mjs` 使用 mock Canvas 验证整帧渲染、布局转换和兼容降级，不需要浏览器或微信运行时。

所有图标、按钮和 HUD 优先用自绘矢量或已授权资源；正式资源进入工程前必须在 `assets/` 中登记来源、版本和许可证。
