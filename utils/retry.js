// 失败重试保留同一提交编号；取消只停止本次操作，不清空页面输入。
function cancelled(error) { const result = error instanceof Error ? error : new Error(String(error || '操作已取消')); result.cancelled = true; return result; }
async function run(task, options = {}) {
  for (;;) {
    try { return await task(); }
    catch (error) {
      if (error && error.cancelled) throw error;
      if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') throw error;
      if (typeof wx.hideLoading === 'function') wx.hideLoading();
      const again = await new Promise(resolve => wx.showModal({
        title: options.title || '上传失败', content: String(typeof options.message === 'function' ? options.message(error) : error && error.message || '网络暂时不可用，请重试'),
        confirmText: '重试', cancelText: '取消', showCancel: true,
        success: result => resolve(!!result.confirm), fail: () => resolve(false)
      }));
      if (!again) throw cancelled(error);
    }
  }
}
module.exports = { run, cancelled };
