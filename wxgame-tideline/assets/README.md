# 资源目录

只放入自有、已获授权或许可证允许再分发的资源。每个资源应在本目录或 `ASSET_MANIFEST.md` 中记录：

- 文件名和版本
- 制作者或生成工具
- 来源链接（如有）
- 许可证和商用范围
- 是否经过人工修改与相似性检查

M6 已加入一份自有 SVG 精灵和五个确定性程序化 WAV 音效；Canvas 仍保留几何
回退，避免微信基础库的图片解码差异影响可玩性。音效可用
`npm run generate:audio` 重建，资源完整性用 `npm run check:assets` 检查。

仍禁止引入真实地铁录音、官方地图、Logo、站内照片或未登记的网络资源。字体
采用设备系统字体栈，详见 `FONT_POLICY.md`；视觉规范和生成记录分别见
`VISUAL_SPEC.md`、`GENERATIVE_RECORD.md`。
