// 足迹首页：从营地配置生成地图上的四个可点击入口。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { camps: [], showProfileGuide: false, otherFootprintsHasContent: false },
  // 返回足迹首页时重新判断，刚编辑过的伙伴或相册会立刻出现红色提示。
  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setSelected(1);
    // 首页地图固定呈现四个主要分类；其余预置分类与自定义活动从右上角“更多活动”进入。
    const primaryIds = ['rural', 'summer', 'changsha', 'shanghai'];
    const otherFootprintsHasContent = ['winter', 'spark', 'other'].some(campId => data.hasJourneyEdits({ campId }));
    this.setData({ camps: data.camps().filter(item => primaryIds.indexOf(item.id) >= 0).map(item => Object.assign(item, { hasJourneyEdits: data.hasJourneyEdits({ campId: item.id }) })), otherFootprintsHasContent, showProfileGuide: data.shouldShowProfileGuide() });
  },
  openCamp(e) { nav.go(`/pages/camp/detail?campId=${e.currentTarget.dataset.id}`); },
  openOtherFootprints() { nav.go('/pages/other-footprints/index'); },
  // 自定义欢迎卡片支持局部加粗；两种选择都会写入“已处理”状态，避免反复弹出。
  guideEdit() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); nav.go('/pages/profile/intro-editor'); },
  guideSkip() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); }
});
