const data = require('../../utils/data');
const cloud = require('../../utils/cloud-service');
const nav = require('../../utils/nav');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', name: '', originalName: '', cover: '', saving: false, deleting: false },
  onLoad(options) {
    const id = nav.decode(options.id);
    if (!id) return;
    const activity = data.getActivity(id);
    if (!activity) {
      wx.showToast({ title: '活动不存在，请刷新后重试', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
    }
    this.setData({ id: activity.id, name: activity.name, originalName: activity.name, cover: activity.cover || '' });
  },
  input(e) { this.setData({ name: e.detail.value }); },
  chooseCover() {
    privacy.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: result => this.setData({ cover: result.tempFiles[0].tempFilePath }),
      fail: privacy.showChooseImageError
    });
  },
  clearCover() { this.setData({ cover: '' }); },
  async save() {
    const name = String(this.data.name || '').trim();
    if (!name) return wx.showToast({ title: '请填写活动名称', icon: 'none' });
    if (data.getActivities().some(item => item.id !== this.data.id && item.name === name)) return wx.showToast({ title: '已存在同名活动', icon: 'none' });
    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存' });
    try {
      let cover = this.data.cover;
      if (cover && !cloud.isRemoteFile(cover)) cover = await cloud.persistFile(cover, 'activity-covers');
      await data.saveActivity({ id: this.data.id || undefined, name, originalName: this.data.originalName, cover });
      wx.hideLoading();
      wx.showToast({ title: this.data.id ? '活动已更新' : '活动已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
    } catch (error) {
      wx.hideLoading();
      this.setData({ saving: false });
      cloud.showUploadError(error, '活动封面保存失败');
    }
  },
  remove() {
    if (!this.data.id || this.data.deleting) return;
    wx.showModal({
      title: '删除这个活动？',
      content: '活动下的伙伴、相册、照片、记录和作品都会永久删除，且无法恢复。',
      confirmText: '全部删除',
      confirmColor: '#B84A3D',
      success: async result => {
        if (!result.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: '正在删除' });
        try {
          await data.deleteActivity(this.data.id, this.data.originalName || this.data.name);
          wx.hideLoading();
          wx.showToast({ title: '活动已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
        } catch (error) {
          wx.hideLoading();
          this.setData({ deleting: false });
          wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
        }
      }
    });
  }
});
