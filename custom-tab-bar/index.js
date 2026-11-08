// 自定义底部栏：用同一份水彩留白与线条图标统一四个首页入口的视觉。
const cloud = require('../utils/cloud-service');
const tabs = [
  { key: 'fun', text: '趣闻', path: '/pages/fun/index', icon: '/assets/images/tab-fun-active-v2.png' },
  { key: 'footprints', text: '足迹', path: '/pages/footprints/index', icon: '/assets/images/tab-footprints-v2.png' },
  { key: 'friends', text: '好友', path: '/pages/friends/index', icon: '/assets/images/tab-friends-v2.png' },
  { key: 'profile', text: '我的', path: '/pages/profile/index', icon: '/assets/images/tab-profile-v2.png' }
];

Component({
  data: { tabs, selected: 0, badge: 0, reviewBadge: 0 },
  lifetimes: {
    attached() { this.startBadgePolling(); },
    detached() { this.stopBadgePolling(); }
  },
  pageLifetimes: {
    show() { this.startBadgePolling(); },
    hide() { this.stopBadgePolling(); }
  },
  methods: {
    startBadgePolling() {
      if (this.badgePoller) return;
      this.refreshBadge();
      this.badgePoller = setInterval(() => this.refreshBadge(), 15000);
    },
    stopBadgePolling() {
      if (this.badgePoller) clearInterval(this.badgePoller);
      this.badgePoller = null;
      this._badgeRequest = (this._badgeRequest || 0) + 1;
    },
    // 四个 tab 页在 onShow 中调用，确保从任意页面返回时高亮状态正确。
    setSelected(selected) { this.setData({ selected: Number(selected) || 0 }); },
    // 好友申请仍使用红点提示，只是改为绘制在自定义“好友”图标上。
    setBadge(badge) {
      this._badgeRequest = (this._badgeRequest || 0) + 1;
      const count = Math.max(0, Number(badge) || 0);
      if (count !== this.data.badge) this.setData({ badge: count });
    },
    async refreshBadge() {
      const request = this._badgeRequest = (this._badgeRequest || 0) + 1;
      const result = await cloud.getNoticeBadges();
      if (request !== this._badgeRequest || !result) return;
      this.setBadge(result.count);
      if (result.reviewCount != null) {
        const count = Math.max(0, Number(result.reviewCount) || 0);
        if (count !== this.data.reviewBadge) this.setData({ reviewBadge: count });
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const page = pages[pages.length - 1];
        if (page && page.route === 'pages/profile/index' && page.onReviewBadgeChanged) page.onReviewBadgeChanged(count);
      }
    },
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      if (Number(index) === this.data.selected) return;
      this.setData({ selected: Number(index) });
      wx.switchTab({ url: path });
    }
  }
});
