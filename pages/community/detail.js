// 趣闻中的内容来自云端：所有人可查看公开内容，只有发布者本人可进入编辑页。
const cloud = require('../../utils/cloud-service');
const data = require('../../utils/data');
const nav = require('../../utils/nav');
const threads = require('../../utils/comment-threads');
const imagePreview = require('../../utils/image-preview');
const media = require('../../utils/work-media');
const publicBrowser = require('../../utils/public-browser');

const titles = { photo: '公开相册', growth: '公开记录', work: '公开作品', companion: '伙伴详情' };

Page({
  data: { item: null, pageTitle: '公开内容', campName: '', comments: [], commentCount: 0, expandedThreads: {}, commentBody: '', replyTarget: null, commentPlaceholder: '写下你的评论…', commentFocus: false, loadingContent: true, publicBrowseEnabled: false, browseLoading: false, browsePrevious: false, browseNext: false, browsePosition: 0, browseTotal: 0 },
  onLoad(options) {
    this.kind = options.kind;
    this.id = options.id;
    this.ownerUid = options.ownerUid;
    this.recordId = options.recordId || '';
    this.albumOwnerUid = options.albumOwnerUid || '';
    this.browseSession = options.browseSession || '';
    this._publicBrowser = publicBrowser.get(this.browseSession);
    if (this._publicBrowser && publicBrowser.key(this._publicBrowser.current()) !== publicBrowser.key({ kind: this.kind, id: this.id, ownerUid: this.ownerUid, recordId: this.recordId })) {
      publicBrowser.discard(this.browseSession);
      this._publicBrowser = null;
    }
    this.updatePublicBrowser();
    this.hasLoaded = false;
    const preview = wx.getStorageSync('hui_time_public_preview_v1');
    if (!this._publicBrowser && preview && (preview.visibility === 'public' || preview.ownerUid === data.getProfile().uid) && preview.kind === this.kind && String(preview.id) === String(this.id)) {
      const item = Object.assign({}, preview, { images: preview.images || (preview.image ? [preview.image] : []), favorite: !!preview.favorite, canEdit: preview.canEdit === true || preview.ownerUid === data.getProfile().uid, visibilityLabel: data.visibilityLabel(preview.visibility) });
      this.setData({ item, pageTitle: titles[this.kind] || '公开内容', campName: data.getCampName(item.campId) });
      this.resolveMedia(item);
    }
    this.refresh();
  },
  // 从编辑页返回时刷新一次，立刻显示刚保存的标题、正文或可见范围。
  onShow() { if (this.hasLoaded) this.refresh(); },
  onUnload() { this._unloaded = true; clearTimeout(this._commentTapTimer); publicBrowser.discard(this.browseSession); },
  contentIdentity() { return [this.kind, this.id, this.ownerUid || '', this.recordId || ''].join('|'); },
  isCurrent(identity) { return !this._unloaded && identity === this.contentIdentity(); },
  updatePublicBrowser() {
    const state = this._publicBrowser && this._publicBrowser.state();
    this.setData({ publicBrowseEnabled: !!state, browsePrevious: !!(state && state.hasPrevious), browseNext: !!(state && state.hasNext), browsePosition: state ? state.position : 0, browseTotal: state ? state.total : 0 });
  },
  previousContent() { return this.browseContent(-1); },
  nextContent() { return this.browseContent(1); },
  firstContent() { if (this._publicBrowser && this.data.browsePrevious) return this.browseContent(1, 1); },
  lastContent() { if (this._publicBrowser && this.data.browseNext) return this.browseContent(-1, this._publicBrowser.state().total); },
  jumpContent() {
    if (!this._publicBrowser || this._unloaded || this.data.browseLoading || this._jumpDialogOpen) return;
    this._jumpDialogOpen = true;
    wx.showModal({
      title: '跳转到指定内容', editable: true, content: '', placeholderText: `请输入 1–${this._publicBrowser.state().total} 的条目序号`, confirmText: '跳转', cancelText: '取消', confirmColor: '#315F49',
      success: result => { if (result.confirm) return this.jumpToContent(result.content); },
      complete: () => { this._jumpDialogOpen = false; }
    });
  },
  jumpToContent(input) {
    if (!this._publicBrowser || this._unloaded || this.data.browseLoading) return;
    const value = String(input == null ? '' : input).trim(), position = Number(value);
    const total = this._publicBrowser.state().total;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(position) || position < 1 || position > total) return wx.showToast({ title: `请输入 1–${total} 的整数序号`, icon: 'none' });
    if (position !== this.data.browsePosition || !this.data.item) return this.browseContent(0, position);
  },
  async browseContent(direction, position) {
    if (!this._publicBrowser || this._unloaded || this.data.browseLoading) return;
    this.setData({ browseLoading: true });
    try {
      let cursor;
      for (let attempts = 0; attempts < 20; attempts++) {
        const target = attempts === 0 && position != null ? await this._publicBrowser.seek(position) : await this._publicBrowser.neighbor(direction, cursor);
        if (this._unloaded) return;
        if (!target) {
          this.updatePublicBrowser();
          return wx.showToast({ title: position != null ? '内容列表已变化，请按最新序号重试' : direction > 0 ? '已经是最后一条了' : '已经是第一条了', icon: 'none' });
        }
        const item = target.item;
        const skipUnavailable = () => {
          this._publicBrowser.markUnavailable(item); cursor = target.cursor;
          if (direction !== 0) return true;
          this.updatePublicBrowser();
          wx.showToast({ title: '这条内容已删除或不再公开，请选择其他序号', icon: 'none' });
          return false;
        };
        if (target.unavailable) { if (skipUnavailable()) continue; return; }
        const result = await cloud.getContent(item.kind, item.id, item.ownerUid, item.recordId);
        if (this._unloaded) return;
        if (!result || result.error) {
          if (result && ['FORBIDDEN', 'NOT_FOUND', 'CONTENT_NOT_FOUND'].includes(result.error)) { if (skipUnavailable()) continue; return; }
          throw new Error(result && result.message || '内容加载失败，请稍后重试');
        }
        if (!result.item || result.item.visibility !== 'public' || result.item.status !== 'published') { if (skipUnavailable()) continue; return; }
        this._publicBrowser.commit(target.cursor);
        this.updatePublicBrowser();
        await this.selectContent(item, result);
        if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 });
        return;
      }
      this.updatePublicBrowser();
      wx.showToast({ title: '多条内容已不可查看，请返回列表刷新', icon: 'none' });
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: String(error.message || '内容切换失败，请重试').slice(0, 70), icon: 'none' });
    } finally { if (!this._unloaded) this.setData({ browseLoading: false }); }
  },
  // 未部署云函数时，“趣闻”会回退展示本机公开内容；详情页也必须能对应打开该内容。
  getLocalPublicContent() {
    const profile = data.getProfile();
    if (this.ownerUid && this.ownerUid !== profile.uid) return null;
    const getters = { photo: data.getPhoto, growth: data.getGrowthById, work: data.getWork };
    const item = getters[this.kind] ? getters[this.kind](this.id) : null;
    if (!item || item.visibility !== 'public') return null;
    return Object.assign({}, item, { kind: this.kind, ownerUid: item.hideUid ? '' : profile.uid, ownerName: profile.name || '我', ownerAvatar: profile.avatar || '', recordId: '', favorite: !!item.favorite, canEdit: true });
  },
  async refresh(prefetched) {
    const request = this._refreshRequest = (this._refreshRequest || 0) + 1;
    this.setData({ loadingContent: true });
    let result = prefetched || await cloud.getContent(this.kind, this.id, this.ownerUid, this.recordId);
    if (this._unloaded || request !== this._refreshRequest) return;
    this.usingLocalFallback = false;
    if (!result || result.error || !result.item || this._publicBrowser && (result.item.visibility !== 'public' || result.item.status !== 'published')) {
      this.setData({ item: null, loadingContent: false });
      wx.showToast({ title: result && result.message ? result.message : '内容暂不可查看', icon: 'none' });
      if (this._publicBrowser) return;
      return setTimeout(() => { if (!this._unloaded && request === this._refreshRequest) wx.navigateBack(); }, 300);
    }
    const item = Object.assign({}, result.item, {
      images: result.item.images || (result.item.image ? [result.item.image] : []),
      favorite: !!result.item.favorite,
      // 旧云函数尚未部署时用本机 UID 维持开发版体验；正式权限仍以云端 canEdit 为准。
      canEdit: result.item.canEdit === true || result.item.ownerUid === data.getProfile().uid
    });
    item.visibilityLabel = data.visibilityLabel(item.visibility);
    this.recordId = item.recordId || this.recordId;
    if (this.usingLocalFallback) {
      const local = data.recordContentView(this.kind, this.id, this.ownerUid);
      if (local) item.views = local.views;
    } else cloud.recordView(this.kind, this.id, this.ownerUid, this.recordId).then(view => {
      if (!this._unloaded && request === this._refreshRequest && view && !view.error) this.setData({ 'item.views': view.views });
    });
    this.setData({ item, loadingContent: false, pageTitle: titles[this.kind] || '公开内容', campName: data.getCampName(item.campId) });
    this.resolveMedia(item);
    wx.removeStorageSync('hui_time_public_preview_v1');
    this.hasLoaded = true;
    this.refreshComments();
  },
  async resolveMedia(item) {
    if (!item) return;
    const paths = [item.image, item.avatar, item.cover].concat(item.images || []).filter(Boolean);
    const resolved = await cloud.resolveCloudFiles(paths);
    if (this._unloaded || !this.data.item || String(this.data.item.id) !== String(item.id) || (this.data.item.recordId || '') !== (item.recordId || '') || this.data.item.kind !== item.kind) return;
    let cursor = 0;
    const next = Object.assign({}, this.data.item);
    next.isVideo = media.isVideo(item);
    if (next.isVideo) next.videoUrl = await media.playbackUrl(item).catch(() => '');
    if (item.image) next.image = resolved[cursor++];
    if (item.avatar) next.avatar = resolved[cursor++];
    if (item.cover) next.cover = resolved[cursor++];
    if ((item.images || []).length) next.images = resolved.slice(cursor);
    if (this._unloaded || !this.data.item || this.data.item.filePath !== item.filePath || String(this.data.item.id) !== String(item.id) || (this.data.item.recordId || '') !== (item.recordId || '') || this.data.item.kind !== item.kind) return;
    this.setData({ item: next });
  },
  async previewImage(e) {
    const item = this.data.item || {};
    if (item.kind === 'photo' && this.albumOwnerUid) {
      // 每次按云端当前授权结果获取好友照片，权限变化后不使用旧的预览缓存。
      const result = await data.getFriendContentAsync(this.albumOwnerUid, 'footprints');
      if (!result || result.error) return wx.showToast({ title: '好友相册暂不可查看', icon: 'none' });
      const photos = (result.records || []).filter(photo => photo.kind === 'photo');
      const current = photos.find(photo => item.recordId ? photo.recordId === item.recordId : String(photo.id) === String(item.id));
      if (!current) return wx.showToast({ title: '这张图片已删除或不再可见', icon: 'none' });
      return imagePreview.openAlbum(photos, current, { onClose: photo => this.selectGalleryPhoto(photo) });
    }
    const images = item.kind === 'growth' ? item.images || [] : [item.image || item.avatar].filter(Boolean);
    return imagePreview.open(images, e.currentTarget.dataset.index);
  },
  selectGalleryPhoto(photo) {
    if (this._unloaded || !photo || String(photo.id) === String(this.id) && (photo.recordId || '') === this.recordId) return;
    return this.selectContent(Object.assign({}, photo, { kind: 'photo', ownerUid: this.albumOwnerUid || photo.ownerUid || this.ownerUid }));
  },
  selectContent(content, prefetched) {
    this._commentDrafts = this._commentDrafts || {};
    this._commentDrafts[this.contentIdentity()] = this.data.commentBody || '';
    this.id = content.id;
    this.recordId = content.recordId || '';
    this.ownerUid = content.ownerUid || '';
    this.kind = content.kind;
    this.rawComments = [];
    this._commentRequest = null;
    this._sendToken = null;
    this._sendingComment = false;
    this._skipNextCommentTap = false;
    clearTimeout(this._commentTapTimer);
    this.setData({ item: null, comments: [], commentCount: 0, expandedThreads: {}, commentBody: this._commentDrafts[this.contentIdentity()] || '', replyTarget: null, commentPlaceholder: '写下你的评论…', commentFocus: false });
    return this.refresh(prefetched);
  },
  async favorite() {
    const identity = this.contentIdentity();
    if (this.usingLocalFallback) {
      try { await data.toggleFavorite(this.kind, this.id, this.ownerUid); } catch (error) { return wx.showToast({ title: error.message, icon: 'none' }); }
      const item = this.getLocalPublicContent();
      return this.setData({ 'item.favorite': item.favorite, 'item.likes': item.likes });
    }
    const result = await cloud.toggleLike(this.kind, this.id, this.ownerUid, this.recordId, !this.data.item.favorite);
    if (!this.isCurrent(identity)) return;
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '点赞未完成', icon: 'none' });
    this.setData({ 'item.favorite': result.favorite, 'item.likes': result.likes });
  },
  setThreadedComments(list) {
    this.rawComments = Array.isArray(list) ? list : [];
    this.setData({ comments: threads.buildCommentThreads(this.rawComments, this.data.expandedThreads), commentCount: this.rawComments.length });
  },
  async refreshComments() {
    if (this.usingLocalFallback) return this.setThreadedComments(data.getComments(this.kind, this.id));
    const identity = this.contentIdentity();
    const result = await cloud.getComments(this.kind, this.id, this.ownerUid, this.recordId);
    if (!this.isCurrent(identity)) return;
    if (result && !result.error && Array.isArray(result.comments)) this.setThreadedComments(result.comments);
  },
  commentInput(e) { this.setData({ commentBody: e.detail.value }); },
  commentBlur() { this.setData({ commentFocus: false }); },
  reply(e) {
    if (this._skipNextCommentTap) {
      this._skipNextCommentTap = false;
      return;
    }
    const target = e.currentTarget.dataset;
    this.setData({ replyTarget: { id: target.id, name: target.name }, commentPlaceholder: `回复 ${target.name}…`, commentFocus: true });
  },
  commentLongPress(e) {
    const target = e.currentTarget.dataset;
    const canDelete = target.canDelete === true || target.canDelete === 'true' || target.canDelete === 1 || target.canDelete === '1';
    const itemList = canDelete ? ['删除', '举报'] : ['举报'];
    this._skipNextCommentTap = true;
    clearTimeout(this._commentTapTimer);
    this._commentTapTimer = setTimeout(() => { this._skipNextCommentTap = false; }, 1500);
    wx.showActionSheet({
      itemList,
      success: result => {
        const action = itemList[result.tapIndex];
        if (action === '删除') this.confirmDeleteComment(target.id);
        if (action === '举报') this.reportCommentById(target.id);
      }
    });
  },
  confirmDeleteComment(id) {
    wx.showModal({
      title: '删除这条评论？',
      content: '删除后无法恢复；如果包含回复，相关回复也会一并删除。',
      confirmText: '删除',
      confirmColor: '#B85249',
      success: async result => {
        if (!result.confirm) return;
        const removed = await cloud.deleteComment(id);
        if (!removed || removed.error) return wx.showToast({ title: removed && removed.message ? removed.message : '删除未完成', icon: 'none' });
        data.deleteComment(id);
        this.setData({ replyTarget: null, commentPlaceholder: '写下你的评论…', commentFocus: false });
        await this.refreshComments();
        wx.showToast({ title: '评论已删除', icon: 'success' });
      }
    });
  },
  toggleReplies(e) {
    const id = e.currentTarget.dataset.id;
    const expandedThreads = Object.assign({}, this.data.expandedThreads, { [id]: !this.data.expandedThreads[id] });
    this.setData({ expandedThreads });
    this.setThreadedComments(this.rawComments);
  },
  cancelReply() { this.setData({ replyTarget: null, commentPlaceholder: '写下你的评论…', commentFocus: false }); },
  async submitComment() {
    const body = this.data.commentBody.trim();
    if (!body) return wx.showToast({ title: '写下评论后再发送', icon: 'none' });
    const rootId = this.data.replyTarget ? threads.getThreadRootId(this.rawComments, this.data.replyTarget.id) : '';
    if (this._sendingComment) return;
    this._sendingComment = true;
    const identity = this.contentIdentity();
    const sendToken = this._sendToken = {};
    const parentId = this.data.replyTarget ? this.data.replyTarget.id : '';
    const signature = JSON.stringify([this.kind, this.id, parentId, body]);
    if (!this._commentRequest || this._commentRequest.signature !== signature) this._commentRequest = { signature, id: data.newContentId('comment') };
    const result = await cloud.saveComment({ id: this._commentRequest.id, targetType: this.kind, targetId: this.id, ownerUid: this.ownerUid, recordId: this.recordId, parentId, body });
    const activeSend = this._sendToken === sendToken;
    if (activeSend) { this._sendingComment = false; this._sendToken = null; }
    if (!this.isCurrent(identity) || !activeSend) {
      if (result && !result.error && this._commentDrafts && this._commentDrafts[identity] === body) this._commentDrafts[identity] = '';
      return;
    }
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '评论发送失败', icon: 'none' });
    this._commentRequest = null;
    const expandedThreads = rootId ? Object.assign({}, this.data.expandedThreads, { [rootId]: true }) : this.data.expandedThreads;
    this.setData({ commentBody: '', replyTarget: null, commentPlaceholder: '写下你的评论…', expandedThreads, commentFocus: false });
    this.refreshComments();
  },
  async favoriteComment(e) {
    const identity = this.contentIdentity();
    const comment = (this.rawComments || []).find(item => item.id === e.currentTarget.dataset.id);
    const result = await cloud.toggleCommentLike(e.currentTarget.dataset.id, comment ? !comment.favorite : undefined);
    if (!this.isCurrent(identity)) return;
    if (!result || result.error) return wx.showToast({ title: result && result.message ? result.message : '操作未完成', icon: 'none' });
    this.setThreadedComments(this.rawComments.map(item => item.id === e.currentTarget.dataset.id ? Object.assign({}, item, result) : item));
  },
  chooseReport(onChoose) {
    const reasons = ['不当内容', '虚假或误导信息', '涉嫌侵权', '骚扰或辱骂', '其他问题'];
    wx.showActionSheet({ itemList: reasons, success: result => onChoose(reasons[result.tapIndex]) });
  },
  reportContent() {
    if (!this.data.item || this.data.item.canEdit) return wx.showToast({ title: '不能举报自己发布的内容', icon: 'none' });
    const target = { type: 'content', kind: this.kind, id: this.id, ownerUid: this.ownerUid, recordId: this.recordId };
    this.chooseReport(async reason => {
      const result = await cloud.createReport(Object.assign({}, target, { reason }));
      wx.showToast({ title: result && !result.error ? '举报已提交' : result && result.message ? result.message : '举报提交失败', icon: 'none' });
    });
  },
  reportCommentById(id) {
    this.chooseReport(async reason => {
      const result = await cloud.createReport({ type: 'comment', id, reason });
      wx.showToast({ title: result && !result.error ? '举报已提交' : result && result.message ? result.message : '举报提交失败', icon: 'none' });
    });
  },
  async openFile() {
    const item = this.data.item || {};
    if (media.isVideo(item)) return media.playbackUrl(item).then(url => wx.previewMedia({ sources: [{ url, type: 'video' }] })).catch(() => wx.showToast({ title: '视频加载失败，请重试', icon: 'none' }));
    const originalPath = item.filePath || '';
    if (!originalPath) return wx.showToast({ title: '发布者没有上传作品文件', icon: 'none' });
    if (!/^cloud:\/\//i.test(originalPath)) {
      if (item.canEdit && !/^https?:\/\//i.test(originalPath)) return wx.openDocument({ filePath: originalPath, showMenu: true });
      if (!/^https?:\/\//i.test(originalPath)) return wx.showToast({ title: '该文件是发布者设备上的旧临时文件，请对方重新上传', icon: 'none' });
    }
    const extensionMatch = String(item.fileType || item.fileName || '').match(/(?:^|\.)([a-zA-Z0-9]+)$/);
    const fileType = extensionMatch ? extensionMatch[1].toLowerCase() : '';
    const documentTypes = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const cloudDownload = fileID => new Promise((resolve, reject) => {
      if (!wx.cloud || !wx.cloud.downloadFile) return reject(new Error('NO_CLOUD_DOWNLOAD'));
      wx.cloud.downloadFile({ fileID, success: result => result && result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error('EMPTY_CLOUD_FILE')), fail: reject });
    });
    const httpDownload = url => new Promise((resolve, reject) => wx.downloadFile({
      url,
      success: result => Number(result.statusCode) >= 200 && Number(result.statusCode) < 300 && result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error(`HTTP_${result.statusCode || 0}`)),
      fail: reject
    }));
    wx.showLoading({ title: '正在下载文件' });
    let localPath = '';
    try {
      // 首选云存储原生下载；若权限或客户端版本导致失败，再使用云函数签发的 HTTPS 临时地址。
      if (/^cloud:\/\//i.test(originalPath)) {
        try { localPath = await cloudDownload(originalPath); } catch (error) { localPath = ''; }
      }
      let downloadUrl = item.fileUrl || (/^https?:\/\//i.test(originalPath) ? originalPath : '');
      if (!localPath && !/^https?:\/\//i.test(downloadUrl) && /^cloud:\/\//i.test(originalPath)) {
        const urls = await cloud.resolveCloudFiles([originalPath]);
        downloadUrl = urls[0] || '';
      }
      if (!localPath && /^https?:\/\//i.test(downloadUrl)) localPath = await httpDownload(downloadUrl);
      if (!localPath) throw new Error('DOWNLOAD_FAILED');
    } catch (error) {
      wx.hideLoading();
      return wx.showToast({ title: '文件下载失败，请确认云文件仍存在', icon: 'none' });
    }
    wx.hideLoading();
    if (imageTypes.indexOf(fileType) >= 0) return wx.previewImage({ current: localPath, urls: [localPath], showmenu: true });
    const options = { filePath: localPath, showMenu: true, fail: () => wx.showToast({ title: documentTypes.indexOf(fileType) >= 0 ? '文件打开失败，请稍后重试' : '该文件格式暂不支持直接打开', icon: 'none' }) };
    if (documentTypes.indexOf(fileType) >= 0) options.fileType = fileType;
    wx.openDocument(options);
  },
  saveVideo() {
    if (this.data.loadingContent || this.data.browseLoading || !this.data.item) return;
    const item = this.data.item;
    return media.saveVideo(async () => {
      const result = await cloud.getContent(item.kind, item.id, item.ownerUid, item.recordId);
      if (!result || result.error || !result.item || result.item.filePath !== item.filePath) return null;
      return result.item;
    });
  },
  // 若启动时的云端同步尚未完成，先同步自己的内容，避免把已有内容误打开成“新建”。
  hasLocalContent() {
    if (this.kind === 'photo') return !!data.getPhoto(this.id);
    if (this.kind === 'growth') return !!data.getGrowthById(this.id);
    if (this.kind === 'work') return !!data.getWork(this.id);
    return false;
  },
  edit() {
    if (!this.data.item || !this.data.item.canEdit) return wx.showToast({ title: '仅发布者可以编辑', icon: 'none' });
    if (this.hasLocalContent()) return this.openEditor();
    data.hydrateOwnCloudState().then(() => {
      if (!this.hasLocalContent()) return wx.showToast({ title: '内容正在同步，请稍后重试', icon: 'none' });
      this.openEditor();
    });
  },
  openEditor() {
    const context = { campId: this.data.item.campId, stageId: this.data.item.stageId, subcampId: this.data.item.subcampId };
    const suffix = nav.query(context).replace('?', '&');
    const id = encodeURIComponent(this.id);
    const targets = { photo: '/pages/album/editor', growth: '/pages/growth/editor', work: '/pages/profile/work-editor' };
    if (!targets[this.kind]) return wx.showToast({ title: '此内容暂不支持编辑', icon: 'none' });
    nav.go(`${targets[this.kind]}?id=${id}${suffix}`);
  }
});
