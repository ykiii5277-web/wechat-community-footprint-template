const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { friend: null, activities: [], loading: true },
  onLoad(options) { this.uid = nav.decode(options.id); this.refresh(); },
  async refresh() {
    const result = await data.getFriendContentAsync(this.uid, 'footprints');
    if (!result || result.error) {
      wx.showToast({ title: result && result.error ? result.error : '好友活动暂不可查看', icon: 'none' });
      return setTimeout(() => wx.navigateBack(), 300);
    }
    const groups = {};
    (result.records || []).filter(item => item.campId === 'other').forEach(item => {
      const name = data.normalizeActivityName(item.activityName);
      if (!name) return;
      if (!groups[name]) groups[name] = { name, count: 0, cover: '' };
      groups[name].count += 1;
      if (!groups[name].cover) groups[name].cover = item.image || (item.images || [])[0] || item.cover || item.avatar || '';
    });
    this.setData({ friend: result.friend || null, activities: Object.keys(groups).map(name => groups[name]).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')), loading: false });
  },
  openActivity(e) {
    const name = data.normalizeActivityName(e.currentTarget.dataset.name);
    nav.go(`/pages/friends/camp?id=${encodeURIComponent(this.uid)}&campId=other&activityName=${encodeURIComponent(name)}`);
  }
});
