// 好友申请页：处理本机缓存中的待同意或待拒绝请求。
const data = require('../../utils/data');

Page({
  data: { requests: [] },
  onShow() { this.refresh(); },
  async refresh() {
    const requests = (await data.getFriendRequestsAsync('incoming')).map(item => Object.assign(item, { initial: (item.fromName || '好').slice(0, 1) }));
    // 动态加入首项后，好友位于底部栏第 3 项（索引从 0 开始为 2）。
    if (requests.length) wx.setTabBarBadge({ index: 2, text: requests.length > 99 ? '99+' : String(requests.length) }); else wx.removeTabBarBadge({ index: 2 });
    this.setData({ requests });
  },
  async accept(e) { const result = await data.acceptFriendRequestAsync(e.currentTarget.dataset.id); if (!result || result.error) return wx.showToast({ title: result && result.error ? result.error : '申请已处理', icon: 'none' }); wx.showToast({ title: '已同意好友申请', icon: 'success' }); this.refresh(); },
  async reject(e) { const result = await data.rejectFriendRequestAsync(e.currentTarget.dataset.id); if (!result || result.error) return wx.showToast({ title: result && result.error ? result.error : '申请已处理', icon: 'none' }); wx.showToast({ title: '已拒绝申请', icon: 'none' }); this.refresh(); }
});
