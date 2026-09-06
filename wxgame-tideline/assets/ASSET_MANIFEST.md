# 资源来源清单（M6 v0.1）

每个进入发布包的资源都必须在这里有记录。当前条目均为本项目自有制作或
确定性程序生成；最终项目许可证冻结前，不单独对外授权这些资源。

| 文件 | 类型 | 制作者/生成工具 | 来源或提示词记录 | 版本 | 许可证/商用范围 | 人工修改 | 相似性复核 | 备注 |
|---|---|---|---|---|---|---|---|---|
| `generated/tideline-player-sprite.png` | PNG 高细节玩家四帧 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的主角设计参考板；潮汐青分层外套、侧扫短发、工具背包、哨子挂件和四帧待机/行走/疏导动作 | 2.0.0 | 项目自有；随最终项目许可证 | 是，清理透明背景、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 微信运行时优先加载，PNG 解码兼容性更好 |
| `generated/tideline-passenger-regular-sprite.png` | PNG 普通 NPC 四帧 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 独立设计的雾蓝通勤客；四帧待机/行走/疏导挥手 | 0.1.0 | 项目自有；随最终项目许可证 | 是，去除棋盘背景、裁切四帧并缩放为 256×64，保留透明通道 | 初检通过；发布前需第二人复核 | 普通 NPC 专用，加载失败时回退 Canvas 几何造型 |
| `generated/tideline-passenger-fast-sprite.png` | PNG 快步 NPC 四帧高细节 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的快步动作板；按蓝色 Sprite 风格重做橙色风衣、黄色围巾、背包和奔跑动作 | 2.0.0 | 项目自有；随最终项目许可证 | 是，保留透明通道、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 快步 NPC 专用，加载失败时回退 SVG/Canvas 几何造型 |
| `generated/tideline-passenger-slow-sprite.png` | PNG 慢行 NPC 四帧高细节 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的慢行动作板；紫色开衫、手杖、行走动作 | 1.0.0 | 项目自有；随最终项目许可证 | 是，保留透明通道、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 慢行角色源图，合并到 PNG 六行运行时图集 |
| `generated/tideline-passenger-luggage-sprite.png` | PNG 行李 NPC 四帧高细节 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的行李动作板；芥黄色外套、挎包、拉杆箱 | 1.0.0 | 项目自有；随最终项目许可证 | 是，保留透明通道、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 行李角色源图，合并到 PNG 六行运行时图集 |
| `generated/tideline-passenger-phone-sprite.png` | PNG 手机 NPC 四帧高细节 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的手机动作板；青色连帽衫、耳机、手机 | 1.0.0 | 项目自有；随最终项目许可证 | 是，保留透明通道、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 手机角色源图，合并到 PNG 六行运行时图集 |
| `generated/tideline-passenger-group-sprite.png` | PNG 同行组四帧高细节 Sprite 图集 | 内置 `image_gen` + Pillow 后处理 | 外部视觉工作区的同行组动作板；妈妈与小孩牵手、四帧动作 | 1.0.0 | 项目自有；随最终项目许可证 | 是，保留透明通道、裁切四帧并缩放为 256×64 RGBA | 初检通过；发布前需第二人复核 | 同行组角色源图，合并到 PNG 六行运行时图集 |
| `generated/tideline-passenger-atlas.svg` | SVG 六类 NPC 四帧高细节图集 | 项目内确定性 SVG 生成脚本 | `scripts/generate-passenger-atlas.mjs`；六类角色分别绘制发型、服装结构、专属配件、阴影和四帧动作 | 0.3.0 | 项目自有；随最终项目许可证 | 是，按蓝色 Sprite 风格标准重绘 | 初检通过；发布前需第二人复核 | PNG 运行时图集异常时回退 SVG/Canvas 几何造型 |
| `generated/tideline-passenger-atlas.png` | PNG 六类 NPC 四帧高细节运行时图集 | `scripts/compose-passenger-atlas.py` | 由六张独立四帧 PNG 合成为 256×384 六行图集；运行时优先加载，避免 SVG 解码差异 | 1.0.0 | 项目自有；随最终项目许可证 | 是，统一 RGBA、透明通道和帧基线 | 初检通过；发布前需第二人复核 | 行顺序：普通、快步、慢行、行李、手机、同行组 |
| `generated/tideline-player-sprite.svg` | SVG Q 版玩家帧图集 | 项目内手工 SVG | `VISUAL_SPEC.md`；四帧待机/行走/疏导动作，无外部参考图 | 0.1.0 | 项目自有；随最终项目许可证 | 是，人工绘制 | 初检通过；发布前需第二人复核 | 玩家 Sprite，微信图片解码失败时几何回退 |
| `generated/tideline-sprite.svg` | SVG 矢量精灵 | 项目内手工 SVG | `VISUAL_SPEC.md`；抽象几何，无外部参考图 | 0.1.0 | 项目自有；随最终项目许可证 | 是，人工绘制 | 初检通过；发布前需第二人复核 | 玩家、6 类乘客、站台徽章、按钮图标 |
| `audio/tideline-loop.wav` | PCM WAV 轻松欢快循环 BGM | `scripts/generate-audio.mjs` | G 大调跳动短旋律、分解和弦、三角波低音和轻鼓点，无采样 | 1.4.0 | 项目自有；随最终项目许可证 | 否 | 初检通过；真机试听待 M7 | 8s，22050Hz，单声道，循环播放 |
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
