const data = require('../../utils/data');

Page({
  data: { activities: [], loading: true },
  onShow() {
    this.refresh();
    data.getActivitiesAsync().then(() => this.refresh()).catch(() => wx.showToast({ title: '云端暂未同步，当前为缓存', icon: 'none' }));
  },
  refresh() { this.setData({ activities: data.getActivities(), loading: false }); },
  addActivity() { wx.navigateTo({ url: '/pages/activities/editor' }); },
  editActivity(e) {
    wx.navigateTo({ url: `/pages/activities/editor?id=${encodeURIComponent(e.currentTarget.dataset.id)}` });
  },
  openActivity(e) {
    const activity = data.getActivity(e.currentTarget.dataset.id, e.currentTarget.dataset.name);
    if (!activity) return wx.showToast({ title: '活动不存在，请刷新后重试', icon: 'none' });
    wx.navigateTo({ url: `/packages/camps/camp-detail?campId=other&activityId=${encodeURIComponent(activity.id)}&activityName=${encodeURIComponent(activity.name)}` });
  }
});
