// 相册编辑页：新建时可一次上传多张图片；编辑已有图片时仍保持单张替换。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, folderId: '', folderName: '', images: [], canAddImages: true, name: '', showName: false, visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '', isPublic: false, hideUid: false },
  onLoad(options) {
    let photo = options.id ? data.getPhoto(options.id) : null;
    const routeContext = nav.contextFrom(options);
    const context = photo ? { campId: photo.campId || routeContext.campId, stageId: photo.stageId || routeContext.stageId, subcampId: photo.subcampId || routeContext.subcampId, activityName: photo.activityName || routeContext.activityName || '' } : routeContext;
    // 读取一次相册列表会把旧版未归类照片迁移到“回忆集”。
    data.getFolders(context);
    if (photo) photo = data.getPhoto(photo.id);
    const folderId = (photo && photo.folderId) || options.folderId || '';
    const folder = folderId ? data.getFolder(folderId) : null;
    if (!folder) {
      wx.showToast({ title: '请先进入一个相册再上传', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 250);
    }
    const albumContext = { campId: folder.campId || context.campId, stageId: folder.stageId || '', subcampId: folder.subcampId || '', activityName: folder.activityName || '' };
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === (photo ? photo.visibility : 'friends')));
    const images = photo && photo.image ? [photo.image] : [];
    this.setData({ id: photo ? photo.id : '', context: albumContext, folderId, folderName: folder.name || '回忆集', images, canAddImages: images.length < 9, name: photo ? photo.name : '', showName: photo ? photo.showName === true : false, visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint, isPublic: visibilityOptions[visibilityIndex].value === 'public', hideUid: photo ? photo.hideUid === true : false });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  nameVisible(e) { this.setData({ showName: e.detail.value }); },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint, isPublic: visibility.value === 'public' }); },
  hideUidChange(e) { this.setData({ hideUid: e.detail.value }); },
  chooseImages() {
    const remaining = this.data.id ? 1 : 9 - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '一次最多上传 9 张图片', icon: 'none' });
    privacy.chooseMedia({ count: remaining, mediaType: ['image'], success: async result => {
      wx.showLoading({ title: '正在压缩上传' });
      try {
        const images = await Promise.all(result.tempFiles.map(item => cloud.persistFile(item.tempFilePath, 'photos')));
        const next = this.data.id ? images.slice(0, 1) : this.data.images.concat(images).slice(0, 9);
        this.setData({ images: next, canAddImages: next.length < 9 });
      } catch (error) {
        cloud.showUploadError(error, '照片上传失败');
      } finally { wx.hideLoading(); }
    }, fail: privacy.showChooseImageError });
  },
  removeImage(e) { const images = this.data.images.filter((item, index) => index !== Number(e.currentTarget.dataset.index)); this.setData({ images, canAddImages: images.length < 9 }); },
  async save() {
    if (!this.data.images.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    wx.showLoading({ title: '正在保存图片' });
    let images;
    try {
      images = await Promise.all(this.data.images.map(image => cloud.isRemoteFile(image) ? image : cloud.persistFile(image, 'photos')));
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '照片上传失败');
    }
    const name = this.data.name.trim();
    const common = { showName: this.data.showName, folderId: this.data.folderId, campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid };
    if (this.data.id) data.savePhoto(Object.assign({}, common, { id: this.data.id, image: images[0], name: name || '未命名图片' }));
    else images.forEach((image, index) => data.savePhoto(Object.assign({}, common, { image, name: name ? (images.length === 1 ? name : `${name} · ${index + 1}`) : `图片 ${index + 1}` })));
    this.setData({ images });
    wx.hideLoading();
    wx.showToast({ title: this.data.id || images.length === 1 ? '图片已保存' : `已保存 ${images.length} 张`, icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  },
  remove() { wx.showModal({ title: '删除这张图片？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deletePhoto(this.data.id); wx.navigateBack({ delta: 1 }); } } }); }
});
