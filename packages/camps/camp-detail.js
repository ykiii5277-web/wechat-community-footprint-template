// 营地详情页：阶段选择与原来的阶段内容页合并在这里，避免在两页之间切换。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const featureGuide = require('../../utils/feature-guide');
// 复用足迹页面已有的水彩营地素材，保证进入营地后的视觉仍是一套风格。
const campArtwork = {
  rural: '/assets/images/rural-hero-v2.jpg',
  summer: '/assets/images/summer-hero-v2.jpg',
  changsha: '/assets/images/changsha-hero-v2.jpg',
  shanghai: '/assets/images/shanghai-hero-v2.jpg',
  winter: '/assets/images/other-footprints-watercolor-v1.jpg',
  spark: '/assets/images/other-footprints-watercolor-v1.jpg',
  other: '/assets/images/other-footprints-watercolor-v1.jpg'
};
// 阶段选择卡使用独立的人物插画，而不是重复展示整张营地背景图。
// 后续若增加新阶段，只需在这里补上一张对应图片即可。
const stagePortraits = {
  camper: '/packages/camps/assets/stage-camper-v1.jpg',
  volunteer: '/packages/camps/assets/stage-volunteer-v1.jpg'
};
function stageState(camp, stage, subcampId, activityName) {
  const context = { campId: camp.id, stageId: stage ? stage.id : '', subcampId: subcampId || '', activityName: camp.id === 'other' ? String(activityName || '').trim() : '' };
  const subcamp = data.getSubcamp(context.campId, context.stageId, context.subcampId);
  // 页面只保留阶段标题；原本的文字介绍卡已按界面设计移除。
  return { activeStage: stage, context, stageTitle: subcamp ? subcamp.name : stage.name };
}

Page({
  data: { camp: null, hasStages: false, stages: [], activeStage: null, context: {}, stageTitle: '', activityName: '', hasCompanions: false, hasAlbum: false, hasRecords: false, hasWorks: false },
  onLoad(options) {
    const savedCamp = data.getCamp(options.campId);
    const activityName = savedCamp && savedCamp.id === 'other' ? data.normalizeActivityName(nav.decode(options.activityName)) : '';
    // “其他活动”必须先选择一个活动文件夹，不能再从详情页临时输入名称。
    if (savedCamp && savedCamp.id === 'other' && !activityName) return wx.redirectTo({ url: '/pages/activities/index' });
    this._activityId = nav.decode(options.activityId);
    const activity = savedCamp && savedCamp.id === 'other' ? data.getActivity(this._activityId, activityName) : null;
    const camp = savedCamp && Object.assign({}, savedCamp, {
      name: activity ? activity.name : savedCamp.name,
      heroImage: (activity && activity.cover) || campArtwork[savedCamp.id] || campArtwork.rural
    });
    if (!camp) return wx.navigateBack();
    const activeStage = camp.stages.find(item => item.id === options.stageId) || camp.stages[0] || null;
    const detail = activeStage ? stageState(camp, activeStage, options.subcampId, activityName) : { context: { campId: camp.id, activityName } };
    this.setData(Object.assign({ camp, hasStages: camp.stages.length > 0, activityName }, detail));
  },
  // 返回任一模块后，更新当前阶段与所有阶段入口的红色路径提示。
  onShow() { this.refresh(); featureGuide.syncPage(this); },
  refresh() {
    const camp = this.data.camp;
    if (!camp) return;
    if (camp.id === 'other') {
      const activity = data.getActivity(this._activityId, this.data.activityName);
      const name = activity ? activity.name : data.getCamp('other').name;
      const heroImage = activity && activity.cover || campArtwork.other;
      if (name !== camp.name || heroImage !== camp.heroImage) this.setData({ 'camp.name': name, 'camp.heroImage': heroImage });
    }
    this.refreshJourneyNotices();
  },
  refreshJourneyNotices() {
    const campId = this.data.camp.id;
    const context = this.data.context.campId ? this.data.context : { campId };
    // 为每个入口补齐“是否选中、是否已有内容、人物插画”三项纯展示数据。
    // 使用新对象避免修改 data.js 中保存的原始营地数据。
    const contexts = this.data.camp.stages.map(item => ({ campId, stageId: item.id, activityName: context.activityName }));
    const [current, ...stageNotices] = data.getJourneyNotices([context, ...contexts]);
    const stages = this.data.camp.stages.map((item, index) => Object.assign({}, item, {
      active: context.stageId === item.id,
      hasJourneyEdits: Object.values(stageNotices[index]).some(Boolean),
      portrait: stagePortraits[item.id] || this.data.camp.heroImage
    }));
    this.setData(Object.assign({ stages }, current));
  },
  // 点击阶段只在本页切换模块内容，不再进入原来的 stages 独立页面。
  chooseStage(e) {
    const stage = this.data.camp.stages.find(item => item.id === e.currentTarget.dataset.stage);
    if (!stage) return;
    this.setData(stageState(this.data.camp, stage, '', this.data.activityName), () => {
      this.refreshJourneyNotices();
      wx.pageScrollTo({ selector: '#stage-modules', duration: 280 });
    });
  },
  openCompanions() { nav.go(`/pages/companions/index${nav.query(this.data.context)}`); },
  openAlbum() { nav.go(`/pages/album/index${nav.query(this.data.context)}`); },
  openRecords() { nav.go(`/pages/growth/index?mode=records${nav.query(this.data.context).replace('?', '&')}`); },
  openWorks() { nav.go(`/pages/growth/index?mode=works${nav.query(this.data.context).replace('?', '&')}`); }
});
