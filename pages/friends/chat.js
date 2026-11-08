// 好友聊天页：消息只通过云函数收发，云端会在每次请求时验证双方仍是好友。
const cloud = require('../../utils/cloud-service');
const data = require('../../utils/data');
const intents = require('../../utils/request-intent');
const CHAT_SNAPSHOT_MS = 60 * 1000;

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
  data: { friend: null, messages: [], body: '', scrollTarget: '', unavailable: false, sending: false, hasMore: false, loadingOlder: false },
  async onLoad(options) {
    this._alive = true;
    await require('../../utils/actions').ready({ waitForHydration: false });
    if (!this._alive) return;
    this.uid = options.id || '';
    const pending = intents.read(`chat_${this.uid}`);
    if (pending) this.setData({ body: pending.payload.body });
    // 先显示已缓存的好友资料，云端消息回来后再用实时资料补全。
    const friend = data.getFriend(this.uid);
    if (friend) this.setData({ friend: decorateFriend(friend) });
    return this.refresh(true);
  },
  onShow() { this.startPolling(); },
  onHide() { this.stopPolling(); },
  onUnload() { this._alive = false; this.stopPolling(); },
  startPolling() {
    if (this.poller) return;
    // 聊天页停留期间每 5 秒同步一次，不在后台持续请求。
    this.poller = setInterval(() => this.refresh(false), 5000);
  },
  stopPolling() { if (this.poller) { clearInterval(this.poller); this.poller = null; } },
  async refresh(showFailure) {
    if (!this.uid || this._refreshing) return;
    this._refreshing = true;
    const version = Date.now() - this._snapshotAt < CHAT_SNAPSHOT_MS ? this._snapshotVersion : undefined;
    let result;
    try { result = await cloud.getChatMessages(this.uid, undefined, version); }
    catch { result = null; }
    finally { this._refreshing = false; }
    if (this._alive === false) return;
    if (version && result && result.unchanged && result.version === version) {
      if (this.data.unavailable) this.setData({ unavailable: false });
      if (result.markedRead) this.refreshBadge();
      return;
    }
    if (!result || result.error || !Array.isArray(result.messages)) {
      this.setData({ unavailable: true });
      if (showFailure) wx.showToast({ title: result && result.message ? result.message : '聊天服务暂不可用', icon: 'none' });
      return;
    }
    const messages = this.mergeMessages(result.messages);
    const previous = this.data.messages;
    const last = messages[messages.length - 1];
    const previousLast = previous[previous.length - 1];
    // 只有首次加载或确实收到新消息时滚动到底部，避免用户向上翻旧消息时被拉回。
    const scrollTarget = last && (!previousLast || previousLast.id !== last.id) ? `message-${last.id}` : this.data.scrollTarget;
    this._snapshotVersion = result.version;
    this._snapshotAt = Date.now();
    const changes = { friend: decorateFriend(Object.assign({}, this.data.friend || {}, result.friend || {})), messages, unavailable: false, scrollTarget };
    if (!previous.length) { this._historyCursor = result.before; changes.hasMore = !!result.hasMore; }
    this.setData(changes);
    if (result.markedRead || result.markedRead == null) this.refreshBadge();
    if (result.friend && result.friend.remark == null && !this._requestedLegacyFriend) {
      this._requestedLegacyFriend = true;
      data.getFriendAsync(this.uid).then(friend => {
        if (friend && this._alive !== false && this.data.friend.remark == null) {
          this.setData({ friend: decorateFriend(Object.assign({}, this.data.friend, { remark: friend.remark || '' })) });
        }
      }).catch(() => {});
    }
  },
  refreshBadge() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.refreshBadge) tabBar.refreshBadge();
  },
  mergeMessages(incoming) {
    const byId = new Map(this.data.messages.map(item => [item.id, item]));
    incoming.forEach(item => byId.set(item.id, Object.assign({}, item, { timeLabel: formatTime(item.createdAt), initial: (item.senderName || '好').slice(0, 1) })));
    return Array.from(byId.values()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
  },
  async loadOlder() {
    if (!this.data.hasMore || this.data.loadingOlder || !this._historyCursor) return;
    this.setData({ loadingOlder: true });
    const result = await cloud.getChatMessages(this.uid, this._historyCursor);
    if (this._alive === false) return;
    this.setData({ loadingOlder: false });
    if (!result || result.error) return wx.showToast({ title: result && result.message || '历史消息读取失败', icon: 'none' });
    const anchor = this.data.messages[0];
    this._historyCursor = result.before;
    this.setData({ messages: this.mergeMessages(result.messages || []), hasMore: !!result.hasMore, scrollTarget: anchor ? `message-${anchor.id}` : '' });
  },
  input(e) { this.setData({ body: e.detail.value || '' }); },
  async send() {
    const body = this.data.body.trim();
    if (!body || this.data.sending) return;
    let intent;
    try { intent = intents.begin(`chat_${this.uid}`, { uid: this.uid, body }); } catch (error) { return wx.showToast({ title: '无法保留提交信息，请清理缓存空间后再试', icon: 'none' }); }
    this.setData({ sending: true });
    const result = await cloud.sendChatMessage(this.uid, body, intent.requestId);
    if (this._alive === false) return;
    this.setData({ sending: false });
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '消息发送失败', icon: 'none' });
    intents.complete(intent);
    if (this.data.body.trim() === body) this.setData({ body: '' });
    this.refresh(false);
  }
});
