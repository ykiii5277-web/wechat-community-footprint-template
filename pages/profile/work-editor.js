// 作品编辑页：上传作品文件、填写标题和正文，并保存其所属的足迹上下文。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

// 选择到的临时文件在小程序退出后可能失效，因此先保存为本地文件。
function saveFile(tempPath, sourceName, done) {
  wx.showLoading({ title: '正在上传文件' });
  cloud.persistFile(tempPath, 'work-files', sourceName).then(done).catch(() => wx.showToast({ title: '文件上传失败，请重试', icon: 'none' })).finally(() => wx.hideLoading());
}
function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

Page({
  data: { id: '', context: {}, title: '', body: '', legacyCover: '', filePath: '', fileName: '', fileSize: 0, fileMeta: '', camps: [], campIndex: 0, campName: '', visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '', isPublic: false, hideUid: false },
  onLoad(options) {
    const camps = data.camps();
    const work = options.id ? data.getWork(options.id) : null;
    const routeContext = nav.contextFrom(options);
    const campId = work ? work.campId : (routeContext.campId || camps[0].id);
    const context = { campId, stageId: work ? (work.stageId || '') : routeContext.stageId, subcampId: work ? (work.subcampId || '') : routeContext.subcampId, activityName: work ? (work.activityName || '') : (routeContext.activityName || '') };
    const campIndex = Math.max(0, camps.findIndex(item => item.id === campId));
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === (work ? work.visibility : 'friends')));
    this.setData({ id: work ? work.id : '', context, title: work ? work.title : '', body: work ? (work.body || '') : '', legacyCover: work ? (work.cover || '') : '', filePath: work ? (work.filePath || '') : '', fileName: work ? (work.fileName || '') : '', fileSize: work ? (work.fileSize || 0) : 0, fileMeta: work ? formatFileSize(work.fileSize) : '', camps, campIndex, campName: camps[campIndex].name, visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint, isPublic: visibilityOptions[visibilityIndex].value === 'public', hideUid: work ? work.hideUid === true : false });
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  campChange(e) {
    const campIndex = Number(e.detail.value);
    const campId = this.data.camps[campIndex].id;
    // 阶段编号只对原营地有效；换营地后清空阶段和子营地归属。
    const context = Object.assign({}, this.data.context, { campId, stageId: campId === this.data.context.campId ? this.data.context.stageId : '', subcampId: campId === this.data.context.campId ? this.data.context.subcampId : '', activityName: campId === this.data.context.campId ? this.data.context.activityName : '' });
    this.setData({ campIndex, campName: this.data.camps[campIndex].name, context });
  },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint, isPublic: visibility.value === 'public' }); },
  hideUidChange(e) { this.setData({ hideUid: e.detail.value }); },
  chooseFile() {
    privacy.chooseMessageFile({ count: 1, type: 'file', success: result => {
      const file = result.tempFiles[0];
      if (Number(file.size) > 20 * 1024 * 1024) return wx.showToast({ title: '作品文件不能大于 20MB', icon: 'none' });
      saveFile(file.path, file.name || '', filePath => this.setData({ filePath, fileName: file.name || '未命名文件', fileSize: Number(file.size) || 0, fileMeta: formatFileSize(file.size) }));
    }, fail: () => wx.showToast({ title: '暂未选择文件', icon: 'none' }) });
  },
  clearFile() { this.setData({ filePath: '', fileName: '', fileSize: 0, fileMeta: '' }); },
  async save(e) {
    const status = e.currentTarget.dataset.status;
    const title = this.data.title.trim();
    const body = this.data.body.trim();
    if (!title) return wx.showToast({ title: '请先写下作品标题', icon: 'none' });
    if (status === 'published' && !body) return wx.showToast({ title: '发布前请写下正文', icon: 'none' });
    if (this.data.fileSize > 20 * 1024 * 1024) return wx.showToast({ title: '作品文件不能大于 20MB', icon: 'none' });
    wx.showLoading({ title: '正在保存作品' });
    let filePath = this.data.filePath;
    try {
      if (filePath && !cloud.isRemoteFile(filePath)) filePath = await cloud.persistFile(filePath, 'work-files', this.data.fileName);
    } catch (error) {
      wx.hideLoading();
      return wx.showToast({ title: '作品文件未上传成功，请重试', icon: 'none' });
    }
    const fileTypeMatch = String(this.data.fileName || '').match(/\.([^.]+)$/);
    // 旧版本封面若仍是本机临时路径就不再带入共享内容，避免它导致整条作品云端保存失败。
    const cover = cloud.isRemoteFile(this.data.legacyCover) ? this.data.legacyCover : '';
    data.saveWork({ id: this.data.id, title, body, cover, filePath, fileName: this.data.fileName, fileSize: this.data.fileSize, fileType: fileTypeMatch ? fileTypeMatch[1].toLowerCase() : '', campId: this.data.camps[this.data.campIndex].id, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid, status });
    if (filePath !== this.data.filePath) this.setData({ filePath });
    wx.hideLoading();
    wx.showToast({ title: status === 'draft' ? '草稿已保存' : '作品已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  }
});
