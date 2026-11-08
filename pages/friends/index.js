// 好友首页：显示 UID、待处理申请数量和已保存的好友列表。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const featureGuide = require('../../utils/feature-guide');
const managementTools = require('../../utils/friend-management');

Page({
  data: { statusBarHeight: 20, headerActionOffset: 44, friends: [], friendCount: 0, groups: [], activeTab: 'friends', sortOptions: managementTools.SORTS, sortIndex: 0, sortName: '名称字母', managementBusy: false, loading: false, profile: null, pendingRequests: [], requestCount: 0, messageCount: 0 },
  onLoad() {
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = Number(info.statusBarHeight) || 20;
      const menu = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
      this.setData({ statusBarHeight, headerActionOffset: menu && menu.bottom > statusBarHeight ? menu.bottom - statusBarHeight + 8 : 44 });
    } catch (error) { /* 旧客户端使用默认安全间距。 */ }
  },
  onShow() { if (getApp().ensureProfileOnboarding && getApp().ensureProfileOnboarding()) return; this.startPolling(); this.refresh(); featureGuide.syncPage(this); getApp().maybeOpenFeatureGuide(); },
  onHide() { this.stopPolling(); },
  onUnload() { this._unloaded = true; this.stopPolling(); },
  startPolling() { if (!this.poller) this.poller = setInterval(() => { if (!this.data.loading) this.refresh(); }, 10000); },
  stopPolling() { if (this.poller) { clearInterval(this.poller); this.poller = null; } },
  async refresh() {
    const request = this._refreshRequest = (this._refreshRequest || 0) + 1;
    this.setData({ loading: true });
    try {
    // 同步读取当前资料，后台修改 UID 后“好友”页无需重启即可显示新号码。
    const [friends, requests, profile, unreadResult] = await Promise.all([data.getFriendsAsync(), data.getFriendRequestsAsync('incoming'), data.refreshCurrentProfileAsync(), cloud.getUnreadChats()]);
    if (this._unloaded || request !== this._refreshRequest) return;
    this._management = data.getFriendManagement();
    const requestCount = requests.length;
    const unreadByUid = unreadResult && !unreadResult.error ? unreadResult.byUid || {} : {};
    const messageCount = unreadResult && !unreadResult.error ? Number(unreadResult.total) || 0 : 0;
    // 趣闻加入首项后，好友位于自定义底栏第 3 项（索引从 0 开始为 2）。
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) { tabBar.setSelected(2); tabBar.setBadge(requestCount + messageCount); }
    // 备注优先作为列表主名称；真实昵称仍在副标题中保留，避免混淆。
    this._rawFriends = friends.map((item, index) => Object.assign({}, item, { tone: index % 4, initial: (item.name || '好').slice(0, 1), displayName: item.remark || item.name, displayMeta: item.remark ? `昵称：${item.name}${item.bio ? ` · ${item.bio}` : ''}` : item.bio || '点击查看好友允许开放的内容', unreadCount: Number(unreadByUid[item.uid || item.id]) || 0, affection: item.affection || { points: 0, level: 1, title: '萍水相逢' } }));
    this.setData({ requestCount, messageCount, profile, pendingRequests: requests.map(item => Object.assign({}, item, { initial: (item.fromName || '好').slice(0, 1) })) });
    this.renderFriends();
    } catch (error) {
      if (!this._unloaded && request === this._refreshRequest) wx.showToast({ title: '好友列表加载失败，请稍后重试', icon: 'none' });
    } finally { if (!this._unloaded && request === this._refreshRequest) this.setData({ loading: false }); }
  },
  renderFriends() {
    const management = managementTools.normalize(this._management);
    const groupNames = new Map(management.groups.map(group => [group.id, group.name]));
    const friends = managementTools.sortFriends(this._rawFriends || [], management.sort).map(friend => Object.assign({}, friend, { groupName: groupNames.get(friend.groupId) || management.groups[0].name, groupIndex: Math.max(0, management.groups.findIndex(group => group.id === friend.groupId)) }));
    this._expandedGroups = this._expandedGroups || { 'camp-friends': true };
    const groups = managementTools.grouped(friends, management, this._expandedGroups).map(group => Object.assign(group, { count: group.friends.length }));
    const sortIndex = Math.max(0, managementTools.SORTS.findIndex(sort => sort.id === management.sort));
    this.setData({ friends, friendCount: friends.length, groups, sortIndex, sortName: managementTools.SORTS[sortIndex].name });
  },
  chooseTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab }); },
  toggleGroup(e) { const id = e.currentTarget.dataset.id; this._expandedGroups = this._expandedGroups || { 'camp-friends': true }; this._expandedGroups[id] = !this._expandedGroups[id]; this.renderFriends(); },
  async updateManagement(payload, success) {
    if (this._managementBusy) return false;
    this._managementBusy = true; this._refreshRequest = (this._refreshRequest || 0) + 1;
    this.setData({ managementBusy: true });
    try {
      return await require('../../utils/actions').run(this, () => data.saveFriendManagement(payload), success, async management => {
        this._management = management;
        if (payload.operation === 'assign') this._rawFriends = (this._rawFriends || []).map(friend => String(friend.uid || friend.id) === String(payload.uid) ? Object.assign({}, friend, { groupId: payload.groupId }) : friend);
        this.renderFriends();
        await this.refresh();
      });
    } finally { this._managementBusy = false; if (!this._unloaded) this.setData({ managementBusy: false, loading: false }); }
  },
  sortChange(e) {
    const sort = managementTools.SORTS[Number(e.detail.value)];
    if (sort && sort.id !== (this._management || {}).sort) return this.updateManagement({ operation: 'sort', sort: sort.id }, '排序已更新');
  },
  createGroup() {
    if (this.data.managementBusy || this._groupDialog) return;
    if ((this._management && this._management.groups || []).some(group => group.id === this._newGroupId)) this._newGroupId = '';
    const groupId = this._newGroupId || (this._newGroupId = data.newContentId('friend-group'));
    this.editGroupName({ operation: 'create', groupId }, '', '新建分组');
  },
  editGroupName(payload, currentName, title) {
    this._groupDialog = true;
    wx.showModal({ title, editable: true, content: currentName, placeholderText: '请输入分组名称，最多20字', confirmText: '保存', confirmColor: '#315F49',
      success: async result => {
        if (!result.confirm || this._unloaded) return;
        const name = String(result.content || '').trim();
        if (!name || Array.from(name).length > 20) return wx.showToast({ title: '分组名称需为1至20个字', icon: 'none' });
        if (await this.updateManagement(Object.assign({}, payload, { name }), '分组已保存')) this._newGroupId = '';
      }, complete: () => { this._groupDialog = false; }
    });
  },
  groupMenu(e) {
    if (this.data.managementBusy) return;
    const group = this.data.groups.find(group => group.id === e.currentTarget.dataset.id);
    if (!group) return;
    if (group.isDefault) return this.editGroupName({ operation: 'rename', groupId: group.id }, group.name, '重命名默认分组');
    wx.showActionSheet({ itemList: ['重命名分组', '删除分组'], success: result => {
      if (result.tapIndex === 0) return this.editGroupName({ operation: 'rename', groupId: group.id }, group.name, '重命名分组');
      const defaultGroup = this.data.groups.find(item => item.isDefault);
      wx.showModal({ title: '删除这个分组？', content: `组内好友将移回默认分组“${defaultGroup.name}”，好友关系会保留。`, confirmText: '删除', confirmColor: '#A34B3C', success: answer => { if (answer.confirm) this.updateManagement({ operation: 'delete', groupId: group.id }, '分组已删除'); } });
    } });
  },
  prepareGroupMove(e) { this._moveGroups = { uid: e.currentTarget.dataset.uid, groups: this.data.groups.map(group => ({ id: group.id, name: group.name })) }; },
  moveFriend(e) {
    if (this.data.managementBusy) return;
    const uid = e.currentTarget.dataset.uid;
    const groups = this._moveGroups && this._moveGroups.uid === uid ? this._moveGroups.groups : this.data.groups;
    const group = groups[Number(e.detail.value)];
    this._moveGroups = null;
    if (group) return this.updateManagement({ operation: 'assign', uid, groupId: group.id }, '好友分组已更新');
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
