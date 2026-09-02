# 《潮汐线：赶上这班车》微信小游戏

这是一个全新独立实现的微信小游戏工程，题材为虚构城市“湾城”的“潮汐线”早高峰通勤。目前已完成 M2 规则核心、M3 Canvas 渲染层、M4 微信平台适配、M5 三关运行时集成、M6 自有资源接入和 M7 自动化质量基线。

## 当前目标

- 用原生小游戏 Canvas 完成一个可离线运行的 2D 人群通行小游戏。
- 借鉴“观察人流、寻找空隙、限时进入车厢”的高层玩法，但不复制任何外部项目的代码、文案、素材或品牌表达。
- 首个可玩版本只做 3 个关卡，验证移动、避让、疏导、倒计时和结算闭环。

## 目录

```text
wxgame-tideline/
├─ game.js                    # 微信小游戏启动入口，加载 dist/runtime
├─ game.json                  # 小游戏运行配置
├─ project.config.json        # 微信开发者工具项目配置（需替换 AppID）
├─ GAME_DESIGN.md             # 游戏策划方案
├─ DEVELOPMENT_PLAN.md        # 开发工作项、顺序与验收标准
├─ assets/                    # 自有或已授权资源及来源记录
├─ src/
│  ├─ core/                   # 与平台无关的游戏模型、规则和模拟
│  ├─ platform/wx/            # 微信 API 适配层
│  ├─ runtime/                 # M5/M6 页面状态、主循环、存档和音效编排
│  └─ render/                 # Canvas 渲染与 Canvas UI
├─ scripts/                   # 微信小游戏构建脚本
└─ tests/                     # 核心规则、渲染和平台适配测试
```

## 用微信开发者工具打开

> 导入目录必须是包含 `game.js`、`game.json` 和 `project.config.json` 的
> `D:/测试/jiditie-main/wxgame-tideline`，不要选择上层 `jiditie-main` 网页目录。

1. 在 `project.config.json` 中把 `appid` 替换成自己的小游戏 AppID；内部预览可暂时使用 `touristappid`。
2. 在微信开发者工具中选择“小游戏”并导入本目录。
3. 首次运行先在工程目录执行 `npm install`，再执行 `npm run build:wxgame` 生成 `dist/`；随后用微信开发者工具打开本目录即可运行 `game.js`。
4. `game.js` 会等待一轮 JSBridge 事件循环后创建 `GameRuntime`；若 bridge 暂时未就绪会有限重试。启动画面不会同步读取系统信息，构建缺失时会显示离线提示而不会发起网络请求。

### 开发者工具告警与空白路线页

- `SharedArrayBuffer will require cross-origin isolation` 是开发者工具内置 Chromium 的弃用提示，不是小游戏业务异常；本工程未使用 `SharedArrayBuffer`，可忽略或升级开发者工具。
- `[jsbridge] ... jsbridge not ready` 可能出现在首帧初始化时。入口已延迟创建运行时并在 bridge 稳定后刷新 Canvas 尺寸；建议在“详情 → 本地设置”选择稳定基础库后重新编译。
- 若路线页只看到标题，先在本目录重新执行 `npm run build:wxgame`，然后在开发者工具点击“编译/清缓存并重新编译”。路线卡片对旧版 Canvas 圆角/路径 API 已提供矩形降级，不需要改动业务关卡数据。

## 独立创作与权利边界

- 线路、城市、站名、角色、对白、UI、字体、音效和图标均按虚构世界重新设计。
- 不把参考项目的源码、PRD 原文、截图、官方地图、Logo、广播录音或其他资源放入本目录。
- 每个外部资源都要在 `assets/` 中记录来源、版本和许可证；生成式资源保留生成记录并进行相似性复核。
- 项目许可证尚未决定。确定作者和权利链后，再补充明确的 MIT、Apache-2.0 或其他适用许可证。

## 文档入口

- [GAME_DESIGN.md](./GAME_DESIGN.md)：产品定位、玩法、关卡、内容和验收目标。
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)：从工程初始化到微信审核发布的工作项和执行顺序。
- [M7_TEST_MATRIX.md](./M7_TEST_MATRIX.md)：自动化、真机、生命周期和异常场景矩阵。
- [M7_PERFORMANCE.md](./M7_PERFORMANCE.md)：220 人压力基准、包体预算和真机采样口径。
- [M7_COMPLIANCE_CHECKLIST.md](./M7_COMPLIANCE_CHECKLIST.md)：版权、隐私、适龄与微信提交闸门。

## M2 当前状态

M2 纯规则核心已经完成，代码位于 `src/core/`，包括：

- 数据模型、三份 MVP 关卡配置和确定性种子随机数；
- 阶段状态机、人群航点、空间哈希碰撞、车门安全区与车厢容量；
- 玩家移动、`疏导` 技能的范围/体力/冷却、四项评分和版本化存档；
- 不依赖渲染或微信运行时的 Node 回归测试。

在本目录执行 `npm install` 后运行 `npm run check`，即可完成类型检查和核心测试。

## M3 当前状态

M3 的 Canvas 表现层已完成，代码位于 `src/render/`，包括：

- 逻辑坐标、DPR 缩放、安全区和窄屏布局，以及世界坐标/屏幕坐标转换；
- 站台、车厢、车门、安全区、容量条、玩家和六类乘客的几何绘制；
- 疏导波纹、碰撞提示、警告覆盖层、HUD、暂停页、路线页和结算页；
- `GameRenderer` 统一整帧入口，保持与微信 API 和 DOM/CSS 解耦；
- `src/platform/debug/` 中的固定步长循环和键盘调试输入（Space 疏导、Esc 暂停、R 重开）。

M3 回归烟测位于 `tests/render.test.mjs`，覆盖 mock Canvas 整帧渲染、DPR/布局、圆角降级、调试输入和固定步长。运行 `npm run test:render` 可单独验证；`npm run check` 会同时执行 M2–M6 的类型、资源和回归测试。

渲染器和平台适配器已在 M5 接入 `game.js` 的正式启动循环；真实微信设备截图与触摸命中仍按 M7 矩阵验证。

## M4 当前状态

M4 微信平台适配已完成，代码位于 `src/platform/wx/`，包括：

- Canvas 初始化、窗口信息、安全区和 DPR 回退；
- 多指摇杆、触点 ID、按钮/门命中和滑出/取消释放；
- 版本化存档的微信同步存储、损坏数据回退和清空；
- 首次用户手势解锁的音效/循环音乐、静音和资源销毁；
- `onHide`/`onShow` 的幂等暂停/恢复回调；
- 全局错误与未处理 Promise 的脱敏诊断和有限缓存。

M4 适配器采用能力注入，不直接读取全局 `wx`，因此可在 Node mock 中测试；M5 已负责把它们接入模拟器、渲染器和小游戏入口。运行 `npm run test:platform` 可单独验证。

## M5 当前状态

M5 已把规则、渲染和微信适配接成一个可运行的 MVP 主流程：

- `src/runtime/game-runtime.ts` 统一管理 `route → game → result` 页面状态、固定步长 ticker、暂停/恢复、重试、下一站和返回路线；`start()` 幂等，避免重复启动多条循环。
- 路线卡片、暂停、重试、下一站、返回路线和车门均使用 Canvas 布局生成的触摸命中区域；摇杆和疏导输入按固定步长送入 `GameSimulation`。
- 完成一关后写入版本化本地存档：记录局数、通关数、疏导次数、最佳分，并按顺序解锁海风门、云港、星环城。
- `game.js` 只负责注入微信全局对象并加载构建产物；没有构建产物时显示可恢复的提示画面。
- `tsconfig.wxgame.json` 与 `scripts/build-wxgame.mjs` 输出 CommonJS `dist/`，并写入局部 `package.json` 以兼容小游戏入口的 `require`。
- `LevelEventConfig` 让事件按关卡数据触发：雨天会收窄可行走区域，临时换门会暂时阻塞旧入口并更新推荐门，行李车会占用一块不可穿越区域；开始、结束和换门记录会进入局内事件日志，HUD/站台会显示当前事件。

构建与回归命令：

```text
npm run build:wxgame
npm run check
```

需要一次性做类型检查并生成小游戏产物时可运行 `npm run build:all`。

## M6 当前状态

M6 已完成一套可追溯的自有视觉与声音资源，并接入运行时：

- `assets/generated/tideline-sprite.svg` 提供玩家、六类乘客、站台徽章和界面图标的抽象几何精灵；Canvas 继续保留几何回退，避免图片解码差异阻断玩法。
- `src/render/design-tokens.ts` 与 `assets/design-tokens.json` 冻结颜色、字体栈、间距和动效时长；字体使用设备系统字体，不依赖外链。
- `scripts/generate-audio.mjs` 生成五个确定性 PCM WAV（循环氛围、疏导、成功、失败、事件提示），来源和复核状态登记在 `assets/ASSET_MANIFEST.md`。
- `GameRuntime` 默认加载 `assets/audio/` 下的音效；首次用户手势后解锁音乐，并按局内 `guide`、`success`、`failure`、`event-start` 事件各播放一次，重试关卡会重置事件游标。
- `npm run check:assets` 校验资源清单、SVG 符号、字体 tokens 和 WAV 格式；`npm run check` 已包含该校验。

项目许可证仍待作者确认，资源暂不单独对外授权。真机试听、字体表现、音量矩阵和低端设备性能属于 M7 验证项。

## M7 当前状态

M7 已完成自动化压力回放、生命周期回归、性能基准和发布包静态审计：

- `tests/m7.test.mjs` 覆盖 220 人有限状态、同种子确定性、快速启动/停止、前后台暂停、连续切关和无状态串线；
- `scripts/benchmark-simulation.mjs` 默认跑 220 人/180 帧，并提供 `--strict` P95 帧预算门槛；
- `scripts/check-release.mjs` 检查 `dist/`、包体、WAV/SVG、资源登记、外部 URL/网络 API、外链字体、source map、调试钩子和小游戏配置；默认与 `--strict` 均可用于 CI，`--production` 会额外阻断占位 AppID；
- `M7_TEST_MATRIX.md`、`M7_PERFORMANCE.md` 和 `M7_COMPLIANCE_CHECKLIST.md` 固化真机、性能、隐私、适龄、版权和微信审核验收项。

常用命令：

```text
npm run test:m7
npm run bench:simulation
npm run check:release
npm run check:release:strict
```

当前审计结果为“测试包可用”：包体约 311 KB、`dist/` 约 180 KB，未发现外链或调试接口；
`project.config.json` 仍使用 `touristappid`，项目最终 LICENSE 也尚未由权利人确认，
因此不能直接称为生产发布包。M8 前替换正式 AppID 后再运行
`node scripts/check-release.mjs --strict --production`，并完成文档中的真机签字。
