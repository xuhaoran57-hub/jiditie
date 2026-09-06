# Q 版动效样板

本轮先落地“几何动效 + 玩家 Sprite”的最小样板，规则层接口保持不变。

## 已接入内容

- `assets/generated/tideline-player-sprite.svg`：可编辑的四帧源文件。
- `assets/generated/tideline-player-sprite.png`：微信小游戏运行时优先加载的四帧图集。
- `src/render/player-sprite.ts`：异步加载、帧定义和解码失败状态。
- `src/render/actor-renderer.ts`：玩家待机呼吸、行走步伐、疏导挥手帧；乘客在被疏导后会弹跳并显示闪光。
- `src/render/actor-renderer.ts`：六类 NPC 使用独立轮廓（普通挎包、快步围巾、慢行帽杖、行李箱、手机连帽衫、同行双人缎带），并保留各自步频。
- `src/render/effects.ts`：疏导扇形波纹、指向目标的光束、目标环和星点。
- `src/render/canvas-ui.ts`：疏导按钮在动作期间显示脉冲反馈。

## 动画驱动约束

- 动画时间来自 `GameState.elapsed` 和事件 `at`，沿用现有固定步长循环。
- 渲染层只读取快照，不向 `GameState` 写入动画字段。
- `wx.createImage`、`drawImage` 不可用或解码失败时，自动回退到原有几何角色。
- 图集帧宽为 64px：0 待机、1/2 行走、3 疏导挥手；疏导事件结束后自动回到待机/行走。
- 六类 NPC 已补充统一 SVG 图集 `assets/generated/tideline-passenger-atlas.svg`；加载失败时仍回退到 `NPC_VISUAL_PROFILES` + Canvas 几何绘制。

## 验证

```text
npm run check:assets
npm run test:render
npm run build:wxgame
```

真机验收仍需在 `667x375`、`480x320` 和竖屏尺寸检查 Sprite 解码、角色比例、疏导光束覆盖关系及 30 FPS 表现。
