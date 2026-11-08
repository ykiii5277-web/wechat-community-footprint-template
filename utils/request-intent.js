// Keep one request ID across lost receipts, including page re-entry on the same account.
const data = require('./data');
const cloud = require('./cloud-service');
function key(scope) {
  const profile = data.getProfile();
  if (!profile || !profile.uid) throw new Error('请先登录后再试');
  return `hui_intent_v1_${cloud.CLOUD_ENV_ID}_${profile.uid}_${scope}`;
}
function read(scope) { return wx.getStorageSync(key(scope)) || null; }
function begin(scope, payload) {
  const storageKey = key(scope), previous = wx.getStorageSync(storageKey);
  const fingerprint = JSON.stringify(payload);
  if (previous && previous.fingerprint === fingerprint) return Object.assign({ storageKey }, previous);
  const value = { requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`, fingerprint, payload };
  wx.setStorageSync(storageKey, value);
  return Object.assign({ storageKey }, value);
}
function complete(intent) {
  try {
    const saved = wx.getStorageSync(intent.storageKey);
    if (saved && saved.requestId === intent.requestId) wx.removeStorageSync(intent.storageKey);
  } catch (error) { /* A confirmed server result stays successful; the same ID remains safe to replay. */ }
}
module.exports = { read, begin, complete };
