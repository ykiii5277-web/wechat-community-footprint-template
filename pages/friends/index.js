// 好友首页：显示 UID、待处理申请数量和已保存的好友列表。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');

Page({
  data: { friends: [], profile: null, pendingRequests: [], requestCount: 0, messageCount: 0 },
  onShow() { this.startPolling(); this.refresh(); },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },
  startPolling() { if (!this.poller) this.poller = setInterval(() => this.refresh(), 10000); },
  stopPolling() { if (this.poller) { clearInterval(this.poller); this.poller = null; } },
  async refresh() {
    // 同步读取当前资料，后台修改 UID 后“好友”页无需重启即可显示新号码。
    const [friends, requests, profile, unreadResult] = await Promise.all([data.getFriendsAsync(), data.getFriendRequestsAsync('incoming'), data.refreshCurrentProfileAsync(), cloud.getUnreadChats()]);
    const requestCount = requests.length;
    const unreadByUid = unreadResult && !unreadResult.error ? unreadResult.byUid || {} : {};
    const messageCount = unreadResult && !unreadResult.error ? Number(unreadResult.total) || 0 : 0;
    // 动态加入首项后，好友位于自定义底栏第 3 项（索引从 0 开始为 2）。
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) { tabBar.setSelected(2); tabBar.setBadge(requestCount + messageCount); }
    // 备注优先作为列表主名称；真实昵称仍在副标题中保留，避免混淆。
    this.setData({ requestCount, messageCount, profile, pendingRequests: requests.map(item => Object.assign({}, item, { initial: (item.fromName || '好').slice(0, 1) })), friends: friends.map((item, index) => Object.assign(item, { tone: index % 4, initial: (item.name || '好').slice(0, 1), displayName: item.remark || item.name, displayMeta: item.remark ? `昵称：${item.name}${item.bio ? ` · ${item.bio}` : ''}` : item.bio || '点击查看好友允许开放的内容', unreadCount: Number(unreadByUid[item.uid || item.id]) || 0, affection: item.affection || { points: 0, level: 1, title: '萍水相逢' } })) });
  },
  open(e) { nav.go(`/pages/friends/detail?id=${e.currentTarget.dataset.id}`); },
  create() { nav.go('/pages/friends/editor'); },
  requests() { nav.go('/pages/friends/requests'); },
  openUnread() {
    const friend = this.data.friends.find(item => item.unreadCount > 0);
    if (friend) return nav.go(`/pages/friends/chat?id=${encodeURIComponent(friend.uid || friend.id)}`);
    wx.showToast({ title: '暂时没有未读消息', icon: 'none' });
  },
  async accept(e) { const result = await data.acceptFriendRequestAsync(e.currentTarget.dataset.id); if (!result || result.error) return wx.showToast({ title: result && result.error ? result.error : '申请已处理', icon: 'none' }); wx.showToast({ title: '已同意好友申请', icon: 'success' }); this.refresh(); },
  async reject(e) { const result = await data.rejectFriendRequestAsync(e.currentTarget.dataset.id); if (!result || result.error) return wx.showToast({ title: result && result.error ? result.error : '申请已处理', icon: 'none' }); wx.showToast({ title: '已拒绝申请', icon: 'none' }); this.refresh(); },
  showAffectionGuide() {
    wx.showModal({
      title: '好感等级说明',
      content: '每累计 3 点好感度升 1 级。\n\n1–4 萍水相逢\n5–9 一见钟情\n10–14 暗生情愫\n15–19 情根深种\n20–29 莫逆于心\n30–39 两心相悦\n40–49 执子之手\n50–69 比翼连枝\n70–99 天涯比邻\n100+ 一念永恒\n\n仅好友之间显示等级；历史赠礼会在成为好友后补算。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
