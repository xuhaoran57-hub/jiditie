# 字体策略（M6）

## 运行时字体

Canvas 只使用设备系统字体栈：

```text
"PingFang SC", "Microsoft YaHei", sans-serif
```

数字倒计时使用：

```text
ui-monospace, "SFMono-Regular", Consolas, monospace
```

`src/render/design-tokens.ts` 的 `canvasFont` / `canvasMonoFont` 统一生成字体
字符串。设备缺少首选字体时由系统回退到 `sans-serif`，不下载字体文件。

## 权利与交付

- 不使用 Google Fonts、在线字体 CDN 或未登记的字体文件。
- 系统字体由设备平台提供，项目不重新分发字体文件；发布说明中不把系统字体
  宣称为项目自有资产。
- 如果后续需要嵌入字体，必须先取得允许微信小游戏再分发和商用的许可证，
  并在 `ASSET_MANIFEST.md` 增加具体版本、许可证和授权凭证。
