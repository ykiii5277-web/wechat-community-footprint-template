// 相册名称必填，封面可选。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, name: '', cover: '' },
  async onLoad(options) { await require('../../utils/actions').ready(); const folder = options.id ? data.getFolder(options.id) : data.getSyncDraft(nav.decode(options.draftKey)); const context = folder ? { campId: folder.campId || '', stageId: folder.stageId || '', subcampId: folder.subcampId || '', activityName: folder.activityName || '' } : nav.contextFrom(options); this.setData({ id: folder ? folder.id : '', context, name: folder ? folder.name : '', cover: folder ? folder.cover : '' }); },
  input(e) { this.setData({ name: e.detail.value }); },
  chooseCover() { privacy.chooseMedia({ count: 1, mediaType: ['image'], success: async result => {
    wx.showLoading({ title: '正在上传封面' });
    try { this.setData({ cover: await cloud.persistFile(result.tempFiles[0].tempFilePath, 'folder-covers') }); }
    catch (error) { cloud.showUploadError(error, '封面上传失败'); }
    finally { wx.hideLoading(); }
  }, fail: privacy.showChooseImageError }); },
  clearCover() { this.setData({ cover: '' }); },
  save() { const name = this.data.name.trim(); if (!name) return wx.showToast({ title: '请填写相册名称', icon: 'none' }); this._saveId = this.data.id || this._saveId || data.newContentId('album'); return require('../../utils/actions').run(this, () => data.saveFolder({ id: this._saveId, name, cover: this.data.cover, campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '' }), '相册已保存', () => wx.navigateBack({ delta: 1 })); },
  remove() { wx.showModal({ title: '删除此相册？', content: '相册会被删除，原有照片不会丢失，并会自动归入“回忆集”。', confirmColor: '#C84A3A', success: result => { if (result.confirm) require('../../utils/actions').run(this, () => data.deleteFolder(this.data.id), '相册已删除', () => wx.navigateBack({ delta: 1 })); } }); }
});
