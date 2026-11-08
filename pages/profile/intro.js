// 简介展示页：空资料用提示文案代替，方便用户知道从哪里开始填写。
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const featureGuide = require('../../utils/feature-guide');

Page({
  data: { profile: null },
  renderProfile(profile) {
    if (!profile) return;
    profile = Object.assign({}, profile);
    profile.displayName = profile.name || '请填写昵称';
    profile.displayAge = profile.stats.age === '' || profile.stats.age == null ? '?' : profile.stats.age;
    profile.displayCampCount = profile.stats.campCount === '' || profile.stats.campCount == null ? '?' : profile.stats.campCount;
    this.setData({ profile });
  },
  async onShow() {
    featureGuide.syncPage(this);
    this.renderProfile(data.getProfile());
    this.renderProfile(await data.refreshCurrentProfileAsync());
  },
  edit() { nav.go('/pages/profile/intro-editor'); }
});
