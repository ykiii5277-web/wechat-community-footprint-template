// 只在用户主动选择图片或文件时申请隐私授权，不在启动阶段打扰用户。
function rawError(error) { return String(error && (error.errMsg || error.message) || error || ''); }
function isCancel(error) { return /cancel/i.test(rawError(error)); }

function privacyError(error) {
  const raw = rawError(error);
  const configurationError = /privacy.*(not|未).*config|未配置|not configured|permission is not declared|api scope is not declared|appid privacy api banned/i.test(raw);
  wx.showModal({
    title: configurationError ? '隐私指引尚未配置' : '需要隐私授权',
    content: configurationError ? '请先在微信公众平台填写并发布《用户隐私保护指引》，声明“选中的照片或视频”和“摄像头”用途，然后重新编译小程序。' : '选择照片需要先同意《用户隐私保护指引》。同意后请再次点击上传。',
    showCancel: false,
    confirmText: '知道了'
  });
}

function authorize(next) {
  if (typeof wx === 'undefined') return;
  if (typeof wx.getPrivacySetting !== 'function') {
    if (typeof wx.requirePrivacyAuthorize !== 'function') return next();
    return wx.requirePrivacyAuthorize({ success: next, fail: privacyError });
  }
  wx.getPrivacySetting({
    success: result => {
      if (!result || !result.needAuthorization || typeof wx.requirePrivacyAuthorize !== 'function') return next();
      wx.requirePrivacyAuthorize({ success: next, fail: privacyError });
    },
    // 部分旧版开发者工具不完整支持 getPrivacySetting，此时仍允许系统选图接口
    // 自己拉起官方隐私授权，不能因此直接拦截本地图片选择。
    fail: next
  });
}

function normalizeImageResult(result) {
  const source = result || {};
  const paths = [];
  (source.tempFiles || []).forEach(file => {
    const path = typeof file === 'string' ? file : (file.tempFilePath || file.path || '');
    if (path) paths.push({ tempFilePath: path, size: Number(file && file.size) || 0 });
  });
  (source.tempFilePaths || []).forEach(path => {
    if (path && !paths.some(file => file.tempFilePath === path)) paths.push({ tempFilePath: path });
  });
  return Object.assign({}, source, { tempFiles: paths, tempFilePaths: paths.map(file => file.tempFilePath) });
}

function chooseImageErrorMessage(error) {
  const raw = rawError(error);
  if (/permission is not declared|api scope is not declared|appid privacy api banned|errno[^\d]*(112)/i.test(raw)) return '当前 AppID 尚未取得选图权限：请在微信公众平台发布隐私保护指引，并声明照片与摄像头用途';
  if (/privacy|authorize|auth deny/i.test(raw)) return '请先同意隐私保护指引，再重新选择图片';
  if (/permission|auth deny|authorize/i.test(raw)) return '未获得相册权限，请在微信设置中允许访问照片';
  if (/not supported|not support|unsupported|invalid api/i.test(raw)) return '当前开发者工具无法打开本地图片，请更新工具或使用真机预览';
  if (/fail.*system|system error|internal error/i.test(raw)) return '系统图片选择器打开失败，请重新编译后再试';
  return '本地图片读取失败，请重新选择；若仍失败请使用真机预览';
}

function showChooseImageError(error) {
  if (isCancel(error)) return;
  wx.showModal({ title: '无法选择图片', content: chooseImageErrorMessage(error), showCancel: false, confirmText: '知道了' });
}

function chooseMedia(options) {
  const config = Object.assign({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] }, options || {});
  const success = config.success;
  const fail = config.fail;
  const complete = config.complete;
  const onlyImages = (config.mediaType || ['image']).every(type => type === 'image');
  const onSuccess = result => {
    const normalized = normalizeImageResult(result);
    if (!normalized.tempFiles.length) return onFail(new Error('chooseImage:fail empty result'));
    if (success) success(normalized);
    if (complete) complete(normalized);
  };
  const onFail = error => {
    if (fail) fail(error);
    else showChooseImageError(error);
    if (complete) complete(error);
  };
  authorize(() => {
    // 项目中的图片入口全部是纯图片选择。chooseImage 在 Windows 开发者工具、
    // 旧基础库和真机上的本地相册兼容性更好，返回值再统一成 chooseMedia 格式。
    if (onlyImages && typeof wx.chooseImage === 'function') {
      return wx.chooseImage({ count: config.count, sourceType: config.sourceType, sizeType: config.sizeType, success: onSuccess, fail: onFail });
    }
    if (typeof wx.chooseMedia === 'function') {
      return wx.chooseMedia({ count: config.count, mediaType: config.mediaType, sourceType: config.sourceType, sizeType: config.sizeType, maxDuration: config.maxDuration, camera: config.camera, success: onSuccess, fail: onFail });
    }
    onFail(new Error('chooseMedia:fail not supported'));
  });
}

function chooseMessageFile(options) {
  authorize(() => wx.chooseMessageFile(options || {}));
}

function openContract() {
  if (typeof wx !== 'undefined' && typeof wx.openPrivacyContract === 'function') {
    wx.openPrivacyContract({
      fail: () => wx.showModal({ title: '暂未打开', content: '请先在微信公众平台完成《小程序用户隐私保护指引》配置并发布，再重新打开。', showCancel: false })
    });
    return;
  }
  wx.showModal({ title: '当前版本暂不支持', content: '请升级微信后查看微信隐私保护指引。', showCancel: false });
}

module.exports = { chooseMedia, chooseMessageFile, showChooseImageError, openContract };
