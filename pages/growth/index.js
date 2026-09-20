// 记录/作品列表由足迹第三页进入；mode 决定当前展示哪一个模块，context 决定所属营地与阶段。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { mode: 'records', context: {}, title: '', records: [], works: [] },
  onLoad(options) {
    const context = nav.contextFrom(options);
    this.setData({ mode: options.mode === 'works' ? 'works' : 'records', context, title: data.contextTitle(context) });
    this.refresh();
  },
  onShow() { this.refresh(); },
  refresh() {
    const records = data.getGrowth(this.data.context).map(item => Object.assign(item, { campName: data.getCampName(item.campId), scene: (data.getCamp(item.campId) || {}).scene || 'rural', imageFailed: false }));
    const works = data.getWorks(this.data.context).map(item => Object.assign(item, { campName: data.getCampName(item.campId), scene: (data.getCamp(item.campId) || {}).scene || 'rural' }));
    this.setData({ records, works });
  },
  detailRecord(e) { nav.go(`/pages/growth/detail?id=${e.currentTarget.dataset.id}`); },
  detailWork(e) { nav.go(`/pages/profile/work-detail?id=${e.currentTarget.dataset.id}`); },
  create() {
    const target = this.data.mode === 'records' ? '/pages/growth/editor' : '/pages/profile/work-editor';
    nav.go(`${target}${nav.query(this.data.context)}`);
  },
  imageError(e) { const id = e.currentTarget.dataset.id; const records = this.data.records.map(item => item.id === id ? Object.assign({}, item, { imageFailed: true }) : item); this.setData({ records }); }
});
