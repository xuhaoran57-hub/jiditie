# platform/wx

这里放微信小游戏适配器：Canvas 初始化、触摸输入、窗口/安全区、音频、存储、前后台生命周期和错误上报。

适配器只向 `core` 和 `render` 暴露窄接口，不在规则层散落 `wx` 调用。每个构造函数都接收一个能力对象，因此可以在 Node 中用 mock 测试，也可以在小游戏入口直接传入全局 `wx`。

## 模块

- `canvas.ts`：`WxCanvasAdapter` 读取 `getWindowInfo`，兼容 `getSystemInfoSync` 回退，计算安全区并配置物理像素/DPR；
- `input.ts`：`WxTouchInputAdapter` 管理摇杆触点 ID、多指按钮命中、门选择和取消/滑出释放；
- `storage.ts`：`WxStorageAdapter` 使用 `getStorageSync`/`setStorageSync`/`removeStorageSync`，复用 `core` 存档迁移并在异常时回退空存档；
- `audio.ts`：`WxAudioAdapter` 管理音效/循环音乐上下文，首次用户手势后解锁，支持静音和销毁；M6 的默认资源路径由 `runtime` 注入。
- `lifecycle.ts`：`WxLifecycleAdapter` 将 `onHide`/`onShow` 转成幂等暂停/恢复回调；
- `diagnostics.ts`：`WxDiagnostics` 捕获全局错误和未处理 Promise，仅保留有限长度的脱敏类别记录；
- `index.ts`：统一导出平台适配器。

## 最小接线示例（M5/M6 使用）

```ts
const surface = new WxCanvasAdapter(wx);
const renderer = GameRenderer.fromCanvas(
  surface.canvas,
  surface.viewport.width,
  surface.viewport.height,
  surface.viewport.dpr,
  surface.viewport.insets,
  level,
);

const touch = new WxTouchInputAdapter(wx, {
  joystickCenter: layout.joystickCenter,
  joystickRadius: layout.joystickRadius,
  guideButtonRect: layout.guideButtonRect,
});
touch.attach();

const lifecycle = new WxLifecycleAdapter(wx, {
  onPause: () => loop.setPaused(true),
  onResume: () => loop.setPaused(false),
});
lifecycle.attach();
```

实际入口由 M5/M6 的 `GameRuntime` 负责创建 `GameSimulation`、固定步长 ticker、渲染帧、页面状态和事件音效；适配器本身不推进规则、不管理关卡流程。

## 验证

`tests/platform.test.mjs` 使用 mock Canvas、触摸事件、存储、音频和生命周期 API 覆盖 M4 的异常回退、多指释放、静音、前后台幂等和脱敏日志。运行 `npm run test:platform` 可单独执行。
