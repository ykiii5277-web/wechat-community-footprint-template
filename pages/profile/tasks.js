const cloud = require('../../utils/cloud-service');

Page({
  data: { tasks: [], weekly: null, perfectWeek: null, date: '', loading: true },
  onShow() { this.refresh(); },
  async refresh() {
    this.setData({ loading: true });
    const result = await cloud.getTaskStatus();
    if (!result || result.error) {
      this.setData({ loading: false });
      return wx.showToast({ title: result && result.message ? result.message : '任务读取失败', icon: 'none' });
    }
    this.setData({ tasks: result.tasks || [], weekly: result.weekly || null, perfectWeek: result.perfectWeek || null, date: result.date || '', loading: false });
  },
  async claim(e) {
    const key = e.currentTarget.dataset.key;
    const result = await cloud.claimTaskReward(key);
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '领取失败', icon: 'none' });
    wx.showToast({ title: result.rewardText || '领取成功', icon: 'success' });
    this.refresh();
  }
});
