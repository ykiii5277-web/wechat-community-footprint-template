const cloud = require('../../utils/cloud-service');
const privacy = require('../../utils/privacy');

Page({
  data: {
    submittingDeletion: false,
    deletionRequested: false,
    feedbackVisible: false,
    feedbackText: '',
    feedbackLength: 0,
    sendingFeedback: false,
    sections: [
      {
        id: 'agreement',
        title: '用户协议',
        summary: '使用规则、账号责任与服务说明',
        expanded: false,
        paragraphs: [
          '欢迎使用“同行足迹”。使用本小程序即表示你同意遵守本协议、微信平台规则及适用法律法规。',
          '用户应妥善使用自己的微信账号，不得冒用他人身份，不得利用本服务发布违法违规、侵权、欺诈、骚扰或危害他人安全的内容。',
          '用户对其发布的文字、图片、评论、聊天和作品文件承担责任，并应确保拥有相应权利。因维护、升级、网络或第三方服务原因，部分功能可能暂时不可用。',
          '虚拟道具仅用于本小程序内的互动体验，不得私下交易、套现或用于违法用途。对违规账号，开发者可采取内容下架、限制功能或终止服务等必要措施。'
        ]
      },
      {
        id: 'privacy',
        title: '隐私政策摘要',
        summary: '我们收集什么，以及为什么收集',
        expanded: false,
        paragraphs: [
          '为提供账号识别、资料展示、好友互动、内容发布、聊天、道具、任务和支付功能，我们会处理微信为本小程序提供的账号标识，以及你主动填写或上传的昵称、头像、简介、图片、文件、评论、消息和交易记录。',
          '相册或文件仅在你主动点击选择时调用。公开、好友可见或仅自己可见的范围由你发布时选择；聊天仅向会话双方展示。内容会使用微信内容安全能力进行检测。',
          '数据存储于本小程序使用的微信云开发环境，并通过云端身份和权限校验访问。除实现功能、履行法定义务或获得你的另行同意外，不会出售你的个人信息。',
          '你可以在相关编辑页更正资料、删除自己发布的内容，也可以在本页提交账号注销与数据删除申请。法律法规另有保存要求的除外。',
          '当你主动使用“联系开发者”提交反馈时，系统会把反馈正文连同你的 UID、昵称、头像、简介和标签发送给管理员，以便识别账号并处理问题。',
          '本摘要不能替代微信公众平台中由开发者配置的《小程序用户隐私保护指引》，请点击页面上方入口查看完整且生效的版本。'
        ]
      },
      {
        id: 'community',
        title: '社区内容规范',
        summary: '发布、互动与举报处理规则',
        expanded: false,
        paragraphs: [
          '请友善、真实地分享经历。禁止发布违法有害、色情低俗、暴力恐怖、仇恨歧视、欺诈营销、恶意引流、侵犯隐私或知识产权的内容。',
          '未经本人同意，请勿公开他人的联系方式、身份资料、私聊内容或其他敏感信息。涉及未成年人的内容应格外谨慎，不得诱导打赏、交易或进行不适当互动。',
          '所有用户均可举报公开内容或评论。开发者会结合举报信息与平台安全结果处理；明显违规内容可能被删除，相关账号可能被限制。恶意举报同样属于违规行为。'
        ]
      },
      {
        id: 'rights',
        title: '账号与数据权利',
        summary: '更正、删除、注销与申诉',
        expanded: false,
        paragraphs: [
          '你可以在“我的—简介”中修改个人资料，并在对应内容页删除自己发布的内容。删除后，相关内容将不再正常展示，但依法应保留的安全、支付或争议处理记录可能在必要期限内继续保存。',
          '提交账号注销与数据删除申请后，系统会生成后台工单。开发者核验账号和未完成事项后进行处理；提交申请不会立即清空数据，避免误触造成不可恢复的损失。',
          '如需撤回尚未处理的申请、查询处理进度或提出隐私相关疑问，可通过本页“联系开发者”说明情况。'
        ]
      }
    ]
  },
  noop() {},
  openFeedback() { this.setData({ feedbackVisible: true, feedbackText: '', feedbackLength: 0 }); },
  closeFeedback() { if (!this.data.sendingFeedback) this.setData({ feedbackVisible: false, feedbackText: '', feedbackLength: 0 }); },
  feedbackInput(e) {
    const feedbackText = String(e.detail.value || '');
    this.setData({ feedbackText, feedbackLength: Array.from(feedbackText).length });
  },
  async sendFeedback() {
    const content = String(this.data.feedbackText || '').trim();
    if (!content) return wx.showToast({ title: '请先填写想反馈的问题', icon: 'none' });
    if (Array.from(content).length > 1000) return wx.showToast({ title: '反馈不能超过 1000 个字', icon: 'none' });
    if (this.data.sendingFeedback) return;
    this.setData({ sendingFeedback: true });
    const response = await cloud.sendFeedback(content);
    this.setData({ sendingFeedback: false });
    if (!response || response.error) return wx.showToast({ title: response && response.message ? response.message : '发送失败，请稍后重试', icon: 'none' });
    this.setData({ feedbackVisible: false, feedbackText: '', feedbackLength: 0 });
    wx.showToast({ title: '反馈已发送', icon: 'success' });
  },
  toggle(e) {
    const index = Number(e.currentTarget.dataset.index);
    const sections = this.data.sections.map((item, itemIndex) => Object.assign({}, item, itemIndex === index ? { expanded: !item.expanded } : {}));
    this.setData({ sections });
  },
  openPrivacy() { privacy.openContract(); },
  requestDeletion() {
    if (this.data.submittingDeletion || this.data.deletionRequested) return;
    wx.showModal({
      title: '提交注销与删除申请？',
      content: '提交后会生成后台工单，不会立即删除。开发者核验后处理，期间请勿重复提交。',
      confirmText: '提交申请',
      confirmColor: '#A2463D',
      success: async result => {
        if (!result.confirm) return;
        this.setData({ submittingDeletion: true });
        const response = await cloud.requestAccountDeletion();
        this.setData({ submittingDeletion: false });
        if (!response || response.error) return wx.showToast({ title: response && response.message ? response.message : '提交失败，请稍后重试', icon: 'none' });
        this.setData({ deletionRequested: true });
        wx.showModal({ title: response.repeated ? '申请已在处理中' : '申请已提交', content: '如需补充说明或撤回申请，请通过“联系开发者”沟通。', showCancel: false });
      }
    });
  }
});
