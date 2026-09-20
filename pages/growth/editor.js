// 记录编辑页：一条记录可保存最多 9 张本地图片，第一张同时作为列表封面。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: { id: '', context: {}, title: '', body: '', date: '', dateForPicker: '', location: '', camps: [], campIndex: 0, campName: '', images: [], canAddImages: true, visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '', isPublic: false, hideUid: false },
  onLoad(options) {
    const camps = data.camps();
    const routeContext = nav.contextFrom(options);
    let entry = options.id ? data.getGrowthById(options.id) : null;
    if (!entry) entry = { id: '', title: '', body: '', campId: routeContext.campId || camps[0].id, stageId: routeContext.stageId, subcampId: routeContext.subcampId, activityName: routeContext.activityName || '', date: data.today(), location: '', images: [], visibility: 'friends' };
    // 编辑已有记录时优先采用记录自身的归属；新建时采用足迹页传来的归属。
    const context = { campId: entry.campId || routeContext.campId, stageId: entry.stageId || routeContext.stageId, subcampId: entry.subcampId || routeContext.subcampId, activityName: entry.activityName || routeContext.activityName || '' };
    const campIndex = Math.max(0, camps.findIndex(item => item.id === context.campId));
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === entry.visibility));
    const images = (entry.images || (entry.image ? [entry.image] : [])).filter(Boolean).slice(0, 9);
    const date = entry.date || data.today();
    this.setData({ id: entry.id, context, title: entry.title, body: entry.body, date, dateForPicker: date.replace(/\./g, '-'), location: entry.location || '', images, canAddImages: images.length < 9, camps, campIndex, campName: camps[campIndex].name, visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint, isPublic: visibilityOptions[visibilityIndex].value === 'public', hideUid: entry.hideUid === true });
  },
  titleInput(e) { this.setData({ title: e.detail.value }); },
  bodyInput(e) { this.setData({ body: e.detail.value }); },
  locationInput(e) { this.setData({ location: e.detail.value }); },
  dateChange(e) { this.setData({ date: e.detail.value.replace(/-/g, '.'), dateForPicker: e.detail.value }); },
  campChange(e) {
    const campIndex = Number(e.detail.value);
    const campId = this.data.camps[campIndex].id;
    // 切换营地后不沿用原营地的阶段和子营地编号。
    const context = Object.assign({}, this.data.context, { campId, stageId: campId === this.data.context.campId ? this.data.context.stageId : '', subcampId: campId === this.data.context.campId ? this.data.context.subcampId : '', activityName: campId === this.data.context.campId ? this.data.context.activityName : '' });
    this.setData({ campIndex, campName: this.data.camps[campIndex].name, context });
  },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint, isPublic: visibility.value === 'public' }); },
  hideUidChange(e) { this.setData({ hideUid: e.detail.value }); },
  chooseImages() {
    const remaining = 9 - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '每条记录最多 9 张图片', icon: 'none' });
    privacy.chooseMedia({ count: remaining, mediaType: ['image'], success: async result => {
      wx.showLoading({ title: '正在压缩上传' });
      try {
        const images = await Promise.all(result.tempFiles.map(item => cloud.persistFile(item.tempFilePath, 'growth')));
        const next = this.data.images.concat(images).slice(0, 9);
        this.setData({ images: next, canAddImages: next.length < 9 });
      } catch (error) {
        cloud.showUploadError(error, '照片上传失败');
      } finally { wx.hideLoading(); }
    }, fail: privacy.showChooseImageError });
  },
  removeImage(e) { const images = this.data.images.filter((item, index) => index !== Number(e.currentTarget.dataset.index)); this.setData({ images, canAddImages: images.length < 9 }); },
  async save() {
    const title = this.data.title.trim();
    const body = this.data.body.trim();
    if (!title || !body) return wx.showToast({ title: '请写下标题和感受', icon: 'none' });
    wx.showLoading({ title: '正在保存记录' });
    let images;
    try {
      images = await Promise.all(this.data.images.map(image => cloud.isRemoteFile(image) ? image : cloud.persistFile(image, 'growth')));
    } catch (error) {
      wx.hideLoading();
      return cloud.showUploadError(error, '照片上传失败');
    }
    data.saveGrowth({ id: this.data.id, title, body, tags: [], date: this.data.date, location: this.data.location.trim(), campId: this.data.camps[this.data.campIndex].id, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', images, visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid });
    this.setData({ images });
    wx.hideLoading();
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  }
});
