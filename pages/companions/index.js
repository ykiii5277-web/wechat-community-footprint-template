// 伙伴列表页：读取当前营地上下文下的伙伴，并打开新增/编辑页面。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { title: '', context: {}, companions: [] },
  onLoad(options) { const context = nav.contextFrom(options); this.setData({ context, title: data.contextTitle(context) }); this.refresh(); },
  onShow() { if (this._shown && this.data.context.campId) this.refresh(); this._shown = true; },
  // 读取头像裁切参数；兼容早期保存的伙伴资料（没有参数时使用默认值）。
  refresh() { const companions = data.getCompanions(this.data.context).map((item, index) => Object.assign(item, { tone: index % 4, avatarScale: Number(item.avatarScale) || 1.3, avatarOffsetX: Number(item.avatarOffsetX) || 0, avatarOffsetY: Number(item.avatarOffsetY) || 0 })); this.setData({ companions }); },
  create() { nav.go(`/pages/companions/editor${nav.query(this.data.context)}`); },
  edit(e) { nav.go(`/pages/companions/editor?id=${e.currentTarget.dataset.id}&${nav.query(this.data.context).slice(1)}`); }
});
