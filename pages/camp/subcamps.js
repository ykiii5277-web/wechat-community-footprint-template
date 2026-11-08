// 子营地选择页：当营地有更细一级分类时，在这里继续选择。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { camp: null, stageId: '', subcamps: [] },
  onLoad(options) { const camp = data.getCamp(options.campId); if (!camp) return wx.navigateBack(); const subcamps = camp.subcamps.filter(item => item.stageId === options.stageId); this.setData({ camp, stageId: options.stageId, subcamps }); },
  // 子营地仍会打开对应的阶段内容，但该内容现在已并入营地详情页。
  open(e) { const id = e.currentTarget.dataset.id; nav.go(`/packages/camps/camp-detail?campId=${this.data.camp.id}&stageId=${this.data.stageId}&subcampId=${id}`); },
  quick(e) { const { id, type } = e.currentTarget.dataset; const context = { campId: this.data.camp.id, stageId: this.data.stageId, subcampId: id }; nav.go(`/pages/${type === 'companions' ? 'companions' : 'album'}/index${nav.query(context)}`); }
});
