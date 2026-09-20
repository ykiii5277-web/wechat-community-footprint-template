// 相册编辑页：名称与封面都可选；名称留空时统一使用“回忆集”。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, name: '', cover: '' },
  onLoad(options) { const folder = options.id ? data.getFolder(options.id) : null; const context = folder ? { campId: folder.campId || '', stageId: folder.stageId || '', subcampId: folder.subcampId || '', activityName: folder.activityName || '' } : nav.contextFrom(options); this.setData({ id: folder ? folder.id : '', context, name: folder ? folder.name : '', cover: folder ? folder.cover : '' }); },
  input(e) { this.setData({ name: e.detail.value }); },
  chooseCover() { privacy.chooseMedia({ count: 1, mediaType: ['image'], success: async result => {
    wx.showLoading({ title: '正在上传封面' });
    try { this.setData({ cover: await cloud.persistFile(result.tempFiles[0].tempFilePath, 'folder-covers') }); }
    catch (error) { cloud.showUploadError(error, '封面上传失败'); }
    finally { wx.hideLoading(); }
  }, fail: privacy.showChooseImageError }); },
  clearCover() { this.setData({ cover: '' }); },
  save() { const name = this.data.name.trim() || '回忆集'; data.saveFolder({ id: this.data.id, name, cover: this.data.cover, campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '' }); wx.showToast({ title: '相册已保存', icon: 'success' }); setTimeout(() => wx.navigateBack({ delta: 1 }), 350); },
  remove() { wx.showModal({ title: '删除此相册？', content: '相册会被删除，原有照片不会丢失，并会自动归入“回忆集”。', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deleteFolder(this.data.id); wx.navigateBack({ delta: 1 }); } } }); }
});
