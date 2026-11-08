const cloud = require('./cloud-service');
const nav = require('./nav');

// 调用方只传入当前账号或云端已授权返回的照片，不能混入别的相册、活动或时期。
function albumPhotos(photos, current) {
  if (!current) return [];
  const value = input => nav.decode(input).trim();
  return (photos || []).filter(photo => photo && photo.image && (!photo.kind || photo.kind === 'photo') &&
    ['folderId', 'campId', 'stageId', 'subcampId', 'activityName'].every(key => value(photo[key]) === value(current[key])));
}

function openAlbum(photos, current, options = {}) {
  if (!current) return;
  const group = albumPhotos(photos, current);
  const index = group.findIndex(photo => String(photo.id) === String(current.id));
  const selected = index >= 0 ? group : [current];
  const viewerOptions = typeof options.onClose === 'function' ? {
    onClose: index => options.onClose(selected[index]), useCloudFileIds: options.useCloudFileIds
  } : {};
  return open(selected.map(photo => photo.image), Math.max(0, index), viewerOptions);
}

// 使用微信原生预览器：支持全屏、多图切换、双指缩放和长按保存菜单。
async function open(paths, index = 0, options = {}) {
  const source = (Array.isArray(paths) ? paths : [paths]).map((path, index) => ({ path, index })).filter(item => item.path);
  if (!source.length) return wx.showToast({ title: '图片暂不可查看', icon: 'none' });
  try {
    const selected = source.find(item => item.index === Math.floor(Number(index) || 0)) || source[0];
    const paths = source.map(item => item.path);
    // 自己的相册由小程序 image 直接读取云文件。全屏页只渲染当前图片和相邻图片。
    const resolved = options.useCloudFileIds && typeof options.onClose === 'function' ? paths : await cloud.resolveCloudFiles(paths);
    const usable = source.map((item, position) => Object.assign({}, item, { url: resolved[position] })).filter(item => item.url);
    if (!usable.length) return wx.showToast({ title: '图片加载失败', icon: 'none' });
    const current = usable.find(item => item.index === selected.index) || usable[0];
    if (typeof options.onClose === 'function') {
      const sessions = require('./image-viewer-session');
      const session = sessions.create(usable, usable.indexOf(current), options.onClose);
      return wx.navigateTo({
        url: `/pages/media/image-viewer?session=${encodeURIComponent(session)}`,
        fail: () => { sessions.discard(session); wx.showToast({ title: '图片预览失败，请稍后重试', icon: 'none' }); }
      });
    }
    return wx.previewImage({
      current: current.url, urls: usable.map(item => item.url), showmenu: true,
      fail: () => wx.showToast({ title: '图片预览失败，请稍后重试', icon: 'none' })
    });
  } catch (error) { return wx.showToast({ title: '图片加载失败，请稍后重试', icon: 'none' }); }
}

module.exports = { open, openAlbum, albumPhotos };
