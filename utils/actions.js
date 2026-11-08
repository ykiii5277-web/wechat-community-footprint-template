async function run(page, action, success, after) {
  if (page._cloudActionBusy) return false;
  page._cloudActionBusy = true;
  wx.showLoading({ title: '正在同步', mask: true });
  try {
    const result = await require('./retry').run(action, { title: '操作未完成' });
    wx.hideLoading();
    if (success) wx.showToast({ title: success, icon: 'success' });
    if (after) await after(result);
    return true;
  } catch (error) {
    wx.hideLoading();
    if (!error.cancelled) wx.showModal({ title: '操作未完成', content: String(error && error.message || '云端未确认成功，请稍后重试'), showCancel: false });
    return false;
  } finally { page._cloudActionBusy = false; }
}
async function ready({ waitForHydration = true } = {}) {
  if (typeof getApp !== 'function') return;
  const app = getApp();
  if (app && app.globalData) {
    if (app.globalData.bootstrapPromise) await app.globalData.bootstrapPromise.catch(() => null);
    if (waitForHydration && app.globalData.hydrationPromise) await app.globalData.hydrationPromise;
  }
}
// 已核对账号的缓存能先显示。首次恢复数据或旧入口找不到内容时，等同步结束再确认。
async function readOwnContent(read) {
  const cached = read();
  if (cached) return cached;
  await ready();
  return read();
}
module.exports = { run, ready, readOwnContent };
