// 成长记录详情页：展示单条记录，并提供点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const imagePreview = require('../../utils/image-preview');

Page({
  data: { entry: null, camp: null },
  onLoad(options) { this.id = options.id; data.recordContentView('growth', this.id); this.refresh(); },
  onShow() { if (this.id) this.refresh(); },
  refresh() { const entry = data.getGrowthById(this.id); if (!entry) return wx.navigateBack(); this.setData({ entry, camp: data.getCamp(entry.campId) }); },
  previewImage(e) { imagePreview.open(this.data.entry.images || [], e.currentTarget.dataset.index); },
  favorite() { data.toggleFavorite('growth', this.id); this.refresh(); },
  edit() { nav.go(`/pages/growth/editor?id=${this.id}`); },
  remove() { wx.showModal({ title: '删除这条记录？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) { data.deleteGrowth(this.id); wx.navigateBack({ delta: 1 }); } } }); }
});
