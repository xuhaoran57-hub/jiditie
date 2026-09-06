# M5/M6/M7 运行时编排

`GameRuntime` 是小游戏入口和平台适配器之间的唯一编排层：

```text
触摸/生命周期 → GameRuntime → GameSimulation
                         ↘ GameRenderer
```

规则层的 `LevelEventConfig` 会在运行时随局内时钟触发内容事件。12 站战役覆盖
雨天收窄横向空间、提前关门、行李车占用临时区域和散场快步人流；事件状态由
`GameState.activeEvent` 暴露，渲染层只读该快照，不直接修改规则。

运行时默认从 `CAMPAIGN_LEVELS` 和 `WxStorageAdapter` 读取 12 站与进度，页面状态为
`home`、`route`、`game`、`result`、`achievements`、`appearance`、`settings`。开始游戏后路线页
只展示已解锁关卡，并通过下拉面板选择。`start()` 会幂等地绑定触摸、前后台和诊断监听，并只
创建一个 ticker；测试可以不调用 `start()`，直接用 `tick(seconds)` 手动推进。

M6 的 `DEFAULT_RUNTIME_AUDIO_SOURCES` 指向随包的程序化 WAV。首次有效触摸会
解锁 `WxAudioAdapter` 并尝试启动循环氛围；运行时扫描 `GameState.events`，对
`guide`、`success`、`failure` 和 `event-start` 各播放一次。事件游标在重试或切换
关卡时重置，音频 API 缺失、未解锁或静音时由适配器安全降级为无声。

入口可以使用 `createWxGameRuntime(wx, { autoStart: true })`，也可以传入
`{ api: wx }`（`wx` 字段是同义别名）以便替换为测试 mock。

入口构建方式：

```text
npm run build:wxgame
```

该命令把 TypeScript 输出到 `dist/`，并在 `dist/package.json` 中声明 CommonJS，
供微信小游戏的 `game.js` 使用 `require('./dist/runtime/index.js')` 加载。

## M7 发布前检查

构建后可运行 `npm run check:release` 做默认静态审计；CI 建议运行
`npm run check:release:strict`。审计会确认运行时入口、CommonJS 边界、随包资源和
包体预算，并扫描外部 URL/网络 API、外链字体、source map 与调试钩子。当前
`touristappid` 只作为开发预览值，正式提交前使用
`node scripts/check-release.mjs --strict --production` 验证已替换 AppID。

生命周期、音频和输入的真实设备步骤见项目根目录的 `M7_TEST_MATRIX.md`；Node
压力基准的口径与限制见 `M7_PERFORMANCE.md`。
