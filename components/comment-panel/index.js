// 可复用评论组件：照片、记录和作品只要传入目标类型与 ID 即可共用。
const data = require('../../utils/data');
const cloud = require('../../utils/cloud-service');
const threads = require('../../utils/comment-threads');

Component({
  properties: {
    targetType: { type: String, value: '' },
    targetId: { type: String, value: '' }
  },
  data: { comments: [], commentCount: 0, expandedThreads: {}, body: '', replyTarget: null, placeholder: '写下你的评论…', commentFocus: false },
  observers: {
    'targetType,targetId': function () { this.refresh(); }
  },
  methods: {
    // 保留原始平铺数据，渲染前再按主评论分组，方便点赞后精确更新某条回复。
    setThreadedComments(list) {
      this.rawComments = Array.isArray(list) ? list : [];
      this.setData({ comments: threads.buildCommentThreads(this.rawComments, this.data.expandedThreads), commentCount: this.rawComments.length });
    },
    async refresh() {
      const { targetType, targetId } = this.properties;
      if (!targetType || !targetId) return this.setData({ comments: [], commentCount: 0 });
      const remote = await cloud.getComments(targetType, targetId);
      // 已部署云函数时优先显示所有用户的评论；未部署时继续显示本机评论，方便开发调试。
      this.usingLocalFallback = !(remote && !remote.error && Array.isArray(remote.comments));
      this.setThreadedComments(this.usingLocalFallback ? data.getComments(targetType, targetId) : remote.comments);
    },
    input(e) { this.setData({ body: e.detail.value }); },
    commentBlur() { this.setData({ commentFocus: false }); },
    reply(e) {
      if (this._skipNextCommentTap) {
        this._skipNextCommentTap = false;
        return;
      }
      const target = e.currentTarget.dataset;
      this.setData({ replyTarget: { id: target.id, name: target.name }, placeholder: `回复 ${target.name}…`, commentFocus: true });
    },
    commentLongPress(e) {
      const id = e.currentTarget.dataset.id;
      this._skipNextCommentTap = true;
      clearTimeout(this._commentTapTimer);
      this._commentTapTimer = setTimeout(() => { this._skipNextCommentTap = false; }, 1500);
      wx.showActionSheet({
        itemList: ['删除', '举报'],
        success: result => {
          if (result.tapIndex === 0) this.confirmDeleteComment(id);
          if (result.tapIndex === 1) this.reportComment(id);
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
          this.setData({ replyTarget: null, placeholder: '写下你的评论…', commentFocus: false });
          await this.refresh();
          this.triggerEvent('change');
          wx.showToast({ title: '评论已删除', icon: 'success' });
        }
      });
    },
    chooseReport(onChoose) {
      const reasons = ['不当内容', '虚假或误导信息', '涉嫌侵权', '骚扰或辱骂', '其他问题'];
      wx.showActionSheet({ itemList: reasons, success: result => onChoose(reasons[result.tapIndex]) });
    },
    reportComment(id) {
      this.chooseReport(async reason => {
        const result = await cloud.createReport({ type: 'comment', id, reason });
        wx.showToast({ title: result && !result.error ? '举报已提交' : result && result.message ? result.message : '举报提交失败', icon: 'none' });
      });
    },
    // 回复默认折叠，点击“回复图标 + 条数”可展开该主评论下的整组回复。
    toggleReplies(e) {
      const id = e.currentTarget.dataset.id;
      const expandedThreads = Object.assign({}, this.data.expandedThreads, { [id]: !this.data.expandedThreads[id] });
      this.setData({ expandedThreads });
      this.setThreadedComments(this.rawComments);
    },
    cancelReply() { this.setData({ replyTarget: null, placeholder: '写下你的评论…', commentFocus: false }); },
    async submit() {
      const body = this.data.body.trim();
      if (!body) return wx.showToast({ title: '写下评论后再发送', icon: 'none' });
      if (this._sending) return;
      this._sending = true;
      const rootId = this.data.replyTarget ? threads.getThreadRootId(this.rawComments, this.data.replyTarget.id) : '';
      const parentId = this.data.replyTarget ? this.data.replyTarget.id : '';
      const signature = JSON.stringify([this.properties.targetType, this.properties.targetId, parentId, body]);
      if (!this._commentRequest || this._commentRequest.signature !== signature) this._commentRequest = { signature, id: data.newContentId('comment') };
      const result = await cloud.saveComment({ id: this._commentRequest.id, targetType: this.properties.targetType, targetId: this.properties.targetId, parentId, body });
      this._sending = false;
      if (!result || result.error) return wx.showToast({ title: result && result.message || '评论未发送，请重试', icon: 'none' });
      this._commentRequest = null;
      const expandedThreads = rootId ? Object.assign({}, this.data.expandedThreads, { [rootId]: true }) : this.data.expandedThreads;
      this.setData({ body: '', replyTarget: null, placeholder: '写下你的评论…', expandedThreads, commentFocus: false });
      await this.refresh();
      this.triggerEvent('change');
    },
    async favorite(e) {
      const item = (this.rawComments || []).find(value => value.id === e.currentTarget.dataset.id);
      const remote = await cloud.toggleCommentLike(e.currentTarget.dataset.id, item ? !item.favorite : undefined);
      if (remote && !remote.error) this.setThreadedComments(this.rawComments.map(item => item.id === e.currentTarget.dataset.id ? Object.assign({}, item, remote) : item));
      else return wx.showToast({ title: remote && remote.message || '点赞未完成，请重试', icon: 'none' });
      this.triggerEvent('change');
    }
  }
});
