// 《潮汐线：赶上这班车》微信小游戏入口。
// 运行前先执行 npm run build:wxgame，把 TypeScript 运行时输出到 dist/。
(function bootstrapTideline() {
  // 部分微信开发者工具版本在 game.js 刚加载时尚未完成 JSBridge 初始化。
  // 启动阶段不读取窗口信息，先让 bridge 完成一轮事件循环，再创建运行时。
  const BOOT_RETRY_LIMIT = 8;
  const BOOT_RETRY_DELAY = 32;
  let bootCanvas;
  let bootAttempts = 0;

  function scheduleBoot(callback) {
    const run = () => {
      if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') {
        try {
          wx.nextTick(callback);
          return;
        } catch (_error) {
          // nextTick 在 bridge 尚未就绪时也可能失败，退回定时器。
        }
      }
      callback();
    };
    if (typeof setTimeout === 'function') {
      setTimeout(run, BOOT_RETRY_DELAY);
    } else {
      run();
    }
  }

  function drawBoot(message) {
    if (typeof wx === 'undefined' || typeof wx.createCanvas !== 'function') return;
    if (!bootCanvas) {
      try {
        bootCanvas = wx.createCanvas();
      } catch (_error) {
        return;
      }
    }
    let context;
    try {
      context = bootCanvas && bootCanvas.getContext && bootCanvas.getContext('2d');
    } catch (_error) {
      return;
    }
    if (!context) return;
    // bridge 未就绪时只使用保守回退尺寸，避免再次触发 getSystemInfo。
    const width = 375;
    const height = 667;
    const dpr = 1;
    bootCanvas.width = Math.round(width * dpr);
    bootCanvas.height = Math.round(height * dpr);
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
    scheduleBoot(() => drawBoot('请在微信小游戏环境中运行'));
    return;
  }

  let runtimeModule;
  try {
    runtimeModule = require('./dist/runtime/index.js');
  } catch (_error) {
    scheduleBoot(() => drawBoot('请先运行 npm run build:wxgame'));
    return;
  }

  function startRuntime() {
    try {
      // 生产入口不把运行时挂到全局对象，避免留下可被外部脚本调用的调试接口。
      runtimeModule.createWxGameRuntime(wx, { autoStart: true });
    } catch (_error) {
      if (bootAttempts < BOOT_RETRY_LIMIT) {
        bootAttempts += 1;
        scheduleBoot(startRuntime);
        return;
      }
      drawBoot('启动失败，请检查构建与基础库版本');
    }
  }

  scheduleBoot(startRuntime);
})();
