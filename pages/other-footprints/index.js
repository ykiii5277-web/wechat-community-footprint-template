// 使用标准的“目录/index”页面结构，避免开发者工具对新增单文件路由的热更新遗漏。
const data = require('../../utils/data');

Page({
  data: { winterHasContent: false, sparkHasContent: false, otherHasContent: false },
  onShow() {
    this.setData({
      winterHasContent: data.hasJourneyEdits({ campId: 'winter' }),
      sparkHasContent: data.hasJourneyEdits({ campId: 'spark' }),
      otherHasContent: data.hasJourneyEdits({ campId: 'other' })
    });
  },
  openCamp(e) {
    const campId = e.currentTarget.dataset.id;
    if (campId === 'other') return wx.navigateTo({ url: '/pages/activities/index' });
    wx.navigateTo({ url: `/pages/camp/detail?campId=${encodeURIComponent(campId)}` });
  },
  backToFootprints() { wx.switchTab({ url: '/pages/footprints/index' }); },
  switchTo(e) { wx.switchTab({ url: e.currentTarget.dataset.path }); }
});
