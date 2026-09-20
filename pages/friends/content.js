// 好友公开内容页：按类型查看对方的简介、足迹或成长内容。
const data = require('../../utils/data');
const nav = require('../../utils/nav');

const titles = { footprints: '好友足迹', intro: '关于TA', module: '好友足迹内容' };
const moduleTitles = { companion: '好友伙伴', photo: '好友相册', growth: '好友记录', work: '好友作品' };

Page({
  data: { friend: null, type: '', title: '', camps: [], records: [] },
  onLoad(options) { this.id = nav.decode(options.id); this.type = options.type || 'intro'; this.campId = nav.decode(options.campId); this.stageId = nav.decode(options.stageId); this.kind = nav.decode(options.kind); this.folderId = nav.decode(options.folderId); this.activityName = data.normalizeActivityName(nav.decode(options.activityName)); this.refresh(); },
  onShow() { if (this.id) this.refresh(); },
  async refresh() {
    const result = await data.getFriendContentAsync(this.id, this.type);
    if (!result || result.error) {
      wx.showToast({ title: result && result.error ? result.error : '无权访问此内容', icon: 'none' });
      return setTimeout(() => wx.navigateBack(), 300);
    }
    const rawFriend = result.friend || {};
    const stats = rawFriend.stats || {};
    const friend = Object.assign({}, rawFriend, {
      displayName: rawFriend.name || '未命名用户',
      initial: (rawFriend.name || '未').slice(0, 1),
      displayAge: stats.age === '' || stats.age == null ? '?' : stats.age,
      displayCampCount: stats.campCount === '' || stats.campCount == null ? '?' : stats.campCount,
      tags: Array.isArray(rawFriend.tags) ? rawFriend.tags : []
    });
    const allRecords = result.records || [];
    const camps = (result.camps && result.camps.length ? result.camps : data.camps().filter(item => (result.campIds || []).indexOf(item.id) >= 0)).map(item => Object.assign({}, item, { hasContent: allRecords.some(record => record.campId === item.id) }));
    // 云端已先验证双方是好友，并过滤“仅自己可见”的内容；页面只负责展示结果。
    const records = allRecords.filter(item => this.type !== 'module' || ((!this.campId || item.campId === this.campId) && (!this.stageId || !item.stageId || item.stageId === this.stageId) && (!this.kind || item.kind === this.kind) && (!this.activityName || data.normalizeActivityName(item.activityName) === this.activityName) && (!this.folderId || (this.folderId === '__legacy__' ? !item.folderId : item.folderId === this.folderId)))).map(item => Object.assign(item, { contentLabel: item.contentLabel || (item.kind === 'work' ? '作品' : item.kind === 'photo' ? '相册' : item.kind === 'companion' ? '伙伴' : '记录'), visibilityLabel: data.visibilityLabel(item.visibility) }));
    this.setData({ friend, type: this.type, title: this.type === 'module' ? (moduleTitles[this.kind] || titles.module) : (titles[this.type] || '好友资料'), camps, records });
  },
  openCamp(e) {
    const campId = e.currentTarget.dataset.id;
    if (campId === 'other') return nav.go(`/pages/friends/activities?id=${encodeURIComponent(this.id)}`);
    nav.go(`/pages/friends/camp?id=${encodeURIComponent(this.id)}&campId=${encodeURIComponent(campId)}`);
  },
  openContent(e) {
    const item = e.currentTarget.dataset;
    const preview = this.data.records.find(record => record.id === item.id && record.kind === item.kind);
    if (preview) wx.setStorageSync('hui_time_public_preview_v1', preview);
    // recordId 能直接定位云端内容，也让作者隐蔽 UID 后的详情仍可正常打开。
    nav.go(`/pages/community/detail?kind=${encodeURIComponent(item.kind)}&id=${encodeURIComponent(item.id)}&ownerUid=${encodeURIComponent(item.ownerUid || this.id)}&recordId=${encodeURIComponent(item.recordId || '')}`);
  }
});
