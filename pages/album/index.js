const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { title: '', context: {}, folderId: '', currentFolder: null, photos: [], folders: [], selectionMode: false, selectedIds: [] },
  onLoad(options) {
    const context = nav.contextFrom(options);
    this.setData({ title: data.contextTitle(context), context, folderId: options.folderId || '' });
    this.refresh();
  },
  onShow() { if (this.data.context.campId) this.refresh(); },
  refresh() {
    // 先读取相册列表，以便旧版未归类照片完成“回忆集”兼容迁移，再读取照片。
    const rawFolders = data.getFolders(this.data.context);
    const allPhotos = data.getPhotos(this.data.context);
    const folders = rawFolders.map(item => {
      const folderPhotos = allPhotos.filter(photo => photo.folderId === item.id);
      return Object.assign({}, item, { count: folderPhotos.length, displayCover: item.cover || (folderPhotos[0] && folderPhotos[0].image) || '' });
    });
    const currentFolder = this.data.folderId ? folders.find(item => item.id === this.data.folderId) || null : null;
    if (this.data.folderId && !currentFolder) {
      wx.showToast({ title: '相册不存在或已被删除', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 250);
    }
    const visiblePhotos = currentFolder ? allPhotos.filter(item => item.folderId === currentFolder.id) : [];
    const selectedIds = this.data.selectedIds.filter(id => visiblePhotos.some(item => item.id === id));
    const photos = visiblePhotos.map((item, index) => Object.assign({}, item, { offset: index % 2 ? 'lower' : '', selected: selectedIds.indexOf(item.id) >= 0 }));
    this.setData({ photos, folders, currentFolder, selectedIds });
  },
  openFolder(e) {
    const suffix = nav.query(this.data.context).replace('?', '&');
    nav.go(`/pages/album/index?folderId=${encodeURIComponent(e.currentTarget.dataset.id)}${suffix}`);
  },
  tapPhoto(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.selectionMode) return nav.go(`/pages/photo/preview?id=${id}`);
    const selectedIds = this.data.selectedIds.indexOf(id) >= 0 ? this.data.selectedIds.filter(item => item !== id) : this.data.selectedIds.concat(id);
    this.setData({ selectedIds }, () => this.refresh());
  },
  toggleSelectionMode() { this.setData({ selectionMode: !this.data.selectionMode, selectedIds: [] }, () => this.refresh()); },
  deleteSelected() {
    const selectedIds = this.data.selectedIds;
    if (!selectedIds.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    wx.showModal({ title: '删除所选图片？', content: `将删除 ${selectedIds.length} 张图片及其评论，操作不可恢复。`, confirmColor: '#C84A3A', success: result => {
      if (!result.confirm) return;
      data.deletePhotos(selectedIds);
      this.setData({ selectionMode: false, selectedIds: [] }, () => this.refresh());
    } });
  },
  moveSelected() {
    const selectedIds = this.data.selectedIds;
    if (!selectedIds.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    const targets = this.data.folders.filter(item => item.id !== this.data.folderId);
    if (!targets.length) return wx.showToast({ title: '暂无其他相册', icon: 'none' });
    wx.showActionSheet({ itemList: targets.map(item => item.name), success: result => {
      data.movePhotos(selectedIds, targets[result.tapIndex].id);
      this.setData({ selectionMode: false, selectedIds: [] }, () => this.refresh());
      wx.showToast({ title: '已移动到其他相册', icon: 'success' });
    } });
  },
  createPhoto() {
    if (!this.data.folderId) return wx.showToast({ title: '请先进入一个相册', icon: 'none' });
    const suffix = nav.query(this.data.context).replace('?', '&');
    nav.go(`/pages/album/editor?folderId=${encodeURIComponent(this.data.folderId)}${suffix}`);
  },
  createFolder() { nav.go(`/pages/album/folder-editor${nav.query(this.data.context)}`); },
  editFolder(e) {
    const suffix = nav.query(this.data.context).replace('?', '&');
    nav.go(`/pages/album/folder-editor?id=${encodeURIComponent(e.currentTarget.dataset.id)}${suffix}`);
  },
  imageError(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ photos: this.data.photos.map(item => item.id === id ? Object.assign({}, item, { imageFailed: true }) : item) });
  }
});
