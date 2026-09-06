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
  使用正弦/三角波、C 大调五声音阶短句、轻鼓点、包络和确定性参数，不含真人录音、歌曲或第三方采样。
- BGM：`audio/tideline-loop.wav` 为 8 秒整循环的轻松欢快旋律，采用 120 BPM、G 大调四小节和弦进行，包含跳动短旋律、分解和弦、低音和低音量节拍；循环边界使用一致的节拍和相位，沿用运行时已有的循环音乐入口。
- 可重复性：同一脚本版本和参数会生成相同字节内容。
- 初检：频谱和时长适合按钮/事件提示；发布前需在目标设备试听并做音量检查。

## 权利声明

上述内容为本项目自有制作/生成结果。最终项目许可证尚待作者确认；在许可证
冻结前不得把本目录资源单独标记为 MIT/Apache-2.0 或向第三方再授权。

## 玩家 Sprite 样板

- 文件：`generated/tideline-player-sprite.svg`
- 运行时文件：`generated/tideline-player-sprite.png`，由外部视觉工作区的主角设计参考板裁切并缩放为 256×64 RGBA 四帧图集。
- 制作方式：内置 `image_gen` 重新设计潮汐线站务主角，补齐侧扫短发、分层潮汐青外套、反光条、工具背包、哨子挂件和四帧待机/左右行走/疏导挥手动作；再进行透明通道清理、脚底对齐和帧裁切。
- 使用方式：渲染层通过 `wx.createImage` 优先加载 PNG；图片不可用时保留 SVG/Canvas 几何回退。

## 普通 NPC Sprite

- 文件：`generated/tideline-passenger-regular-sprite.png`
- 生成工具：内置 `image_gen`；参考蓝色 Sprite 的比例、深色描边和分层配色。
- 生成内容：单个雾蓝上衣、深色裤子、斜挎包的普通通勤客，横向四帧为待机、左步、右步和疏导挥手；无文字、Logo、站牌或第三方素材。
- 后处理：使用 Pillow 从生成预览中分离角色，移除棋盘背景，裁切四帧，统一基线并缩放为 256×64 RGBA 图集；项目运行时通过 `wx.createImage` 加载。
- 失败回退：图片未加载或解码失败时继续使用 `actor-renderer.ts` 中的普通 NPC 几何造型。
- 复核：已检查尺寸、PNG 签名和 alpha 通道；发布前仍需第二人进行相似性和运行时复核。

## NPC 多类型 SVG 图集

- 文件：`generated/tideline-passenger-atlas.svg`
- 制作方式：`scripts/generate-passenger-atlas.mjs` 以固定颜色、轮廓和配件参数生成
  六行四帧 SVG；每行对应普通、快步、慢行、行李、手机和同行组。
- 运行时：`passenger-sprite.ts` 根据 NPC 类型选择图集行；图片不可用时继续使用
  `actor-renderer.ts` 的几何造型。
- 可重复性：脚本不依赖网络或随机数，同一版本输出相同 SVG 字节；v0.3 以全新角色参考板
  为基准，为五类非普通 NPC 分别补齐发型、领口/衣襟、配件、明暗层次和四帧动作差异，
  不沿用旧角色参考。
- 复核：已检查 256×384 画布和受限品牌关键词；发布前仍需第二人进行相似性和真机复核。

## 快步 NPC Sprite

- 文件：`generated/tideline-passenger-fast-sprite.png`
- 参考板：外部视觉工作区中的 `tideline-fast-sprite-sheet-v2.png`，以用户提供的蓝色四帧 Sprite 为风格基准，识别全新橙色风衣、黄色围巾和背包造型；原始参考图不随微信项目发布。
- 生成方式：内置 `image_gen` 生成透明四帧横向动作板，再由 `scripts/process-fast-sprite.py` 裁切并缩放为 256×64 RGBA 图集。
- 运行时：快步乘客优先加载该 PNG；失败时回退到 SVG 图集，再回退到 Canvas 几何角色。

## 角色参考图归档

- 参考板和原始动作板保存在 Codex 视觉工作区的外部归档目录，不再放在仓库 `references/` 下。
- 这些图片只用于美术复核，不被运行时加载；移出仓库可避免微信预览把多 MB 的原始参考图一并上传。
- 当前仓库只保留裁切后的 PNG Sprite、PNG 图集和可编辑 SVG 源。

## NPC PNG 运行时图集

- 文件：`generated/tideline-passenger-atlas.png`
- 制作方式：`scripts/compose-passenger-atlas.py` 将普通、快步、慢行、行李、手机和同行组六张
  256×64 RGBA 四帧图集合成为 256×384 六行图集。
- 运行时：`asset-registry.ts` 统一加载 PNG 图集；`tideline-passenger-atlas.svg` 保留为可编辑矢量源和回退素材。
