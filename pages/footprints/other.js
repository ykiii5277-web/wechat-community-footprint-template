// “其他足迹”是足迹地图的延伸入口；三类活动继续使用同一套营地详情与内容模块。
const nav = require('../../utils/nav');

Page({
  openCamp(e) { nav.go(`/packages/camps/camp-detail?campId=${e.currentTarget.dataset.id}`); },
  switchTab(e) { wx.switchTab({ url: e.currentTarget.dataset.path }); }
});
