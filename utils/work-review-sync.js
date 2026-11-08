const data = require('./data');

// 页面先显示缓存，随后校验审核结果。只在可见且有待审核作品时继续轮询。
function start(page, render) {
  stop(page);
  const token = page._workReviewToken;
  const refresh = async () => {
    try {
      const changed = await data.refreshOwnWorks();
      if (token !== page._workReviewToken) return;
      if (changed) render.call(page);
    } catch { /* 暂时断网时保留可浏览的缓存。 */ }
    if (token !== page._workReviewToken) return;
    const pending = data.getWorks().some(work => work.visibility === 'public' && work.reviewStatus === 'pending');
    if (pending) page._workReviewTimer = setTimeout(refresh, 15000);
  };
  refresh();
}
function stop(page) {
  page._workReviewToken = (page._workReviewToken || 0) + 1;
  if (page._workReviewTimer) clearTimeout(page._workReviewTimer);
  page._workReviewTimer = null;
}
module.exports = { start, stop };
