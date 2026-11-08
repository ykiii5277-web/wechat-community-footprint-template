// 记录/作品列表由足迹第三页进入；mode 决定当前展示哪一个模块，context 决定所属营地与阶段。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const reviewSync = require('../../utils/work-review-sync');

Page({
  data: { mode: 'records', context: {}, title: '', records: [], works: [] },
  onLoad(options) {
    const context = nav.contextFrom(options);
    this.setData({ mode: options.mode === 'works' ? 'works' : 'records', context, title: data.contextTitle(context) });
    this.refresh();
  },
  onShow() {
    if (this._shown) this.refresh(); this._shown = true;
    if (this.data.mode === 'works') reviewSync.start(this, this.refresh);
  },
  onHide() { reviewSync.stop(this); },
  onUnload() { reviewSync.stop(this); },
  refresh() {
    const showWorks = this.data.mode === 'works';
    const items = showWorks ? data.getWorks(this.data.context) : data.getGrowth(this.data.context);
    const camps = new Map();
    const cards = items.map(item => {
      if (!camps.has(item.campId)) camps.set(item.campId, data.getCamp(item.campId) || {});
      const camp = camps.get(item.campId);
      return Object.assign({}, item, { campName: camp.name || '未关联营地', scene: camp.scene || 'rural' });
    });
    this.setData({ [showWorks ? 'works' : 'records']: cards });
  },
  detailRecord(e) { nav.go(`/pages/growth/detail?id=${e.currentTarget.dataset.id}`); },
  detailWork(e) { nav.go(`/pages/profile/work-detail?id=${e.currentTarget.dataset.id}`); },
  create() {
    const target = this.data.mode === 'records' ? '/pages/growth/editor' : '/pages/profile/work-editor';
    nav.go(`${target}${nav.query(this.data.context)}`);
  },
  imageError(e) {
    const index = this.data.records.findIndex(item => item.id === e.currentTarget.dataset.id);
    if (index >= 0 && !this.data.records[index].imageFailed) this.setData({ [`records[${index}].imageFailed`]: true });
  }
});
