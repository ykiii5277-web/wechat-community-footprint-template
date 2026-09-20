const sections = [
  {
    number: '一', button: '模板定位', title: '一、一套可复用的社群成长记录模板',
    paragraphs: ['“同行足迹”面向学校、社团、公益组织、兴趣小组和活动社区，帮助成员按活动与阶段整理共同经历。当前展示名称、分类和图片均为示例，部署者可以按照自己的品牌与业务场景替换。']
  },
  {
    number: '二', button: '核心能力', title: '二、从足迹到作品的完整记录',
    paragraphs: ['模板内置伙伴、相册、记录和作品四类内容，支持多活动、多阶段与多相册管理。公开内容可进入动态页，好友内容仅向好友开放，私密内容只由本人查看。']
  },
  {
    number: '三', button: '互动关系', title: '三、围绕真实关系建立互动',
    paragraphs: ['用户可以通过 UID 添加好友，查看对方授权的资料与足迹，并使用点赞、评论、回复和聊天等互动能力。好感等级根据好友之间的历史赠礼计算，不以公开 UID 作为身份或权限凭证。']
  },
  {
    number: '四', button: '云端架构', title: '四、微信云开发承载多用户数据',
    paragraphs: ['云函数负责身份校验、跨用户读取、数据库写入、文件访问和业务规则，客户端不直接修改好友、库存、支付或奖励数据。部署时需创建自己的云环境、数据库集合与管理员配置。']
  },
  {
    number: '五', button: '内容治理', title: '五、隐私声明与内容安全不可省略',
    paragraphs: ['上线前应根据实际功能完成用户隐私保护指引、用户协议和社区规范，并启用微信内容安全接口。模板提供了相应代码入口，但平台声明、审核材料与运营处置仍需部署者自行完成。']
  },
  {
    number: '六', button: '运营工具', title: '六、任务、邮箱与开发者福利',
    paragraphs: ['模板包含每日任务、奖励邮箱、背包、赠礼、排行榜奖励和管理员福利发放。管理员身份由云端 OPENID 或资料中的 isAdmin 字段控制，普通用户无法仅凭 UID 获得管理权限。']
  },
  {
    number: '七', button: '支付说明', title: '七、虚拟支付是可选能力',
    paragraphs: ['商店示例采用个人主体可用的道具直购流程。只有在主体资质、商品配置、密钥、回调与真实支付验收全部完成后才应启用；不需要支付时，可隐藏商店入口并保留免费的任务与赠礼功能。']
  },
  {
    number: '八', button: '二次开发', title: '八、从配置开始打造自己的社区',
    paragraphs: ['建议先修改 config/app-config.js、活动分类、品牌文案和示例素材，再按部署文档创建云资源。公开发布前请移除测试数据、检查素材版权、轮换曾暴露的密钥，并在真机上完成双账号回归测试。']
  }
].map(section => Object.assign({ expanded: false }, section));

Page({
  data: { sections },

  toggleSection(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.sections[index]) return;
    const key = `sections[${index}].expanded`;
    this.setData({ [key]: !this.data.sections[index].expanded });
  }
});
