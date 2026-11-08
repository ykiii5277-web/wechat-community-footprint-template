// 作品详情页：展示单篇作品以及点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const media = require('../../utils/work-media');
const reviewSync = require('../../utils/work-review-sync');
const VIDEO_URL_REUSE_MS = 2 * 60 * 1000;
function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
Page({
  data: { work: null, camp: null, body: '', fileMeta: '', isVideo: false, videoUrl: '' },
  async onLoad(options) {
    const work = await require('../../utils/actions').readOwnContent(() => data.getWork(options.id));
    if (this._unloaded) return;
    if (!work) return wx.navigateBack();
    this.id = options.id;
    this.showWork(work);
    if (this._visible !== false) reviewSync.start(this, this.refresh);
    const viewed = data.recordContentView('work', this.id);
    if (viewed && Number.isFinite(viewed.views) && viewed.views !== work.views) this.setData({ 'work.views': viewed.views });
  },
  onShow() { this._visible = true; if (this._shown && this.id) { this.refresh(); reviewSync.start(this, this.refresh); } this._shown = true; },
  onHide() { this._visible = false; reviewSync.stop(this); },
  onUnload() { this._unloaded = true; reviewSync.stop(this); },
  refresh() {
    if (!this.id || this._unloaded) return;
    const work = data.getWork(this.id);
    if (!work) return wx.navigateBack();
    this.showWork(work);
  },
  showWork(work) {
    const isVideo = media.isVideo(work);
    const path = isVideo ? work.filePath : '';
    const sameVideo = !!path && this._videoPath === path;
    if (!sameVideo) {
      this._videoPath = path;
      this._videoRequest = null;
      this._videoResolvedAt = 0;
    }
    const update = { work, camp: data.getCamp(work.campId), body: work.body || '', fileMeta: formatFileSize(work.fileSize), isVideo };
    if (!sameVideo) update.videoUrl = '';
    this.setData(update);
    if (!path || this._videoRequest || this.data.videoUrl && Date.now() - this._videoResolvedAt < VIDEO_URL_REUSE_MS) return;
    const request = this._videoRequest = media.playbackUrl(work);
    request.then(videoUrl => {
      if (!this._unloaded && this._videoRequest === request && videoUrl) {
        this._videoResolvedAt = Date.now();
        this.setData({ videoUrl });
      }
    }).catch(() => {}).finally(() => {
      if (this._videoRequest === request) this._videoRequest = null;
    });
  },
  favorite() { return require('../../utils/actions').run(this, () => data.toggleFavorite('work', this.id), '', () => this.refresh()); },
  saveVideo() { return media.saveVideo(() => this.data.work); },
  // 继续携带原作品的足迹归属，编辑后仍能回到同一个营地阶段。
  edit() { const work = this.data.work; const context = { campId: work.campId, stageId: work.stageId, subcampId: work.subcampId }; nav.go(`/pages/profile/work-editor?id=${this.id}${nav.query(context).replace('?', '&')}`); },
  openFile() {
    if (media.isVideo(this.data.work)) return media.playbackUrl(this.data.work).then(url => wx.previewMedia({ sources: [{ url, type: 'video' }] })).catch(() => wx.showToast({ title: '视频加载失败，请重试', icon: 'none' }));
    const filePath = this.data.work && this.data.work.filePath;
    if (!filePath) return wx.showToast({ title: '暂未上传作品文件', icon: 'none' });
    const open = path => wx.openDocument({ filePath: path, showMenu: true, fail: () => wx.showToast({ title: '该文件格式暂不支持打开', icon: 'none' }) });
    // 云存储文件需先下载成临时本地路径；直接把 cloud:// 传给 openDocument 会导致打开失败。
    if (/^cloud:\/\//.test(filePath)) {
      if (!wx.cloud || !wx.cloud.downloadFile) return wx.showToast({ title: '云文件暂不可打开', icon: 'none' });
      wx.showLoading({ title: '正在打开文件' });
      return wx.cloud.downloadFile({ fileID: filePath }).then(result => open(result.tempFilePath)).catch(() => wx.showToast({ title: '文件下载失败，请稍后再试', icon: 'none' })).finally(() => wx.hideLoading());
    }
    open(filePath);
  },
  remove() { wx.showModal({ title: '删除这篇作品？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) require('../../utils/actions').run(this, () => data.deleteWork(this.id), '作品已删除', () => wx.navigateBack({ delta: 1 })); } }); }
});
