// “我的”首页：汇总个人资料、UID、收藏入口和编辑入口。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const catalog = require('../../utils/virtual-items');

Page({
  data: { profile: null, primaryReceivedItems: [], otherReceivedItems: [], showOtherGifts: false, mailboxUnreadCount: 0, taskRewardCount: 0, isAdmin: false },
  renderProfile(profile) {
    if (!profile) return;
    profile = Object.assign({}, profile);
    profile.displayName = profile.name || '请填写昵称';
    profile.displayAge = profile.stats.age === '' || profile.stats.age == null ? '?' : profile.stats.age;
    profile.displayCampCount = profile.stats.campCount === '' || profile.stats.campCount == null ? '?' : profile.stats.campCount;
    this.setData({ profile });
  },
  async onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setSelected(3);
    this.renderProfile(data.getProfile());
    const [profile, inventory, mailbox, taskStatus, adminStatus] = await Promise.all([data.refreshCurrentProfileAsync(), cloud.getInventory(), cloud.getMailbox(), cloud.getTaskStatus(), cloud.getAdminStatus()]);
    this.renderProfile(profile);
    if (inventory && !inventory.error && inventory.wallet) {
      const received = catalog.receivedGroups(inventory.wallet.received);
      this.setData({ primaryReceivedItems: received.primary, otherReceivedItems: received.other });
    }
    if (mailbox && !mailbox.error) this.setData({ mailboxUnreadCount: (mailbox.mails || []).filter(item => !item.readAt).length });
    if (taskStatus && !taskStatus.error) {
      const daily = (taskStatus.tasks || []).filter(item => item.complete && !item.claimed).length;
      const weekly = taskStatus.weekly && taskStatus.weekly.eligible && !taskStatus.weekly.claimed ? 1 : 0;
      const perfectWeek = taskStatus.perfectWeek && taskStatus.perfectWeek.eligible && !taskStatus.perfectWeek.claimed ? 1 : 0;
      this.setData({ taskRewardCount: daily + weekly + perfectWeek });
    }
    this.setData({ isAdmin: !!(adminStatus && !adminStatus.error && adminStatus.isAdmin) });
  },
  toggleOtherGifts() { this.setData({ showOtherGifts: !this.data.showOtherGifts }); },
  open(e) { const target = e.currentTarget.dataset.target; nav.go(`/pages/profile/${target}`); }
});
