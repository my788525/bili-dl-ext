// popup 仅做状态展示：ffmpeg 已随扩展本地内置，无需 CDN 设置。
// 保留空逻辑以保持脚本可加载，不依赖任何存储项。
const tip = document.getElementById('tip');
if (tip) tip.textContent = '';
