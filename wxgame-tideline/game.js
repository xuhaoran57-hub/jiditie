// 《潮汐线：赶上这班车》微信小游戏入口。
// 运行前先执行 npm run build:wxgame，把 TypeScript 运行时输出到 dist/。
(function bootstrapTideline() {
  function drawBoot(message) {
    if (typeof wx === 'undefined' || typeof wx.createCanvas !== 'function') return;
    let canvas;
    try {
      canvas = wx.createCanvas();
    } catch (_error) {
      return;
    }
    let context;
    try {
      context = canvas && canvas.getContext && canvas.getContext('2d');
    } catch (_error) {
      return;
    }
    if (!context) return;
    let system = {};
    try {
      system = wx.getWindowInfo
        ? (wx.getWindowInfo() || {})
        : (wx.getSystemInfoSync ? (wx.getSystemInfoSync() || {}) : {});
    } catch (_error) {
      system = {};
    }
    const width = Number.isFinite(system.windowWidth) ? system.windowWidth : 375;
    const height = Number.isFinite(system.windowHeight) ? system.windowHeight : 667;
    const dpr = Math.min(Math.max(Number.isFinite(system.pixelRatio) ? system.pixelRatio : 1, 1), 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (context.setTransform) context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#071d29';
    context.fillRect(0, 0, width, height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ff8a28';
    context.font = '900 28px sans-serif';
    context.fillText('潮汐线', width / 2, height / 2 - 30);
    context.fillStyle = '#f6fbff';
    context.font = '600 15px sans-serif';
    context.fillText(message, width / 2, height / 2 + 10);
    context.fillStyle = '#9db6c1';
    context.font = '12px sans-serif';
    context.fillText('湾城虚构线路 · 非官方作品', width / 2, height / 2 + 42);
  }

  if (typeof require !== 'function' || typeof wx === 'undefined') {
    drawBoot('请在微信小游戏环境中运行');
    return;
  }

  let runtimeModule;
  try {
    runtimeModule = require('./dist/runtime/index.js');
  } catch (_error) {
    drawBoot('请先运行 npm run build:wxgame');
    return;
  }

  try {
    // 生产入口不把运行时挂到全局对象，避免留下可被外部脚本调用的调试接口。
    runtimeModule.createWxGameRuntime(wx, { autoStart: true });
  } catch (_error) {
    drawBoot('启动失败，请检查构建与基础库版本');
  }
})();
