# core 规则层（M2）

这里放与平台无关的纯 TypeScript 游戏模型、关卡配置和模拟逻辑。核心只接收确定的
种子、输入和时间步长，渲染层可以把 `GameState` 当作只读快照。

主要入口是 `index.ts`：

- `GameSimulation`：创建一局、推进时间、切换车门和触发疏导；
- `PhaseMachine`：可单独测试的进站/下车/上车/警告/结算状态机；
- `createPassengers`、`resolveCollisions`：确定性人群生成、空间哈希和圆形碰撞；
- `MVP_LEVELS`：海风门、云港、星环城三份数据驱动关卡；
- `LevelEventConfig` / `GameState.activeEvent`：按局内时间驱动雨天、临时换门和行李车规则事件；
- `calculateScore`、`emptySave`/`parseSave`/`serializeSave`：评分与版本化存档。

运行 `npm run check` 可先做 TypeScript 类型检查，再执行 Node 核心回归测试。
规则层不引用微信运行时、DOM、Canvas 或 CSS，因此可以在没有渲染器的环境中重放一局。
