// 阶段选择页：把一个营地下的“营员/志愿者”等阶段渲染成入口。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { camp: null, stage: null, context: {}, intro: '', pageTitle: '', subtitle: '', hasCompanions: false, hasAlbum: false, hasRecords: false, hasWorks: false },
  onLoad(options) { const camp = data.getCamp(options.campId); if (!camp) return wx.navigateBack(); const stage = camp.stages.find(item => item.id === options.stageId); const context = { campId: camp.id, stageId: stage ? stage.id : '', subcampId: options.subcampId || '' }; const subcamp = data.getSubcamp(context.campId, context.stageId, context.subcampId); this.setData({ camp, stage, context, pageTitle: subcamp ? subcamp.name : stage.name, subtitle: subcamp ? `${camp.name} · ${stage.name}` : camp.name, intro: subcamp ? `在${subcamp.name}，我们以志愿服务的方式，把经验与温暖分享给更多人。` : stage && stage.id === 'volunteer' ? '以志愿者的身份回望，把经验与温暖分享给更多人。' : '从好奇出发，在每一次体验中慢慢认识自己和世界。' }, () => this.refreshContentState()); },
  // 从记录、作品、伙伴或相册页返回时，更新四个模块的内容提示。
  onShow() { if (this.data.context.campId) this.refreshContentState(); },
  refreshContentState() {
    const context = this.data.context;
    this.setData({ hasCompanions: data.getCompanions(context).length > 0, hasAlbum: data.getPhotos(context).length > 0, hasRecords: data.getGrowth(context).length > 0, hasWorks: data.getWorks(context).length > 0 });
  },
  companions() { nav.go(`/pages/companions/index${nav.query(this.data.context)}`); },
  album() { nav.go(`/pages/album/index${nav.query(this.data.context)}`); },
  // “成长”原本的两个子模块现作为足迹第三页的独立入口。
  records() { nav.go(`/pages/growth/index?mode=records${nav.query(this.data.context).replace('?', '&')}`); },
  works() { nav.go(`/pages/growth/index?mode=works${nav.query(this.data.context).replace('?', '&')}`); }
});
