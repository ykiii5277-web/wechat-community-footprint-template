// 好友营地详情：复刻自己的足迹逻辑，但所有内容由云端先做好友权限过滤。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

const portraits = { camper: '/assets/images/stage-camper-v1.jpg', volunteer: '/assets/images/stage-volunteer-v1.jpg' };
const modules = [
  { kind: 'companion', name: '伙伴', hint: '一起同行的人', icon: '♟', tone: 'green' },
  { kind: 'photo', name: '相册', hint: '留下的好时光', icon: '▧', tone: 'gold' },
  { kind: 'growth', name: '记录', hint: '写下的成长感受', icon: '✦', tone: 'coral' },
  { kind: 'work', name: '作品', hint: '保存的创作文件', icon: '▤', tone: 'blue' }
];

Page({
  data: { friend: null, camp: null, stages: [], activeStage: null, modules: [], activityName: '' },
  onLoad(options) {
    this.uid = nav.decode(options.id);
    this.campId = nav.decode(options.campId);
    this.activityName = data.normalizeActivityName(nav.decode(options.activityName));
    if (this.campId === 'other' && !this.activityName) return wx.redirectTo({ url: `/pages/friends/activities?id=${encodeURIComponent(this.uid)}` });
    this.refresh();
  },
  async refresh() {
    const result = await data.getFriendContentAsync(this.uid, 'footprints');
    if (!result || result.error) return wx.showToast({ title: result && result.error ? result.error : '好友足迹暂不可查看', icon: 'none' });
    const savedCamp = data.getCamp(this.campId);
    if (!savedCamp) return wx.navigateBack();
    const camp = Object.assign({}, savedCamp, { name: this.campId === 'other' && this.activityName ? this.activityName : savedCamp.name });
    this.records = (result.records || []).filter(item => item.campId === this.campId && (!this.activityName || data.normalizeActivityName(item.activityName) === this.activityName));
    const activeStage = this.data.activeStage || camp.stages[0];
    const stages = camp.stages.map(stage => Object.assign({}, stage, { portrait: portraits[stage.id], active: activeStage && activeStage.id === stage.id, hasContent: this.records.some(item => !item.stageId || item.stageId === stage.id) }));
    this.setData({ friend: result.friend, camp, stages, activeStage, activityName: this.activityName }, () => this.refreshModules());
  },
  chooseStage(e) {
    const activeStage = this.data.camp.stages.find(item => item.id === e.currentTarget.dataset.id);
    if (!activeStage) return;
    this.setData({ activeStage, stages: this.data.stages.map(item => Object.assign({}, item, { active: item.id === activeStage.id })) }, () => this.refreshModules());
  },
  refreshModules() {
    const stageId = this.data.activeStage ? this.data.activeStage.id : '';
    const visible = this.records.filter(item => !stageId || !item.stageId || item.stageId === stageId);
    this.setData({ modules: modules.map(item => Object.assign({}, item, { count: visible.filter(record => record.kind === item.kind).length })) });
  },
  openModule(e) {
    const stageId = this.data.activeStage ? this.data.activeStage.id : '';
    const activity = this.activityName ? `&activityName=${encodeURIComponent(this.activityName)}` : '';
    const kind = e.currentTarget.dataset.kind;
    if (kind === 'photo') return nav.go(`/pages/friends/albums?id=${encodeURIComponent(this.uid)}&campId=${encodeURIComponent(this.campId)}&stageId=${encodeURIComponent(stageId)}${activity}`);
    nav.go(`/pages/friends/content?id=${encodeURIComponent(this.uid)}&type=module&campId=${encodeURIComponent(this.campId)}&stageId=${encodeURIComponent(stageId)}&kind=${encodeURIComponent(kind)}${activity}`);
  }
});
