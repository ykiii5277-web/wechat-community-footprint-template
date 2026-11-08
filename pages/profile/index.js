// “我的”首页：汇总个人资料、UID、收藏入口和编辑入口。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');
const featureGuide = require('../../utils/feature-guide');

Page({
  data: { profile: null, primaryReceivedItems: [], otherReceivedItems: [], showOtherGifts: false, mailboxUnreadCount: 0, taskRewardCount: 0, isAdmin: false, pendingWorkCount: 0 },
  renderProfile(profile) {
    if (!profile) return;
    profile = Object.assign({}, profile);
    profile.displayName = profile.name || '请填写昵称';
    profile.displayAge = profile.stats.age === '' || profile.stats.age == null ? '?' : profile.stats.age;
    profile.displayCampCount = profile.stats.campCount === '' || profile.stats.campCount == null ? '?' : profile.stats.campCount;
    this.setData({ profile });
  },
  async onShow() {
    if (getApp().ensureProfileOnboarding && getApp().ensureProfileOnboarding()) return;
    getApp().maybeOpenFeatureGuide();
    featureGuide.syncPage(this);
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setSelected(3);
    this.renderProfile(data.getProfile());
    const request = this._profileRequest = (this._profileRequest || 0) + 1;
    const apply = (promise, render) => promise.then(result => {
      if (request === this._profileRequest) render(result);
    });
    await Promise.allSettled([
      apply(data.refreshCurrentProfileAsync(), profile => this.renderProfile(profile)),
      apply(cloud.getInventory(), inventory => {
        if (!inventory || inventory.error || !inventory.wallet) return;
        const received = catalog.receivedGroups(inventory.wallet.received);
        this.setData({ primaryReceivedItems: received.primary, otherReceivedItems: received.other });
      }),
      apply(cloud.getMailbox(), mailbox => {
        if (mailbox && !mailbox.error) this.setData({ mailboxUnreadCount: (mailbox.mails || []).filter(item => !item.readAt).length });
      }),
      apply(cloud.getTaskStatus(), taskStatus => {
        if (!taskStatus || taskStatus.error) return;
        const daily = (taskStatus.tasks || []).filter(item => item.complete && !item.claimed).length;
        const weekly = taskStatus.weekly && taskStatus.weekly.eligible && !taskStatus.weekly.claimed ? 1 : 0;
        const perfectWeek = taskStatus.perfectWeek && taskStatus.perfectWeek.eligible && !taskStatus.perfectWeek.claimed ? 1 : 0;
        this.setData({ taskRewardCount: daily + weekly + perfectWeek });
      }),
      apply(cloud.getAdminStatus(), adminStatus => {
        if (!adminStatus || adminStatus.error) return;
        const isAdmin = !!adminStatus.isAdmin;
        this.setData({ isAdmin });
        if (!isAdmin || Number.isFinite(adminStatus.pendingWorkCount)) this.onReviewBadgeChanged(isAdmin ? adminStatus.pendingWorkCount : 0);
      })
    ]);
  },
  onHide() { this._profileRequest = (this._profileRequest || 0) + 1; },
  onUnload() { this._profileRequest = (this._profileRequest || 0) + 1; },
  onReviewBadgeChanged(value) {
    const pendingWorkCount = Math.max(0, Number(value) || 0);
    const updates = {};
    if (pendingWorkCount !== this.data.pendingWorkCount) updates.pendingWorkCount = pendingWorkCount;
    if (pendingWorkCount > 0 && !this.data.isAdmin) updates.isAdmin = true;
    if (Object.keys(updates).length) this.setData(updates);
  },
  toggleOtherGifts() { this.setData({ showOtherGifts: !this.data.showOtherGifts }); },
  open(e) {
    const target = e.currentTarget.dataset.target;
    if (target === 'guide') return featureGuide.start(getApp().globalData.bootstrapUid || data.getProfile().uid);
    nav.go(`/pages/profile/${target}`);
  }
});
