# 资源来源清单（M6 v0.1）

每个进入发布包的资源都必须在这里有记录。当前条目均为本项目自有制作或
确定性程序生成；最终项目许可证冻结前，不单独对外授权这些资源。

| 文件 | 类型 | 制作者/生成工具 | 来源或提示词记录 | 版本 | 许可证/商用范围 | 人工修改 | 相似性复核 | 备注 |
|---|---|---|---|---|---|---|---|---|
| `generated/tideline-player-sprite.png` | PNG Q 版玩家帧图集 | `scripts/generate-player-sprite.py` | 由项目内 SVG 源文件重绘，四帧待机/行走/疏导动作 | 0.1.0 | 项目自有；随最终项目许可证 | 是，人工绘制与脚本栅格化 | 初检通过；发布前需第二人复核 | 微信运行时优先加载，PNG 解码兼容性更好 |
| `generated/tideline-player-sprite.svg` | SVG Q 版玩家帧图集 | 项目内手工 SVG | `VISUAL_SPEC.md`；四帧待机/行走/疏导动作，无外部参考图 | 0.1.0 | 项目自有；随最终项目许可证 | 是，人工绘制 | 初检通过；发布前需第二人复核 | 玩家 Sprite，微信图片解码失败时几何回退 |
| `generated/tideline-sprite.svg` | SVG 矢量精灵 | 项目内手工 SVG | `VISUAL_SPEC.md`；抽象几何，无外部参考图 | 0.1.0 | 项目自有；随最终项目许可证 | 是，人工绘制 | 初检通过；发布前需第二人复核 | 玩家、6 类乘客、站台徽章、按钮图标 |
| `audio/tideline-loop.wav` | PCM WAV 循环氛围 | `scripts/generate-audio.mjs` | 确定性正弦/三角波参数，无采样 | 0.1.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 1.5s，22050Hz，单声道 |
| `audio/ui-guide.wav` | PCM WAV UI 音效 | `scripts/generate-audio.mjs` | 确定性短音调，无采样 | 0.1.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 疏导按钮 |
| `audio/ui-success.wav` | PCM WAV 结算音效 | `scripts/generate-audio.mjs` | 确定性三音符，无采样 | 0.1.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 成功结算 |
| `audio/ui-failure.wav` | PCM WAV 结算音效 | `scripts/generate-audio.mjs` | 确定性低音下行，无采样 | 0.1.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 失败结算 |
| `audio/event-alert.wav` | PCM WAV 事件提示 | `scripts/generate-audio.mjs` | 确定性双音提示，无采样 | 0.1.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 事件开始 |
| `design-tokens.json` | JSON 设计 tokens | 项目内手工维护 | `VISUAL_SPEC.md` | 0.1.0 | 项目文档；随最终项目许可证 | 是 | 与运行时 tokens 对照通过 | 颜色、字体、间距、动效 |

## 复核规则

- 不使用现实地铁运营方的 Logo、官方地图、广播录音、照片或制服标识。
- 生成式资源要保存原始提示词、工具/模型版本和最终修改记录。
- 字体、音效和图标即使免费，也要记录具体许可证和再分发条件。
- 发布前由非制作者复核一次，确认没有可识别的第三方角色、商标或素材复刻。
