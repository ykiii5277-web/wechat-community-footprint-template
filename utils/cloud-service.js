// 云端通信层：页面和 data.js 不直接操作云函数或云存储，上传必须取得可跨设备访问的 cloud:// 文件 ID。
const appConfig = require('../config/app-config');
const FUNCTION_NAME = appConfig.cloudFunctionName || 'hui-api';
// 在 config/app-config.js 配置自己的云环境，前端和云函数应属于同一个环境。
const CLOUD_ENV_ID = appConfig.cloudEnvId || '';
const STORAGE_PREFIX = appConfig.storagePrefix || 'community-footprint';
// 图片安全检查当前接收不超过 1MB 的文件；900KB 是压缩目标，不是用户原图的上传上限。
const MAX_SAFE_IMAGE_BYTES = 900 * 1024;
const MAX_MEDIA_FILE_BYTES = 1000 * 1024 * 1024;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_FILE_BYTES = 500 * 1024 * 1024;
const IMAGE_CATEGORIES = ['images', 'avatars', 'photos', 'growth', 'folder-covers', 'activity-covers', 'companion-avatars', 'memory-books'];
let cloudInitialized = false;
let uploadErrorVisible = false;

function initCloud() {
  if (typeof wx === 'undefined' || !wx.cloud) return false;
  if (!cloudInitialized) {
    const environment = CLOUD_ENV_ID || wx.cloud.DYNAMIC_CURRENT_ENV;
    try {
      const options = { traceUser: true };
      if (environment) options.env = environment;
      wx.cloud.init(options);
      cloudInitialized = true;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function canUseCloud() {
  return initCloud() && typeof wx.cloud.callFunction === 'function';
}

// 云函数异常不会打断本地编辑；调用方拿到 null 后使用 data.js 的本地兜底结果。
function call(action, payload = {}) {
  if (!canUseCloud()) return Promise.resolve(null);
  return wx.cloud.callFunction({ name: FUNCTION_NAME, data: { action, payload } })
    .then(result => {
      const response = result && result.result ? result.result : null;
      if (response && response.error === 'PROFILE_REQUIRED' && typeof getApp === 'function') {
        const app = getApp();
        if (app && app.globalData) { app.globalData.profileRequired = true; if (app.ensureProfileOnboarding) app.ensureProfileOnboarding(); }
      }
      return response;
    })
    .catch(error => ({
      error: 'CLOUD_CALL_FAILED',
      message: String(error && (error.errMsg || error.message) || '云端连接失败，请稍后重试').replace(/^cloud\.callFunction:fail\s*/i, '').slice(0, 100)
    }));
}

// 上传成功时返回 cloud:// 文件 ID，好友和其他用户才能读取图片；失败时仍保留本地文件方便继续编辑。
function isRemoteFile(path) {
  const value = String(path || '');
  return /^(cloud:\/\/|https?:\/\/)/i.test(value) && !/^https?:\/\/(tmp|usr|store|localhost|127\.0\.0\.1)([/:]|$)/i.test(value);
}

function fileSize(path) {
  return new Promise((resolve, reject) => {
    const success = result => resolve(Math.max(0, Number(result && result.size) || 0));
    const fail = error => reject(error || new Error('FILE_INFO_FAILED'));
    if (typeof wx.getFileInfo === 'function') return wx.getFileInfo({ filePath: path, success, fail });
    const manager = wx.getFileSystemManager && wx.getFileSystemManager();
    if (manager && typeof manager.getFileInfo === 'function') return manager.getFileInfo({ filePath: path, success, fail });
    resolve(0);
  });
}

function compressImage(path, quality, width, height) {
  return new Promise((resolve, reject) => {
    if (typeof wx.compressImage !== 'function') return reject(new Error('当前微信不支持图片压缩，请更新微信后重试'));
    wx.compressImage({
      src: path, quality, compressedWidth: width, compressedHeight: height,
      success: result => result && result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('图片压缩未返回文件，请重试')),
      fail: () => reject(new Error('图片自动压缩失败，请重试或重新选择图片'))
    });
  });
}

function imageExtension(path, fallbackName = '') {
  return new Promise(resolve => {
    const fallback = String(fallbackName || path).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    const fallbackExtension = fallback ? `.${fallback[1].toLowerCase()}` : '.jpg';
    if (typeof wx.getImageInfo !== 'function') return resolve(fallbackExtension);
    wx.getImageInfo({
      src: path,
      success: result => {
        const type = String(result && result.type || '').toLowerCase();
        if (type === 'jpeg' || type === 'jpg') return resolve('.jpg');
        if (['png', 'gif', 'webp'].indexOf(type) >= 0) return resolve(`.${type}`);
        resolve(fallbackExtension);
      },
      fail: () => resolve(fallbackExtension)
    });
  });
}

async function prepareImage(path) {
  const size = await fileSize(path);
  if (!size) throw new Error('无法读取图片大小，请重新选择图片');
  if (size > MAX_IMAGE_FILE_BYTES) throw new Error('单张图片不能超过20M');
  if (size <= MAX_SAFE_IMAGE_BYTES) return path;
  const info = await new Promise((resolve, reject) => {
    if (typeof wx.getImageInfo !== 'function') return reject(new Error('无法读取图片尺寸，请更新微信后重试'));
    wx.getImageInfo({ src: path, success: resolve, fail: () => reject(new Error('无法读取图片，请重新选择图片')) });
  });
  const width = Number(info.width), height = Number(info.height);
  if (!(width > 0 && height > 0)) throw new Error('无法读取图片尺寸，请重新选择图片');
  // 优先保留原尺寸，在质量 88～98 之间寻找符合上限的最高参数；确有必要才缩小像素。
  // 每次从同一份原图生成，不能使用上一轮压缩结果。PNG 不支持有损质量调整。
  const jpeg = /^(jpg|jpeg)$/i.test(String(info.type || ''));
  const originalEdge = Math.max(width, height);
  const minimumEdge = Math.min(originalEdge, 1080);
  let edge = originalEdge;
  const encode = async quality => {
    const scale = Math.min(1, edge / originalEdge);
    const current = await compressImage(path, quality, Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
    const compressedSize = await fileSize(current);
    if (!compressedSize) throw new Error('无法读取压缩后的图片，请重试');
    return { path: current, size: compressedSize };
  };
  for (;;) {
    let candidate = await encode(98);
    if (candidate.size <= MAX_SAFE_IMAGE_BYTES) return candidate.path;
    if (jpeg) {
      candidate = await encode(88);
      if (candidate.size <= MAX_SAFE_IMAGE_BYTES) {
        let best = candidate, low = 89, high = 97;
        while (low <= high) {
          const quality = Math.floor((low + high) / 2);
          const trial = await encode(quality);
          if (trial.size <= MAX_SAFE_IMAGE_BYTES) { best = trial; low = quality + 1; }
          else high = quality - 1;
        }
        return best.path;
      }
    }
    if (edge === minimumEdge) break;
    // 根据实际输出体积估算下一尺寸，限制每轮降幅，避免直接从大合照跳到小图。
    const factor = Math.max(0.75, Math.min(0.95, Math.sqrt(MAX_SAFE_IMAGE_BYTES / candidate.size) * 0.98));
    edge = Math.max(minimumEdge, Math.floor(edge * factor));
  }
  // 安全接口的大小限制不能以悄悄压到 360px、质量 50 的方式满足。
  throw new Error('当前图片无法在安全检测大小限制内保留清晰度，请换用JPG图片后重试');
}

function uploadErrorMessage(error) {
  const raw = String(error && (error.errMsg || error.message) || error || '');
  if (/^[\u4e00-\u9fa5]/.test(raw)) return raw.slice(0, 80);
  if (/privacy|authorize|auth deny/i.test(raw)) return '请先同意隐私保护指引，再选择图片';
  if (/quota|storage.*(full|limit)|space.*(full|limit)|exceed/i.test(raw)) return '云存储空间或上传额度已满，请先在云开发控制台扩容';
  if (/企业小程序云环境|env|environment|cloud init|-501000|-404011/i.test(raw)) return '尚未配置企业小程序云环境，请先创建云环境并填写环境 ID';
  if (/permission|forbidden|unauthorized|auth fail/i.test(raw)) return '云存储没有上传权限，请检查云环境存储权限';
  if (/file.*(not found|not exist)|no such file/i.test(raw)) return '所选图片已失效，请重新选择';
  if (/network|timeout|fail connect/i.test(raw)) return '网络连接不稳定，请稍后重新上传';
  return '图片上传失败，请检查云存储配置后重试';
}

function showUploadError(error, title = '上传失败', retry) {
  if (error && error.cancelled) return;
  if (uploadErrorVisible) return;
  uploadErrorVisible = true;
  wx.showModal({
    title,
    content: uploadErrorMessage(error),
    showCancel: typeof retry === 'function',
    confirmText: typeof retry === 'function' ? '重试' : '知道了',
    cancelText: '取消',
    success: result => { if (result.confirm && typeof retry === 'function') setTimeout(retry, 0); },
    complete: () => { uploadErrorVisible = false; }
  });
}

let imagePreparation = Promise.resolve();
function prepareImageForUpload(tempPath, sourceName) {
  // 同时传输两张图片，但一次只解码和压缩一张，避免大图挤占手机内存。
  const prepared = imagePreparation.then(async () => {
    const filePath = await prepareImage(tempPath);
    return { filePath, extension: await imageExtension(filePath, sourceName) };
  });
  imagePreparation = prepared.catch(() => {});
  return prepared;
}

function createUploadAttempt(tempPath, category, sourceName) {
  const uploadKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let prepared;
  // 图片发布必须得到 cloud:// 文件 ID；退回本地路径会造成自己能看见、其他用户无法渲染的假成功。
  return async () => {
    if (!tempPath || isRemoteFile(tempPath)) return tempPath || '';
    try {
      if (!canUseCloud() || !wx.cloud.uploadFile) throw new Error('上传服务暂时不可用，请检查网络后重试');
      if (!prepared) {
        const videoFile = category === 'work-videos' || category === 'work-files' && /\.(mp4|mov|m4v|webm|3gp|avi|mkv|flv|wmv|mpeg|mpg|ts)(?:\?|$)/i.test(sourceName || tempPath);
        const imageFile = IMAGE_CATEGORIES.includes(category) || category === 'work-files' && /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)(?:\?|$)/i.test(sourceName || tempPath);
        if (!imageFile && await fileSize(tempPath) > (videoFile ? MAX_VIDEO_FILE_BYTES : MAX_MEDIA_FILE_BYTES)) {
          throw new Error(videoFile ? '压缩后的视频不能超过500M' : '单个文件不能超过1000M');
        }
        // 消息文件的临时路径可能没有扩展名，优先使用原文件名。
        const match = String(sourceName || tempPath).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
        const { filePath, extension } = imageFile
          ? await prepareImageForUpload(tempPath, sourceName)
          : { filePath: tempPath, extension: match ? `.${match[1].toLowerCase()}` : '' };
        const safeCategory = String(category || 'files').replace(/[^a-z0-9-]/gi, '-');
        prepared = { filePath, cloudPath: `${STORAGE_PREFIX}/${safeCategory}/${uploadKey}${extension}` };
      }
      const result = await wx.cloud.uploadFile(prepared);
      if (!result || !result.fileID) throw new Error('UPLOAD_NO_FILE_ID');
      return result.fileID;
    } catch (error) {
      if (/file.*(?:not found|not exist)|no such file/i.test(String(error && (error.errMsg || error.message) || ''))) prepared = null;
      const wrapped = new Error(uploadErrorMessage(error));
      wrapped.originalError = error;
      throw wrapped;
    }
  };
}

async function persistFile(tempPath, category = 'images', sourceName = '', options = {}) {
  const attempt = createUploadAttempt(tempPath, category, sourceName);
  return options.silent ? attempt() : require('./retry').run(attempt, { title: '上传失败' });
}

// 两张一组，保留选图顺序，避免大图同时压缩占用过多内存。
async function persistImages(paths, category, onBatch) {
  for (let offset = 0; offset < paths.length; offset += 2) {
    const attempts = paths.slice(offset, offset + 2).map(path => createUploadAttempt(path, category, ''));
    const uploaded = [];
    try {
      await require('./retry').run(async () => {
        const results = await Promise.allSettled(attempts.map(async (attempt, index) => {
          if (!uploaded[index]) uploaded[index] = await attempt();
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      }, { title: '照片上传失败' });
    } finally {
      const completed = uploaded.filter(Boolean);
      if (completed.length) onBatch(completed);
    }
  }
}

// 把 cloud:// 文件 ID 换成当前用户可直接渲染的临时 HTTPS 地址。
// 转换失败时保留原值，详情页仍可继续展示文字内容并给出明确提示。
async function resolveCloudFiles(paths) {
  const source = Array.isArray(paths) ? paths : [];
  const cloudIds = [...new Set(source.filter(path => /^cloud:\/\//i.test(String(path || ''))))];
  if (!cloudIds.length || !canUseCloud() || !wx.cloud.getTempFileURL) return Promise.resolve(source.slice());
  const urls = {};
  for (let index = 0; index < cloudIds.length; index += 50) {
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: cloudIds.slice(index, index + 50) });
      (result.fileList || []).forEach(item => { if (item && item.fileID && item.tempFileURL) urls[item.fileID] = item.tempFileURL; });
    } catch (error) { /* 单批失败不丢弃其他批次已解析的地址。 */ }
  }
  return source.map(path => urls[path] || path);
}

function saveProfile(profile) { return call('profile.upsert', { profile }); }
function bootstrap(profile) { return call('profile.bootstrap', { profile }); }
function getCurrentProfile() { return call('profile.current'); }
function getOwnState() { return call('state.mine'); }
function upsertContent(kind, item) { return call('content.upsert', { kind, item }); }
function deleteContent(kind, id) { return call('content.delete', { kind, id }); }
function getContent(kind, id, ownerUid, recordId) { return call('content.get', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function recordView(kind, id, ownerUid, recordId) { return call('content.view', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function toggleLike(kind, id, ownerUid, recordId, favorite) { return call('content.like', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '', favorite }); }
function upsertComment(comment) { return call('comment.upsert', { comment }); }
function deleteComments(targetType, targetId) { return call('comment.deleteForTarget', { targetType, targetId }); }
function deleteComment(id) { return call('comment.delete', { id }); }
function getComments(kind, id, ownerUid, recordId) { return call('comment.list', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function saveComment(comment) { return call('comment.upsert', { comment }); }
function toggleCommentLike(id, favorite) { return call('comment.like', { id, favorite }); }
function getFavoriteItems(type) { return call('favorite.list', { type }); }
// 举报仍由云端验证访问权限和“不能举报自己”的规则，前端只负责提交举报理由。
function createReport(payload) { return call('report.create', payload); }
function sendFeedback(content) { return call('feedback.send', { content: content || '' }); }
function requestAccountDeletion(reason) { return call('account.deleteRequest', { reason: reason || '' }); }
function getPublicRanking(options) { return call('content.publicList', options); }
function getPublicYears() { return call('content.publicYears'); }
function getFriends() { return call('friend.list'); }
function getFriend(uid) { return call('friend.get', { uid }); }
function getFriendRequests() { return call('friend.requests'); }
function createFriendRequest(toUid, reason) { return call('friend.request', { toUid, reason }); }
function acceptFriendRequest(id) { return call('friend.accept', { id }); }
function rejectFriendRequest(id) { return call('friend.reject', { id }); }
function updateFriendRemark(uid, remark) { return call('friend.remark', { uid, remark }); }
function deleteFriend(uid) { return call('friend.remove', { uid }); }
function getFriendContent(uid, type) { return call('friend.content', { uid, type }); }
// 聊天仅通过云函数读写，云端会验证双方是否仍是好友。
function getChatMessages(uid, before, version) { return call('chat.list', { uid, before, version }); }
function sendChatMessage(uid, body, requestId) { return call('chat.send', { uid, body, requestId }); }
function getUnreadChats() { return call('chat.unread'); }
let badgeRequest, useBadgeEndpoint = true;
function getNoticeBadges() {
  if (!badgeRequest) {
    badgeRequest = (async () => {
      if (useBadgeEndpoint) {
        const result = await call('friend.badge');
        if (result && Number.isFinite(result.count)) return { count: result.count, reviewCount: Number.isFinite(result.reviewCount) ? result.reviewCount : null };
        if (!result || result.error !== 'UNKNOWN_ACTION') return null;
        useBadgeEndpoint = false;
      }
      // 旧版云函数仍可配合新前端测试。
      const [requests, unread] = await Promise.all([getFriendRequests(), getUnreadChats()]);
      const requestCount = requests && !requests.error && Array.isArray(requests.requests) ? requests.requests.length : 0;
      const messageCount = unread && !unread.error ? Number(unread.total) || 0 : 0;
      return { count: requestCount + messageCount, reviewCount: null };
    })().finally(() => { badgeRequest = null; });
  }
  return badgeRequest;
}
function getFriendBadge() { return getNoticeBadges().then(result => result ? result.count : null); }
// 道具、任务与邮箱全部由云端记账，客户端只展示结果，不能直接修改数量。
function getInventory() { return call('inventory.get'); }
function sendGift(payload) { return call('gift.send', payload); }
function getTaskStatus() { return call('task.status'); }
function claimTaskReward(key) { return call('task.claim', { key }); }
function getMailbox() { return call('mail.list'); }
function claimMail(id) { return call('mail.claim', { id }); }
function markMailboxRead() { return call('mail.read'); }
function deleteMail(id) { return call('mail.delete', { id }); }
function getAdminStatus() { return call('admin.status'); }
function previewAccountDeletion(targetUid) { return call('admin.account.previewDeletion', { targetUid }); }
function deleteAccountByUid(targetUid, accountKey) { return call('admin.account.deleteByUid', { targetUid, accountKey, confirmation: `DELETE:${targetUid}` }); }
function broadcastReward(payload) { return call('admin.reward.broadcast', payload); }
function sendRewardToUid(payload) { return call('admin.reward.user', payload); }

module.exports = {
  CLOUD_ENV_ID,
  MAX_MEDIA_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_VIDEO_FILE_BYTES,
  fileSize,
  initCloud,
  canUseCloud,
  call,
  persistFile,
  persistImages,
  uploadErrorMessage,
  showUploadError,
  isRemoteFile,
  resolveCloudFiles,
  saveProfile,
  bootstrap,
  getCurrentProfile,
  getOwnState,
  upsertContent,
  deleteContent,
  getContent,
  recordView,
  toggleLike,
  upsertComment,
  deleteComments,
  deleteComment,
  getComments,
  saveComment,
  toggleCommentLike,
  getFavoriteItems,
  createReport,
  sendFeedback,
  requestAccountDeletion,
  getPublicRanking,
  getPublicYears,
  getFriends,
  getFriend,
  getFriendRequests,
  createFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  updateFriendRemark,
  deleteFriend,
  getFriendContent,
  getChatMessages,
  sendChatMessage,
  getUnreadChats,
  getFriendBadge,
  getNoticeBadges,
  getInventory,
  sendGift,
  getTaskStatus,
  claimTaskReward,
  getMailbox,
  claimMail,
  markMailboxRead,
  deleteMail,
  getAdminStatus,
  previewAccountDeletion,
  deleteAccountByUid,
  broadcastReward,
  sendRewardToUid
};
