// 图片详情页：展示一张照片及其点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const imagePreview = require('../../utils/image-preview');

Page({
  data: { photo: null, camp: null },
  async onLoad(options) {
    const photo = await require('../../utils/actions').readOwnContent(() => data.getPhoto(options.id));
    if (this._unloaded) return;
    if (!photo) return wx.navigateBack();
    this.id = options.id;
    this.showPhoto(photo);
    this.recordView();
  },
  onShow() { if (this._shown && this.id) this.refresh(); this._shown = true; },
  onUnload() { this._unloaded = true; },
  refresh() {
    if (!this.id || this._unloaded) return;
    const photo = data.getPhoto(this.id);
    if (!photo) return wx.navigateBack();
    this.showPhoto(photo);
  },
  showPhoto(photo) { this.setData({ photo, camp: data.getCamp(photo.campId) }); },
  recordView() {
    const viewed = data.recordContentView('photo', this.id);
    if (viewed && Number.isFinite(viewed.views) && viewed.views !== this.data.photo.views) this.setData({ 'photo.views': viewed.views });
  },
  previewImage() {
    const photo = this.data.photo;
    if (!photo) return;
    const context = photo.folderId ? { folderId: photo.folderId } : {};
    return imagePreview.openAlbum(data.getPhotos(context), photo, { useCloudFileIds: true, onClose: photo => {
      if (this._unloaded || !photo || String(photo.id) === String(this.id)) return;
      this.id = photo.id;
      this.refresh();
      if (this.data.photo && this.data.photo.id === this.id) this.recordView();
    } });
  },
  favorite() { return require('../../utils/actions').run(this, () => data.toggleFavorite('photo', this.id), '', () => this.refresh()); },
  edit() { const { campId, stageId, subcampId } = this.data.photo; nav.go(`/pages/album/editor?id=${this.id}&campId=${campId}&stageId=${stageId || ''}&subcampId=${subcampId || ''}`); },
  remove() { wx.showModal({ title: '删除这张图片？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) require('../../utils/actions').run(this, () => data.deletePhoto(this.id), '图片已删除', () => wx.navigateBack({ delta: 1 })); } }); }
});
