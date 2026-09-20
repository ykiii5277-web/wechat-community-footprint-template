const cloud = require('./cloud-service');

// 使用微信原生预览器：支持全屏、多图切换、双指缩放和长按保存菜单。
async function open(paths, index = 0) {
  const source = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!source.length) return wx.showToast({ title: '图片暂不可查看', icon: 'none' });
  const resolved = await cloud.resolveCloudFiles(source);
  const urls = resolved.filter(Boolean);
  if (!urls.length) return wx.showToast({ title: '图片加载失败', icon: 'none' });
  const currentIndex = Math.max(0, Math.min(urls.length - 1, Number(index) || 0));
  wx.previewImage({
    current: urls[currentIndex],
    urls,
    showmenu: true,
    fail: () => wx.showToast({ title: '图片预览失败，请稍后重试', icon: 'none' })
  });
}

module.exports = { open };
