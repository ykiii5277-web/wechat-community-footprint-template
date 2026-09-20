// 好友聊天页：消息只通过云函数收发，云端会在每次请求时验证双方仍是好友。
const cloud = require('../../utils/cloud-service');
const data = require('../../utils/data');

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decorateFriend(friend) {
  const value = friend || {};
  return Object.assign({}, value, { initial: (value.remark || value.name || '好').slice(0, 1), displayName: value.remark || value.name || '好友' });
}

Page({
  data: { friend: null, messages: [], body: '', scrollTarget: '', unavailable: false, sending: false },
  async onLoad(options) {
    this.uid = options.id || '';
    // 先显示已缓存的好友资料，云端消息回来后再用实时资料补全。
    const friend = await data.getFriendAsync(this.uid);
    if (friend) this.setData({ friend: decorateFriend(friend) });
    this.refresh(true);
  },
  onShow() { this.startPolling(); },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },
  startPolling() {
    if (this.poller) return;
    // 聊天页停留期间每 5 秒同步一次，不在后台持续请求。
    this.poller = setInterval(() => this.refresh(false), 5000);
  },
  stopPolling() { if (this.poller) { clearInterval(this.poller); this.poller = null; } },
  async refresh(showFailure) {
    if (!this.uid) return;
    const result = await cloud.getChatMessages(this.uid);
    if (!result || result.error || !Array.isArray(result.messages)) {
      this.setData({ unavailable: true });
      if (showFailure) wx.showToast({ title: result && result.message ? result.message : '聊天服务暂不可用', icon: 'none' });
      return;
    }
    const messages = result.messages.map(item => Object.assign({}, item, { timeLabel: formatTime(item.createdAt), initial: (item.senderName || '好').slice(0, 1) }));
    const previous = this.data.messages;
    const last = messages[messages.length - 1];
    const previousLast = previous[previous.length - 1];
    // 只有首次加载或确实收到新消息时滚动到底部，避免用户向上翻旧消息时被拉回。
    const scrollTarget = last && (!previousLast || previousLast.id !== last.id) ? `message-${last.id}` : this.data.scrollTarget;
    this.setData({ friend: decorateFriend(Object.assign({}, this.data.friend || {}, result.friend || {})), messages, unavailable: false, scrollTarget });
    // 打开聊天后云端已把消息标为已读，通知底栏立即刷新红点。
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.refreshBadge) tabBar.refreshBadge();
  },
  input(e) { this.setData({ body: e.detail.value || '' }); },
  async send() {
    const body = this.data.body.trim();
    if (!body || this.data.sending) return;
    this.setData({ sending: true });
    const result = await cloud.sendChatMessage(this.uid, body);
    this.setData({ sending: false });
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '消息发送失败', icon: 'none' });
    this.setData({ body: '' });
    this.refresh(false);
  }
});
