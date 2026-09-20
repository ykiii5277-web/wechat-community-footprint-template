// 自定义底部栏：用同一份水彩留白与线条图标统一四个首页入口的视觉。
const cloud = require('../utils/cloud-service');
const tabs = [
  { key: 'fun', text: '动态', path: '/pages/fun/index', icon: '/assets/images/tab-fun-active-v2.png' },
  { key: 'footprints', text: '足迹', path: '/pages/footprints/index', icon: '/assets/images/tab-footprints-v2.png' },
  { key: 'friends', text: '好友', path: '/pages/friends/index', icon: '/assets/images/tab-friends-v2.png' },
  { key: 'profile', text: '我的', path: '/pages/profile/index', icon: '/assets/images/tab-profile-v2.png' }
];

Component({
  data: { tabs, selected: 0, badge: 0 },
  lifetimes: {
    attached() { this.refreshBadge(); this.badgePoller = setInterval(() => this.refreshBadge(), 15000); },
    detached() { if (this.badgePoller) clearInterval(this.badgePoller); }
  },
  methods: {
    // 四个 tab 页在 onShow 中调用，确保从任意页面返回时高亮状态正确。
    setSelected(selected) { this.setData({ selected: Number(selected) || 0 }); },
    // 好友申请仍使用红点提示，只是改为绘制在自定义“好友”图标上。
    setBadge(badge) { this.setData({ badge: Math.max(0, Number(badge) || 0) }); },
    async refreshBadge() {
      const [requests, unread] = await Promise.all([cloud.getFriendRequests(), cloud.getUnreadChats()]);
      const requestCount = requests && !requests.error && Array.isArray(requests.requests) ? requests.requests.length : 0;
      const messageCount = unread && !unread.error ? Number(unread.total) || 0 : 0;
      this.setBadge(requestCount + messageCount);
    },
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      if (Number(index) === this.data.selected) return;
      this.setData({ selected: Number(index) });
      wx.switchTab({ url: path });
    }
  }
});
