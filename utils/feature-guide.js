// 首次登录引导在真实页面之间移动；每一步都指向该页面上的一个主要操作区。
const PREFIX = 'hui_time_feature_guide_v1_';
const TAB_ROUTES = ['pages/fun/index', 'pages/footprints/index', 'pages/friends/index', 'pages/profile/index'];
const STEPS = [
  { id: 'fun', route: 'pages/fun/index', title: '趣闻：发现公开故事', target: '搜索框', placement: 'bottom', tabPage: true, points: ['输入关键词后点“搜索”，查找公开内容。', '切换“最新／本周／月份／年份”和内容类别，浏览榜单。', '点内容卡片看详情；“奖励说明”可查看排名奖励。'] },
  { id: 'footprints', route: 'pages/footprints/index', title: '足迹：选择一段经历', target: '地图入口', placement: 'bottom', tabPage: true, points: ['点击地图上的营地，进入自己的成长足迹。', '右上角“其他足迹”可创建和管理多个活动。', '有内容的入口会出现提示图标。'] },
  { id: 'camp', route: 'packages/camps/camp-detail', url: '/packages/camps/camp-detail?campId=rural', title: '足迹：整理内容', target: '伙伴、相册、记录、作品', placement: 'top', points: ['选择营员或服务阶段，再进入对应内容区。', '相册要先新建，再进入相册上传照片。', '写记录或新建作品时，可选择公开、仅好友或仅自己可见。'] },
  { id: 'friends', route: 'pages/friends/index', title: '好友：找到认识的人', target: '添加好友按钮', placement: 'center', tabPage: true, points: ['点击上方“添加好友”，输入对方 UID 并填写非空的申请内容后发申请。', '顶部“好友申请”可同意或拒绝申请；“消息”可查看未读聊天。', '点击好友卡片，可看对方允许好友查看的足迹并赠送心意。'] },
  { id: 'profile', route: 'pages/profile/index', title: '我的：管理账号', target: '简介入口', placement: 'bottom', tabPage: true, points: ['上方显示你的 UID 和收到的心意。', '“简介”可编辑头像、昵称与个人介绍。', '下面还有收藏、背包、任务、邮箱及安全与协议。'] },
  { id: 'intro', route: 'pages/profile/intro', title: '简介：让朋友认识你', target: '编辑简介按钮', placement: 'bottom', points: ['点击“编辑简介”，可以设置头像、昵称、介绍和标签。', '你的 UID 可提供给朋友搜索账号；改昵称不会改变 UID。'] },
  { id: 'tasks', route: 'pages/profile/tasks', title: '任务：领取每日心意', target: '每日任务列表', placement: 'bottom', points: ['完成任务后，点击任务右侧的“领取”。', '连续完成每周任务，还可领取全勤奖励。'] },
  { id: 'backpack', route: 'pages/profile/backpack', title: '背包：赠送已有道具', target: '道具列表', placement: 'bottom', points: ['这里只显示当前拥有、可以赠送的道具。', '有库存时点击“赠送”，选择好友并送出心意。'] },
  { id: 'mailbox', route: 'pages/profile/mailbox', title: '邮箱：收下奖励', target: '邮件列表', placement: 'bottom', points: ['榜单奖励和开发者福利会送到邮箱。', '有待领取的邮件时点击“领取”，奖励会进入背包。', '引导结束后，可随时从“我的—功能引导”再看一遍。'] }
];
let active = false;
let stepIndex = 0;
let guideUid = '';

function key(uid) { return `${PREFIX}${String(uid || '')}`; }
function state(uid) { return uid ? wx.getStorageSync(key(uid)) || '' : ''; }
function queue(uid) {
  if (uid && state(uid) !== 'seen') wx.setStorageSync(key(uid), 'pending');
}
function shouldAutoOpen(uid) { return state(uid) === 'pending'; }
function markSeen(uid) { if (uid) wx.setStorageSync(key(uid), 'seen'); }
function isActive() { return active; }
// 真机与开发者工具返回的 page.route 可能带前导斜杠；导航表统一不带斜杠。
function routeOf(page) { return String(page && page.route || '').replace(/^\/+/, '').split('?')[0]; }
function currentPage() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  return pages.length ? pages[pages.length - 1] : null;
}
function syncPage(page) {
  if (!page || typeof page.setData !== 'function') return;
  const step = active && STEPS[stepIndex].route === routeOf(page) ? STEPS[stepIndex] : null;
  page.setData({ guideStep: step, guideIndex: step ? stepIndex : 0, guideTotal: STEPS.length });
}
function syncCurrentPage() { syncPage(currentPage()); }
function navigateToStep() {
  const step = STEPS[stepIndex];
  const page = currentPage();
  if (page && routeOf(page) === step.route) return syncPage(page);
  const url = step.url || `/${step.route}`;
  const method = TAB_ROUTES.indexOf(step.route) >= 0 ? 'switchTab' : page && TAB_ROUTES.indexOf(routeOf(page)) < 0 ? 'redirectTo' : 'navigateTo';
  wx[method]({
    url,
    success: () => {
      syncCurrentPage();
      if (step.id === 'camp' && typeof wx.pageScrollTo === 'function') {
        setTimeout(() => wx.pageScrollTo({ selector: '#stage-modules', duration: 280 }), 120);
      }
    },
    fail: () => { active = false; syncCurrentPage(); }
  });
}
function start(uid) {
  guideUid = String(uid || '');
  active = true;
  stepIndex = 0;
  navigateToStep();
}
function next() {
  if (!active) return;
  if (stepIndex >= STEPS.length - 1) return finish(true);
  stepIndex += 1;
  navigateToStep();
}
function previous() {
  if (!active || stepIndex === 0) return;
  stepIndex -= 1;
  navigateToStep();
}
function finish(returnToMine = false) {
  if (!active) return;
  active = false;
  markSeen(guideUid);
  syncCurrentPage();
  if (returnToMine) wx.switchTab({ url: '/pages/profile/index' });
}

module.exports = { queue, shouldAutoOpen, markSeen, isActive, syncPage, start, next, previous, finish, steps: STEPS };
