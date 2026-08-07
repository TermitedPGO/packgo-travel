#!/usr/bin/env node
/**
 * Pack & Go 海報渲染器：HTML → PNG / PDF
 *
 * 為什麼不用 wkhtmltopdf：報價單/收據是 A4 文件流，wkhtmltopdf 夠用；海報吃
 * flexbox、漸層、圓角、大字級，wkhtmltopdf 的舊 WebKit 會把圓角與漸層畫壞
 * （紅線 6 圓角是硬規定，畫壞就是違規），所以海報一律走 Chrome。
 *
 * 為什麼不用 chrome --screenshot：headless=new 的 --window-size 給的是「外框」
 * 尺寸，實際 viewport 會被瀏覽器介面吃掉一截（本機實測 1080x1350 只拿到
 * 1080x1263），截圖卻仍照外框輸出，結果就是版面底部被切、圖檔下緣留白。
 * 改走 CDP：Emulation.setDeviceMetricsOverride 指定 viewport、
 * Page.captureScreenshot 帶 clip，輸出尺寸逐像素可控。不需要 npm 安裝任何東西，
 * Node 22 內建 WebSocket 就夠。
 *
 * 用法：
 *   node render.mjs <input.html> <output.png> [--size wechat] [--scale 2]
 *   node render.mjs poster.html poster.pdf --size print-a4
 */

import { execFile } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, dirname } from 'node:path';

/**
 * CSS 像素尺寸。實際 PNG 輸出 = w×scale, h×scale。
 * pdfIn 是印刷用的實體紙張尺寸（英吋）；出 PDF 時畫布會改用 pdfIn×96,
 * 長寬比與 PNG 版一致,所以同一份 HTML 兩種輸出版面完全相同。
 */
const SIZES = {
  // 微信朋友圈 / LINE：4:5 直式,在手機動態牆佔最大版面
  wechat: { w: 1080, h: 1350, scale: 1 },
  line: { w: 1080, h: 1350, scale: 1 },
  // IG 方形貼文
  square: { w: 1080, h: 1080, scale: 1 },
  // IG / FB 限時動態、Reels 封面
  story: { w: 1080, h: 1920, scale: 1 },
  // 門市張貼、客人自行列印（PNG 出 300dpi = 2480×3508）
  'print-a4': { w: 1240, h: 1754, scale: 2, pdfIn: { w: 8.27, h: 11.69 } },
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.PLAYWRIGHT_BROWSERS_PATH && join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'),
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  const hit = CHROME_CANDIDATES.filter(Boolean).find((c) => existsSync(c));
  if (hit) return hit;
  throw new Error(
    'HALT: 找不到 Chrome/Chromium。裝 Google Chrome,或設 CHROME_PATH=<binary 路徑> 再跑一次。'
  );
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 極簡 CDP client：夠用就好,不做重連與流量控制。 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        const ls = this.listeners.get(msg.method) || [];
        this.listeners.set(msg.method, []);
        for (const l of ls) l(msg.params);
      }
    });
  }

  static async connect(url, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
        });
        return new CDP(ws);
      } catch {
        if (Date.now() > deadline) throw new Error(`HALT: 連不上 Chrome DevTools (${url})`);
        await sleep(120);
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise((resolve) => {
      const ls = this.listeners.get(method) || [];
      ls.push(resolve);
      this.listeners.set(method, ls);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* 關閉失敗不影響輸出 */ }
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
    else positional.push(argv[i]);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [inputArg, outputArg] = positional;

if (!inputArg || !outputArg) {
  fail('usage: node render.mjs <input.html> <output.(png|pdf)> '
     + `[--size ${Object.keys(SIZES).join('|')}] [--scale N]`);
}

const sizeKey = flags.size || 'wechat';
const preset = SIZES[sizeKey];
if (!preset) fail(`HALT: 未知尺寸 "${sizeKey}"。可用：${Object.keys(SIZES).join(', ')}`);

const scale = flags.scale ? Number(flags.scale) : preset.scale;
if (!Number.isFinite(scale) || scale <= 0) fail(`HALT: --scale 必須是正數,收到 "${flags.scale}"`);

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
if (!existsSync(inputPath)) fail(`HALT: 找不到輸入檔 ${inputPath}`);

const isPdf = extname(outputPath).toLowerCase() === '.pdf';

// 出 PDF 時畫布改用實體紙張尺寸(英吋×96),長寬比與 PNG 版相同,版面不會跑掉。
const canvas = isPdf && preset.pdfIn
  ? { w: Math.round(preset.pdfIn.w * 96), h: Math.round(preset.pdfIn.h * 96) }
  : { w: preset.w, h: preset.h };

// ---------- 準備工作目錄 ----------
const html = readFileSync(inputPath, 'utf8');
const injection = `<style id="packgo-poster-size">:root{--poster-w:${canvas.w}px;`
  + `--poster-h:${canvas.h}px;--poster-size:"${sizeKey}";}`
  + 'html,body{margin:0;padding:0;background:transparent;}</style>';
const staged = html.includes('</head>')
  ? html.replace('</head>', `${injection}</head>`)
  : injection + html;

const workDir = mkdtempSync(join(tmpdir(), 'packgo-poster-'));
const stagedPath = join(workDir, 'poster.html');
writeFileSync(stagedPath, staged, 'utf8');

// Logo 用相對路徑引用。工作 HTML 同層找不到就退到 skill 自己的 assets/,
// 這樣直接渲染 references/template.html 也會有 logo。
for (const asset of ['packgo-logo-white.png', 'packgo-logo-navy.png']) {
  const src = [
    resolve(inputPath, '..', asset),
    resolve(inputPath, '..', 'assets', asset),
    resolve(inputPath, '..', '..', 'assets', asset),
  ].find((p) => existsSync(p));
  if (src) copyFileSync(src, join(workDir, asset));
}

// 其他相對資源(hero 照片等)：跟著工作 HTML 一起搬進暫存目錄。
for (const m of staged.matchAll(/(?:src=|url\()\s*["']?(?!data:|https?:|file:|#)([^"')\s>]+)/g)) {
  const rel = m[1];
  if (rel.includes('..') || rel.startsWith('/')) continue; // 不跨出工作目錄
  const src = resolve(inputPath, '..', rel);
  const dest = join(workDir, rel);
  if (existsSync(src) && !existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

// ---------- 啟動 Chrome ----------
const chrome = findChrome();
const profileDir = join(workDir, 'profile');
mkdirSync(profileDir, { recursive: true });

const child = execFile(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { maxBuffer: 8 * 1024 * 1024 });

let cdp;
let cleaned = false;
/**
 * 清理暫存。Chrome 結束前還在寫 profile,直接 rm 會撞 ENOTEMPTY,
 * 所以先殺行程再重試幾次;真的刪不掉也只是留下暫存檔,不能讓它蓋掉出圖結果。
 */
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { cdp?.close(); } catch { /* 連線已斷 */ }
  try { child.kill('SIGKILL'); } catch { /* 已結束 */ }
  // 同步等待:這個函式也掛在 process exit 上,那裡不能 await。
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 0; i < 8; i++) {
    try { rmSync(workDir, { recursive: true, force: true }); return; } catch { nap(150); }
  }
};
process.on('exit', cleanup);

try {
  // Chrome 把實際 port 寫進 DevToolsActivePort,輪詢等它出現。
  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  let wsUrl = null;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
      if (port && path) { wsUrl = `ws://127.0.0.1:${port}${path}`; break; }
    }
    await sleep(100);
  }
  if (!wsUrl) throw new Error('HALT: Chrome 沒有開出 DevTools port,啟動失敗。');

  cdp = await CDP.connect(wsUrl);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  // 關鍵：viewport 由這裡決定,不再受 --window-size 的外框尺寸影響。
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: canvas.w,
    height: canvas.h,
    deviceScaleFactor: isPdf ? 1 : scale,
    mobile: false,
  }, sessionId);

  await cdp.send('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `file://${stagedPath}` }, sessionId);
  await Promise.race([loaded, sleep(20000)]);

  // 字體沒載完就截圖會掉字/變豆腐,等 document.fonts 收斂再拍。
  await cdp.send('Runtime.evaluate', {
    expression: 'document.fonts.ready.then(() => true)',
    awaitPromise: true,
  }, sessionId).catch(() => { /* 舊版 Chrome 沒有 fonts API,略過 */ });
  await sleep(150);

  // 模板的 autoFit 若判定塞不下會插紅色警示條,這裡讀回來一起報給使用者。
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      overflow: !!document.querySelector('.overflow-warning'),
      autofit: (document.title.match(/autofit=([0-9.]+)/) || [])[1] || null
    })`,
    returnByValue: true,
  }, sessionId).catch(() => null);
  const status = probe?.result?.value ? JSON.parse(probe.result.value) : {};

  if (isPdf) {
    const paper = preset.pdfIn || { w: canvas.w / 96, h: canvas.h / 96 };
    const { data } = await cdp.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: paper.w,
      paperHeight: paper.h,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      preferCSSPageSize: false,
    }, sessionId);
    writeFileSync(outputPath, Buffer.from(data, 'base64'));
  } else {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: canvas.w, height: canvas.h, scale: 1 },
    }, sessionId);
    writeFileSync(outputPath, Buffer.from(data, 'base64'));
  }

  // 逐像素驗尺寸：出圖尺寸不對就是不合格,不能默默交出去。
  if (!isPdf) {
    const png = readFileSync(outputPath);
    const gotW = png.readUInt32BE(16), gotH = png.readUInt32BE(20);
    const wantW = Math.round(canvas.w * scale), wantH = Math.round(canvas.h * scale);
    if (gotW !== wantW || gotH !== wantH) {
      throw new Error(`HALT: 輸出尺寸不符,預期 ${wantW}x${wantH},實得 ${gotW}x${gotH}`);
    }
    console.log(`OK ${outputPath}  size=${sizeKey}  ${gotW}x${gotH}px  scale=${scale}`);
  } else {
    console.log(`OK ${outputPath}  size=${sizeKey}  ${canvas.w}x${canvas.h}css  A4`);
  }

  if (status.autofit) {
    console.log(`   note: 內容偏長,已自動縮排至 ${status.autofit} 倍。想維持標準字級就刪一條賣點。`);
  }
  if (status.overflow) {
    fail('HALT: 版面溢出,圖上已印紅色警示條。刪減賣點或縮短主標後重出,不要直接發。');
  }
} catch (err) {
  fail(err.message.startsWith('HALT') ? err.message : `HALT: 渲染失敗 — ${err.message}`);
}

process.exit(0);
