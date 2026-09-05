# M6 生成与复核记录

## SVG 精灵

- 文件：`generated/tideline-sprite.svg`
- 制作方式：开发者手工编写 SVG 几何路径，参考本仓库的 `VISUAL_SPEC.md` tokens；
  未调用第三方素材库、照片、Logo 或角色参考图。
- 修改记录：v0.1（2026-09-01）建立符号、预览板和中文说明。
- 初检：未发现可识别的现实线路标识；发布前需非制作者二次复核。

## 程序化音效

- 文件：`audio/*.wav`
- 制作方式：`scripts/generate-audio.mjs` 生成 22050Hz、16-bit、单声道 PCM；
  使用正弦/三角波、包络和确定性参数，不含真人录音、歌曲或第三方采样。
- 可重复性：同一脚本版本和参数会生成相同字节内容。
- 初检：频谱和时长适合按钮/事件提示；发布前需在目标设备试听并做音量检查。

## 权利声明

上述内容为本项目自有制作/生成结果。最终项目许可证尚待作者确认；在许可证
冻结前不得把本目录资源单独标记为 MIT/Apache-2.0 或向第三方再授权。

## 玩家 Sprite 样板

- 文件：`generated/tideline-player-sprite.svg`
- 运行时文件：`generated/tideline-player-sprite.png`，由 `scripts/generate-player-sprite.py` 从同一套几何规范栅格化生成。
- 制作方式：项目内手工绘制的 256x64 四帧 SVG 图集，帧 0 为待机，帧 1/2 为行走，帧 3 为疏导挥手。
- 使用方式：渲染层通过 `wx.createImage` 可选加载；图片不可用时回退到 Canvas 几何角色。

## 普通 NPC Sprite

- 文件：`generated/tideline-passenger-regular-sprite.png`
- 生成工具：内置 `image_gen`；参考项目内 `generated/tideline-player-sprite.png` 的 Q 版比例、深色描边和配色。
- 生成内容：单个雾蓝上衣、深色裤子、斜挎包的普通通勤客，横向四帧为待机、左步、右步和疏导挥手；无文字、Logo、站牌或第三方素材。
- 后处理：使用 Pillow 从生成预览中分离角色，移除棋盘背景，裁切四帧，统一基线并缩放为 256×64 RGBA 图集；项目运行时通过 `wx.createImage` 加载。
- 失败回退：图片未加载或解码失败时继续使用 `actor-renderer.ts` 中的普通 NPC 几何造型。
- 复核：已检查尺寸、PNG 签名和 alpha 通道；发布前仍需第二人进行相似性和运行时复核。
