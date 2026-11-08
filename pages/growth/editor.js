// 记录编辑页：一条记录可保存最多 9 张本地图片，第一张同时作为列表封面。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, title: '', body: '', date: '', location: '', images: [], canAddImages: true, visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '', isPublic: false, hideUid: false },
async onLoad(options) { await require('../../utils/actions').ready();
    const camps = data.camps();
    const routeContext = nav.contextFrom(options);
    let entry = options.id ? data.getGrowthById(options.id) : data.getSyncDraft(nav.decode(options.draftKey));
    if (!entry) entry = { id: '', title: '', body: '', campId: routeContext.campId || camps[0].id, stageId: routeContext.stageId, subcampId: routeContext.subcampId, activityName: routeContext.activityName || '', date: data.today(), location: '', images: [], visibility: 'friends' };
    // 编辑已有记录时优先采用记录自身的归属；新建时采用足迹页传来的归属。
    const context = { campId: entry.campId || routeContext.campId || camps[0].id, stageId: entry.stageId || '', subcampId: entry.subcampId || '', activityName: entry.activityName || '' };
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === entry.visibility));
    const images = (entry.images || (entry.image ? [entry.image] : [])).filter(Boolean).slice(0, 9);
    const date = entry.date || data.today();
    // 日期自动生成；编辑旧记录时保留原日期，不再要求用户选择。
    this.setData({ id: entry.id, context, title: entry.title, body: entry.body, date, location: entry.location || '', images, canAddImages: images.length < 9, visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint, isPublic: visibilityOptions[visibilityIndex].value === 'public', hideUid: entry.hideUid === true });
  },
  titleInput(e) { this.setData({ title: e.detail.value }); },
  bodyInput(e) { this.setData({ body: e.detail.value }); },
  locationInput(e) { this.setData({ location: e.detail.value }); },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint, isPublic: visibility.value === 'public' }); },
  hideUidChange(e) { this.setData({ hideUid: e.detail.value }); },
  previewImage(e) { return require('../../utils/image-preview').open(this.data.images, e.currentTarget.dataset.index); },
  chooseImages() {
    if (this._imageBusy || this._saving) return;
    const remaining = 9 - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '每条记录最多 9 张图片', icon: 'none' });
    privacy.chooseMedia({ count: remaining, mediaType: ['image'], success: async result => {
      if (this._imageBusy) return;
      this._imageBusy = true;
      wx.showLoading({ title: '正在压缩上传', mask: true });
      try {
        const paths = result.tempFiles.slice(0, remaining).map(file => file.tempFilePath);
        await cloud.persistImages(paths, 'growth', images => {
          const next = this.data.images.concat(images);
          this.setData({ images: next, canAddImages: next.length < 9 });
        });
      } catch (error) {
        cloud.showUploadError(error, '照片上传失败');
      } finally { this._imageBusy = false; wx.hideLoading(); }
    }, fail: privacy.showChooseImageError });
  },
  removeImage(e) { if (this._imageBusy || this._saving) return; const images = this.data.images.filter((item, index) => index !== Number(e.currentTarget.dataset.index)); this.setData({ images, canAddImages: images.length < 9 }); },
  async save() {
    if (this._saving || this._imageBusy) return;
    this._saving = true;
    try {
    const title = this.data.title.trim();
    const body = this.data.body.trim();
    if (!title || !body) return wx.showToast({ title: '请写下标题和感受', icon: 'none' });
    this._saveId = this.data.id || this._saveId || data.newContentId('growth');
    data.stageDraft('growth', Object.assign({}, this.data.context, { id: this._saveId, title, body, date: this.data.date, location: this.data.location, images: this.data.images, visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid }));
    wx.showLoading({ title: '正在保存记录' });
    let images;
    try {
      images = []; for (const image of this.data.images) images.push(cloud.isRemoteFile(image) ? image : await cloud.persistFile(image, 'growth'));
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '照片上传失败', () => this.save());
    }
    this._saveId = this.data.id || this._saveId || data.newContentId('growth');
    try {
      await data.saveGrowth({ id: this._saveId, title, body, tags: [], date: this.data.date, location: this.data.location.trim(), campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', images, visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid });
    } catch (error) { wx.hideLoading(); return cloud.showUploadError(error, '记录未保存到云端', () => this.save()); }
    this.setData({ images });
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
    } finally { this._saving = false; }
  }
});
