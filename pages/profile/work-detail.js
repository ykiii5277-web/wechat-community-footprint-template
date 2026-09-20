// 作品详情页：展示单篇作品以及点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return '';
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
Page({
  data: { work: null, camp: null, body: '', fileMeta: '' },
  onLoad(options) { this.id = options.id; data.recordContentView('work', this.id); this.refresh(); },
  onShow() { if (this.id) this.refresh(); },
  refresh() { const work = data.getWork(this.id); if (!work) return wx.navigateBack(); const camp = data.getCamp(work.campId); this.setData({ work, camp, body: work.body || '', fileMeta: formatFileSize(work.fileSize) }); },
  favorite() { data.toggleFavorite('work', this.id); this.refresh(); },
  // 继续携带原作品的足迹归属，编辑后仍能回到同一个营地阶段。
  edit() { const work = this.data.work; const context = { campId: work.campId, stageId: work.stageId, subcampId: work.subcampId }; nav.go(`/pages/profile/work-editor?id=${this.id}${nav.query(context).replace('?', '&')}`); },
  openFile() {
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
  remove() { wx.showModal({ title: '删除这篇作品？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deleteWork(this.id); wx.navigateBack({ delta: 1 }); } } }); }
});
