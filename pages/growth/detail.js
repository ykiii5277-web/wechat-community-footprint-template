// 成长记录详情页：展示单条记录，并提供点赞、评论、编辑和删除操作。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const imagePreview = require('../../utils/image-preview');

Page({
  data: { entry: null, camp: null },
  async onLoad(options) {
    const entry = await require('../../utils/actions').readOwnContent(() => data.getGrowthById(options.id));
    if (this._unloaded) return;
    if (!entry) return wx.navigateBack();
    this.id = options.id;
    this.showEntry(entry);
    const viewed = data.recordContentView('growth', this.id);
    if (viewed && Number.isFinite(viewed.views) && viewed.views !== entry.views) this.setData({ 'entry.views': viewed.views });
  },
  onShow() { if (this._shown && this.id) this.refresh(); this._shown = true; },
  onUnload() { this._unloaded = true; },
  refresh() {
    if (!this.id || this._unloaded) return;
    const entry = data.getGrowthById(this.id);
    if (!entry) return wx.navigateBack();
    this.showEntry(entry);
  },
  showEntry(entry) { this.setData({ entry, camp: data.getCamp(entry.campId) }); },
  previewImage(e) { imagePreview.open(this.data.entry.images || [], e.currentTarget.dataset.index); },
  favorite() { return require('../../utils/actions').run(this, () => data.toggleFavorite('growth', this.id), '', () => this.refresh()); },
  edit() { nav.go(`/pages/growth/editor?id=${this.id}`); },
  remove() { wx.showModal({ title: '删除这条记录？', content: '删除后无法恢复，是否继续？', confirmColor: '#C84A3A', success: result => { if (result.confirm) require('../../utils/actions').run(this, () => data.deleteGrowth(this.id), '记录已删除', () => wx.navigateBack({ delta: 1 })); } }); }
});
