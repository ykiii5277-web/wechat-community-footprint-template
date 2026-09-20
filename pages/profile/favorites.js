// 收藏页同时读取云端点赞与本地兼容数据：照片=相册，成长=记录+作品，评论=点赞过的评论。
const data = require('../../utils/data');
const cloud = require('../../utils/cloud-service');
const nav = require('../../utils/nav');

Page({
  data: { active: '照片', items: [], loading: false },

  onShow() { this.refresh(); },

  async refresh() {
    const type = this.data.active;
    this.setData({ loading: true });
    const source = await data.getFavoriteItemsAsync(type);
    // 用户切换栏目后，丢弃上一个栏目的迟到响应。
    if (type !== this.data.active) return;
    const items = source.map(item => Object.assign({}, item, {
      campName: data.getCampName(item.campId),
      scene: (data.getCamp(item.campId) || {}).scene || 'rural',
      kind: type === '照片' ? 'photo' : type === '成长' ? item.kind : 'comment'
    }));
    this.setData({ items, loading: false });
  },

  choose(e) {
    this.setData({ active: e.currentTarget.dataset.type, items: [] });
    this.refresh();
  },

  open(e) {
    const selected = this.data.items.find(item => String(item.id) === String(e.currentTarget.dataset.item));
    if (!selected) return;
    const isComment = selected.kind === 'comment';
    const kind = isComment ? selected.targetType : selected.kind;
    const id = isComment ? selected.targetId : selected.id;
    const ownerUid = isComment ? selected.targetOwnerUid : selected.ownerUid;
    const recordId = isComment ? selected.targetRecordId : selected.recordId;

    // 云端收藏可能来自其他用户，统一进入公开内容详情；recordId 也支持作者隐藏 UID 的内容。
    if (selected.remote || recordId) {
      if (!isComment) wx.setStorageSync('hui_time_public_preview_v1', selected);
      return nav.go(`/pages/community/detail?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&ownerUid=${encodeURIComponent(ownerUid || '')}&recordId=${encodeURIComponent(recordId || '')}`);
    }
    nav.go(kind === 'photo' ? `/pages/photo/preview?id=${id}` : kind === 'growth' ? `/pages/growth/detail?id=${id}` : `/pages/profile/work-detail?id=${id}`);
  },

  async unfavorite(e) {
    const selected = this.data.items.find(item => String(item.id) === String(e.currentTarget.dataset.id));
    if (!selected) return;
    let result = null;
    if (selected.remote || selected.recordId || selected.targetRecordId) {
      result = selected.kind === 'comment'
        ? await cloud.toggleCommentLike(selected.id)
        : await cloud.toggleLike(selected.kind, selected.id, selected.ownerUid, selected.recordId);
      if (!result || result.error) {
        return wx.showToast({ title: result && result.message ? result.message : '取消点赞失败', icon: 'none' });
      }
    } else {
      data.toggleFavorite(selected.kind, selected.id);
    }
    this.setData({ items: this.data.items.filter(item => String(item.id) !== String(selected.id)) });
  }
});
