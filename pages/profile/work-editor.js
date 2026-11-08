// 作品编辑页：上传作品文件、填写标题和正文，并保存其所属的足迹上下文。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');
const media = require('../../utils/work-media');

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

Page({
  data: { id: '', context: {}, title: '', body: '', legacyCover: '', filePath: '', fileName: '', fileSize: 0, fileMeta: '', mediaType: 'file', busy: false, videoUrl: '', visibilityOptions: [], visibilityIndex: 1, visibilityName: '仅好友可见', visibilityHint: '', isPublic: false, hideUid: false },
async onLoad(options) { await require('../../utils/actions').ready();
    if (options.id) await data.refreshOwnWorks().catch(() => false);
    if (this._unloaded) return;
    const camps = data.camps();
    const work = options.id ? data.getWork(options.id) : data.getSyncDraft(nav.decode(options.draftKey));
    this._workVersion = work && work.updatedAt;
    const routeContext = nav.contextFrom(options);
    const campId = (work && work.campId) || routeContext.campId || camps[0].id;
    const context = { campId, stageId: work ? (work.stageId || '') : routeContext.stageId, subcampId: work ? (work.subcampId || '') : routeContext.subcampId, activityName: work ? (work.activityName || '') : (routeContext.activityName || '') };
    const visibilityOptions = data.visibilityOptions();
    const visibilityIndex = Math.max(0, visibilityOptions.findIndex(item => item.value === (work ? work.visibility : 'friends')));
    this.setData({ id: work ? work.id : '', context, title: work ? work.title : '', body: work ? (work.body || '') : '', legacyCover: work ? (work.cover || '') : '', filePath: work ? (work.filePath || '') : '', fileName: work ? (work.fileName || '') : '', fileSize: work ? (work.fileSize || 0) : 0, fileMeta: work ? formatFileSize(work.fileSize) : '', visibilityOptions, visibilityIndex, visibilityName: visibilityOptions[visibilityIndex].name, visibilityHint: visibilityOptions[visibilityIndex].hint, isPublic: visibilityOptions[visibilityIndex].value === 'public', hideUid: work ? work.hideUid === true : false });
    if (media.isVideo(work)) { this.setData({ mediaType: 'video' }); media.playbackUrl(work).then(videoUrl => { if (this.data.filePath === work.filePath) this.setData({ videoUrl }); }).catch(() => {}); }
  },
  onUnload() { this._unloaded = true; },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  visibilityChange(e) { const visibilityIndex = Number(e.detail.value); const visibility = this.data.visibilityOptions[visibilityIndex]; this.setData({ visibilityIndex, visibilityName: visibility.name, visibilityHint: visibility.hint, isPublic: visibility.value === 'public' }); },
  hideUidChange(e) { this.setData({ hideUid: e.detail.value }); },
  chooseFile() {
    if (this.data.busy) return;
    privacy.chooseMessageFile({ count: 1, type: 'file', success: result => {
      const file = result.tempFiles[0];
      this.uploadAttachment(file.path, file.name || '未命名文件', media.isVideo({ fileName: file.name }) ? 'video' : 'file');
    }, fail: () => wx.showToast({ title: '暂未选择文件', icon: 'none' }) });
  },
  chooseVideo() {
    if (this.data.busy) return;
    privacy.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album'], success: result => {
      this.uploadAttachment(result.tempFiles[0].tempFilePath, `视频-${Date.now()}.mp4`, 'video');
    }, fail: error => { if (!/cancel/i.test(String(error && error.errMsg))) cloud.showUploadError(error, '无法选择视频'); } });
  },
  async uploadAttachment(path, name, mediaType) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: mediaType === 'video' ? '正在压缩视频' : '正在上传文件', mask: true });
    try {
      const prepared = mediaType === 'video' ? await require('../../utils/retry').run(() => media.prepareVideo(path), { title: '视频处理失败' }) : { path, size: await cloud.fileSize(path) };
      if (mediaType === 'video' && prepared.size > cloud.MAX_VIDEO_FILE_BYTES) throw new Error('压缩后的视频不能超过500M');
      if (prepared.size > cloud.MAX_MEDIA_FILE_BYTES) throw new Error('作品单个文件不能超过1000M');
      if (mediaType === 'video') name = name.replace(/\.[^.]+$/, '') + '.mp4';
      wx.showLoading({ title: '正在上传作品', mask: true });
      const filePath = await cloud.persistFile(prepared.path, mediaType === 'video' ? 'work-videos' : 'work-files', name);
      this.setData({ filePath, fileName: name, fileSize: prepared.size, fileMeta: formatFileSize(prepared.size), mediaType, videoUrl: mediaType === 'video' ? prepared.path : '' });
    } catch (error) { cloud.showUploadError(error, '作品上传失败', () => this.uploadAttachment(path, name, mediaType)); }
    finally { this.setData({ busy: false }); wx.hideLoading(); }
  },
  clearFile() { if (!this.data.busy) this.setData({ filePath: '', fileName: '', fileSize: 0, fileMeta: '', mediaType: 'file', videoUrl: '' }); },
  async save() {
    if (this.data.busy) return;
    const status = 'published';
    const title = this.data.title.trim();
    const body = this.data.body.trim();
    if (!title) return wx.showToast({ title: '请先写下作品标题', icon: 'none' });
    if (!body && !this.data.filePath) return wx.showToast({ title: '请填写正文或上传作品文件', icon: 'none' });
    if (media.isVideo(this.data) && this.data.fileSize > cloud.MAX_VIDEO_FILE_BYTES) return wx.showToast({ title: '压缩后的视频不能超过500M', icon: 'none' });
    if (this.data.fileSize > cloud.MAX_MEDIA_FILE_BYTES) return wx.showToast({ title: '作品单个文件不能超过1000M', icon: 'none' });
    this._pendingWorkId = this.data.id || this._pendingWorkId || data.newContentId('work');
    data.stageDraft('work', Object.assign({}, this.data.context, { id: this._pendingWorkId, title, body, filePath: this.data.filePath, fileName: this.data.fileName, fileSize: this.data.fileSize, mediaType: this.data.mediaType, cover: this.data.legacyCover, status, visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid }));
    this.setData({ busy: true });
    wx.showLoading({ title: '正在保存作品' });
    let filePath = this.data.filePath;
    try {
      if (filePath && !cloud.isRemoteFile(filePath)) filePath = await cloud.persistFile(filePath, media.isVideo(this.data) ? 'work-videos' : 'work-files', this.data.fileName);
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy: false });
      return cloud.showUploadError(error, '作品文件未上传成功', () => this.save());
    }
    const fileTypeMatch = String(this.data.fileName || '').match(/\.([^.]+)$/);
    // 旧版本封面若仍是本机临时路径就不再带入共享内容，避免它导致整条作品云端保存失败。
    const cover = cloud.isRemoteFile(this.data.legacyCover) ? this.data.legacyCover : '';
    this.setData({ busy: true });
    try {
      this._pendingWorkId = this.data.id || this._pendingWorkId || `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const saved = await data.saveWorkAsync({ id: this._pendingWorkId, updatedAt: this._workVersion, title, body, cover, filePath, mediaType: this.data.mediaType, fileName: this.data.fileName, fileSize: this.data.fileSize, fileType: fileTypeMatch ? fileTypeMatch[1].toLowerCase() : '', campId: this.data.context.campId, stageId: this.data.context.stageId, subcampId: this.data.context.subcampId, activityName: this.data.context.activityName || '', visibility: this.data.visibilityOptions[this.data.visibilityIndex].value, hideUid: this.data.isPublic && this.data.hideUid, status });
      this._reviewPending = saved && saved.reviewStatus === 'pending';
    } catch (error) { wx.hideLoading(); this.setData({ busy: false }); return cloud.showUploadError(error, '作品保存失败', () => this.save()); }
    this.setData({ busy: false });
    if (filePath !== this.data.filePath) this.setData({ filePath });
    wx.hideLoading();
    wx.showToast({ title: this._reviewPending ? '已保存，附件待审核' : '作品已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 350);
  }
});
