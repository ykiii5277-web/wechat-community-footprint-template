const cloud = require('../../utils/cloud-service');
const media = require('../../utils/work-media');
Page({
  data: { items: [], loading: true, error: '', busy: false, rejecting: null, rejectionReason: '' },
  onShow() { this.refresh(); },
  onUnload() { this._unloaded = true; },
  async refresh() {
    this.setData({ loading: true, error: '' });
    const result = await cloud.call('admin.work.pending');
    if (this._unloaded) return;
    if (!result || result.error) return this.setData({ loading: false, error: result && result.message || '审核列表读取失败' });
    const items = (result.items || []).map(item => Object.assign({}, item, {
      isVideo: media.isVideo(item), isImage: /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(item.fileName || ''), checked: false
    }));
    this.setData({ items, loading: false });
  },
  checked(e) {
    const recordId = e.currentTarget.dataset.id;
    this.setData({ items: this.data.items.map(item => item.recordId === recordId ? Object.assign({}, item, { checked: !!e.detail.value.length }) : item) });
  },
  async openFile(e) {
    const item = this.data.items.find(value => value.recordId === e.currentTarget.dataset.id);
    if (!item) return;
    if (item.isImage) return wx.previewImage({ urls: [item.fileUrl], current: item.fileUrl });
    wx.showLoading({ title: '正在读取附件', mask: true });
    try {
      const result = await wx.cloud.downloadFile({ fileID: item.filePath });
      wx.openDocument({ filePath: result.tempFilePath, fileType: item.fileType, showMenu: true, fail: () => wx.showToast({ title: '此格式无法预览，请勿直接通过审核', icon: 'none' }) });
    } catch (error) { wx.showToast({ title: '附件读取失败', icon: 'none' }); }
    finally { wx.hideLoading(); }
  },
  async review(e) {
    if (this.data.busy || this.data.rejecting || this._confirming) return;
    const { id, decision } = e.currentTarget.dataset;
    const item = this.data.items.find(value => value.recordId === id);
    if (!item || decision === 'approved' && !item.checked) return;
    if (decision === 'rejected') return this.setData({ rejecting: item, rejectionReason: '' });
    if (decision !== 'approved') return;
    this._confirming = true;
    const confirm = await new Promise(resolve => wx.showModal({ title: '确认审核通过？', content: '请确认已查看完整附件，内容符合社区规范。通过后按发布者选择的范围展示。', success: result => resolve(result.confirm), fail: () => resolve(false) }));
    this._confirming = false;
    if (!confirm || this._unloaded) return;
    await this.submitReview(item, decision);
  },
  reasonInput(e) { this.setData({ rejectionReason: e.detail.value }); },
  cancelRejection() {
    if (!this.data.busy) this.setData({ rejecting: null, rejectionReason: '' });
  },
  async confirmRejection() {
    if (this.data.busy || !this.data.rejecting) return;
    const reason = String(this.data.rejectionReason || '').trim();
    if (reason.length > 200) return wx.showToast({ title: '不通过原因最多填写200字', icon: 'none' });
    await this.submitReview(this.data.rejecting, 'rejected', reason);
  },
  async submitReview(item, decision, reason = '') {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await cloud.call('admin.work.review', { recordId: item.recordId, updatedAt: item.updatedAt, decision, reason });
      if (this._unloaded) return;
      if (!result || result.error) return wx.showToast({ title: result && result.message || '审核未保存', icon: 'none' });
      this.setData({ rejecting: null, rejectionReason: '' });
      wx.showToast({ title: decision === 'rejected' ? '已拒绝并通知作者' : '已保存审核结果' });
      await this.refresh();
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: '审核未保存，请重试', icon: 'none' });
    } finally {
      if (!this._unloaded) this.setData({ busy: false });
    }
  }
});
