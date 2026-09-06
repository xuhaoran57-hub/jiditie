# render

这里放 Canvas 2D 渲染器和 Canvas UI。渲染器只读取 `core` 的游戏状态，不负责改变游戏规则，也不依赖微信 API、浏览器 DOM 或 CSS。

## 入口

- `GameRenderer.fromCanvas(canvas, width, height, dpr, insets, level)`：从小游戏 Canvas 创建渲染器，并配置物理像素尺寸；
- `renderer.render(state, level, options)`：绘制游戏、路线、暂停和结算画面；
- `renderGameFrame(context, state, level, options)`：在已有 `RenderContext` 上绘制一帧；
- `RenderContext.worldToScreen` / `screenToWorld`：供输入适配层进行坐标转换。

## 设计约束

- 逻辑世界保留 `320 × 868` 的规则坐标（车厢高度扩展到 300），竖屏按等比缩放；横屏重新排布为“车厢在上、站台在下”，通过独立的横/纵缩放填满舞台；
- 横屏状态栏改为左侧悬浮卡片，顶部空间优先留给车厢；路线卡片和结算面板使用横向布局，世界坐标不再靠旋转矩阵切换方向；
- 站台、按钮和 HUD 继续使用 Canvas 几何图形；玩家、普通乘客和快步乘客加载独立高细节 PNG Sprite，其余类型加载六行高细节 PNG 图集，SVG 作为回退源，解码失败时自动回退几何角色；
- `roundRect` 缺失时自动回退到 `quadraticCurveTo` 路径，低版本基础库仍可绘制；
- `GameRenderer` 不持有模拟器、不推进时间、不写入存档。平台层应在每个固定步长更新后显式传入最新快照。

## 调试与测试

桌面调试适配位于 `src/platform/debug/`：方向键/WASD 移动、Space 疏导、Esc 暂停、R 重开。`tests/render.test.mjs` 使用 mock Canvas 验证整帧渲染、布局转换和兼容降级，不需要浏览器或微信运行时。

所有图标、按钮和 HUD 优先用自绘矢量或已授权资源；正式资源进入工程前必须在 `assets/` 中登记来源、版本和许可证。
