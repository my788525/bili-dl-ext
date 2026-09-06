/* Bilibili 视频下载器（自用）— content script
 * 流程：注入按钮 -> 读取页面 __INITIAL_STATE__ 拿 bvid/cid/分P列表 ->
 *        取流(页面优先, 失败走后台SW) -> 并行下载音视频 m4s ->
 *        ffmpeg.wasm 合并 mp4 / 仅音频转 m4a|mp3 -> 保存。
 * 支持单 P、仅音频、以及多 P 合集批量下载。
 * 媒体下载优先用页面上下文 fetch（自动带 Referer），遇 CORS 失败自动回退后台 SW
 * （host_permissions 绕过 CORS；后台 DNR 规则统一注入 Referer）。
 */

(() => {
  'use strict';

  // ---------- 常量 ----------
  const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
  const QN_LABEL = {
    127: '8K 超清', 126: '杜比视界', 125: 'HDR 真彩', 120: '4K 超清',
    116: '1080P60 高帧率', 112: '1080P+ 高码率', 80: '1080P 高清',
    74: '720P60 高帧率', 64: '720P 高清', 32: '480P 清晰', 16: '360P 流畅'
  };

  // ---------- MD5（WBI 签名兜底用） ----------
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

  const $ = (sel, root = document) => root.querySelector(sel);
  function safeName(s) { return (s || 'bilibili').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 80).trim() || 'bilibili'; }
  function getMixinKey(orig) { return MIXIN_KEY_ENC_TAB.map(i => orig[i] || '').join('').slice(0, 32); }

  // ---------- 后台 SW 通信（CORS 兜底） ----------
  function swCall(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res && res.ok) resolve(res.data !== undefined ? res.data : res.buffer);
        else reject(new Error((res && res.error) || 'SW 调用失败'));
      });
    });
  }
  async function swPlayUrl(bvid, cid, qn) { return swCall({ type: 'playurl', bvid, cid, qn }); }
  async function swDownload(url) { return swCall({ type: 'download', url }); }
  // 注：swDownload 现仅作兜底保留；媒体分片的实际下载已移至 Offscreen 文档内完成。

  // ---------- WBI 签名（页面兜底） ----------
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
  async function getPlayUrlLocal(bvid, cid, qn = 80) {
    const { img, sub } = await getWbiKeys();
    const signed = signWbi({ bvid, cid, qn, fnval: 16, fnver: 0, fourk: 1, platform: 'html5' }, img, sub);
    const qs = new URLSearchParams(signed).toString();
    const resp = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${qs}`, { credentials: 'include' }).then(r => r.json());
    if (resp.code !== 0) throw new Error('playurl 失败：' + (resp.message || resp.code));
    return resp.data;
  }
  // 取流：页面优先，失败回退后台 SW
  async function getPlayUrl(bvid, cid, qn) {
    try { return await getPlayUrlLocal(bvid, cid, qn); }
    catch (e) { return await swPlayUrl(bvid, cid, qn); }
  }

  // ---------- 通用 WBI 签名请求（页面优先 + SW 兜底） ----------
  async function wbiFetch(endpoint, params) {
    try {
      const { img, sub } = await getWbiKeys();
      const signed = signWbi(params, img, sub);
      const qs = new URLSearchParams(signed).toString();
      const resp = await fetch(`https://api.bilibili.com${endpoint}?${qs}`, { credentials: 'include' }).then(r => r.json());
      if (resp.code !== 0) throw new Error(resp.message || String(resp.code));
      return resp.data;
    } catch (e) {
      return swCall({ type: 'wbi', endpoint, params }); // 后台 SW 兜底
    }
  }

  // 兜底：从 bvid 调 view 接口拿 cid / 分P列表 / 标题（不依赖页面 __INITIAL_STATE__）
  async function getViewInfo(bvid) {
    const data = await wbiFetch('/x/web-interface/wbi/view', { bvid });
    const pages = (data.pages || []).map(p => ({ cid: p.cid, page: p.page, part: (p.part || ('P' + p.page)) }));
    const cid = data.cid || (pages[0] && pages[0].cid) || null;
    return {
      bvid: data.bvid || bvid,
      cid,
      title: data.title || document.title || 'bilibili',
      pages: pages.length ? pages : (cid ? [{ cid, page: 1, part: '' }] : []),
      pic: (data.pic || null),
      subtitle: data.subtitle || null
    };
  }

  // ---------- 读取页面状态（MV3 正道：scripting.executeScript 在 MAIN world 读取 __INITIAL_STATE__） ----------
  // 说明：content script 运行在 isolated world，无法直接读取页面的 window.__INITIAL_STATE__。
  // 旧方案用 document.createElement('script') + textContent 注入「内联脚本」做桥接，但 MV3 扩展
  // CSP（`script-src 'self'`）禁止 inline script，会在插件管理里报 CSP 违规。
  // 改用 chrome.scripting.executeScript 在 MAIN world 执行纯函数读取：既合规（无内联脚本），又能直接拿页面状态。
  // 委托 background 在 MAIN world 读页面 __INITIAL_STATE__（content 无 chrome.tabs/scripting 权限）
  async function readInitialState() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'read-initial-state' }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve((resp && resp.state) || null);
        });
      } catch (_) { resolve(null); }
    });
  }
  async function getState() {
    // 优先：在 MAIN world 读取页面 __INITIAL_STATE__（MV3 合规，无内联脚本）
    const st = await readInitialState();
    if (st && st.bvid && st.cid) return st;
    // 兜底：从 URL 取 bvid，再调 view 接口拿 cid / pages / title
    const m = location.href.match(/BV[0-9A-Za-z]+/i);
    const urlBvid = m ? m[0] : null;
    if (urlBvid) {
      try {
        const info = await getViewInfo(urlBvid);
        if (info && info.cid) return info;
      } catch (e) { console.warn('[bili-dl] view 兜底失败', e); return { error: 'view 接口也失败：' + String(e.message || e) }; }
    }
    return { error: '页面未提供 bvid/cid，且 URL 中未找到 BV 号（请确认在 B 站视频播放页）' };
  }

  // ---------- 任务分发：content 仅转发配置，完整流水线在 Offscreen 内完成 ----------
  // Chrome 的 chrome.runtime.sendMessage 走 JSON 序列化、有 64MiB 上限，且无法传二进制，
  // 故设计上：content 把「任务配置（m4s URL / 标题 / 选项）」发给 offscreen，offscreen 内部
  // 取流 -> ffmpeg 合并/转码 -> chrome.downloads.download 落盘；进度/结果用文本消息回传。
  let ui = { status: null, bar: null };
  let currentReqId = null;
  let listenerReady = false;
  // 任务已完成（bili-dl-done 已到）—— 之后到达的 bili-dl-progress 不再写 status/bar，
  // 避免 SW 中转的 chrome.tabs.query 并发回调乱序导致「done 之后又收到 phase=save 的
  // progress 把状态覆盖回『保存中』」。下一次 dispatchTask 调用时重置为 false。
  let doneReceived = false;

  // 批量下载的实时状态（供进度消息更新分P行与顶部计数）
  let rowEls = new Map();          // cid -> { row, mark, cb }（多P列表行的稳定引用）
  let currentBatchMeta = null;     // { reqId, byIndex:[{cid,label}] }
  let batchRunning = false;        // 是否有批量任务在运行
  let batchQn = 0;                 // 批量清晰度选择：0=最高可用
  const completedIdx = new Set();  // 已完成的 jobIndex（防止 progress 重复计数）
  let batchDone = 0, batchFail = 0; // 已完成 / 失败计数
  // 持久化键
  const AUDONLY_KEY = 'bili_dl_audonly';
  const AUDFMT_KEY = 'bili_dl_audfmt';
  let lastAudonly = false; // 镜像 buildUI 内的 audonly 勾选，供模块级 resetBatchUI 使用

  // 已下载分P 去重（持久化）：记录已成功下载的 cid，重复点「下载选中」时自动跳过
  const DEDUP_KEY = 'bili_dl_downloaded';
  let downloadedCids = new Set();
  chrome.storage.local.get(DEDUP_KEY, (s) => {
    if (s && Array.isArray(s[DEDUP_KEY])) downloadedCids = new Set(s[DEDUP_KEY]);
  });
  // 失败分P 的错误详情（供「详情」展开 + 「重试」按钮使用），key=page.cid
  const failErrors = new Map();
  // 文件名冲突策略（uniquify/overwrite/prompt）
  function getConflictAction() {
    const el = document.getElementById('bili-dl-conflict');
    const v = el ? el.value : 'uniquify';
    return (v === 'overwrite' || v === 'prompt' || v === 'uniquify') ? v : 'uniquify';
  }
  // 字节速率格式化（offscreen 上报的 speed 为 bytes/s）
  function formatSpeed(bytesPerSec) {
    const b = Number(bytesPerSec) || 0;
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB/s';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB/s';
    return b.toFixed(0) + ' B/s';
  }

  // 持久化已下载 cid 集合（去重用）
  function persistDownloaded() {
    try { chrome.storage.local.set({ [DEDUP_KEY]: Array.from(downloadedCids) }); } catch (_) {}
  }

  // 字幕 JSON -> ASS 文本转换（B站字幕为内部 JSON 格式，转成通用 ASS 便于播放器加载）
  function assTime(sec) {
    sec = Math.max(0, sec || 0);
    const h = Math.floor(sec / 3600); sec -= h * 3600;
    const m = Math.floor(sec / 60); sec -= m * 60;
    const s = sec.toFixed(2);
    return `${h}:${String(m).padStart(2, '0')}:${s.padStart(5, '0')}`;
  }
  function jsonToAss(json) {
    const body = Array.isArray(json && json.Body) ? json.Body : [];
    const fs = (json && json.font_size) || 25;
    const lines = [
      '[Script Info]', 'ScriptType: v4.00', 'PlayResX: 1920', 'PlayResY: 1080', '',
      '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,Microsoft YaHei,${fs},&H00FFFFFF,&H00000000,0,0,2,20,20,40,1`, '',
      '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Text'
    ];
    for (const s of body) {
      const text = String(s.content || '').replace(/\r?\n/g, '\\N');
      lines.push(`Dialogue: 0,${assTime(s.from)},${assTime(s.to)},Default,,0,0,0,${text}`);
    }
    return lines.join('\n');
  }

  function setStatus(text) { if (ui.status) ui.status.textContent = text; }
  function setBar(pct) { if (ui.bar) ui.bar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%'; }

  // 文件名格式 & 下载位置 的持久化键
  const FMT_KEY = 'bili_dl_namefmt';
  const DIR_KEY = 'bili_dl_dir';
  const SAVEAS_KEY = 'bili_dl_saveas';

  // 清洗下载子目录（与 offscreen.sanitizeDir 规则一致：相对路径、防跳出、去非法字符、限长）
  function sanitizeDirInput(d) {
    if (!d) return '';
    return String(d)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.{2,}/g, '')
      .replace(/[<>:"|?*\0]/g, '_')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .slice(0, 80);
  }
  // 模块级读取下载位置配置（供 dispatchTask 等模块作用域函数使用，直接查 DOM，避免被 buildUI 局部 const 遮蔽）
  function getDir() { const el = document.getElementById('bili-dl-dir'); return el ? sanitizeDirInput(el.value) : ''; }
  function getSaveAs() { const el = document.getElementById('bili-dl-saveas'); return el ? el.checked : false; }
  function getNameFormat() {
    const pick = (id) => { const el = document.getElementById(id); return el ? el.checked : true; };
    return {
      title: pick('bili-dl-fmt-title'),
      pn: pick('bili-dl-fmt-pn'),
      part: pick('bili-dl-fmt-part'),
      qn: pick('bili-dl-fmt-qn')
    };
  }

  // 下载完成 Toast：从右下角平滑滑入并自动淡出（面板关着也可见）
  function showToast(title, body, isError) {
    let t = document.getElementById('bili-dl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'bili-dl-toast'; document.body.appendChild(t); }
    t.className = isError ? 'is-error' : '';
    t.innerHTML = `<div class="t-title">${title}</div><div class="t-body">${body}</div>`;
    void t.offsetWidth; // 触发重排，确保过渡动画生效
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 4200);
  }

  // 系统通知（面板关闭也可见，比 Toast 更可靠）；失败时回退到页面内 Toast
  const NOTIFY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  function biliNotify(title, body, isError) {
    try {
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create('bili-dl-notify', {
          type: 'basic', iconUrl: NOTIFY_ICON, title, message: body, priority: 2
        });
      }
    } catch (_) {}
    showToast(title, body, isError); // 双重保险
  }

  async function ensureOffscreen() {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ensure-offscreen' }, () => resolve());
    });
    await new Promise(r => setTimeout(r, 400)); // 等待文档创建完成
  }

  // 把 job 列表交给 offscreen 处理（offscreen 内完成取流+合并+落盘）
  async function dispatchTask(jobs, nameFormat, dir, saveAs, conflictAction) {
    if (!jobs || !jobs.length) { setStatus('没有可下载的流'); return; }
    currentReqId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    doneReceived = false; // 新一轮：清空 done 守卫
    // 构建批量元数据：jobIndex -> cid/label，供进度消息定位到具体分P行
    currentBatchMeta = {
      reqId: currentReqId,
      byIndex: jobs.map(j => ({ cid: (j && typeof j.cid === 'number') ? j.cid : null, label: (j && j._label) || '' }))
    };
    completedIdx.clear(); batchDone = 0; batchFail = 0;
    try { await ensureOffscreen(); }
    catch (e) { setStatus('创建 offscreen 失败：' + (e.message || e)); return; }
    chrome.runtime.sendMessage({
      type: 'bili-dl-task', reqId: currentReqId, jobs,
      nameFormat: nameFormat || getNameFormat(),
      dir: (typeof dir === 'string') ? dir : getDir(),
      saveAs: (typeof saveAs === 'boolean') ? saveAs : getSaveAs(),
      conflictAction: (typeof conflictAction === 'string') ? conflictAction : getConflictAction()
    });
    armBatchTimeout(); // 兜底：5 分钟未收到 done 时强制复位
  }

  function runSelfTest() {
    currentReqId = 'selftest-' + Date.now().toString(36);
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: 'bili-dl-selftest' });
      setStatus('正在加载 ffmpeg wasm（首次约 24MB，请稍候）…');
      setBar(0);
    }).catch(e => setStatus('创建 offscreen 失败：' + (e.message || e)));
  }

  // 逐P状态标记：state ∈ pending|running|ok|fail；pct 取值 [0,1]，控制行内 .row-bg 的宽度
  // —— 各分P 各自推进、各自判完成，互不阻塞；状态转换在 CSS 中自动联动 row-bg 与对勾
  function markRow(cid, state, pct) {
    const r = rowEls.get(cid);
    if (!r || !r.mark) return;
    const row = r.row;
    // 行内进度覆盖层：每行一张绝对定位的 <i class="row-bg">，宽度由 state/pct 控制
    let bg = row.querySelector(':scope > .row-bg');
    if (!bg) { bg = document.createElement('i'); bg.className = 'row-bg'; row.insertBefore(bg, row.firstChild); }
    // 行 class 收敛（不在 ok 时残留 running、fail 时残留 ok）
    row.classList.toggle('is-ok', state === 'ok');
    row.classList.toggle('is-fail', state === 'fail');
    row.classList.toggle('is-running', state === 'running' || state === 'pending');
    r.mark.textContent = state === 'ok' ? '✓' : state === 'fail' ? '✗' : state === 'running' ? '⏳' : '';
    if (state === 'ok') {
      // 完成：CSS 内 is-ok 强制 .row-bg width:100%（深绿实色 + ✓）；这里再次保证即使响应式被裁切也行
      bg.style.width = '100%';
    } else if (state === 'fail') {
      // 失败：清零宽度，仅靠行 class 浅红与 ✗；CSS 内 is-fail 会强制红覆盖
      bg.style.width = '0%';
    } else if (state === 'running' && typeof pct === 'number') {
      // 进行中：按 0..100% 横向填充浅绿色
      const w = Math.round(Math.max(0, Math.min(1, pct)) * 100);
      bg.style.width = w + '%';
    } else {
      bg.style.width = '0%';
    }
  }
  function updateBatchHeader() {
    const h = document.getElementById('bili-dl-multi-head-txt');
    if (!h) return;
    const total = currentBatchMeta ? currentBatchMeta.byIndex.length : 0;
    // 顶部只显示「下载中… 已完成 X/Y」——不再带百分比与速度（行内进度自行展示）
    h.textContent = batchRunning
      ? `下载中… 已完成 ${batchDone + batchFail}/${total}`
      : '全选 / 全不选';
  }
  function onBatchProgress(msg) {
    if (!currentBatchMeta || msg.reqId !== currentBatchMeta.reqId) return;
    const meta = currentBatchMeta.byIndex[msg.jobIndex];
    if (!meta) return;
    if (msg.phase === 'done') {
      // 【本地真相源】fetch 100% 与 done 通常都到达；以 Set 幂等防止重复计数。
      // markRow 写 is-ok → 整行变深绿实色 + 白色 ✓；不再依赖任何集中状态栏。
      if (!completedIdx.has(msg.jobIndex)) { completedIdx.add(msg.jobIndex); batchDone++; }
      if (meta.cid != null) markRow(meta.cid, 'ok');
    } else if (msg.phase === 'error') {
      if (!completedIdx.has(msg.jobIndex)) { completedIdx.add(msg.jobIndex); batchFail++; }
      if (meta.cid != null) markRow(meta.cid, 'fail');
    } else if (msg.phase === 'fetch' && (msg.progress || 0) >= 1) {
      // 【100% 立即收尾】fetch 阶段就达到 100% —— 立即视为该分P 完成（深绿实色 + ✓）
      if (!completedIdx.has(msg.jobIndex)) { completedIdx.add(msg.jobIndex); batchDone++; }
      if (meta.cid != null) markRow(meta.cid, 'ok');
    } else if (msg.phase === 'fetch') {
      // 进行中：更新该分P 行的进度覆盖层宽度；其他行完全不受影响
      if (meta.cid != null) markRow(meta.cid, 'running', msg.progress);
    }
    updateBatchHeader();
    // 【本地真相源】当本批所有 jobs 都已通过 progress 标记为完成（含成功与失败）时，
    // 立即主动复位 UI + 写完成文案 + Toast——即便 done 消息被 SW 中转链丢失，UI 也不会卡住。
    if (batchRunning && currentBatchMeta) {
      const total = currentBatchMeta.byIndex.length;
      if (completedIdx.size >= total) tryLocalDone();
    }
  }
  // 本地真相源触发条件：每个分P 进度达到 100%（或出错）即视为完成
  // —— 此时 content 立即复位按钮与状态栏，不依赖 bili-dl-done 消息
  function tryLocalDone() {
    if (!currentBatchMeta) return;
    const total = currentBatchMeta.byIndex.length;
    const okCount = batchDone;
    const failCount = batchFail;
    onBatchDone(); // batchRunning=false
    // 记录成功 cid（去重）—— best-effort，done 到达时仍会覆盖/补全
    currentBatchMeta.byIndex.forEach((m) => {
      if (m.cid != null) downloadedCids.add(m.cid);
    });
    persistDownloaded();
    setBar(100);
    resetBatchUI();
    updateBatchHeader();
    // 批量完成后自动取消勾选（本批分P 移出选中集合），便于下次直接下载无需手动去勾
    uncheckBatchRows();
    // 重渲染列表：成功行显示去重标记
    if (ctx) renderList();
    // 文案：与 done 处理器一致但用本地数据
    if (total === 1) {
      const tag = okCount === 1 ? '✅ 已保存到下载文件夹' : '❌ 下载失败';
      setStatus(tag);
      biliNotify(okCount ? '🎉 下载完成' : '😢 下载失败', okCount ? '文件已保存到下载文件夹' : '未知错误', okCount === 0);
    } else if (failCount === 0) {
      setStatus(`✅ 全部完成：${okCount} 个文件已保存到下载文件夹`);
      biliNotify('🎉 下载完成', `共 ${okCount} 个文件已保存到下载文件夹`, false);
    } else if (okCount > 0) {
      setStatus(`⚠️ 完成 ${okCount}/${total}（其余失败）`);
      biliNotify('⚠️ 部分完成', `${okCount}/${total} 个成功，其余失败`, true);
    } else {
      setStatus(`😢 全部失败`);
      biliNotify('😢 下载失败', '所有分P均失败', true);
    }
    // 标记本地完成已触发，避免 done 消息到达时重复写
    doneReceived = true;
  }
  function onBatchDone() {
    batchRunning = false;
  }

  function registerMsgListener() {
    if (listenerReady) return; listenerReady = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'bili-dl-progress' && msg.reqId === currentReqId) {
        // 中央状态栏不再实时刷新——各分P 进度完全由各自行内 .row-bg 推进；
        // 中央进度条仅在所有分P 完成时一次性置 100%（在 tryLocalDone 内调用）。
        // 这样避免了「下载中（X/Y） X%」长期显示 + 卡在「99%」等待 done 的问题：
        // 用户看到的反馈就是各分P 行内色块横向填充，单行完成立即变深绿 + ✓，
        // 全部完成时才闪一次底部状态条 + Toast。
        onBatchProgress(msg);
      } else if (msg.type === 'bili-dl-done' && msg.reqId === currentReqId) {
        // 【本地真相源】tryLocalDone() 可能已先行触发（按 progress 自动复位）。
        // 如果已经触发过，done 仅用作 success/fallback 统计补全，不重复写文案。
        const alreadyDone = doneReceived;
        doneReceived = true;
        const results = msg.results || [];
        const okList = results.filter(r => r.ok);
        const failList = results.filter(r => !r.ok);
        const okCount = okList.length;
        const total = results.length;
        // 记录成功 cid（去重用）与失败详情（重试/详情用）
        results.forEach(r => {
          if (r.ok && r.cid != null) downloadedCids.add(r.cid);
          if (!r.ok && r.cid != null) failErrors.set(r.cid, r.error || '未知错误');
        });
        persistDownloaded();
        if (alreadyDone) return; // 本地真相源已处理过，文案 / 按钮 / 通知已发
        setBar(100);
        onBatchDone();
        // 多P：用 done 结果做最终行状态标记（与 byIndex 同序）
        if (currentBatchMeta && currentBatchMeta.reqId === msg.reqId) {
          currentBatchMeta.byIndex.forEach((m, i) => {
            if (m.cid == null) return;
            const res = results[i];
            markRow(m.cid, res && res.ok ? 'ok' : (res ? 'fail' : 'pending'));
          });
          updateBatchHeader();
        }
        resetBatchUI();
        // 批量完成后自动取消勾选（本批分P 移出选中集合）
        uncheckBatchRows();
        // 重渲染列表：成功行显示 ✓、失败行显示「重试 / 详情」、已下载行显示去重标记
        if (ctx) renderList();
        if (total === 0) {
          setStatus('⚠️ 没有可下载的内容');
          return;
        }
        // 统计「子目录下载失败，已落默认下载目录」的兜底数量，用于 toast 提示
        const fallbackCount = okList.filter(r => r.fallback).length;
        const fallbackNote = fallbackCount
          ? `（${fallbackCount} 个因子目录不存在，已落默认下载目录）`
          : '';
        if (okCount === total) {
          if (total === 1) {
            const name = okList[0].filename || '视频';
            setStatus(`✅ ${name} 已保存${fallbackCount ? '到默认下载目录' : '到下载文件夹'}`);
            biliNotify('🎉 下载完成', `${name} 已保存${fallbackCount ? '到默认下载目录（子目录不存在）' : '到下载文件夹'}`, false);
          } else {
            const tip = msg.cancelled ? '（已取消）' : '';
            setStatus(`✅ 全部完成：${okCount} 个文件已保存到下载文件夹 ${tip}${fallbackNote}`);
            biliNotify('🎉 下载完成', `共 ${okCount} 个文件已保存到下载文件夹${tip}${fallbackNote}`, false);
          }
        } else if (okCount > 0) {
          const fails = failList.map(f => f.error || '失败').slice(0, 2).join('；');
          setStatus(`⚠️ 完成 ${okCount}/${total}` + (fails ? ('：' + fails) : '') + fallbackNote);
          biliNotify('⚠️ 部分完成', `${okCount}/${total} 个成功，其余失败（${fails}）${fallbackNote}`, true);
        } else {
          const fails = failList.map(f => f.error || '失败').slice(0, 2).join('；');
          setStatus(`😢 下载失败：` + (fails || '未知错误'));
          biliNotify('😢 下载失败', fails || '未知错误', true);
        }
      } else if (msg.type === 'bili-dl-selftest-result') {
        if (msg.ok) { setStatus('✅ ffmpeg 自检通过（本地 wasm 可用）'); setBar(100); }
        else { setStatus('❌ ffmpeg 自检失败：' + (msg.error || '未知')); }
      }
    });
  }

  // 批量结束后复位：解除勾选禁用、恢复按钮文案、清空运行态
  function resetBatchUI() {
    batchRunning = false;
    rowEls.forEach(r => { if (r.cb) r.cb.disabled = false; });
    const batchBtn = document.getElementById('bili-dl-batch');
    if (batchBtn) {
      const n = (ctx && ctx.selected) ? ctx.selected.size : 0;
      batchBtn.textContent = lastAudonly
        ? `⬇ 下载选中（音频 · ${n} 个）`
        : `⬇ 下载选中（${n} 个）`;
      batchBtn.dataset.mode = 'download';
    }
    if (batchTimeoutTimer) { clearTimeout(batchTimeoutTimer); batchTimeoutTimer = null; }
  }
  // 批量完成后自动取消勾选：把本批参与下载的分P 从选中集合移除并解除 checkbox，
  // 避免「下次下载还得手动去取消勾选」。失败行也一并取消（其「重试」按钮不依赖勾选）。
  function uncheckBatchRows() {
    if (!ctx || !currentBatchMeta) return;
    currentBatchMeta.byIndex.forEach(m => {
      if (m.cid == null) return;
      ctx.selected.delete(m.cid);
      const r = rowEls.get(m.cid);
      if (r && r.cb) { r.cb.checked = false; r.row.classList.remove('cb-disabled'); }
    });
  }
  // 兜底：5 分钟内若仍未收到 bili-dl-done（SW 中转丢失/offscreen 关闭太早等极端情况），
  // 强制复位 UI 避免「卡在 100%」永久不恢复。让用户至少能再次点击下载。
  let batchTimeoutTimer = null;
  function armBatchTimeout() {
    if (batchTimeoutTimer) clearTimeout(batchTimeoutTimer);
    batchTimeoutTimer = setTimeout(() => {
      if (!batchRunning) return;
      batchRunning = false;
      rowEls.forEach(r => { if (r.cb) r.cb.disabled = false; });
      const b = document.getElementById('bili-dl-batch');
      if (b) {
        const n = (ctx && ctx.selected) ? ctx.selected.size : 0;
        b.textContent = lastAudonly ? `⬇ 下载选中（音频 · ${n} 个）` : `⬇ 下载选中（${n} 个）`;
        b.dataset.mode = 'download';
      }
      setStatus('⚠️ 任务已超时未收到完成通知（请检查下载文件夹是否已写入，刷新页面重试）');
      biliNotify('⚠️ 任务超时', '请检查下载文件夹，刷新页面重试', true);
      batchTimeoutTimer = null;
    }, 5 * 60 * 1000);
  }

  // 流类型判别：DASH（分离音视频）优先，durl（已封装合成流）兜底
  function classifyStreams(data) {
    if (data && data.dash && Array.isArray(data.dash.video) && data.dash.video.length) {
      const videos = data.dash.video.slice().sort((a, b) => b.id - a.id);
      const audio = (data.dash.audio || []).slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      return {
        type: 'dash',
        videos,
        audioUrl: audio ? (audio.baseUrl || (audio.backupUrl && audio.backupUrl[0]) || '') : ''
      };
    }
    if (data && Array.isArray(data.durl) && data.durl.length) {
      return { type: 'durl', url: data.durl[0].url };
    }
    return { type: 'none' };
  }

  // ---------- UI ----------
  let ctx = null;

  function buildUI() {
    if (document.getElementById('bili-dl-root')) return;
    const root = document.createElement('div');
    root.id = 'bili-dl-root';
    root.innerHTML = `
      <style>
        #bili-dl-root * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", system-ui, sans-serif; }
        #bili-dl-fab { position: fixed; right: 18px; bottom: 18px; z-index: 999999; background: #fb7299; color: #fff; border: none; border-radius: 22px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: grab; box-shadow: 0 4px 14px rgba(251,114,153,.45); touch-action: none; }
        #bili-dl-fab:active { cursor: grabbing; }
        #bili-dl-fab:hover { background: #fc8bab; }
        #bili-dl-panel { position: fixed; z-index: 999999; width: 320px; background: #fff; border-radius: 12px; padding: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.25); display: none; color: #222; font-size: 13px; max-height: calc(100vh - 88px); flex-direction: column; overflow: hidden; }
        #bili-dl-panel h4 { margin: 0 0 8px; font-size: 14px; color: #fb7299; }
        #bili-dl-panel .title { color:#666; margin-bottom:8px; word-break:break-all; max-height:40px; overflow:hidden; }
        .bili-dl-opts { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
        .bili-dl-opts label { display:flex; align-items:center; gap:4px; cursor:pointer; }
        .bili-dl-opts select { flex:1; padding:3px 4px; border:1px solid #eee; border-radius:6px; font-size:12px; }
        /* 文件名格式勾选区 */
        .bili-dl-fmt { margin:6px 0; padding:8px 10px; border:1px dashed #eed3df; border-radius:8px; background:#fffafc; }
        .bili-dl-fmt .fmt-title { font-size:12px; color:#999; margin-bottom:6px; }
        .bili-dl-fmt label { display:inline-flex; align-items:center; gap:3px; margin:0 12px 4px 0; font-size:12px; cursor:pointer; }
        /* 文件名实时预览 */
        .bili-dl-fmt .fmt-preview { margin-top:8px; padding:6px 8px; background:#fff; border:1px solid #f0d9e4; border-radius:6px; font-size:12px; color:#666; line-height:1.5; }
        .bili-dl-fmt .fmt-pv-label { color:#aaa; }
        .bili-dl-fmt .fmt-pv-name { color:#c0346b; word-break:break-all; font-family: ui-monospace, Menlo, Consolas, monospace; }
        .bili-dl-fmt .fmt-note { color:#bbb; font-size:11px; margin-top:2px; }
        /* 下载位置（子目录 / 系统对话框） */
        .bili-dl-dir { margin:6px 0; padding:8px 10px; border:1px dashed #d3e0ee; border-radius:8px; background:#f7fbff; }
        .bili-dl-dir .dir-title { font-size:12px; color:#999; margin-bottom:6px; }
        .bili-dl-dir .dir-row { display:flex; align-items:center; gap:2px; }
        .bili-dl-dir .dir-prefix { font-size:12px; color:#aac4dd; white-space:nowrap; font-family: ui-monospace, Menlo, Consolas, monospace; }
        .bili-dl-dir input[type=text] { flex:1; min-width:0; padding:5px 7px; border:1px solid #d8e6f2; border-radius:6px; font-size:12px; font-family: ui-monospace, Menlo, Consolas, monospace; }
        .bili-dl-dir input[type=text]:focus { outline:none; border-color:#fb7299; }
        .bili-dl-dir .dir-saveas { display:flex; align-items:flex-start; gap:5px; margin-top:7px; font-size:11.5px; color:#666; cursor:pointer; line-height:1.4; }
        .bili-dl-dir .dir-note { color:#e07b3a; font-size:11px; margin-top:5px; min-height:0; }
        .bili-dl-dir .dir-note:empty { display:none; }
        /* 设置栏：统一收纳（仅下载音频 / 文件名格式 / 下载位置 / 测试 ffmpeg）；默认折叠，省垂直空间 */
        .coll-head { display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:#fb7299; cursor:pointer; user-select:none; margin-bottom:2px; }
        .coll-head .chev { display:inline-block; transition: transform .2s ease; transform: rotate(90deg); font-size:11px; }
        .collapsed > .coll-head .chev { transform: rotate(0deg); }
        .bili-dl-settings .coll-body { overflow-y:auto; max-height:42vh; }
        .bili-dl-settings.collapsed .coll-body { display:none; }
        .bili-dl-batch { display:block; width:100%; margin:6px 0 4px; padding:9px 10px; border:none; border-radius:8px; background:#ffdde8; color:#c0346b; font-weight:600; cursor:pointer; font-size:13px; }
        .bili-dl-batch:hover { background:#ffc9dd; }
        .bili-dl-q { display:block; width:100%; text-align:left; margin:4px 0; padding:8px 10px; border:1px solid #eee; border-radius:8px; background:#fafafa; cursor:pointer; font-size:13px; color:#333; }
        .bili-dl-q:hover { background:#fff0f5; border-color:#fb7299; }
        /* 多P行状态：运行中/成功/失败 视觉反馈 —— 行内覆盖式进度条 + 深绿实色完成态 */
        .bili-dl-row { position: relative; overflow: hidden; transition: border-color .15s; }
        /* 行内进度覆盖层：绝对定位铺底，width 由 JS 0–100% 控制 */
        .bili-dl-row .row-bg { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: rgba(46,204,113,0.22); z-index: 0; pointer-events: none; transition: width .18s ease-out; }
        /* 行内容全部浮在 .row-bg 之上（z:1） */
        .bili-dl-row > * { position: relative; z-index: 1; }
        /* 多 P 列表容器：固定范围滚动，避免长列表顶出下载按钮 */
        #bili-dl-list { flex:1 1 auto; min-height:200px; max-height:48vh; overflow-y:auto; margin:4px 0; padding-right:4px; }
        #bili-dl-list::-webkit-scrollbar { width:8px; }
        #bili-dl-list::-webkit-scrollbar-thumb { background:#f3b9cd; border-radius:4px; }
        #bili-dl-list::-webkit-scrollbar-track { background:transparent; }
        .bili-dl-row .mark { width:16px; text-align:center; color:#999; font-weight:700; flex:0 0 auto; transition: color .15s; }
        /* 运行中：浅绿边框提示，不影响其他行 */
        .bili-dl-row.is-running { border-color: #9be3b0; }
        /* 完成：整行深绿实色背景 + 大号白色对勾 + row-bg 推满 100% */
        .bili-dl-row.is-ok { background: #055c05; border-color: #055c05; color: #fff; }
        .bili-dl-row.is-ok .row-bg { width: 100% !important; background: transparent; }
        .bili-dl-row.is-ok .mark { color: #fff; font-size: 16px; text-shadow: 0 1px 2px rgba(0,0,0,.18); }
        .bili-dl-row.is-ok .bili-dl-fmt-toggle,
        .bili-dl-row.is-ok .err-detail { display: none; }
        /* 失败：浅红背景，单行单独标记，不影响其他行 */
        .bili-dl-row.is-fail { background: #fde7e7; border-color: #f3b9b9; }
        .bili-dl-row.is-fail .row-bg { width: 100% !important; background: rgba(231,76,60,0.18); }
        .bili-dl-row.is-fail .mark { color: #c0392b; }
        .bili-dl-row.cb-disabled { opacity:.6; }
        .bili-dl-multi-tools { display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 2px; }
        .bili-dl-multi-tools button { flex:1 1 auto; padding:4px 6px; border:1px solid #eee; border-radius:6px; background:#fafafa; cursor:pointer; font-size:11.5px; color:#555; }
        .bili-dl-multi-tools button:hover { background:#fff0f5; border-color:#fb7299; color:#c0346b; }
        /* 多 P 选择栏（全选/全不选 + 反选/仅当前P）固定吸顶，不随列表滚动下拉 */
        .bili-dl-multi-sticky { position: sticky; top: 0; z-index: 2; background: #fff; padding: 2px 0 6px; margin-bottom: 4px; border-bottom: 1px solid #f0f0f0; }
        .bili-dl-batchqn { display:flex; align-items:center; gap:6px; margin:4px 0 2px; font-size:12px; color:#666; }
        .bili-dl-batchqn select { flex:1; padding:4px 6px; border:1px solid #eee; border-radius:6px; font-size:12px; }
        #bili-dl-status { margin-top:10px; padding:6px 8px; color:#666; min-height:44px; line-height:1.45; background:#fafafa; border-radius:6px; flex-shrink:0; word-break:break-all; }
        .bili-dl-bar { height:6px; background:#eee; border-radius:4px; margin-top:6px; overflow:hidden; flex-shrink:0; }
        .bili-dl-bar > i { display:block; height:100%; width:0; background:#fb7299; transition:width .2s; }
        #bili-dl-close { float:right; cursor:pointer; color:#bbb; }
        /* 设置栏「增强」区块：去重 / 字幕 / 弹幕 / 封面 / 冲突策略 */
        .bili-dl-extra { margin:6px 0; padding:8px 10px; border:1px dashed #cfe9d4; border-radius:8px; background:#f4fcf6; display:flex; flex-wrap:wrap; gap:5px 12px; align-items:center; }
        .bili-dl-extra .extra-chk { display:inline-flex; align-items:center; gap:3px; font-size:12px; cursor:pointer; color:#4a6b52; }
        .bili-dl-conflict { display:flex; align-items:center; gap:6px; width:100%; font-size:12px; color:#666; margin-top:2px; }
        .bili-dl-conflict select { flex:1; padding:3px 4px; border:1px solid #eee; border-radius:6px; font-size:12px; }
        /* 已下载分P：去重后预标记 */
        .bili-dl-row.is-done { background:#f0fff5; border-color:#9be3b0; }
        .bili-dl-row.is-done .mark { color:#2ecc71; }
        /* 失败行：重试 / 详情按钮 + 错误详情展开 */
        .bili-dl-row .row-actions { margin-left:auto; display:flex; gap:4px; flex:0 0 auto; }
        .bili-dl-row .retry, .bili-dl-row .detail { font-size:11px; border-radius:5px; padding:1px 6px; cursor:pointer; }
        .bili-dl-row .retry { color:#c0346b; background:#fff0f5; border:1px solid #fb7299; }
        .bili-dl-row .detail { color:#888; background:#f3f3f3; border:1px solid #ddd; }
        .bili-dl-row .err-detail { display:none; width:100%; margin-top:4px; padding:5px 7px; background:#fff5f5; border:1px solid #f3c9c9; border-radius:5px; font-size:11px; color:#b03a3a; white-space:pre-wrap; word-break:break-all; }
        .bili-dl-row.show-err .err-detail { display:block; }
        /* 下载完成 Toast：独立悬浮、平滑滑入/淡出，面板关闭也可见 */
        #bili-dl-toast { position: fixed; right: 18px; top: 18px; z-index: 1000000; max-width: 320px; background: #fff; border-left: 4px solid #2ecc71; border-radius: 10px; padding: 12px 14px; box-shadow: 0 10px 34px rgba(0,0,0,.18); color: #222; font-size: 13px; line-height: 1.45; opacity: 0; transform: translateY(-14px) scale(.98); transition: opacity .35s ease, transform .35s ease; pointer-events: none; }
        #bili-dl-toast.show { opacity: 1; transform: translateY(0) scale(1); }
        #bili-dl-toast .t-title { font-weight: 700; color: #fb7299; margin-bottom: 3px; font-size: 14px; }
        #bili-dl-toast.is-error { border-left-color: #e74c3c; }
        #bili-dl-toast.is-error .t-title { color: #e74c3c; }
        #bili-dl-toast .t-body { color: #555; word-break: break-all; }
        /* 面板底部：版本 + GitHub 链接；更新横幅 */
        .bili-dl-footer { margin-top: 8px; padding-top: 6px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #999; }
        .bili-dl-footer a { color: #fb7299; text-decoration: none; }
        .bili-dl-footer a:hover { text-decoration: underline; }
        #bili-dl-update { display: none; margin-top: 8px; padding: 8px 10px; background: #fff4e6; border: 1px solid #ffd8a8; border-radius: 8px; font-size: 12px; color: #a05a00; line-height: 1.5; }
        #bili-dl-update a { color: #d9480f; font-weight: 700; text-decoration: none; }
        #bili-dl-update a:hover { text-decoration: underline; }
      </style>
      <button id="bili-dl-fab">⬇ 下载视频</button>
      <div id="bili-dl-panel">
        <span id="bili-dl-close">✕</span>
        <h4>Bilibili 视频下载（自用）</h4>
        <div class="title" id="bili-dl-vtitle"></div>
        <div class="bili-dl-settings collapsed" id="bili-dl-settings-box">
          <div class="coll-head" id="bili-dl-settings-toggle"><span class="chev">▾</span> ⚙ 设置（音频 / 文件名格式 / 下载位置）</div>
          <div class="coll-body">
            <div class="bili-dl-opts">
              <label><input type="checkbox" id="bili-dl-audonly"> 仅下载音频</label>
              <select id="bili-dl-audfmt">
                <option value="m4a">m4a（封装，推荐）</option>
                <option value="mp3">mp3（转码，通用）</option>
              </select>
            </div>
            <div class="bili-dl-fmt">
              <div class="fmt-title">文件名格式 · 勾选组合（PN/选集名称仅多P合集生效）</div>
              <label><input type="checkbox" id="bili-dl-fmt-title" checked> 视频标题</label>
              <label><input type="checkbox" id="bili-dl-fmt-pn" checked> PN（分P序号）</label>
              <label><input type="checkbox" id="bili-dl-fmt-part" checked> 选集名称</label>
              <label><input type="checkbox" id="bili-dl-fmt-qn" checked> 清晰度</label>
              <div class="fmt-preview" id="bili-dl-fmt-preview"></div>
            </div>
            <div class="bili-dl-dir">
              <div class="dir-title">Chrome 扩展只能存到“下载”目录下的子文件夹；勾选下方开关可弹系统对话框选任意真实文件夹</div>
              <div class="dir-row">
                <span class="dir-prefix">下载目录/</span>
                <input type="text" id="bili-dl-dir" placeholder="例如 Bilibili/Videos" spellcheck="false" autocomplete="off">
              </div>
              <label class="dir-saveas"><input type="checkbox" id="bili-dl-saveas"> 下载时弹出系统“另存为”对话框（可选任意真实文件夹；批量时会逐文件弹出）</label>
              <div class="dir-note" id="bili-dl-dir-note"></div>
            </div>
            <div class="bili-dl-extra">
              <label class="extra-chk"><input type="checkbox" id="bili-dl-dedup" checked> 去重（跳过已下载分P）</label>
              <label class="extra-chk"><input type="checkbox" id="bili-dl-aux-sub"> 字幕</label>
              <label class="extra-chk"><input type="checkbox" id="bili-dl-aux-dm"> 弹幕</label>
              <label class="extra-chk"><input type="checkbox" id="bili-dl-aux-cover"> 封面</label>
              <div class="bili-dl-conflict">
                <span>文件名冲突</span>
                <select id="bili-dl-conflict">
                  <option value="uniquify">自动重命名（推荐）</option>
                  <option value="overwrite">覆盖</option>
                  <option value="prompt">每次询问</option>
                </select>
              </div>
            </div>
            <button class="bili-dl-batch" id="bili-dl-selftest" style="background:#eaf2ff;color:#2a5db0;">🔧 测试 ffmpeg 管线</button>
          </div>
        </div>
        <button class="bili-dl-batch" id="bili-dl-batch" style="display:none"></button>
        <div id="bili-dl-list"></div>
        <div id="bili-dl-status"></div>
        <div class="bili-dl-bar"><i id="bili-dl-bar-i"></i></div>
        <div id="bili-dl-update">⬆️ 发现新版本 <b id="bili-dl-newver"></b>！<a id="bili-dl-updatelink" href="https://github.com/my788525/bili-dl-ext/releases/latest" target="_blank" rel="noopener">前往下载</a></div>
        <div class="bili-dl-footer">
          <span id="bili-dl-curver">v1.0.0</span>
          <a id="bili-dl-github" href="https://github.com/my788525/bili-dl-ext" target="_blank" rel="noopener">GitHub 仓库</a>
        </div>
      </div>
      <div id="bili-dl-toast"></div>
    `;
    document.body.appendChild(root);

    const fab = $('#bili-dl-fab'), panel = $('#bili-dl-panel'), list = $('#bili-dl-list');
    const status = $('#bili-dl-status'), bar = $('#bili-dl-bar-i'), vtitle = $('#bili-dl-vtitle');
    // 面板底部显示当前版本号
    const curVerEl = document.getElementById('bili-dl-curver');
    if (curVerEl) curVerEl.textContent = 'v' + chrome.runtime.getManifest().version;
    const audonly = $('#bili-dl-audonly'), audfmt = $('#bili-dl-audfmt'), batchBtn = $('#bili-dl-batch');
    const selftestBtn = $('#bili-dl-selftest');
    const fmtTitle = $('#bili-dl-fmt-title'), fmtPn = $('#bili-dl-fmt-pn');
    const fmtPart = $('#bili-dl-fmt-part'), fmtQn = $('#bili-dl-fmt-qn');
    const dirInput = $('#bili-dl-dir'), saveasCb = $('#bili-dl-saveas'), dirNote = $('#bili-dl-dir-note');

    // 文件名格式持久化：跨页面/刷新保留勾选
    const saveFmt = () => chrome.storage.local.set({
      [FMT_KEY]: { title: fmtTitle.checked, pn: fmtPn.checked, part: fmtPart.checked, qn: fmtQn.checked }
    });
    chrome.storage.local.get(FMT_KEY, (s) => {
      const saved = (s && s[FMT_KEY]) || null;
      if (saved) {
        fmtTitle.checked = saved.title !== false;
        fmtPn.checked = saved.pn !== false;
        fmtPart.checked = saved.part !== false;
        fmtQn.checked = saved.qn !== false;
      }
    });
    [fmtTitle, fmtPn, fmtPart, fmtQn].forEach(cb => {
      cb.onchange = () => { saveFmt(); if (ctx && !batchRunning) renderList(); updateFmtPreview(); };
    });

    // 下载位置持久化：子目录 + 是否弹系统对话框（getDir/getSaveAs 为模块级函数，直接查 DOM）
    const saveDir = () => chrome.storage.local.set({ [DIR_KEY]: dirInput.value.trim(), [SAVEAS_KEY]: saveasCb.checked });
    chrome.storage.local.get([DIR_KEY, SAVEAS_KEY], (s) => {
      if (s && typeof s[DIR_KEY] === 'string') dirInput.value = s[DIR_KEY];
      if (s && typeof s[SAVEAS_KEY] === 'boolean') saveasCb.checked = s[SAVEAS_KEY];
    });
    dirInput.oninput = () => {
      const cleaned = sanitizeDirInput(dirInput.value);
      if (cleaned !== dirInput.value.trim()) {
        dirNote.textContent = '已自动修正：仅允许“下载”目录下的相对路径（去掉了 /、.. 及非法字符）';
      } else {
        dirNote.textContent = '';
      }
      saveDir();
      updateFmtPreview();
    };
    saveasCb.onchange = () => { saveDir(); if (ctx) renderList(); };

    // 设置栏（统一收纳：仅下载音频 / 文件名格式 / 下载位置 / 测试 ffmpeg）：默认折叠，展开状态持久化
    const SETTINGS_OPEN_KEY = 'bili_dl_settings_open';
    const settingsBox = $('#bili-dl-settings-box'), settingsToggle = $('#bili-dl-settings-toggle');
    settingsToggle.onclick = () => {
      const nowCollapsed = settingsBox.classList.toggle('collapsed');
      chrome.storage.local.set({ [SETTINGS_OPEN_KEY]: !nowCollapsed });
    };
    chrome.storage.local.get(SETTINGS_OPEN_KEY, (s) => {
      if (s[SETTINGS_OPEN_KEY] === true) settingsBox.classList.remove('collapsed');
    });

    // 让模块级消息监听器能更新最新创建的 UI 元素
    ui.status = status; ui.bar = bar;
    registerMsgListener();

    $('#bili-dl-close').onclick = () => { panel.style.display = 'none'; };
    // 记忆「仅下载音频 / 音频格式」跨页面持久化
    const saveAudio = () => chrome.storage.local.set({ [AUDONLY_KEY]: audonly.checked, [AUDFMT_KEY]: audfmt.value });
    chrome.storage.local.get([AUDONLY_KEY, AUDFMT_KEY], (s) => {
      if (typeof s[AUDONLY_KEY] === 'boolean') audonly.checked = s[AUDONLY_KEY];
      if (typeof s[AUDFMT_KEY] === 'string' && s[AUDFMT_KEY]) audfmt.value = s[AUDFMT_KEY];
      lastAudonly = audonly.checked;
      if (ctx) renderList();
      updateFmtPreview();
    });
    audonly.onchange = () => { lastAudonly = audonly.checked; saveAudio(); if (ctx && !batchRunning) renderList(); updateFmtPreview(); };
    audfmt.onchange = () => { saveAudio(); };

    // 面板跟随浮动按钮定位：拖动 FAB 后展开面板也落在按钮附近（上/下方自适应，防溢出视口）
    function positionPanelNearFab() {
      const rect = fab.getBoundingClientRect();
      const pw = panel.offsetWidth || 320, ph = panel.offsetHeight || 360;
      const gap = 8;
      let top;
      if (rect.top - gap - ph >= 0) top = rect.top - gap - ph;            // 优先按钮上方
      else if (rect.bottom + gap + ph <= window.innerHeight) top = rect.bottom + gap; // 否则下方
      else top = Math.max(0, Math.min(rect.top, window.innerHeight - ph)); // 兜底贴边
      let left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - pw));
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = left + 'px'; panel.style.top = top + 'px';
    }
    // 版本检测：对比 GitHub 上的 version.json，发现新版本时显示更新横幅
    const REPO_URL = 'https://github.com/my788525/bili-dl-ext';
    const VERSION_URL = 'https://raw.githubusercontent.com/my788525/bili-dl-ext/main/version.json';
    let updateChecked = false;
    function verCmp(a, b) {
      const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
      for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
      return 0;
    }
    function checkUpdate(force) {
      if (!force && updateChecked) return;
      updateChecked = true;
      const cur = chrome.runtime.getManifest().version;
      const updEl = document.getElementById('bili-dl-update');
      const verEl = document.getElementById('bili-dl-newver');
      const linkEl = document.getElementById('bili-dl-updatelink');
      fetch(VERSION_URL, { cache: 'no-store' })
        .then(r => (r && r.ok ? r.json() : null))
        .then(j => {
          if (!j || !j.version) { updEl.style.display = 'none'; return; }
          if (verCmp(j.version, cur) > 0) {
            verEl.textContent = j.version;
            linkEl.href = j.release_url || (REPO_URL + '/releases/latest');
            updEl.style.display = 'block';
          } else {
            updEl.style.display = 'none';
          }
        })
        .catch(() => { updEl.style.display = 'none'; });
    }
    // 快捷键 Alt+B 切换面板
    function togglePanel() {
      const willOpen = panel.style.display !== 'flex';
      panel.style.display = willOpen ? 'flex' : 'none';
      if (willOpen) { positionPanelNearFab(); checkUpdate(false); updateFmtPreview(); if (!ctx) loadQualities(); }
    }

    // 浮动按钮可拖动到页面任意位置 + 记忆位置
    const FABPOS_KEY = 'bili_dl_fabpos';
    function applyFabPos(p) {
      fab.style.right = 'auto'; fab.style.bottom = 'auto';
      fab.style.left = p.left + 'px'; fab.style.top = p.top + 'px';
    }
    function clampFab(x, y) {
      const w = fab.offsetWidth || 110, h = fab.offsetHeight || 40;
      const maxX = Math.max(0, window.innerWidth - w), maxY = Math.max(0, window.innerHeight - h);
      return { left: Math.min(Math.max(0, x), maxX), top: Math.min(Math.max(0, y), maxY) };
    }
    // 初始位置：优先读取记忆，否则默认右下角
    let fabPos = null;
    chrome.storage.local.get(FABPOS_KEY, (s) => {
      const saved = s && s[FABPOS_KEY];
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        fabPos = clampFab(saved.left, saved.top); applyFabPos(fabPos); // 夹回视口，防窗口缩小后跑到屏外
      } else {
        const w = fab.offsetWidth || 110, h = fab.offsetHeight || 40;
        fabPos = { left: Math.max(0, window.innerWidth - w - 18), top: Math.max(0, window.innerHeight - h - 18) };
        applyFabPos(fabPos);
      }
    });
    let dragStart = null, justDragged = false;
    fab.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;            // 仅左键拖动
      justDragged = false;
      const rect = fab.getBoundingClientRect();
      dragStart = { mx: e.clientX, my: e.clientY, ox: rect.left, oy: rect.top, moved: false };
      e.preventDefault();                    // 防止文本选中/默认拖拽图片等行为
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.mx, dy = e.clientY - dragStart.my;
      if (!dragStart.moved && Math.hypot(dx, dy) < 4) return; // 小于阈值视为点击，不启动拖动
      dragStart.moved = true; justDragged = true;
      fabPos = clampFab(dragStart.ox + dx, dragStart.oy + dy);
      applyFabPos(fabPos);
      if (panel.style.display === 'flex') positionPanelNearFab(); // 拖动时面板跟随
    });
    document.addEventListener('mouseup', () => {
      if (!dragStart) return;
      if (dragStart.moved) chrome.storage.local.set({ [FABPOS_KEY]: fabPos }); // 拖动结束才持久化
      dragStart = null;
    });
    // 点击切换面板：拖动结束后抑制本次 click，避免误触发展开/收起
    fab.onclick = () => { if (justDragged) { justDragged = false; return; } togglePanel(); };
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        // 避免覆盖浏览器/页面对 Alt+B 的默认行为可能造成的异常
        e.preventDefault();
        togglePanel();
      }
    });

    // 独立测试 ffmpeg 本地 wasm 管线（不依赖 B 站接口，经 offscreen 运行）
    selftestBtn.onclick = () => { runSelfTest(); };

    async function loadQualities() {
      status.textContent = '正在解析视频信息…'; bar.style.width = '0%'; list.innerHTML = '';
      try {
        const st = await getState();
        if (!st.bvid || !st.cid) throw new Error('未能从页面读取 bvid/cid，请确认在视频播放页。');
        vtitle.textContent = st.title;
        const data = await getPlayUrl(st.bvid, st.cid, 120);
        const cls = classifyStreams(data);
        if (cls.type === 'none') throw new Error('该视频无可下载的流（可能需登录，或会员专享/受限）。');
        const pages = st.pages && st.pages.length ? st.pages : [{ cid: st.cid, page: 1, part: '' }];
        ctx = { title: st.title, bvid: st.bvid, cls, pages, selected: new Set(pages.map(p => p.cid)), pic: st.pic || null };
        renderList();
        updateFmtPreview();
        status.textContent = audonly.checked ? '点击下载音频' : '选择清晰度开始下载';
      } catch (err) { status.textContent = '错误：' + err.message; }
    }

    // 文件名实时预览：用当前页面数据 + 下载目录作样本，复刻 offscreen 的拼装规则
    function previewFileName(nf, dir) {
      const isMulti = ctx && ctx.pages && ctx.pages.length > 1;
      const title = (ctx && ctx.title) ? ctx.title : '视频标题';
      const page = isMulti ? (ctx.pages[0].page || 1) : 0;
      const part = isMulti ? (ctx.pages[0].part || '') : '';
      const audioMode = audonly.checked;
      const segs = [];
      if (nf.title) segs.push(safeName(title));
      if (nf.pn && page) segs.push('P' + String(page).padStart(2, '0'));
      if (nf.part && part) segs.push(safeName(part));
      if (nf.qn && !audioMode) segs.push('1080p'); // 清晰度示例（视频模式）
      const base = segs.length ? segs.join('_') : 'bili-dl';
      const ext = audioMode ? 'm4a' : 'mp4';
      const dirClean = sanitizeDirInput(dir || '');
      return (dirClean ? (dirClean + '/') : '') + base + '.' + ext;
    }
    function updateFmtPreview() {
      const pv = document.getElementById('bili-dl-fmt-preview');
      if (!pv) return;
      const nf = getNameFormat();
      const isMulti = ctx && ctx.pages && ctx.pages.length > 1;
      pv.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'fmt-pv-label';
      label.textContent = '示例：下载目录/';
      const nameEl = document.createElement('b');
      nameEl.className = 'fmt-pv-name';
      nameEl.textContent = previewFileName(nf, getDir());
      pv.appendChild(label); pv.appendChild(nameEl);
      if (!isMulti && (nf.pn || nf.part)) {
        const note = document.createElement('div');
        note.className = 'fmt-note';
        note.textContent = '（当前为单P视频，PN/选集名称即使勾选也不生效）';
        pv.appendChild(note);
      }
    }

    function renderList() {
      list.innerHTML = '';
      if (!ctx) return;
      const multi = ctx.pages.length > 1;
      if (multi) {
        rowEls = new Map(); // 重置逐行引用（用于进度消息更新状态）
        // ---- 批量清晰度选择器（应用到所有勾选分P；仅 DASH 流有可选清晰度）----
        if (ctx.cls.type === 'dash' && Array.isArray(ctx.cls.videos) && ctx.cls.videos.length) {
          const qnRow = document.createElement('div');
          qnRow.className = 'bili-dl-batchqn';
          const qnLabel = document.createElement('span');
          qnLabel.textContent = '批量清晰度';
          const qnSel = document.createElement('select');
          const opt0 = document.createElement('option');
          opt0.value = '0'; opt0.textContent = '最高可用';
          qnSel.appendChild(opt0);
          ctx.cls.videos.forEach(v => {
            const o = document.createElement('option');
            o.value = String(v.id);
            o.textContent = (QN_LABEL[v.id] || ('清晰度 ' + v.id)) + (v.bandwidth ? ' · ' + Math.round(v.bandwidth / 1000) + 'kbps' : '');
            qnSel.appendChild(o);
          });
          qnSel.value = String(batchQn);
          qnSel.onchange = () => { batchQn = parseInt(qnSel.value, 10) || 0; };
          qnRow.appendChild(qnLabel); qnRow.appendChild(qnSel);
          list.appendChild(qnRow);
        } else {
          const qnNote = document.createElement('div');
          qnNote.className = 'bili-dl-batchqn';
          qnNote.style.cssText = 'font-size:12px;color:#999;margin:2px 2px 6px;';
          qnNote.textContent = '该视频为合成流（固定清晰度），无需选择清晰度';
          list.appendChild(qnNote);
        }

        // ---- 全选/全不选 + 多选快捷工具（反选 / 仅当前P）----
        const head = document.createElement('label');
        head.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 2px;font-size:12px;color:#666;cursor:pointer;';
        const selAllCb = document.createElement('input');
        selAllCb.type = 'checkbox';
        selAllCb.checked = ctx.selected.size === ctx.pages.length;
        const headTxt = document.createElement('span');
        headTxt.id = 'bili-dl-multi-head-txt';
        headTxt.textContent = '全选 / 全不选';
        head.appendChild(selAllCb); head.appendChild(headTxt);

        const tools = document.createElement('div');
        tools.className = 'bili-dl-multi-tools';
        const mkTool = (t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; return b; };
        const invBtn = mkTool('反选'), curBtn = mkTool('仅当前P');
        invBtn.onclick = () => {
          if (batchRunning) return;
          ctx.pages.forEach(p => { if (ctx.selected.has(p.cid)) ctx.selected.delete(p.cid); else ctx.selected.add(p.cid); });
          selAllCb.checked = ctx.selected.size === ctx.pages.length; syncRows();
        };
        curBtn.onclick = () => {
          if (batchRunning) return;
          const m = location.href.match(/[?&]p=(\d+)/i);
          const cur = m ? parseInt(m[1], 10) : 1;
          ctx.pages.forEach(p => { if (p.page === cur) ctx.selected.add(p.cid); else ctx.selected.delete(p.cid); });
          selAllCb.checked = ctx.selected.size === ctx.pages.length; syncRows();
        };
        tools.appendChild(invBtn); tools.appendChild(curBtn);

        // 选择栏（全选/全不选 + 反选/仅当前P）吸顶固定，不随分P列表滚动下拉
        const stickyBar = document.createElement('div');
        stickyBar.className = 'bili-dl-multi-sticky';
        stickyBar.appendChild(head);
        stickyBar.appendChild(tools);
        list.appendChild(stickyBar);

        // ---- 分P 勾选行（带逐行状态图标）----
        const rowMap = new Map();
        const updateDlBtn = () => {
          const n = ctx.selected.size;
          batchBtn.style.display = 'block';
          if (batchRunning) { batchBtn.textContent = '⛔ 取消下载'; }
          else { batchBtn.textContent = (audonly.checked ? '⬇ 下载选中（音频 · ' : '⬇ 下载选中（') + n + ' 个）'; }
        };
        const syncRows = () => {
          ctx.pages.forEach(page => { const cb = rowMap.get(page.cid); if (cb) cb.checked = ctx.selected.has(page.cid); });
          updateDlBtn();
        };
        const dedupOn = document.getElementById('bili-dl-dedup') && document.getElementById('bili-dl-dedup').checked;
        ctx.pages.forEach(page => {
          const row = document.createElement('label');
          row.className = 'bili-dl-row';
          row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 8px;margin:4px 0;border:1px solid #eee;border-radius:8px;cursor:pointer;font-size:13px;';
          // 行内进度覆盖层（绝对定位、初始 0% 宽；由 markRow 控制 width）
          // —— 预置避免后续 markRow 首次调用时的「凭空插入」视觉跳变
          const rowBg = document.createElement('i'); rowBg.className = 'row-bg'; row.appendChild(rowBg);
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          let checked = ctx.selected.has(page.cid);
          // 去重：已下载的分P 默认取消勾选并标记（避免重复落盘）
          if (dedupOn && downloadedCids.has(page.cid)) { checked = false; ctx.selected.delete(page.cid); row.classList.add('is-done'); }
          cb.checked = checked;
          const mark = document.createElement('span'); mark.className = 'mark';
          const span = document.createElement('span');
          span.style.cssText = 'flex:1;min-width:0;';
          span.textContent = 'P' + String(page.page).padStart(2, '0') + (page.part ? ' · ' + page.part : '');
          row.appendChild(cb); row.appendChild(mark); row.appendChild(span);
          list.appendChild(row);
          rowMap.set(page.cid, cb);
          rowEls.set(page.cid, { row, mark, cb });
          // 失败行：标记 ✗ 并提供「重试 / 详情」+ 错误展开
          if (failErrors.has(page.cid)) {
            mark.textContent = '✗'; row.classList.add('is-fail');
            const err = failErrors.get(page.cid);
            const actions = document.createElement('div'); actions.className = 'row-actions';
            const retry = document.createElement('button');
            retry.type = 'button'; retry.className = 'retry'; retry.textContent = '重试';
            retry.onclick = (e) => { e.preventDefault(); e.stopPropagation(); retryOne(page.cid); };
            const detail = document.createElement('button');
            detail.type = 'button'; detail.className = 'detail'; detail.textContent = '详情';
            detail.onclick = (e) => { e.preventDefault(); e.stopPropagation(); row.classList.toggle('show-err'); };
            actions.appendChild(retry); actions.appendChild(detail);
            const errDetail = document.createElement('div');
            errDetail.className = 'err-detail'; errDetail.textContent = err;
            errDetail.onclick = (e) => e.stopPropagation();
            row.appendChild(actions); row.appendChild(errDetail);
          }
          cb.onchange = () => {
            if (cb.checked) ctx.selected.add(page.cid); else ctx.selected.delete(page.cid);
            selAllCb.checked = ctx.selected.size === ctx.pages.length;
            updateDlBtn();
          };
        });

        selAllCb.onchange = () => {
          if (selAllCb.checked) ctx.pages.forEach(p => ctx.selected.add(p.cid));
          else ctx.selected.clear();
          syncRows();
        };

        batchBtn.onclick = () => {
          if (batchRunning) {
            chrome.runtime.sendMessage({ type: 'bili-dl-cancel', reqId: currentReqId });
            setStatus('已发送取消请求，正在收尾当前分P…');
            return;
          }
          const picked = ctx.pages.filter(p => ctx.selected.has(p.cid));
          if (!picked.length) { setStatus('请先勾选要下载的分P'); return; }
          startBatch(picked, ctx.title, audonly.checked, audfmt.value, batchQn);
        };
        updateDlBtn();
        return; // 多选模式下不渲染单 P 清晰度按钮
      } else {
        batchBtn.style.display = 'none';
      }
      // durl 合成流：已封装音视频，直接下载即可（音频需额外提取）
      if (ctx.cls.type === 'durl') {
        const btn = document.createElement('button');
        btn.className = 'bili-dl-q';
        btn.textContent = audonly.checked ? '⬇ 下载音频（从合成流提取）' : '⬇ 下载视频（合成流）';
        btn.onclick = audonly.checked
          ? () => startDurlAudio(ctx.cls.url, ctx.title, audfmt.value, 0, '')
          : () => startDurl(ctx.cls.url, ctx.title, 0, '');
        list.appendChild(btn);
        const tip = document.createElement('div'); tip.style.cssText = 'color:#aaa;font-size:12px;margin-top:4px;';
        tip.textContent = '该视频仅有合成流（已封装音视频），无需合并。'; list.appendChild(tip);
        return;
      }
      // DASH：分离的音视频轨，需 ffmpeg 合并
      if (audonly.checked) {
        const btn = document.createElement('button');
        btn.className = 'bili-dl-q';
        btn.textContent = '⬇ 下载音频（最佳音质 · ' + audfmt.value.toUpperCase() + '）';
        btn.onclick = () => startAudio(ctx.title, '', ctx.cls.audioUrl, audfmt.value, 0, '');
        list.appendChild(btn);
        const tip = document.createElement('div'); tip.style.cssText = 'color:#aaa;font-size:12px;margin-top:4px;';
        tip.textContent = '仅下载音轨，不下载视频。'; list.appendChild(tip);
      } else {
        ctx.cls.videos.forEach(v => {
          const btn = document.createElement('button');
          btn.className = 'bili-dl-q';
          const label = QN_LABEL[v.id] || ('清晰度 ' + v.id);
          const sizeHint = v.bandwidth ? ' · ' + Math.round(v.bandwidth / 1000) + 'kbps' : '';
          btn.textContent = label + sizeHint;
          const videoUrl = v.baseUrl || (v.backupUrl && v.backupUrl[0]) || '';
          btn.onclick = () => startVideo(videoUrl, ctx.cls.audioUrl, ctx.title, v.id, 0, '');
          list.appendChild(btn);
        });
      }
    }

    // 逐分P 取流并判别类型（DASH / durl）
    async function getPageStreams(bvid, page) {
      const data = await getPlayUrl(bvid, page.cid, 120);
      return classifyStreams(data);
    }

    async function startVideo(videoUrl, audioUrl, title, qn, page, part) {
      if (!videoUrl) { setStatus('该清晰度直链缺失'); return; }
      ctx = null;
      dispatchTask([{ kind: 'video', videoUrl, audioUrl, title, page: page || 0, part: part || '', qn: qn || 0 }], getNameFormat());
    }

    async function startAudio(title, _unused, audioUrl, fmt, page, part) {
      if (!audioUrl) { setStatus('音轨直链缺失'); return; }
      ctx = null;
      dispatchTask([{ kind: 'audio', audioUrl, title, page: page || 0, part: part || '', audioFormat: fmt }], getNameFormat());
    }

    // durl 合成流：直接下载，无需 ffmpeg 合并（offscreen 内完成落盘）
    async function startDurl(url, title, page, part) {
      if (!url) { setStatus('合成流直链缺失'); return; }
      ctx = null;
      const ext = /\.flv(\?|$)/i.test(url) ? 'flv' : 'mp4';
      dispatchTask([{ kind: 'durl', url, title, page: page || 0, part: part || '', ext }], getNameFormat());
    }

    // durl 合成流提取音频（offscreen 内完成落盘）
    async function startDurlAudio(url, title, fmt, page, part) {
      if (!url) { setStatus('合成流直链缺失'); return; }
      ctx = null;
      dispatchTask([{ kind: 'durl-audio', url, title, page: page || 0, part: part || '', audioFormat: fmt }], getNameFormat());
    }

    // 单分P 重试：仅重下失败的那个（复用 getPageStreams + dispatchTask 单 job）
    async function retryOne(cid) {
      if (!ctx || !ctx.pages) return;
      const page = ctx.pages.find(p => p.cid === cid);
      if (!page) return;
      const picked = [page];
      // 重试时按当前「仅音频 / 格式 / 清晰度」重新构建单个 job
      const fmt = audfmt.value;
      const qn = batchQn;
      const nf = getNameFormat();
      const bvid = ctx.bvid;
      const isMulti = ctx.pages.length > 1;
      const pageNo = isMulti ? page.page : 0;
      const partName = isMulti ? (page.part || '') : '';
      const label = isMulti ? ('P' + String(pageNo).padStart(2, '0') + (partName ? '_' + safeName(partName) : '')) : '';
      const audonlyMode = audonly.checked;
      try {
        const cls = await getPageStreams(bvid, page);
        let job = null;
        if (cls.type === 'durl') {
          if (audonlyMode) job = { kind: 'durl-audio', url: cls.url, title: ctx.title, page: pageNo, part: partName, audioFormat: fmt, cid, _label: label };
          else { const ext = /\.flv(\?|$)/i.test(cls.url) ? 'flv' : 'mp4'; job = { kind: 'durl', url: cls.url, title: ctx.title, page: pageNo, part: partName, ext, cid, _label: label }; }
        } else if (cls.type === 'dash') {
          if (audonlyMode) job = { kind: 'audio', audioUrl: cls.audioUrl, title: ctx.title, page: pageNo, part: partName, audioFormat: fmt, cid, _label: label };
          else {
            let v = cls.videos[0];
            if (qn && qn !== 0) { const f = cls.videos.find(x => x.id === qn); if (f) v = f; }
            const videoUrl = v.baseUrl || (v.backupUrl && v.backupUrl[0]) || '';
            job = { kind: 'video', videoUrl, audioUrl: cls.audioUrl, title: ctx.title, page: pageNo, part: partName, qn: v.id, cid, _label: label };
          }
        }
        if (!job) { setStatus('该分P无可下载的流'); return; }
        if (currentBatchMeta && currentBatchMeta.byIndex) {
          // 复用已有批量元数据槽位，让进度/结果仍落到对应行
          const idx = currentBatchMeta.byIndex.findIndex(m => m.cid === cid);
          if (idx >= 0) currentBatchMeta.byIndex[idx] = { cid, label };
        }
        setStatus('正在重试 P' + String(pageNo).padStart(2, '0') + '…');
        failErrors.delete(cid);
        dispatchTask([job], nf);
        if (cid != null) markRow(cid, 'running');
      } catch (e) {
        setStatus('重试失败：' + (e && e.message ? e.message : e));
      }
    }

    // 辅助下载（字幕/弹幕/封面）：content 上下文直接调 chrome.downloads.download（该 API 在 content 可用）
    // 文件名沿用与视频一致的命名规则（不含清晰度），与视频落在同一目录，便于归档
    function auxNameBase(page) {
      const isMulti = ctx && ctx.pages.length > 1;
      const pageNo = isMulti ? page.page : 0;
      const partName = isMulti ? (page.part || '') : '';
      const nf = getNameFormat();
      const segs = [];
      if (nf.title) segs.push(safeName(ctx.title));
      if (nf.pn && pageNo) segs.push('P' + String(pageNo).padStart(2, '0'));
      if (nf.part && partName) segs.push(safeName(partName));
      return segs.length ? segs.join('_') : 'bili-dl';
    }
    async function directDownload(url, filename) {
      await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: getConflictAction() });
    }
    async function directDownloadText(text, filename, mime) {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      await chrome.downloads.download({ url: `data:${mime || 'application/octet-stream'};base64,${b64}`, filename, saveAs: false, conflictAction: getConflictAction() });
    }
    async function runAuxDownloads(pages) {
      const dir = getDir();
      const prefix = dir ? sanitizeDirInput(dir).replace(/\/+$/, '') + '/' : '';
      const auxSubs = document.getElementById('bili-dl-aux-sub') && document.getElementById('bili-dl-aux-sub').checked;
      const auxDan = document.getElementById('bili-dl-aux-dan') && document.getElementById('bili-dl-aux-dan').checked;
      const auxCov = document.getElementById('bili-dl-aux-cover') && document.getElementById('bili-dl-aux-cover').checked;
      if (!auxSubs && !auxDan && !auxCov) return;
      let count = 0;
      for (const page of pages) {
        const base = prefix + auxNameBase(page);
        try {
          if (auxCov && ctx.pic) {
            await directDownload(ctx.pic.replace(/^\/\//, 'https://'), base + '.jpg');
            count++;
          }
          if (auxDan) {
            await directDownload('https://api.bilibili.com/x/v1/dm/list.so?oid=' + page.cid, base + '.danmaku.xml');
            count++;
          }
          if (auxSubs) {
            const pd = await wbiFetch('https://api.bilibili.com/x/player/wbi/v2', { bvid: ctx.bvid, cid: page.cid });
            const subs = (pd && pd.data && pd.data.subtitle && pd.data.subtitle.list) || [];
            for (const s of subs) {
              const surl = (s.subtitle_url || '').replace(/^\/\//, 'https://');
              if (!surl) continue;
              const txt = await (await fetch(surl)).text();
              let ass = '';
              try { ass = jsonToAss(JSON.parse(txt)); } catch (_) { ass = txt; }
              await directDownloadText(ass, base + '.' + (s.lan || 'sub') + '.ass', 'application/octet-stream');
              count++;
            }
          }
        } catch (e) { console.warn('[bili-dl] aux 下载失败 P' + page.cid, e); }
      }
      if (count) setStatus(`✅ 已附加下载 ${count} 个辅助文件（字幕/弹幕/封面）`);
    }

    async function startBatch(pages, title, audonlyMode, fmt, qn) {
      const bvid = ctx ? ctx.bvid : null;
      const isMulti = ctx && ctx.pages.length > 1; // 仅多P合集才带 PN/选集名称
      const nf = getNameFormat();
      // 去重：勾选了「跳过已下载」时，已成功下载过的 cid 自动跳过
      const dedupOn = document.getElementById('bili-dl-dedup') && document.getElementById('bili-dl-dedup').checked;
      let skipCount = 0;
      const jobs = [];
      for (const page of pages) {
        const pageNo = isMulti ? page.page : 0;
        const partName = isMulti ? (page.part || '') : '';
        const label = isMulti ? ('P' + String(pageNo).padStart(2, '0') + (partName ? '_' + safeName(partName) : '')) : '';
        if (dedupOn && downloadedCids.has(page.cid)) { skipCount++; continue; }
        try {
          const cls = await getPageStreams(bvid, page);
          if (cls.type === 'durl') {
            if (audonlyMode) jobs.push({ kind: 'durl-audio', url: cls.url, title, page: pageNo, part: partName, audioFormat: fmt, cid: page.cid, _label: label });
            else { const ext = /\.flv(\?|$)/i.test(cls.url) ? 'flv' : 'mp4'; jobs.push({ kind: 'durl', url: cls.url, title, page: pageNo, part: partName, ext, cid: page.cid, _label: label }); }
          } else if (cls.type === 'dash') {
            if (audonlyMode) jobs.push({ kind: 'audio', audioUrl: cls.audioUrl, title, page: pageNo, part: partName, audioFormat: fmt, cid: page.cid, _label: label });
            else {
              let v = cls.videos[0];
              if (qn && qn !== 0) { const found = cls.videos.find(x => x.id === qn); if (found) v = found; }
              const videoUrl = v.baseUrl || (v.backupUrl && v.backupUrl[0]) || '';
              jobs.push({ kind: 'video', videoUrl, audioUrl: cls.audioUrl, title, page: pageNo, part: partName, qn: v.id, cid: page.cid, _label: label });
            }
          } else {
            jobs.push({ _error: '该分P无可下载的流（' + label + '）' });
          }
        } catch (e) {
          jobs.push({ _error: (e && e.message) || String(e) });
        }
      }
      const valid = jobs.filter(j => !j._error);
      const errs = jobs.filter(j => j._error).map(j => j._error);
      if (errs.length) console.warn('[bili-dl] 跳过不可下载分P：', errs);
      if (!valid.length) {
        const msg = skipCount ? `已跳过 ${skipCount} 个已下载分P（无新内容）` : '所有分P均无可下载的流';
        setStatus(msg);
        return;
      }
      if (skipCount) setStatus(`已跳过 ${skipCount} 个已下载分P，正在下载其余 ${valid.length} 个…`);
      dispatchTask(valid, nf); // 设置 currentReqId / currentBatchMeta
      // 进入运行态：禁用勾选、按钮变「取消」
      batchRunning = true;
      rowEls.forEach(r => { if (r.cb) { r.cb.disabled = true; r.row.classList.add('cb-disabled'); } });
      const b = document.getElementById('bili-dl-batch');
      if (b) { b.textContent = '⛔ 取消下载'; b.style.display = 'block'; }
      updateBatchHeader();
      // 视频任务提交后，若勾选了辅助下载则异步附带字幕/弹幕/封面（不阻塞主流程）
      const auxOn = document.getElementById('bili-dl-aux-sub')?.checked
        || document.getElementById('bili-dl-aux-dan')?.checked
        || document.getElementById('bili-dl-aux-cover')?.checked;
      if (auxOn) runAuxDownloads(pages).catch(e => console.warn('[bili-dl] aux 异步下载异常', e));
    }
  }

  // ---------- 初始化 ----------
  function isVideoPage() { return /^https?:\/\/(www|m)\.bilibili\.com\/video\//.test(location.href); }
  function init() { if (!isVideoPage()) return; buildUI(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; ctx = null; init(); }
  }, 1500);
})();
