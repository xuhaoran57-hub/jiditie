# M2/M3/M4/M5/M6/M7 测试

`core.test.mjs` 使用 Node 内置 `node:test`，直接加载 `src/core` 的 TypeScript 源码，
覆盖随机种子回放、阶段推进、边界、空间哈希碰撞、疏导冷却、车厢进入、容量、
损坏存档、整局确定性以及雨天/提前关门/行李车三类事件规则。

`render.test.mjs` 使用 mock Canvas 覆盖逻辑坐标/DPR、安全区布局、圆角降级、游戏/路线/暂停/警告/结算整帧渲染、固定步长和桌面调试输入。

`platform.test.mjs` 使用 mock 微信能力覆盖 Canvas 窗口回退、多指触摸、存档异常、音频解锁/静音、前后台生命周期和脱敏诊断。

`m5.test.mjs` 使用 mock Canvas 和 mock 微信对象覆盖运行时启动/停止幂等、路线卡片选关、摇杆推进、前后台暂停、结算解锁、重试/下一站/返回路线、存档持久化以及 M6 音效事件去重和重试重置。

`m7.test.mjs` 使用 220 人压力关卡覆盖有限状态、NaN 防护、同种子确定性重放、快速启动/停止、前后台暂停、重试、连续切关和返回路线，重点防止 ticker 倍增或状态串线。

`runtime-performance.test.mjs` 覆盖全局原生 rAF、取消过期回调、前后台恢复时间基线、静态页无重复绘制、触摸布局复用、暂停/结算/补给刷新和提示过期。`startup.test.mjs` 同时验证异步图集加载后补画；`render.test.mjs` 验证单张背景缓存复用、主题/几何/视口失效、小数 DPR 对齐和能力失败回退。

道具测试的 `frameOperations` 保存当前画面上的文字，只有 `clearRect` 才清空；静态页面没有新绘制时仍保留上一帧，避免测试依赖每次 `tick()` 都重画。

```text
npm run check
```

M7 还提供：

```text
npm run test:m7
npm run bench:simulation
npm run check:release:strict
```

测试不依赖浏览器或微信运行时；真实设备矩阵和 `game.js` 的真机行为按
`M7_TEST_MATRIX.md` 记录，不能用 Node mock 结果替代。
