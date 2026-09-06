/* Bilibili 下载器 — 后台 Service Worker
 * 职责：①WBI 签名 + playurl 取流接口 + 取流兜底；
 *      ②中转 Offscreen→Content 进度/完成消息（content 不在扩展页面广播范围内）；
 *      ③中转 Offscreen→落盘（chrome.downloads 在 offscreen 上下文不可用，
 *        offscreen 用 transferable ArrayBuffer 经长连接把 Uint8Array 转给 SW 落盘）。
 * 媒体分片下载与 ffmpeg 合并/转码在 Offscreen Document 内完成（host_permissions 让 fetch 可读）。
 * 关键点：通过 declarativeNetRequest 动态规则为 bilivideo/hdslb 注入
 *         Referer=https://www.bilibili.com/，绕过 CDN 防盗链。
 */

const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

function md5(s) {
  function add32(a, b) { return (a + b) & 0xffffffff; }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function rhex(n) { let s = '', hex = '0123456789abcdef'; for (let j = 0; j < 4; j++) s += hex[(n >> (j * 8 + 4)) & 0x0F] + hex[(n >> (j * 8)) & 0x0F]; return s; }
  const utf8 = unescape(encodeURIComponent(s));
  const state = [1732584193, -271733879, -1732584194, 271733878];
  const tmp = new Array(16);
  let i;
  for (i = 64; i <= utf8.length; i += 64) {
    for (let j = 0; j < 64; j += 4) tmp[j >> 2] = utf8.charCodeAt(i - 64 + j) | (utf8.charCodeAt(i - 63 + j) << 8) | (utf8.charCodeAt(i - 62 + j) << 16) | (utf8.charCodeAt(i - 61 + j) << 24);
    md5cycle(state, tmp);
  }
  const rem = (i - 64) - utf8.length;
  for (let j = 0; j < rem; j++) tmp[j >> 2] = utf8.charCodeAt(utf8.length + j) | ((utf8.charCodeAt(utf8.length + j + 1) || 0) << 8) | ((utf8.charCodeAt(utf8.length + j + 2) || 0) << 16) | ((utf8.charCodeAt(utf8.length + j + 3) || 0) << 24);
  tmp[rem >> 2] |= 0x80 << (rem % 4 << 3);
  if (rem > 55) { md5cycle(state, tmp); for (let j = 0; j < 16; j++) tmp[j] = 0; }
  tmp[14] = utf8.length * 8;
  md5cycle(state, tmp);
  return rhex(state[0]) + rhex(state[1]) + rhex(state[2]) + rhex(state[3]);
}

function getMixinKey(orig) { return MIXIN_KEY_ENC_TAB.map(i => orig[i] || '').join('').slice(0, 32); }

async function getWbiKeys() {
  const cached = await chrome.storage.local.get(['wbi_img', 'wbi_sub', 'wbi_ts']);
  if (cached.wbi_img && (Date.now() - (cached.wbi_ts || 0) < 10 * 60 * 1000)) return { img: cached.wbi_img, sub: cached.wbi_sub };
  const nav = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' }).then(r => r.json());
  const imgUrl = nav?.data?.wbi_img?.img_url, subUrl = nav?.data?.wbi_img?.sub_url;
  if (!imgUrl || !subUrl) throw new Error('获取 WBI 密钥失败（可能需要登录）');
  const img = imgUrl.split('/').pop().split('.')[0], sub = subUrl.split('/').pop().split('.')[0];
  await chrome.storage.local.set({ wbi_img: img, wbi_sub: sub, wbi_ts: Date.now() });
  return { img, sub };
}

function signWbi(params, imgKey, subKey) {
  const mixin = getMixinKey(imgKey + subKey);
  const params2 = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
  const keys = Object.keys(params2).sort();
  const query = keys.map(k => {
    let v = params2[k];
    if (typeof v === 'string') v = v.replace(/[!'()*]/g, '');
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }).join('&');
  return Object.assign({}, params2, { w_rid: md5(query + mixin) });
}

async function getPlayUrl(bvid, cid, qn = 80) {
  const { img, sub } = await getWbiKeys();
  const params = { bvid, cid, qn, fnval: 16, fnver: 0, fourk: 1, platform: 'html5' };
  const signed = signWbi(params, img, sub);
  const qs = new URLSearchParams(signed).toString();
  const resp = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${qs}`, { credentials: 'include' }).then(r => r.json());
  if (resp.code !== 0) throw new Error('playurl 失败：' + (resp.message || resp.code));
  return resp.data;
}

// 通用 WBI 签名请求（供 content script 在页面 CORS 失败时兜底调用）
async function wbiFetch(endpoint, params) {
  const { img, sub } = await getWbiKeys();
  const signed = signWbi(params, img, sub);
  const qs = new URLSearchParams(signed).toString();
  const resp = await fetch(`https://api.bilibili.com${endpoint}?${qs}`, { credentials: 'include' }).then(r => r.json());
  if (resp.code !== 0) throw new Error('API 失败：' + (resp.message || resp.code));
  return resp.data;
}

async function downloadArrayBuffer(url) {
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error('下载失败 HTTP ' + resp.status);
  return await resp.arrayBuffer();
}

// 安装时注册 Referer 注入规则（绕过 B 站 CDN 防盗链）+ 创建 offscreen 文档
const RULE_ID = 90001;
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }]
        },
        condition: {
          resourceTypes: ['media', 'xmlhttprequest', 'other'],
          regexFilter: 'bilivideo\\.com|hdslb\\.com'  // 仅对 B 站视频 CDN 注入 Referer
        }
      }]
    });
  } catch (e) { console.warn('[bili-dl] DNR 规则注册失败', e); }
  try { await ensureOffscreen(); } catch (e) { console.warn('[bili-dl] offscreen 创建失败', e); }
});

// 缓存 B 站 tab 列表 3 秒，避免 SW 每次中转都并发触发 chrome.tabs.query（callback 顺序无保证，
// 是上次「done 后状态仍是『保存中』」的乱序源头之一）
let biliTabsCache = null;
let biliTabsCacheTS = 0;
const BILI_TABS_TTL = 3000;
async function getBiliTabs() {
  const now = Date.now();
  if (biliTabsCache && (now - biliTabsCacheTS < BILI_TABS_TTL)) return biliTabsCache;
  biliTabsCache = await new Promise(r =>
    chrome.tabs.query({ url: ['*://*.bilibili.com/*', '*://*.b23.tv/*'] }, r));
  biliTabsCacheTS = now;
  return biliTabsCache;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---- 中转：Offscreen → 视频页 content script ----
  // offscreen 用 chrome.runtime.sendMessage 上报的进度/完成消息是广播给扩展页面（含 SW），
  // 不会自动送达 content script（content 不是扩展页面）。此处由 SW 代为转投到 B 站标签页。
  // 关键：listener 内对所有中转消息一视同仁，按 FIFO 进入 SW，火与忘给 content。
  if (msg.type === 'bili-dl-progress' || msg.type === 'bili-dl-done' || msg.type === 'bili-dl-selftest-result') {
    (async () => {
      try {
        const tabs = await getBiliTabs();
        for (const t of tabs || []) {
          try { chrome.tabs.sendMessage(t.id, msg); } catch (_) {}
        }
      } catch (_) {}
      try { sendResponse({}); } catch (_) {}
    })();
    return true; // 异步：保持 SW 唤醒直到 relay 投递完成
  }
  if (msg.type === 'read-initial-state') {
    // content 无 chrome.tabs/scripting 权限，由 SW 代为在 MAIN world 读页面 __INITIAL_STATE__
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ state: null }); return true; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const st = window.__INITIAL_STATE__ || {};
          const vd = st.videoData || {};
          const pages = (st.videoData && st.videoData.pages) || [];
          const pageList = pages.map(p => ({ cid: p.cid, page: p.page, part: (p.part || ('P' + p.page)) }));
          const subtitle = (vd.subtitle && vd.subtitle.list) ? { list: vd.subtitle.list } : null;
          return {
            bvid: vd.bvid || st.bvid || null,
            cid: vd.cid || (pages[0] && pages[0].cid) || null,
            title: vd.title || document.title || 'bilibili',
            pic: vd.pic || st.pic || null,
            subtitle,
            pages: pageList
          };
        } catch (e) { return null; }
      }
    }).then(res => sendResponse({ state: (res && res[0] && res[0].result) || null }))
      .catch(() => sendResponse({ state: null }));
    return true;
  }
  if (msg.type === 'wbi') {
    wbiFetch(msg.endpoint, msg.params || {})
      .then(d => sendResponse({ ok: true, data: d }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // 异步
  }
  if (msg.type === 'playurl') {
    getPlayUrl(msg.bvid, msg.cid, msg.qn || 80)
      .then(d => sendResponse({ ok: true, data: d }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // 异步
  }
  if (msg.type === 'download') {
    downloadArrayBuffer(msg.url)
      .then(buf => sendResponse({ ok: true, buffer: buf }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'ensure-offscreen') {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // 异步
  }
  // 落盘消息现由 onConnect('bili-dl-save') 长连接处理（见下方 chrome.runtime.onConnect），
  // 不再走 onMessage 分块 relay（分块经 SW 中转 content 在批量/并发或 SW 重启时易丢块，
  // 导致文件错位损坏——这正是 v1.1.x「能保存但打不开」的根因）。
});

// ---------- 落盘：offscreen → SW 长连接（transferable ArrayBuffer 分块）→ SW 落盘 ----------
// 沿用 v1.0.0 的可靠方案：offscreen 在合并完每个文件后，开一条 chrome.runtime.connect('bili-dl-save')
// 长连接，把合并好的字节按 8MB 切块、用 transferable ArrayBuffer 直接传给 SW（不经过 content，
// 绝不会因多跳中转丢块）。SW 收齐后：
//   • 默认（非静默）：直接 chrome.downloads.download（字节绝对精确，v1.0.0 原路径，保证能播）；
//   • 静默：字节写入 IndexedDB 中转给 content，由 content 走 File System Access 直写目录（不弹下载栏）。
// 仅当 content 未注入（极少）时，SW 才用 data URL 直接下载兜底。
// 索引数据库辅助（与 content 共享同源 DB bili-dl-fs / store kv，键前缀 bili-save-）
function idbOpenSave() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('bili-dl-fs', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (_) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSetSave(k, v) {
  const db = await idbOpenSave();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGetSave(k) {
  const db = await idbOpenSave();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const rq = tx.objectStore('kv').get(k);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDeleteSave(k) {
  const db = await idbOpenSave();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
// 把 Uint8Array 转 base64 data URL（分块避免 btoa 栈溢出），用于 SW 直接下载兜底
function bytesToDataUrl(buf) {
  const u = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  const STEP = 0x8000;
  let binary = '';
  for (let i = 0; i < u.length; i += STEP) binary += String.fromCharCode.apply(null, u.subarray(i, i + STEP));
  return 'data:application/octet-stream;base64,' + btoa(binary);
}
async function downloadBytesViaApi(bytes, meta, port) {
  const tryOnce = async (filename) => {
    const url = bytesToDataUrl(bytes);
    await chrome.downloads.download({ url, filename, saveAs: meta.saveAs, conflictAction: meta.conflictAction });
    return filename;
  };
  try {
    const fn = await tryOnce(meta.filename);
    port.postMessage({ type: 'done', filename: fn });
  } catch (e) {
    const base = meta.filename.split('/').pop();
    if (base !== meta.filename) {
      try { const fn = await tryOnce(base); port.postMessage({ type: 'done', filename: fn, fallback: '子目录不存在，已落默认下载目录' }); }
      catch (e2) { port.postMessage({ type: 'error', error: String(e2.message || e2) }); }
    } else {
      port.postMessage({ type: 'error', error: String(e.message || e) });
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bili-dl-save') return;
  let state = null;
  port.onDisconnect.addListener(() => { state = null; });
  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === 'init') {
        state = {
          fileId: msg.fileId,
          filename: msg.filename,
          saveAs: (msg.saveAs === true),
          conflictAction: (msg.conflictAction === 'overwrite' || msg.conflictAction === 'prompt' || msg.conflictAction === 'uniquify') ? msg.conflictAction : 'uniquify',
          silent: (msg.silent === true),
          totalSize: msg.totalSize || 0,
          cid: (typeof msg.cid === "number") ? msg.cid : null,
          reqId: msg.reqId || null,
          chunks: []
        };
        port.postMessage({ type: 'ready' });
      } else if (msg.type === 'chunk' && state) {
        state.chunks.push(new Uint8Array(msg.buffer));
      } else if (msg.type === 'final' && state) {
        const out = new Uint8Array(state.totalSize);
        let pos = 0;
        for (const c of state.chunks) { out.set(c, pos); pos += c.length; }
        const meta = { filename: state.filename, saveAs: state.saveAs, conflictAction: state.conflictAction, reqId: state.reqId };
        // 统一写 IndexedDB 中转给 content（content 同时具备 FS API 静默直写与下载 API 兜底能力）；
        // 仅当无 bili 标签页（content 未注入）时，SW 才直接 data URL 下载兜底。
        await idbSetSave('bili-save-' + state.fileId, out);
        const tabs = await getBiliTabs();
        const relay = {
          type: 'bili-dl-write', fileId: state.fileId, filename: state.filename,
          conflictAction: state.conflictAction, reqId: state.reqId, silent: state.silent, cid: state.cid
        };
        let delivered = 0;
        for (const t of tabs || []) { try { await chrome.tabs.sendMessage(t.id, relay); delivered++; } catch (_) {} }
        if (delivered === 0) {
          await downloadBytesViaApi(out, meta, port);
        } else {
          port.postMessage({ type: 'done', filename: state.filename });
        }
        state = null;
      }
    } catch (e) {
      try { port.postMessage({ type: 'error', error: String(e.message || e) }); } catch (_) {}
      state = null;
    }
  });
});

// ---------- Offscreen Document（主线程承载 ffmpeg.wasm） ----------
// ffmpeg 合并/转码放到扩展同源 Offscreen Document 的「主线程」执行（Chrome 109+）。
// offscreen.html 用 <script> 注入 ffmpeg-core.js（顶部 var createFFmpegCore 已挂全局），
// 由 offscreen.js 直接 ccall('main') 驱动。整条流水线（取流→ffmpeg 合并/转码→落盘），
  // 取流/合并在 offscreen 内完成；落盘由 offscreen 经 chrome.runtime.connect('bili-dl-save')
  // 长连接把字节用 transferable ArrayBuffer 分块发来，SW 收齐后在「静默模式」写入 IndexedDB
  // 中转给 content 走 File System Access 直写；非静默则 SW 直接 chrome.downloads.download。
  // 字节从不过 content 重组，彻底规避 v1.1.x「分块 relay 到 content 丢块→错位损坏」问题。
async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('当前 Chrome 版本不支持 offscreen（需 ≥109）');
  try {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) return;
  } catch (_) { /* 忽略探测错误 */ }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: '在扩展同源文档内加载 ffmpeg.wasm，合并/转码 B 站 DASH 音视频流并将结果写入下载文件夹'
  });
}

// ---- 落盘说明：offscreen 经 port 长连接('bili-dl-save') 把字节发来，见下方 onConnect 处理；
// onMessage 中不再保留 'bili-dl-save' 分支（已被 port 长连接取代）。 ----
