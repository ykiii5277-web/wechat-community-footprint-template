// 足迹首页：从营地配置生成地图上的四个可点击入口。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const featureGuide = require('../../utils/feature-guide');

Page({
  data: { camps: [], showProfileGuide: false, otherFootprintsHasContent: false },
  // 返回足迹首页时重新判断，刚编辑过的伙伴或相册会立刻出现红色提示。
  onShow() {
    if (getApp().ensureProfileOnboarding && getApp().ensureProfileOnboarding()) return;
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setSelected(1);
    // 首页地图固定呈现原有四个营地；主题活动、兴趣计划和其他活动从右上角“其他足迹”进入。
    const primaryIds = ['rural', 'summer', 'changsha', 'shanghai'];
    const campIds = primaryIds.concat(['winter', 'spark', 'other']);
    const notices = data.getJourneyNotices(campIds.map(campId => ({ campId }))).map(flags => Object.values(flags).some(Boolean));
    const camps = data.camps().filter(item => primaryIds.includes(item.id)).map(item => Object.assign(item, { hasJourneyEdits: notices[primaryIds.indexOf(item.id)] }));
    this.setData({ camps, otherFootprintsHasContent: notices.slice(primaryIds.length).some(Boolean), showProfileGuide: data.shouldShowProfileGuide() });
    featureGuide.syncPage(this);
    getApp().maybeOpenFeatureGuide();
  },
  openCamp(e) { nav.go(`/packages/camps/camp-detail?campId=${e.currentTarget.dataset.id}`); },
  openOtherFootprints() { nav.go('/pages/other-footprints/index'); },
  // 自定义欢迎卡片支持局部加粗；两种选择都会写入“已处理”状态，避免反复弹出。
  guideEdit() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); nav.go('/pages/profile/intro-editor'); },
  guideSkip() { data.markProfileGuideSeen(); this.setData({ showProfileGuide: false }); }
});
