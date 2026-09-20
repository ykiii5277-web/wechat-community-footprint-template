// 云端通信层：页面和 data.js 不直接操作云函数或云存储，上传必须取得可跨设备访问的 cloud:// 文件 ID。
const appConfig = require('../config/app-config');
const FUNCTION_NAME = appConfig.cloudFunctionName || 'hui-api';
const CLOUD_ENV_ID = appConfig.cloudEnvId || '';
const MAX_SAFE_IMAGE_BYTES = 900 * 1024;
const IMAGE_CATEGORIES = ['images', 'avatars', 'photos', 'growth', 'folder-covers', 'activity-covers', 'companion-avatars', 'memory-books'];
let cloudInitialized = false;
let uploadErrorVisible = false;

function initCloud() {
  if (typeof wx === 'undefined' || !wx.cloud) return false;
  if (!cloudInitialized) {
    // 优先使用当前环境；如果开发者在 config/app-config.js 中填写了环境 ID，则将其作为回退。
    try {
      const options = { traceUser: true };
      const env = wx.cloud.DYNAMIC_CURRENT_ENV || CLOUD_ENV_ID;
      if (env) options.env = env;
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
    .then(result => result && result.result ? result.result : null)
    .catch(error => ({
      error: 'CLOUD_CALL_FAILED',
      message: String(error && (error.errMsg || error.message) || '云端连接失败，请稍后重试').replace(/^cloud\.callFunction:fail\s*/i, '').slice(0, 100)
    }));
}

// 上传成功时返回 cloud:// 文件 ID，好友和其他用户才能读取图片；失败时仍保留本地文件方便继续编辑。
function isRemoteFile(path) { return /^(cloud:\/\/|https?:\/\/)/i.test(String(path || '')); }

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

function compressImage(path, quality) {
  return new Promise((resolve, reject) => {
    if (typeof wx.compressImage !== 'function') return reject(new Error('IMAGE_COMPRESSION_UNAVAILABLE'));
    wx.compressImage({ src: path, quality, success: result => resolve(result.tempFilePath || path), fail: reject });
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
  let current = path;
  let size = await fileSize(current).catch(() => 0);
  if (!size || size <= MAX_SAFE_IMAGE_BYTES) return current;
  for (const quality of [75, 55, 35, 20]) {
    current = await compressImage(current, quality);
    size = await fileSize(current).catch(() => 0);
    if (!size || size <= MAX_SAFE_IMAGE_BYTES) return current;
  }
  throw new Error('图片体积仍然过大，请选择较小的图片');
}

function uploadErrorMessage(error) {
  const raw = String(error && (error.errMsg || error.message) || error || '');
  if (/^[\u4e00-\u9fa5]/.test(raw)) return raw.slice(0, 80);
  if (/privacy|authorize|auth deny/i.test(raw)) return '请先同意隐私保护指引，再选择图片';
  if (/quota|storage.*(full|limit)|space.*(full|limit)|exceed/i.test(raw)) return '云存储空间或上传额度已满，请先在云开发控制台扩容';
  if (/env|environment|cloud init|-501000|-404011/i.test(raw)) return '未连接到云开发环境，请检查模板配置后重新编译';
  if (/permission|forbidden|unauthorized|auth fail/i.test(raw)) return '云存储没有上传权限，请检查云环境存储权限';
  if (/file.*(not found|not exist)|no such file/i.test(raw)) return '所选图片已失效，请重新选择';
  if (/network|timeout|fail connect/i.test(raw)) return '网络连接不稳定，请稍后重新上传';
  return '图片上传失败，请检查云存储配置后重试';
}

function showUploadError(error, title = '上传失败') {
  if (uploadErrorVisible) return;
  uploadErrorVisible = true;
  wx.showModal({
    title,
    content: uploadErrorMessage(error),
    showCancel: false,
    confirmText: '知道了',
    complete: () => { uploadErrorVisible = false; }
  });
}

async function persistFile(tempPath, category = 'images', sourceName = '') {
  if (!tempPath || isRemoteFile(tempPath)) return Promise.resolve(tempPath || '');
  // 图片发布必须得到 cloud:// 文件 ID；退回本地路径会造成自己能看见、其他用户无法渲染的假成功。
  if (!canUseCloud() || !wx.cloud.uploadFile) throw new Error('未连接到云开发环境，请检查模板配置后重新编译');
  try {
    const imageCategory = IMAGE_CATEGORIES.indexOf(category) >= 0;
    const uploadPath = imageCategory ? await prepareImage(tempPath) : tempPath;
    // 消息文件的临时路径有时不带扩展名，优先从用户看到的原文件名提取，确保 openDocument 能识别类型。
    const match = String(sourceName || uploadPath).match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    const extension = imageCategory ? await imageExtension(uploadPath, sourceName) : (match ? `.${match[1].toLowerCase()}` : '');
    const safeCategory = String(category || 'files').replace(/[^a-z0-9-]/gi, '-');
    const prefix = String(appConfig.storagePrefix || 'community-footprint').replace(/[^a-z0-9-]/gi, '-');
    const cloudPath = `${prefix}/${safeCategory}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
    const result = await wx.cloud.uploadFile({ cloudPath, filePath: uploadPath });
    if (!result || !result.fileID) throw new Error('UPLOAD_NO_FILE_ID');
    return result.fileID;
  } catch (error) {
    const wrapped = new Error(uploadErrorMessage(error));
    wrapped.originalError = error;
    throw wrapped;
  }
}

// 把 cloud:// 文件 ID 换成当前用户可直接渲染的临时 HTTPS 地址。
// 转换失败时保留原值，详情页仍可继续展示文字内容并给出明确提示。
function resolveCloudFiles(paths) {
  const source = Array.isArray(paths) ? paths : [];
  const cloudIds = [...new Set(source.filter(path => /^cloud:\/\//i.test(String(path || ''))))];
  if (!cloudIds.length || !canUseCloud() || !wx.cloud.getTempFileURL) return Promise.resolve(source.slice());
  return wx.cloud.getTempFileURL({ fileList: cloudIds }).then(result => {
    const urls = {};
    (result.fileList || []).forEach(item => { if (item && item.fileID && item.tempFileURL) urls[item.fileID] = item.tempFileURL; });
    return source.map(path => urls[path] || path);
  }).catch(() => source.slice());
}

function saveProfile(profile) { return call('profile.upsert', { profile }); }
function bootstrap(profile) { return call('profile.bootstrap', { profile }); }
function getCurrentProfile() { return call('profile.current'); }
function getOwnState() { return call('state.mine'); }
function upsertContent(kind, item) { return call('content.upsert', { kind, item }); }
function deleteContent(kind, id) { return call('content.delete', { kind, id }); }
function getContent(kind, id, ownerUid, recordId) { return call('content.get', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function recordView(kind, id, ownerUid, recordId) { return call('content.view', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function toggleLike(kind, id, ownerUid, recordId) { return call('content.like', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function upsertComment(comment) { return call('comment.upsert', { comment }); }
function deleteComments(targetType, targetId) { return call('comment.deleteForTarget', { targetType, targetId }); }
function deleteComment(id) { return call('comment.delete', { id }); }
function getComments(kind, id, ownerUid, recordId) { return call('comment.list', { kind, id, ownerUid: ownerUid || '', recordId: recordId || '' }); }
function saveComment(comment) { return call('comment.upsert', { comment }); }
function toggleCommentLike(id) { return call('comment.like', { id }); }
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
function getChatMessages(uid) { return call('chat.list', { uid }); }
function sendChatMessage(uid, body) { return call('chat.send', { uid, body }); }
function getUnreadChats() { return call('chat.unread'); }
// 道具、任务、邮箱与虚拟支付全部由云端记账，客户端只展示结果，不能直接修改数量。
function getInventory() { return call('inventory.get'); }
function sendGift(payload) { return call('gift.send', payload); }
function getTaskStatus() { return call('task.status'); }
function claimTaskReward(key) { return call('task.claim', { key }); }
function getMailbox() { return call('mail.list'); }
function claimMail(id) { return call('mail.claim', { id }); }
function markMailboxRead() { return call('mail.read'); }
function deleteMail(id) { return call('mail.delete', { id }); }
function getAdminStatus() { return call('admin.status'); }
function broadcastReward(payload) { return call('admin.reward.broadcast', payload); }
function sendRewardToUid(payload) { return call('admin.reward.user', payload); }
function getPaymentStatus() { return call('pay.status'); }
function createPaymentOrder(productId, loginCode) { return call('pay.create', { productId, loginCode }); }
function queryPayment(outTradeNo) { return call('pay.query', { outTradeNo }); }
function reconcilePayments() { return call('pay.reconcile'); }

module.exports = {
  CLOUD_ENV_ID,
  initCloud,
  canUseCloud,
  call,
  persistFile,
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
  getInventory,
  sendGift,
  getTaskStatus,
  claimTaskReward,
  getMailbox,
  claimMail,
  markMailboxRead,
  deleteMail,
  getAdminStatus,
  broadcastReward,
  sendRewardToUid,
  getPaymentStatus,
  createPaymentOrder,
  queryPayment,
  reconcilePayments
};
