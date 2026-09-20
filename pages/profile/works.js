// 旧版“我的作品”列表入口；与成长栏的作品数据共用同一份本地数据。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
Page({
  data: { works: [], draftCount: 0 },
  onShow() {
    const works = data.getWorks().map(item => Object.assign(item, { campName: data.getCampName(item.campId), scene: (data.getCamp(item.campId) || {}).scene || 'rural' }));
    this.setData({ works, draftCount: works.filter(item => item.status === 'draft').length });
  },
  open(e) { nav.go(`/pages/profile/work-detail?id=${e.currentTarget.dataset.id}`); },
  create() { nav.go('/pages/profile/work-editor'); }
});
