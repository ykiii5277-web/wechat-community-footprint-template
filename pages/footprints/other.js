// “更多活动”是足迹地图的延伸入口；各类活动继续使用同一套详情与内容模块。
const nav = require('../../utils/nav');

Page({
  openCamp(e) { nav.go(`/pages/camp/detail?campId=${e.currentTarget.dataset.id}`); },
  switchTab(e) { wx.switchTab({ url: e.currentTarget.dataset.path }); }
});
