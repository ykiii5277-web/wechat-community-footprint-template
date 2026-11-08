const data = require('../../utils/data');
const nav = require('../../utils/nav');

Page({
  data: { title: '', context: {}, folderId: '', currentFolder: null, photos: [], folders: [], selectionMode: false, selectedIds: [], allSelected: false, selectedCount: 0, photoCount: 0, selectionBusy: false },
  async onLoad(options) {
    const context = nav.contextFrom(options);
    if (options.folderId && !data.getFolder(options.folderId)) {
      await require('../../utils/actions').ready();
      if (this._unloaded) return;
    }
    this.setData({ title: data.contextTitle(context), context, folderId: options.folderId || '' });
    this.refresh();
  },
  onShow() { if (this._shown && this.data.context.campId) this.refresh(); this._shown = true; },
  onUnload() { this._unloaded = true; },
  refresh() {
    if (this._unloaded) return;
    // 先读取相册列表，以便旧版未归类照片完成“回忆集”兼容迁移，再读取照片。
    const rawFolders = data.getFolders(this.data.context);
    const allPhotos = data.getPhotos(this.data.context);
    const photosByFolder = new Map();
    for (const photo of allPhotos) {
      if (!photosByFolder.has(photo.folderId)) photosByFolder.set(photo.folderId, []);
      photosByFolder.get(photo.folderId).push(photo);
    }
    const folders = rawFolders.map(item => {
      const folderPhotos = photosByFolder.get(item.id) || [];
      return Object.assign({}, item, { count: folderPhotos.length, displayCover: item.cover || (folderPhotos[0] && folderPhotos[0].image) || '' });
    });
    const currentFolder = this.data.folderId ? folders.find(item => item.id === this.data.folderId) || null : null;
    if (this.data.folderId && !currentFolder) {
      wx.showToast({ title: '相册不存在或已被删除', icon: 'none' });
      return setTimeout(() => wx.navigateBack({ delta: 1 }), 250);
    }
    const visiblePhotos = currentFolder ? photosByFolder.get(currentFolder.id) || [] : [];
    const visibleIds = new Set(visiblePhotos.map(item => item.id));
    const selected = new Set(this.data.selectedIds.filter(id => visibleIds.has(id)));
    const selectedIds = [...selected];
    const photos = visiblePhotos.map((item, index) => Object.assign({}, item, { offset: index % 2 ? 'lower' : '', selected: selected.has(item.id) }));
    this.setData({ photos, folders, currentFolder, selectedIds, selectedCount: selected.size, photoCount: photos.length, allSelected: photos.length > 0 && selected.size === visibleIds.size });
  },
  openFolder(e) {
    const suffix = nav.query(this.data.context).replace('?', '&');
    nav.go(`/pages/album/index?folderId=${encodeURIComponent(e.currentTarget.dataset.id)}${suffix}`);
  },
  tapPhoto(e) {
    if (this._cloudActionBusy || this.data.selectionBusy) return;
    const id = e.currentTarget.dataset.id;
    if (!this.data.selectionMode) return nav.go(`/pages/photo/preview?id=${id}`);
    const selectedIds = this.data.selectedIds.indexOf(id) >= 0 ? this.data.selectedIds.filter(item => item !== id) : this.data.selectedIds.concat(id);
    this.applySelection(selectedIds);
  },
  applySelection(selectedIds, selectionMode = this.data.selectionMode) {
    const selected = new Set(selectedIds);
    const changes = { selectionMode, selectedIds, selectedCount: selected.size, allSelected: selected.size > 0 && selected.size === new Set(this.data.photos.map(item => item.id)).size };
    this.data.photos.forEach((item, index) => {
      if (item.selected !== selected.has(item.id)) changes[`photos[${index}].selected`] = selected.has(item.id);
    });
    this.setData(changes);
  },
  toggleSelectionMode() { if (this._cloudActionBusy || this.data.selectionBusy) return; this.applySelection([], !this.data.selectionMode); },
  toggleSelectAll() {
    if (!this.data.selectionMode || this._cloudActionBusy || this.data.selectionBusy) return;
    const selectedIds = this.data.allSelected ? [] : [...new Set(this.data.photos.map(item => item.id))];
    this.applySelection(selectedIds);
  },
  changeSelectedVisibility() {
    if (this._cloudActionBusy || this.data.selectionBusy) return;
    const selectedIds = this.data.selectedIds.slice();
    if (!selectedIds.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    const options = ['public', 'friends', 'self'].map(value => data.visibilityOptions().find(item => item.value === value));
    const folderId = this.data.folderId;
    const versions = {};
    this.data.photos.filter(photo => selectedIds.includes(photo.id)).forEach(photo => { if (photo.updatedAt) versions[photo.id] = photo.updatedAt; });
    wx.showActionSheet({
      itemList: options.map(option => option.name),
      success: async result => {
        if (this._unloaded || this._cloudActionBusy || this.data.selectionBusy || !options[result.tapIndex]) return;
        this.setData({ selectionBusy: true });
        try {
          const visibility = options[result.tapIndex].value;
          let hideUid;
          if (visibility === 'public') {
            const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['隐藏我的 UID', '显示我的 UID'], success: answer => resolve(answer.tapIndex === 0), fail: () => resolve(null) }));
            if (choice === null || this._unloaded) return;
            hideUid = choice;
          }
          await require('../../utils/actions').run(this, () => data.changePhotosVisibility(selectedIds, visibility, folderId, versions, hideUid), '可见范围已更新', () => this.refresh());
        } finally { if (!this._unloaded) this.setData({ selectionBusy: false }); }
      }
    });
  },
  deleteSelected() {
    if (this._cloudActionBusy || this.data.selectionBusy) return;
    const selectedIds = this.data.selectedIds;
    if (!selectedIds.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    wx.showModal({ title: '删除所选图片？', content: `将删除 ${selectedIds.length} 张图片及其评论，操作不可恢复。`, confirmColor: '#C84A3A', success: result => {
      if (!result.confirm) return;
      require('../../utils/actions').run(this, () => data.deletePhotos(selectedIds), '所选图片已删除', () => this.setData({ selectionMode: false, selectedIds: [] }, () => this.refresh()));
    } });
  },
  moveSelected() {
    if (this._cloudActionBusy || this.data.selectionBusy) return;
    const selectedIds = this.data.selectedIds;
    if (!selectedIds.length) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    const targets = this.data.folders.filter(item => item.id !== this.data.folderId);
    if (!targets.length) return wx.showToast({ title: '暂无其他相册', icon: 'none' });
    wx.showActionSheet({ itemList: targets.map(item => item.name), success: result => {
      require('../../utils/actions').run(this, () => data.movePhotos(selectedIds, targets[result.tapIndex].id), '已移动到其他相册', () => this.setData({ selectionMode: false, selectedIds: [] }, () => this.refresh()));
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
    const index = this.data.photos.findIndex(item => item.id === id);
    if (index >= 0 && !this.data.photos[index].imageFailed) this.setData({ [`photos[${index}].imageFailed`]: true });
  }
});
