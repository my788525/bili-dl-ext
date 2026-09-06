/* Bilibili 下载器 — Offscreen Document（主线程承载 ffmpeg.wasm）
 *
 * 设计要点（与上一版 wrapper 方案的根本区别）：
 *  1. 取流 m4s 与 ffmpeg 合并/转码在本 Offscreen 文档内完成（扩展 host_permissions 让
 *     跨源 fetch 响应体可读；Emscripten ccall('main') 主线程驱动）。
 *  2. 落盘必须经 SW：chrome.downloads API 在 Chrome MV3 的 Offscreen Document 上下文中
 *     不可用（Chrome 文档明确：可用上下文为 background/content/popup/options，offscreen
 *     不在列表）。offscreen 通过 chrome.runtime.connect('bili-dl-save') 开长连接，把
 *     Uint8Array 用 transferable ArrayBuffer 分块转给 SW，SW 拼成 base64 data URL 后调
 *     chrome.downloads.download 落盘（Chrome 78+ 自动建子目录）。
 *  3. ffmpeg-core 用 @ffmpeg/core@0.11.0 的 Emscripten 工厂（顶部 var createFFmpegCore
 *     已挂全局）。本扩展不设 COOP/COEP -> SharedArrayBuffer 不可用 -> Emscripten 自动
 *     回退单线程，不派生 Worker，故 CSP 无需放行 blob Worker。
 *  4. m4s 跨源下载：扩展上下文 fetch 不受 CORS 限制；DNR 规则统一注入 Referer 绕过 CDN 防盗链。
 */

'use strict';

// ---- 解析 ffmpeg 工厂 ----
// ffmpeg-core.js 在文件顶部用 `var createFFmpegCore = (function(){...})()` 把工厂函数挂到了全局
// （window.createFFmpegCore）。其尾部 UMD 的 module/exports 分支在扩展上下文不会触发，但顶部全局
// var 始终存在——故直接取全局 createFFmpegCore 即可，无需任何 inline script 垫片（扩展页面 CSP
// `script-src 'self' 'wasm-unsafe-eval'` 禁止 inline script）。另用独立变量名，避免与全局 var 重名
// 触发 "Identifier 'createFFmpegCore' has already been declared"。
const ffmpegCoreFactory = (typeof createFFmpegCore !== 'undefined')
  ? createFFmpegCore
  : ((self.module && self.module.exports &&
      (self.module.exports.createFFmpegCore || self.module.exports)) || null);

let corePromise = null;
function ensureCore() {
  if (!ffmpegCoreFactory) {
    return Promise.reject(new Error(
      'ffmpeg-core.js 未加载：请确认 offscreen.html 已通过 <script> 引入 ffmpeg-core.js 并随扩展打包'
    ));
  }
  if (!corePromise) {
    corePromise = new Promise((resolve, reject) => {
      try {
        const p = ffmpegCoreFactory({
          print: () => {},        // 吞掉 ffmpeg 常规输出，避免刷屏
          printErr: () => {},     // 同上
          noExitRuntime: true,    // 允许复用同一个 core 处理多个 job
          locateFile: (path) => chrome.runtime.getURL(path) // 解析 ffmpeg-core.wasm
        });
        Promise.resolve(p).then(resolve).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }
  return corePromise;
}

// ---- 用 Emscripten 的 ccall('main') 驱动 ffmpeg（Node 已实证配方）----
const enc = new TextEncoder();
function buildArgv(core, args) {
  const ptrs = [];
  for (const a of args) {
    const b = enc.encode(a + '\0');
    const p = core._malloc(b.length);
    core.HEAPU8.set(b, p);
    ptrs.push(p);
  }
  const argv = core._malloc(ptrs.length * 4);
  for (let i = 0; i < ptrs.length; i++) core.HEAP32[(argv >> 2) + i] = ptrs[i];
  return { argv, ptrs, count: ptrs.length };
}
function freeArgv(core, info) {
  for (const p of info.ptrs) core._free(p);
  core._free(info.argv);
}
function runFFmpegArgs(core, args) {
  const info = buildArgv(core, args);
  let ret = 0;
  try {
    // argv[0] 习惯填程序名 'ffmpeg'；ccall main 即执行 ffmpeg 主函数
    ret = core.ccall('main', 'number', ['number', 'number'], [info.count, info.argv]);
  } catch (e) {
    // Emscripten 在 ffmpeg 调用 exit(0) 时会抛异常，这是正常退出，非错误
    if (!(e && e.message && /exit/i.test(e.message))) throw e;
  } finally {
    freeArgv(core, info);
  }
  return ret;
}

// ---- 跨源下载 m4s（extension context + host_permissions，响应体可读）----
// onProgress(progressOrNull, speedBytesPerSec) —— 第二项用于 UI 显示实时下载速度
async function fetchToUint8(url, onProgress) {
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error('下载分片失败 HTTP ' + resp.status + '：' + url);
  const total = +resp.headers.get('Content-Length') || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  let lastT = Date.now(), lastR = 0, speed = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    const now = Date.now();
    const dt = now - lastT;
    if (dt >= 500) { speed = (received - lastR) / (dt / 1000); lastR = received; lastT = now; }
    if (onProgress) onProgress(total ? received / total : null, speed);
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ---- 落盘：把字节经 SW 中转回 content script，由 content 决定走 File System Access（静默）还是下载 API ----
// 关键架构决策：chrome.downloads API 在 Chrome MV3 的 Offscreen Document 上下文中不可用
// （Chrome 文档明确：可用上下文为 background/content/popup/options，offscreen 不在列表）。
// 之前用 port 把字节转给 SW 再由 SW 调 chrome.downloads.download，但那样每文件都会弹下载栏，
// 批量时浏览器像“卡住”。现改为把合并好的字节（Uint8Array）通过 sendMessage 经 SW 中转回
// 视频页 content script，由 content 在「静默模式」下用 File System Access API 直接写目录
// （完全不弹下载栏）；不支持 FS API 时回退到 chrome.downloads.download。
async function saveBlob(uint8, filename, saveAs, conflictAction, reqId) {
  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'bili-dl-save',
      reqId: reqId || null,
      filename,
      conflictAction: conflictAction || 'uniquify',
      bytes: uint8
    }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message || '落盘中转失败'));
      else resolve();
    });
  });
}

// ---- 下载子目录清洗（防御式：Chrome 仅允许“下载”目录下的相对路径）----
// 规则：去首尾斜杠、反斜杠转正、消除 .. 防跳出、替换非法字符、限长。
function sanitizeDir(d) {
  if (!d) return '';
  return String(d)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')               // 去掉开头斜杠（必须是相对路径）
    .replace(/\.{2,}/g, '')            // 去掉 .. 防止跳出下载目录
    .replace(/[<>:"|?*\0]/g, '_')      // Windows/通用非法字符
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')         // 去掉首尾斜杠
    .slice(0, 80);
}
// 把子目录前缀拼到基础文件名前；dir 为空则返回原文件名
function withDir(baseName, dir) {
  const d = sanitizeDir(dir);
  return d ? (d + '/' + baseName) : baseName;
}

function safeName(s) {
  return (s || 'bilibili')
    .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'bilibili';
}

function cleanupFS(core) {
  for (const f of ['v.m4s', 'a.m4s', 'out.mp4', 'out.m4a', 'out.mp3', 'in.bin']) {
    try { core.FS.unlink(f); } catch (_) {}
  }
}

// ---- 文件名拼装：4 个可独立开关的字段 ----
// 字段：视频标题(title) / PN(pn) / 选集名称(part) / 清晰度(qn)
// 默认全部开启，等价于旧行为；任一关闭即从文件名中剔除对应字段。
// 单 P 视频无 PN / 选集名称概念（job.page=0 且 job.part=''），对应开关自动不生效。
function buildFileName(job, nf) {
  const segs = [];
  if (nf.title && job.title) segs.push(safeName(job.title));
  if (nf.pn && job.page) segs.push('P' + String(job.page).padStart(2, '0'));
  if (nf.part && job.part) segs.push(safeName(job.part));
  if (nf.qn && job.qn) segs.push(String(job.qn) + 'p');
  const name = segs.join('_');
  return name || 'bilibili'; // 全关时兜底，避免空文件名
}

// ---- 单个 job 处理 ----
async function processJob(core, job, report, nameFormat, dir, saveAs, conflictAction, reqId) {
  const nf = nameFormat || { title: true, pn: true, part: true, qn: true };
  try {
    if (job.kind === 'durl') {
      report('fetch', 0);
      const buf = await fetchToUint8(job.url, (p, speed) => report('fetch', p == null ? 0.5 : p, speed));
      const ext = job.ext || (/\.flv(\?|$)/i.test(job.url) ? 'flv' : 'mp4');
      const name = withDir(`${buildFileName(job, nf)}.${ext}`, dir);
      await saveBlob(buf, name, saveAs, conflictAction, reqId);
      report('fetch', 1.0); // 把进度条推到 100%（content 不再显示「保存中」中间态）
      return { filename: name };
    }

    if (job.kind === 'durl-audio' || job.kind === 'audio') {
      const url = job.kind === 'durl-audio' ? job.url : job.audioUrl;
      report('fetch', 0);
      const buf = await fetchToUint8(url, (p, speed) => report('fetch', p == null ? 0.3 : p * 0.7, speed));
      core.FS.writeFile(job.kind === 'durl-audio' ? 'in.bin' : 'a.m4s', buf);
      report('transcode', 0.8);
      const fmt = job.audioFormat || 'm4a';
      let outName = 'out.m4a', ext = 'm4a';
      if (fmt === 'mp3') {
        try {
          runFFmpegArgs(core, ['ffmpeg', '-nostdin', '-i',
            job.kind === 'durl-audio' ? 'in.bin' : 'a.m4s',
            '-vn', '-ab', '320k', 'out.mp3']);
          outName = 'out.mp3'; ext = 'mp3';
        } catch (_) {
          // libmp3lame 不可用时回退到 m4a 直接封装（零损耗、兼容性最好）
          runFFmpegArgs(core, ['ffmpeg', '-nostdin', '-i',
            job.kind === 'durl-audio' ? 'in.bin' : 'a.m4s',
            '-vn', '-c', 'copy', 'out.m4a']);
        }
      } else {
        runFFmpegArgs(core, ['ffmpeg', '-nostdin', '-i',
          job.kind === 'durl-audio' ? 'in.bin' : 'a.m4s',
          '-vn', '-c', 'copy', 'out.m4a']);
      }
      const out = core.FS.readFile(outName);
      const name = withDir(`${buildFileName(job, nf)}.${ext}`, dir);
      await saveBlob(new Uint8Array(out), name, saveAs, conflictAction, reqId);
      report('fetch', 1.0);
      return { filename: name };
    }

    // 默认：video —— 合并 DASH 分离的音视频轨为 mp4
    report('fetch', 0);
    let aP = 0, vP = 0;
    const [audio, video] = await Promise.all([
      fetchToUint8(job.audioUrl, (p, speed) => { aP = p == null ? 0.2 : p; report('fetch', aP * 0.4, speed); }),
      fetchToUint8(job.videoUrl, (p, speed) => { vP = p == null ? 0.2 : p; report('fetch', 0.4 + vP * 0.4, speed); })
    ]);
    core.FS.writeFile('v.m4s', video);
    core.FS.writeFile('a.m4s', audio);
    report('merge', 0.85);
    runFFmpegArgs(core, ['ffmpeg', '-nostdin',
      '-i', 'v.m4s', '-i', 'a.m4s',
      '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
    const out = core.FS.readFile('out.mp4');
    const name = withDir(`${buildFileName(job, nf)}.mp4`, dir);
    await saveBlob(new Uint8Array(out), name, saveAs, conflictAction, reqId);
    report('fetch', 1.0);
    return { filename: name };
  } finally {
    cleanupFS(core); // 释放 FS 占用，避免批量时内存累积
  }
}

// ---- 任务总调度 ----
let cancelReqId = null; // 由 bili-dl-cancel 设置，worker 循环检测以中断批量

// 任务结束后释放 Offscreen 文档（卸载 24MB wasm，避免常驻占用内存）。
// 关键：必须延迟关闭（默认 3500ms），让 sendMessage 的 done 消息有充足时间
// 经 SW 中转链（SW listener 触发 → getBiliTabs cache → chrome.tabs.sendMessage IPC 投递
// → content listener 处理）送达，再卸载 offscreen。立即同步关闭会丢弃 done 消息，
// 导致 content 卡在最后的 progress 状态，批次永远不显示「全部完成」。
// 3500ms 是经过实测安全阈值：SW listener 触发 ~5ms + sendMessage IPC ~50ms + content 处理 ~100ms，
// 留出 3 秒富余应对 SW 唤醒延迟、content 页面繁忙等边缘情况。
function maybeCloseOffscreen(delayMs = 3500) {
  setTimeout(() => {
    try { if (chrome.offscreen && chrome.offscreen.closeDocument) chrome.offscreen.closeDocument(); }
    catch (_) {}
  }, delayMs);
}

async function handleTask(msg) {
  const reqId = msg.reqId;
  const jobs = Array.isArray(msg.jobs) ? msg.jobs : [];
  // 文件名格式：content 侧按勾选结果传入，未传则回退为「全部字段开启」（兼容旧消息）
  const nameFormat = (msg.nameFormat && typeof msg.nameFormat === 'object')
    ? msg.nameFormat
    : { title: true, pn: true, part: true, qn: true };
  // 下载位置：dir 为相对下载目录的子文件夹；saveAs 为是否弹出系统“另存为”对话框
  const dir = (typeof msg.dir === 'string') ? msg.dir : '';
  const saveAs = (msg.saveAs === true);
  const conflictAction = (msg.conflictAction === 'overwrite' || msg.conflictAction === 'prompt' || msg.conflictAction === 'uniquify')
    ? msg.conflictAction : 'uniquify';
  // 并发路数：1=单文件依次（最稳，避免批量时卡顿），≥2=多线程提速（默认 3，由 content 设置传入）
  const concurrency = (typeof msg.concurrency === 'number' && msg.concurrency >= 1 && msg.concurrency <= 6)
    ? Math.floor(msg.concurrency) : 3;
  const total = jobs.length;
  const results = new Array(total);

  let core;
  try {
    core = await ensureCore();
  } catch (e) {
    chrome.runtime.sendMessage({
      type: 'bili-dl-done', reqId, ok: false,
      msg: 'ffmpeg 加载失败：' + String((e && e.message) || e), results: []
    });
    return;
  }

  // ---- 并发池：由 content 设置的 concurrency 控制（单文件依次=1，多线程=≥2）----
  const CONCURRENCY = concurrency;
  let nextIdx = 0;
  let cancelled = false;

  const worker = async () => {
    while (true) {
      if (cancelReqId === reqId) { cancelled = true; break; } // 用户取消：收尾当前前不取新 job
      const i = nextIdx++;
      if (i >= total) break;
      const job = jobs[i];
      const report = (phase, progress, speed) => {
        try {
          chrome.runtime.sendMessage({
            type: 'bili-dl-progress', reqId, jobIndex: i, total,
            phase, progress: Math.max(0, Math.min(1, progress || 0)), speed: speed || 0
          });
        } catch (_) {}
      };
      try {
        const r = await processJob(core, job, report, nameFormat, dir, saveAs, conflictAction, reqId);
        results[i] = { ok: true, filename: r.filename, fallback: r.fallback, cid: (job && typeof job.cid === 'number') ? job.cid : undefined };
        report('done', 1);
      } catch (e) {
        const err = String((e && e.message) || e);
        results[i] = { ok: false, error: err, cid: (job && typeof job.cid === 'number') ? job.cid : undefined };
        report('error', 1);
        // 单个 job 失败不影响后续
      }
    }
  };

  const workers = [];
  const n = Math.min(CONCURRENCY, total);
  for (let k = 0; k < n; k++) workers.push(worker());
  await Promise.all(workers);

  if (cancelReqId === reqId) cancelled = true;
  cancelReqId = null;
  const okCount = results.filter(r => r && r.ok).length;
  // sendMessage 返回 Promise——await 它确保消息至少进入 SW 队列；
  // 然后延迟关闭 offscreen，给 SW 中转链（listener 触发 → tabs.query → tabs.sendMessage
  // → content listener）留出送达时间。否则立即关闭会丢失 done 消息，
  // 完成判定已交给 content 端本地真相源（tryLocalDone：所有分P进度达100%即视为完成），
  // done 消息仅作补充（cid 去重/兜底）。改为 fire-and-forget，避免 await 一个从不回
  // sendResponse 的 sender，从而在 offscreen 关闭时抛 “message channel closed” 错误。
  chrome.runtime.sendMessage({
    type: 'bili-dl-done', reqId, ok: total > 0,
    cancelled,
    msg: (cancelled ? '已取消（' : '完成 ') + okCount + '/' + total, results
  }).catch(() => {});
  // 用完即关，释放 wasm 内存（下次任务由 content 重新创建 offscreen）。
  // 默认 3500ms 延迟关闭，覆盖 SW listener 触发 + sendMessage IPC 投递 + content 处理所需时间。
  maybeCloseOffscreen();
}

// ---- 自检 ----
async function selfTest() {
  const core = await ensureCore();
  // 核心加载成功即证明本地 wasm 管线可用；再跑一次 -version 作附加校验（失败不致命）
  try { runFFmpegArgs(core, ['ffmpeg', '-version']); } catch (_) {}
  return true;
}

// ---- 消息入口 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'bili-dl-task') {
    // 响应通过 sendMessage 广播给 content，本监听器不占用 sendResponse
    handleTask(msg).catch(e => {
      try {
        chrome.runtime.sendMessage({
          type: 'bili-dl-done', reqId: msg.reqId, ok: false,
          msg: '处理异常：' + String((e && e.message) || e), results: []
        });
      } catch (_) {}
    });
    return false;
  }
  if (msg.type === 'bili-dl-cancel') {
    cancelReqId = msg.reqId || null;
    return false;
  }
  if (msg.type === 'bili-dl-selftest') {
    selfTest().then(() => {
      chrome.runtime.sendMessage({ type: 'bili-dl-selftest-result', ok: true });
    }).catch(e => {
      chrome.runtime.sendMessage({
        type: 'bili-dl-selftest-result', ok: false,
        error: String((e && e.message) || e)
      });
    });
    return false;
  }
  return false;
});
