const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { friend: null, albums: [], loading: true },
  onLoad(options) {
    this.uid = nav.decode(options.id);
    this.campId = nav.decode(options.campId);
    this.stageId = nav.decode(options.stageId);
    this.activityName = data.normalizeActivityName(nav.decode(options.activityName));
    this.refresh();
  },
  async refresh() {
    const result = await data.getFriendContentAsync(this.uid, 'footprints');
    if (!result || result.error) {
      wx.showToast({ title: result && result.error ? result.error : '好友相册暂不可查看', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
    }
    const photos = (result.records || []).filter(item => item.kind === 'photo' && (!this.campId || item.campId === this.campId) && (!this.stageId || !item.stageId || item.stageId === this.stageId) && (!this.activityName || data.normalizeActivityName(item.activityName) === this.activityName));
    const albumById = {};
    (result.albums || []).forEach(item => { albumById[item.id] = item; });
    const groups = {};
    photos.forEach(photo => {
      const folderId = photo.folderId || '__legacy__';
      if (!groups[folderId]) {
        const album = albumById[folderId] || {};
        groups[folderId] = { id: folderId, name: album.name || '回忆集', cover: album.cover || photo.image || '', count: 0 };
      }
      groups[folderId].count += 1;
      if (!groups[folderId].cover) groups[folderId].cover = photo.image || '';
    });
    const albums = Object.keys(groups).map(id => groups[id]).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    this.setData({ friend: result.friend || null, albums, loading: false });
  },
  openAlbum(e) {
    const activity = this.activityName ? `&activityName=${encodeURIComponent(this.activityName)}` : '';
    nav.go(`/pages/friends/content?id=${encodeURIComponent(this.uid)}&type=module&campId=${encodeURIComponent(this.campId)}&stageId=${encodeURIComponent(this.stageId)}&kind=photo&folderId=${encodeURIComponent(e.currentTarget.dataset.id)}${activity}`);
  }
});
