const cloud = require('./cloud-service');

function isVideo(item) {
  return !!item && (item.mediaType === 'video' || /^(mp4|mov|m4v|webm|3gp|avi|mkv|flv|wmv|mpeg|mpg|ts)$/i.test(item.fileType || '') || /\.(mp4|mov|m4v|webm|3gp|avi|mkv|flv|wmv|mpeg|mpg|ts)(?:\?|$)/i.test(item.fileName || item.filePath || ''));
}
function videoInfo(src) {
  return new Promise((resolve, reject) => wx.getVideoInfo({ src, success: resolve, fail: reject }));
}
async function prepareVideo(src) {
  if (typeof wx.compressVideo !== 'function' || typeof wx.getVideoInfo !== 'function') throw new Error('当前微信不支持视频压缩，请更新微信后重试');
  const info = await videoInfo(src);
  const width = Number(info.width) || 1280;
  const height = Number(info.height) || 720;
  // 目标为不超过 1280×720（竖屏相反），保留原比例，不放大小尺寸视频。
  const resolution = Math.min(1, 1280 / Math.max(width, height), 720 / Math.min(width, height));
  const result = await new Promise((resolve, reject) => wx.compressVideo({
    src, bitrate: 1500, fps: Math.min(30, Number(info.fps) || 30), resolution,
    success: resolve, fail: () => reject(new Error('视频压缩失败，请重新选择；不会直接上传未压缩视频'))
  }));
  if (!result.tempFilePath) throw new Error('视频压缩没有返回文件，请重试');
  const size = await cloud.fileSize(result.tempFilePath);
  if (!size) throw new Error('无法读取压缩后的视频大小，请重新选择');
  if (size > cloud.MAX_VIDEO_FILE_BYTES) throw new Error('压缩后的视频不能超过500M');
  return { path: result.tempFilePath, size, duration: Number(info.duration) || 0 };
}
async function playbackUrl(item) {
  if (!isVideo(item) || !item.filePath) return '';
  if (/^https:\/\//i.test(item.fileUrl || '')) return item.fileUrl;
  const paths = await cloud.resolveCloudFiles([item.filePath]);
  const url = paths[0];
  if (!/^https?:\/\//i.test(url || '')) throw new Error('暂时无法获取视频地址，请稍后重试');
  return url;
}

async function downloadVideo(item) {
  const path = item.filePath;
  if (!cloud.isRemoteFile(path)) return path;
  if (/^cloud:\/\//i.test(path) && wx.cloud && wx.cloud.downloadFile) {
    try {
      const result = await wx.cloud.downloadFile({ fileID: path });
      if (result.tempFilePath) return result.tempFilePath;
    } catch {
      // 好友或公开访客可用云函数签发的临时地址。
    }
  }
  const url = await playbackUrl(item);
  const result = await new Promise((resolve, reject) => wx.downloadFile({ url, success: resolve, fail: reject }));
  if (!(result.statusCode >= 200 && result.statusCode < 300) || !result.tempFilePath) throw new Error('VIDEO_DOWNLOAD_FAILED');
  return result.tempFilePath;
}

let savingVideo = false;
async function saveVideo(loadWork) {
  if (savingVideo) return;
  if (typeof wx.saveVideoToPhotosAlbum !== 'function') {
    return wx.showToast({ title: '当前微信版本无法保存视频', icon: 'none' });
  }
  savingVideo = true;
  let filePath;
  wx.showLoading({ title: '正在下载视频', mask: true });
  try {
    const item = await loadWork();
    if (!isVideo(item) || !item.filePath) {
      wx.hideLoading();
      return wx.showToast({ title: '该视频暂不可下载', icon: 'none' });
    }
    filePath = await downloadVideo(item);
    wx.hideLoading();
    await new Promise((resolve, reject) => wx.saveVideoToPhotosAlbum({ filePath, success: resolve, fail: reject }));
    wx.showToast({ title: '视频已保存到相册', icon: 'success' });
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!filePath) wx.hideLoading();
    if (filePath && /permission is not declared|api scope is not declared|privacy.*(?:not configured|banned)|errno[^\d]*112/i.test(message)) {
      wx.showToast({ title: '暂未开通保存到相册的权限', icon: 'none' });
    } else if (filePath && /auth|permission|deny/i.test(message)) {
      wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存到手机相册，再点击保存视频。', confirmText: '去设置', success: result => { if (result.confirm) wx.openSetting({}); } });
    } else {
      wx.showToast({ title: filePath ? '无法保存视频，请检查格式或手机空间' : '视频下载失败，请稍后重试', icon: 'none' });
    }
  } finally {
    savingVideo = false;
  }
}
module.exports = { isVideo, prepareVideo, playbackUrl, saveVideo };
