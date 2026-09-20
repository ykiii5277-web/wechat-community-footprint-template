// 图片详情页：展示一张照片及其点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const imagePreview = require('../../utils/image-preview');

Page({
  data: { photo: null, camp: null },
  onLoad(options) { this.id = options.id; data.recordContentView('photo', this.id); this.refresh(); },
  onShow() { if (this.id) this.refresh(); },
  refresh() { const photo = data.getPhoto(this.id); if (!photo) return wx.navigateBack(); this.setData({ photo, camp: data.getCamp(photo.campId) }); },
  previewImage() { imagePreview.open(this.data.photo.image); },
  favorite() { data.toggleFavorite('photo', this.id); this.refresh(); },
  edit() { const { campId, stageId, subcampId } = this.data.photo; nav.go(`/pages/album/editor?id=${this.id}&campId=${campId}&stageId=${stageId || ''}&subcampId=${subcampId || ''}`); },
  remove() { wx.showModal({ title: '删除这张图片？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deletePhoto(this.id); wx.navigateBack({ delta: 1 }); } } }); }
});
