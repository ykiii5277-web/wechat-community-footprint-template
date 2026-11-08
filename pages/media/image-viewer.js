const sessions = require('../../utils/image-viewer-session');
const cloud = require('../../utils/cloud-service');

function point(touch) {
  return { x: touch.clientX ?? touch.pageX, y: touch.clientY ?? touch.pageY };
}

function pinch(touches) {
  const a = point(touches[0]);
  const b = point(touches[1]);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
}

function invoke(name, options) {
  return new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject })));
}

function errorText(error) {
  return String(error && (error.errMsg || error.message) || '');
}

async function localImagePath(image) {
  const source = image.path || image.url;
  if (!source) throw new Error('EMPTY_IMAGE_SOURCE');
  if (!cloud.isRemoteFile(source)) return source;

  const fileId = /^cloud:\/\//i.test(source) ? source : '';
  const errors = [];
  if (fileId && wx.cloud && typeof wx.cloud.downloadFile === 'function') {
    try {
      const result = await wx.cloud.downloadFile({ fileID: fileId });
      if (result && result.tempFilePath) return result.tempFilePath;
    } catch (error) { errors.push(errorText(error)); }
  }

  const urls = new Set();
  async function download(url) {
    if (!/^https?:\/\//i.test(url || '') || !cloud.isRemoteFile(url) || urls.has(url)) return '';
    urls.add(url);
    try {
      const result = await invoke('downloadFile', { url });
      if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath) return result.tempFilePath;
      errors.push(`HTTP_${result.statusCode || 0}`);
    } catch (error) { errors.push(errorText(error)); }
    return '';
  }
  let path = await download(image.url);
  if (!path && !fileId) path = await download(source);
  if (!path && fileId) {
    const [url] = await cloud.resolveCloudFiles([fileId]).catch(() => []);
    path = await download(url);
  }
  if (path) return path;
  // 可见的网络图也可能已经由微信缓存，尝试取得可写入相册的本地路径。
  if (typeof wx.getImageInfo === 'function') {
    for (const src of urls) {
      try {
        const result = await invoke('getImageInfo', { src });
        if (result.path && !cloud.isRemoteFile(result.path)) return result.path;
      } catch (error) { errors.push(errorText(error)); }
    }
  }
  throw new Error(errors.filter(Boolean).join(' | ') || 'IMAGE_DOWNLOAD_FAILED');
}

Page({
  data: { images: [], total: 0, current: 0, zoomed: false, imageTransform: '', saving: false, topInset: 24 },
  onLoad(options) {
    this.sessionId = options.session;
    const session = sessions.get(this.sessionId);
    if (!session || !session.images.length) {
      wx.showToast({ title: '图片预览已结束，请重新打开', icon: 'none' });
      return wx.navigateBack();
    }
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._viewport = { width: windowInfo.windowWidth, height: windowInfo.windowHeight };
    this._imageSizes = new Map();
    this._transform = { scale: 1, x: 0, y: 0 };
    this.setData({ images: session.images, total: session.images.length, current: session.current, topInset: Number(windowInfo.statusBarHeight) || 24 });
  },
  onResize({ size }) {
    this._viewport = { width: size.windowWidth, height: size.windowHeight };
    this._gesture = null;
    if (this._transform) this.applyTransform(this._transform);
  },
  onUnload() {
    this._unloaded = true;
    const current = this.data.current;
    Promise.resolve().then(() => sessions.finish(this.sessionId, current)).catch(() => {
      wx.showToast({ title: '图片详情刷新失败，请重新进入', icon: 'none' });
    });
  },
  close() { wx.navigateBack(); },
  showImage(current) {
    if (!Number.isInteger(current) || !this.data.images[current] || current === this.data.current) return;
    this._gesture = null;
    this._transform = { scale: 1, x: 0, y: 0 };
    this.setData({ current, zoomed: false, imageTransform: '' });
  },
  change(e) { this.showImage(Number(e.detail.current)); },
  imageLoad(e) {
    const index = Number(e.currentTarget.dataset.index);
    const { width, height } = e.detail;
    if (width > 0 && height > 0) this._imageSizes.set(index, { width, height });
  },
  applyTransform({ scale, x, y }) {
    const { width, height } = this._viewport;
    const image = this._imageSizes.get(this.data.current);
    const fit = image ? Math.min(width / image.width, height / image.height) : 1;
    const limitX = Math.max(0, ((image ? image.width * fit : width) * scale - width) / 2);
    const limitY = Math.max(0, ((image ? image.height * fit : height) * scale - height) / 2);
    x = Math.max(-limitX, Math.min(limitX, x));
    y = Math.max(-limitY, Math.min(limitY, y));
    this._transform = { scale, x, y };
    const imageTransform = scale === 1 ? '' : `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    if (imageTransform !== this.data.imageTransform) this.setData({ imageTransform, zoomed: scale > 1 });
  },
  startGesture(touches, canSwipe) {
    if (!touches.length) return;
    if (touches.length > 1) {
      this._gesture = { type: 'pinch', start: pinch(touches), transform: this._transform };
    } else {
      const type = this._transform.scale > 1 ? 'pan' : canSwipe ? 'swipe' : 'hold';
      this._gesture = { type, start: point(touches[0]), transform: this._transform };
    }
  },
  touchStart(e) { this.startGesture(e.touches || [], true); },
  touchMove(e) {
    const touches = e.touches || [];
    const gesture = this._gesture;
    if (!gesture || !touches.length) return;
    if (touches.length > 1 && gesture.type !== 'pinch') return this.startGesture(touches, false);
    if (touches.length > 1 && gesture.type === 'pinch') {
      const next = pinch(touches);
      const start = gesture.start;
      if (!start.distance) return;
      const initial = gesture.transform;
      let scale = Math.max(1, Math.min(5, initial.scale * next.distance / start.distance));
      if (scale < 1.01) scale = 1;
      const ratio = scale / initial.scale;
      const centerX = this._viewport.width / 2;
      const centerY = this._viewport.height / 2;
      // 让双指中点下的图像位置跟随手势，缩放时不会跳回屏幕中心。
      this.applyTransform({
        scale,
        x: next.x - centerX - (start.x - centerX - initial.x) * ratio,
        y: next.y - centerY - (start.y - centerY - initial.y) * ratio
      });
    } else if (touches.length === 1 && gesture.type === 'pan') {
      const next = point(touches[0]);
      this.applyTransform({
        scale: gesture.transform.scale,
        x: gesture.transform.x + next.x - gesture.start.x,
        y: gesture.transform.y + next.y - gesture.start.y
      });
    }
  },
  touchEnd(e) {
    const touches = e.touches || [];
    if (touches.length) return this.startGesture(touches, false);
    const gesture = this._gesture;
    this._gesture = null;
    const ended = (e.changedTouches || [])[0];
    if (!gesture || gesture.type !== 'swipe' || !ended) return;
    const end = point(ended);
    const dx = end.x - gesture.start.x;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(end.y - gesture.start.y) * 1.25) {
      this.showImage(this.data.current + (dx < 0 ? 1 : -1));
    }
  },
  touchCancel() { this._gesture = null; },
  async imageError(e) {
    const index = Number(e.currentTarget.dataset.index);
    const image = this.data.images[index];
    if (!image || this._unloaded) return;
    this._resolvedFallbacks = this._resolvedFallbacks || new Set();
    if (/^cloud:\/\//i.test(image.url) && !this._resolvedFallbacks.has(index)) {
      this._resolvedFallbacks.add(index);
      const [url] = await cloud.resolveCloudFiles([image.path]).catch(() => []);
      if (this._unloaded) return;
      if (url && url !== image.url) return this.setData({ [`images[${index}].url`]: url, [`images[${index}].failed`]: false });
    }
    this.setData({ [`images[${index}].failed`]: true });
  },
  async save() {
    if (this.data.saving) return;
    const image = this.data.images[this.data.current];
    if (!image) return;
    this.setData({ saving: true });
    let filePath;
    try {
      filePath = await localImagePath(image);
      if (this._unloaded) return;
      await invoke('saveImageToPhotosAlbum', { filePath });
      if (!this._unloaded) wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      if (this._unloaded) return;
      const message = errorText(error);
      if (!filePath) {
        const detail = /domain|合法域名/i.test(message) ? '当前图片的下载地址未获微信允许。'
          : /HTTP_40[134]|file.*(?:not.exist|not.found)|forbidden/i.test(message) ? '图片链接可能已失效，请退出预览后重新打开。'
          : '暂时无法下载这张图片，请稍后重试。';
        return wx.showModal({ title: '图片下载失败', content: detail, showCancel: false });
      }
      if (/permission is not declared|api scope is not declared|privacy.*(?:not configured|banned)|errno[^\d]*112/i.test(message) || error && error.errno === 112) {
        return wx.showModal({ title: '暂未开通保存到相册', content: '请联系小程序管理员，在用户隐私保护指引中声明相册写入权限。', showCancel: false });
      }
      if (/privacy/i.test(message)) return wx.showToast({ title: '请同意隐私保护指引后再保存', icon: 'none' });
      if (/auth|authorize|permission|denied|deny/i.test(message)) {
        return wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到手机相册，再重新保存。', confirmText: '去设置', cancelText: '取消', success: result => { if (result.confirm) wx.openSetting({}); } });
      }
      wx.showToast({ title: '无法写入相册，请检查图片格式或手机空间', icon: 'none' });
    } finally { if (!this._unloaded) this.setData({ saving: false }); }
  }
});
