// 本文件是“本地数据仓库”：页面不直接读写 wx storage，而是统一调用这里的函数。
// 这样以后接入云数据库时，只需替换这一层，页面代码基本不必改动。
const source = require('../data/mock-data');
const cloud = require('./cloud-service');

// 每一类数据在微信本地缓存中各有一个独立的键名，避免互相覆盖。
const KEYS = {
  initialized: 'hui_time_initialized_v1',
  growth: 'hui_time_growth_v1',
  favorites: 'hui_time_favorites_v1',
  workDrafts: 'hui_time_work_drafts_v1',
  profile: 'hui_time_profile_v1',
  works: 'hui_time_works_v1',
  worksManualMigration: 'hui_time_works_manual_v1',
  growthManualMigration: 'hui_time_growth_manual_v2',
  companions: 'hui_time_companions_v1',
  photos: 'hui_time_photos_v1',
  folders: 'hui_time_folders_v1',
  activities: 'hui_time_activities_v1',
  comments: 'hui_time_comments_v1',
  contentViewHistory: 'hui_time_content_view_history_v1',
  friends: 'hui_time_friends_v1',
  friendRequests: 'hui_time_friend_requests_v1',
  profileManualMigration: 'hui_time_profile_manual_v2',
  favoritesInteractionMigration: 'hui_time_favorites_interaction_v2',
  profileGuideSeen: 'hui_time_profile_guide_seen_v1',
  profilePending: 'hui_time_profile_pending_v1'
};

// 基础工具：clone 防止页面意外修改缓存引用；read/write 封装微信本地缓存 API。
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mergeById(localItems, remoteItems) {
  const merged = {};
  (localItems || []).forEach(item => { if (item && item.id) merged[item.id] = item; });
  (remoteItems || []).forEach(item => { if (item && item.id) merged[item.id] = item; });
  return Object.keys(merged).map(id => merged[id]);
}
function read(key, fallback) { const value = wx.getStorageSync(key); return value === '' || value == null ? fallback : value; }
function write(key, value) { wx.setStorageSync(key, value); }
function hasStored(key) { const value = wx.getStorageSync(key); return value !== '' && value != null; }
// 写入本地缓存后，异步镜像到云端。云函数未部署时 cloud-service 会静默回退，开发者工具仍可照常预览。
function mirrorContent(kind, item) { return cloud.upsertContent(kind, item); }
function today() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('.'); }
// 未连接云端时仅生成临时 7 位 UID；正式 UID 会在启动后由云端替换并固定。
function createUid() { return String(Math.floor(1000000 + Math.random() * 9000000)); }
// 内容默认仅向好友开放；把选项集中在这里，四个编辑页与数据层可保持一致。
const VISIBILITY_OPTIONS = [
  { value: 'self', name: '仅自己可见', hint: '只有你自己能查看这条内容。' },
  { value: 'friends', name: '仅好友可见', hint: '已成为好友的人可以查看这条内容。' },
  { value: 'public', name: '公开', hint: '所有进入小程序的人都可以查看这条内容。' }
];
function normalizeVisibility(value) { return VISIBILITY_OPTIONS.some(item => item.value === value) ? value : 'friends'; }
function visibilityLabel(value) { const option = VISIBILITY_OPTIONS.find(item => item.value === normalizeVisibility(value)); return option.name; }
function visibilityOptions() { return clone(VISIBILITY_OPTIONS); }
function isVisibleToFriend(item) { return normalizeVisibility(item && item.visibility) !== 'self'; }
function normalizeActivityName(value) {
  let result = String(value || '').trim();
  for (let index = 0; index < 3; index += 1) {
    try { const next = decodeURIComponent(result); if (next === result) break; result = next.trim(); } catch (error) { break; }
  }
  return result;
}
function matchesActivity(item, context = {}) { return !context.activityName || normalizeActivityName(item.activityName) === normalizeActivityName(context.activityName); }
// “动态”是面向所有访客的公开发现页，因此它比好友页更严格：只收录明确设为公开的内容。
function isVisibleInFun(item) { return normalizeVisibility(item && item.visibility) === 'public'; }

// 首次打开时创建空数据；后续的 migration 用于把旧版本演示数据平滑迁移到新结构。
function init() {
  if (!read(KEYS.initialized, false)) {
    const favorites = { photo: {}, growth: {}, work: {}, comment: {} };
    write(KEYS.growth, []);
    write(KEYS.favorites, favorites);
    write(KEYS.workDrafts, {});
    write(KEYS.initialized, true);
  }
  if (!hasStored(KEYS.profile)) write(KEYS.profile, Object.assign(clone(source.profile), { uid: createUid() }));
  else {
    const profile = read(KEYS.profile, {});
    if (!profile.uid) write(KEYS.profile, Object.assign({}, profile, { uid: createUid() }));
  }
  if (!hasStored(KEYS.profileManualMigration)) {
    const profile = read(KEYS.profile, {});
    const isLegacyDemo = profile.name === '小慧' && profile.bio === '我相信，每一次陪伴和行动，都能让成长留下温暖的痕迹。' && profile.stats && Number(profile.stats.campCount) === 4 && Number(profile.stats.days) === 86;
    if (isLegacyDemo) write(KEYS.profile, { id: profile.id || 'me', uid: profile.uid || createUid(), name: '', bio: '', tags: [], stats: { age: '', campCount: '' } });
    write(KEYS.profileManualMigration, true);
  }
  if (!hasStored(KEYS.growth)) write(KEYS.growth, []);
  if (!hasStored(KEYS.growthManualMigration)) {
    const sampleIds = source.growthEntries.map(item => item.id);
    write(KEYS.growth, read(KEYS.growth, []).filter(item => sampleIds.indexOf(item.id) === -1));
    write(KEYS.growthManualMigration, true);
  }
  if (!hasStored(KEYS.works)) write(KEYS.works, []);
  if (!hasStored(KEYS.worksManualMigration)) {
    const sampleIds = source.works.map(item => item.id);
    write(KEYS.works, read(KEYS.works, []).filter(item => sampleIds.indexOf(item.id) === -1));
    write(KEYS.worksManualMigration, true);
  }
  if (!hasStored(KEYS.companions)) write(KEYS.companions, []);
  if (!hasStored(KEYS.photos)) write(KEYS.photos, []);
  if (!hasStored(KEYS.folders)) write(KEYS.folders, []);
  if (!hasStored(KEYS.activities)) write(KEYS.activities, []);
  if (!hasStored(KEYS.comments)) write(KEYS.comments, []);
  if (!hasStored(KEYS.contentViewHistory)) write(KEYS.contentViewHistory, {});
  if (!hasStored(KEYS.friends)) write(KEYS.friends, []);
  if (!hasStored(KEYS.friendRequests)) write(KEYS.friendRequests, []);
  if (!hasStored(KEYS.favoritesInteractionMigration)) {
    const existing = read(KEYS.favorites, { photo: {}, growth: {}, work: {}, comment: {} });
    existing.photo = existing.photo || {};
    existing.growth = existing.growth || {};
    existing.work = existing.work || {};
    const sourcePhotoIds = source.photos.map(item => item.id);
    const sourceGrowthIds = source.growthEntries.map(item => item.id);
    sourcePhotoIds.forEach(id => { delete existing.photo[id]; });
    sourceGrowthIds.forEach(id => { delete existing.growth[id]; });
    existing.comment = existing.comment || {};
    write(KEYS.favorites, existing);
    write(KEYS.favoritesInteractionMigration, true);
  }
}

// 点赞状态独立存放，再在读取内容时用 decorate 合并为 item.favorite。
function favorites() { init(); return read(KEYS.favorites, { photo: {}, growth: {}, work: {}, comment: {} }); }
// 旧数据可能还没有统计字段；读取时统一补为非负整数，页面就不用逐一判断了。
function metric(value) { return Math.max(0, Number(value) || 0); }
// 记录从单张 image 升级为 images 数组；旧数据读取时自动把旧封面放到第一个位置。
function normalizeImages(images, fallbackImage) {
  const list = Array.isArray(images) ? images : [];
  const normalized = list.filter(Boolean).slice(0, 9);
  if (!normalized.length && fallbackImage) normalized.push(fallbackImage);
  return normalized;
}
function decorate(kind, item) {
  const f = favorites();
  const favorite = !!(f[kind] && f[kind][item.id]);
  // 老版本已经点过赞的内容没有 likes 字段时，先按当前这一次点赞显示为 1。
  const visibility = normalizeVisibility(item.visibility);
  return Object.assign({}, item, { views: metric(item.views), likes: Math.max(metric(item.likes), favorite ? 1 : 0), visibility, visibilityLabel: visibilityLabel(visibility), favorite });
}
// 三种内容分别存放在不同缓存键中；评论只有点赞状态，不记录浏览量。
function contentStorageKey(kind) { return kind === 'photo' ? KEYS.photos : kind === 'growth' ? KEYS.growth : kind === 'work' ? KEYS.works : ''; }
function updateContentMetrics(kind, id, changes) {
  const key = contentStorageKey(kind);
  if (!key) return null;
  const items = read(key, []);
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return null;
  const current = items[index];
  const next = Object.assign({}, current, {
    views: Math.max(0, metric(current.views) + metric(changes.views)),
    likes: Math.max(0, metric(current.likes) + Number(changes.likes || 0))
  });
  items.splice(index, 1, next);
  write(key, items);
  return clone(next);
}
// 同一用户浏览同一条内容需间隔 5 分钟才会再次计数，开发版与云端行为保持一致。
function recordContentView(kind, id, ownerUid) {
  init();
  const history = read(KEYS.contentViewHistory, {});
  const key = `${ownerUid || 'me'}:${kind}:${id}`;
  const timestamp = Date.now();
  if (timestamp - Number(history[key] || 0) < 5 * 60 * 1000) return updateContentMetrics(kind, id, {});
  history[key] = timestamp;
  write(KEYS.contentViewHistory, history);
  // 自己的页面维持即时反馈；云端负责汇总所有用户的真实浏览量和限频记录。
  const result = updateContentMetrics(kind, id, { views: 1 });
  cloud.recordView(kind, id, ownerUid);
  return result;
}
function camps() { return clone(source.camps); }
function getCamp(id) { return camps().find(item => item.id === id); }
function getCampName(id) { const camp = getCamp(id); return camp ? camp.name : '未关联营地'; }
function getSubcamp(campId, stageId, subcampId) { const camp = getCamp(campId); return camp && camp.subcamps.find(item => item.id === subcampId && (!stageId || item.stageId === stageId)); }
function contextTitle(context) {
  if (context.campId === 'other' && context.activityName) return `其他活动 · ${normalizeActivityName(context.activityName)}`;
  const subcamp = getSubcamp(context.campId, context.stageId, context.subcampId);
  if (subcamp) return subcamp.name;
  const camp = getCamp(context.campId);
  if (!camp) return '活动记忆';
  const stage = (camp.stages || []).find(item => item.id === context.stageId);
  return stage ? `${camp.name} · ${stage.name}` : camp.name;
}
// context 是营地/阶段/子营地的筛选条件；不传则返回全部内容。
function getPhotos(context = {}) {
  init();
  return read(KEYS.photos, []).filter(item => (!context.campId || item.campId === context.campId) && (!context.stageId || item.stageId === context.stageId) && (!context.subcampId || item.subcampId === context.subcampId) && matchesActivity(item, context)).map(item => decorate('photo', item));
}
function getPhoto(id) { return getPhotos({}).find(item => item.id === id); }
// 评论以“内容类型 + 内容 ID”关联到照片、记录或作品。
function getComments(targetType, targetId) {
  init();
  const profile = getProfile();
  return read(KEYS.comments, []).filter(item => (!targetType || item.targetType === targetType) && (!targetId || item.targetId === targetId)).map(item => {
    // 旧评论未存头像时，若是自己发出的评论，显示当前简介头像作为兼容回退。
    const isMine = item.authorUid ? item.authorUid === profile.uid : (item.author || '我') === (profile.name || '我');
    return Object.assign(decorate('comment', item), {
      isMine,
      authorInitial: (item.author || '我').slice(0, 1),
      authorAvatar: item.authorAvatar || (isMine ? profile.avatar || '' : ''),
      authorAvatarScale: Number(item.authorAvatarScale) || (isMine ? Number(profile.avatarScale) || 1 : 1),
      authorAvatarOffsetX: Number(item.authorAvatarOffsetX) || (isMine ? Number(profile.avatarOffsetX) || 0 : 0),
      authorAvatarOffsetY: Number(item.authorAvatarOffsetY) || (isMine ? Number(profile.avatarOffsetY) || 0 : 0)
    });
  }).sort((a, b) => a.createdAt - b.createdAt);
}
function saveComment(input) {
  init();
  const comments = read(KEYS.comments, []);
  const profile = getProfile();
  const id = input.id || `comment-${Date.now()}`;
  const createdAt = input.createdAt || Date.now();
  const record = Object.assign({ id, targetType: 'photo', targetId: '', body: '', authorUid: profile.uid || '', author: profile.name || '我', authorAvatar: profile.avatar || '', authorAvatarScale: Number(profile.avatarScale) || 1, authorAvatarOffsetX: Number(profile.avatarOffsetX) || 0, authorAvatarOffsetY: Number(profile.avatarOffsetY) || 0, createdAt, date: today() }, input, { id, createdAt });
  const index = comments.findIndex(item => item.id === id);
  if (index >= 0) comments.splice(index, 1, record); else comments.push(record);
  write(KEYS.comments, comments);
  cloud.upsertComment(record);
  return decorate('comment', record);
}
function deleteComment(id) {
  init();
  const comments = read(KEYS.comments, []);
  const removed = new Set([String(id || '')]);
  // 删除主评论时，同时清理它下面的所有层级回复，避免留下找不到楼主的孤立回复。
  let changed = true;
  while (changed) {
    changed = false;
    comments.forEach(item => {
      if (item.parentId && removed.has(String(item.parentId)) && !removed.has(String(item.id))) {
        removed.add(String(item.id));
        changed = true;
      }
    });
  }
  write(KEYS.comments, comments.filter(item => !removed.has(String(item.id))));
  const all = favorites();
  removed.forEach(commentId => { if (all.comment) delete all.comment[commentId]; });
  write(KEYS.favorites, all);
  return Array.from(removed);
}
function deleteCommentsForTarget(targetType, targetId) {
  const removed = read(KEYS.comments, []).filter(item => item.targetType === targetType && item.targetId === targetId).map(item => item.id);
  write(KEYS.comments, read(KEYS.comments, []).filter(item => !(item.targetType === targetType && item.targetId === targetId)));
  const all = favorites();
  removed.forEach(id => { if (all.comment) delete all.comment[id]; });
  write(KEYS.favorites, all);
  return cloud.deleteComments(targetType, targetId);
}
// 伙伴与相册类似，同样按所在营地上下文筛选。
function decorateCompanion(item) { const visibility = normalizeVisibility(item.visibility); return Object.assign({}, item, { visibility, visibilityLabel: visibilityLabel(visibility) }); }
function getCompanions(context = {}) {
  init();
  return read(KEYS.companions, []).filter(item => (!context.campId || item.campId === context.campId) && (!context.stageId || item.stageId === context.stageId) && (!context.subcampId || item.subcampId === context.subcampId) && matchesActivity(item, context)).map(decorateCompanion);
}
function getCompanion(id) { init(); const item = read(KEYS.companions, []).find(value => value.id === id); return item ? decorateCompanion(item) : null; }
// 记录也可按营地、阶段和子营地读取。旧记录没有阶段信息时，会继续显示在对应营地下，避免迁移后旧内容“消失”。
function getGrowth(context = {}) {
  init();
  return read(KEYS.growth, []).filter(item => (!context.campId || item.campId === context.campId) && (!context.stageId || !item.stageId || item.stageId === context.stageId) && (!context.subcampId || !item.subcampId || item.subcampId === context.subcampId) && matchesActivity(item, context)).map(item => {
    const images = normalizeImages(item.images, item.image);
    return decorate('growth', Object.assign({}, item, { images, image: images[0] || '' }));
  }).sort((a, b) => b.date.localeCompare(a.date));
}
function getGrowthById(id) { return getGrowth().find(item => item.id === id); }
// 个人资料包含固定 UID；UID 只在首次创建资料时生成一次。
function getProfile() { init(); return clone(read(KEYS.profile, Object.assign({}, source.profile, { uid: createUid() }))); }
// 云端资料由 OpenID 定位；只回写本地缓存，避免把旧缓存重新上传并覆盖后台调整。
function applyCloudProfile(profile) {
  if (!profile || !profile.uid) return getProfile();
  const current = getProfile();
  const next = Object.assign({}, current, profile, { stats: Object.assign({}, current.stats || {}, profile.stats || {}) });
  write(KEYS.profile, next);
  return clone(next);
}
// 页面显示时读取一次当前云端资料，让后台改号无需清除本机缓存即可生效。
async function refreshCurrentProfileAsync() {
  const pending = read(KEYS.profilePending, null);
  if (pending) {
    const saved = await cloud.saveProfile(pending);
    if (saved && !saved.error && saved.profile) {
      wx.removeStorageSync(KEYS.profilePending);
      return applyCloudProfile(saved.profile);
    }
    // 云端仍不可用时继续显示刚编辑的本地资料，不能被旧云端资料覆盖。
    return getProfile();
  }
  const remote = await cloud.getCurrentProfile();
  return remote && !remote.error && remote.profile ? applyCloudProfile(remote.profile) : getProfile();
}
function hasPendingProfile() { return !!read(KEYS.profilePending, null); }
function storeProfile(input) {
  const current = getProfile();
  const profile = Object.assign({}, current, input, { stats: Object.assign({}, current.stats, input.stats || {}) });
  write(KEYS.profile, profile);
  write(KEYS.profilePending, profile);
  // 本地演示模式下，历史评论也立即跟随简介里的当前昵称和头像。
  const comments = read(KEYS.comments, []).map(item => {
    const isMine = item.authorUid ? item.authorUid === current.uid : item.author === current.name;
    return isMine ? Object.assign({}, item, { authorUid: profile.uid, author: profile.name || '我', authorAvatar: profile.avatar || '', authorAvatarScale: Number(profile.avatarScale) || 1.3, authorAvatarOffsetX: Number(profile.avatarOffsetX) || 0, authorAvatarOffsetY: Number(profile.avatarOffsetY) || 0 }) : item;
  });
  write(KEYS.comments, comments);
  return clone(profile);
}
function saveProfile(input) {
  const profile = storeProfile(input);
  cloud.saveProfile(profile).then(remote => {
    if (remote && !remote.error && remote.profile) { wx.removeStorageSync(KEYS.profilePending); applyCloudProfile(remote.profile); }
  });
  return profile;
}
// 编辑简介页等待云端写入完成再返回，避免“关于我”立刻刷新时被旧云端资料覆盖。
async function saveProfileAsync(input) {
  const previous = getProfile();
  const profile = storeProfile(input);
  const remote = await cloud.saveProfile(profile);
  if (remote && !remote.error && remote.profile) {
    wx.removeStorageSync(KEYS.profilePending);
    return applyCloudProfile(remote.profile);
  }
  // 内容安全或服务端校验拒绝时回滚本机缓存，避免界面显示了实际上未保存的资料。
  // 只有真正的网络/云函数连接失败才保留“稍后自动同步”的离线副本。
  if (remote && remote.error && remote.error !== 'CLOUD_CALL_FAILED') {
    write(KEYS.profile, previous);
    wx.removeStorageSync(KEYS.profilePending);
    return { error: remote.message || '资料未通过校验，请修改后重试' };
  }
  return Object.assign({}, profile, { pending: true, warning: remote && remote.message ? remote.message : '资料已保存在本机，将在云端恢复后自动同步' });
}
// 云端已有内容时，用它恢复当前账号的私有数据；首次从旧本地版升级时则先把本地内容镜像上去，避免覆盖。
async function hydrateOwnCloudState() {
  const remote = await cloud.getOwnState();
  if (!remote || remote.error || !remote.profile) return false;
  const localPhotos = read(KEYS.photos, []);
  const localGrowth = read(KEYS.growth, []);
  const localWorks = read(KEYS.works, []);
  const localCompanions = read(KEYS.companions, []);
  const localActivities = read(KEYS.activities, []);
  const localFolders = read(KEYS.folders, []);
  const remoteCount = (remote.photos || []).length + (remote.growth || []).length + (remote.works || []).length + (remote.companions || []).length + (remote.activities || []).length + (remote.albums || []).length;
  const localCount = localPhotos.length + localGrowth.length + localWorks.length + localCompanions.length + localActivities.length + localFolders.length;
  if (!remoteCount && localCount) {
    localPhotos.forEach(item => mirrorContent('photo', item));
    localGrowth.forEach(item => mirrorContent('growth', item));
    localWorks.forEach(item => mirrorContent('work', item));
    localCompanions.forEach(item => mirrorContent('companion', item));
    localActivities.forEach(item => mirrorContent('activity', item));
    localFolders.forEach(item => mirrorContent('album', item));
    cloud.saveProfile(getProfile());
    return false;
  }
  if (!hasPendingProfile()) applyCloudProfile(remote.profile);
  write(KEYS.photos, remote.photos || []);
  write(KEYS.growth, remote.growth || []);
  write(KEYS.works, remote.works || []);
  write(KEYS.companions, remote.companions || []);
  const mergedActivities = mergeById(localActivities, remote.activities || []);
  const remoteActivityIds = new Set((remote.activities || []).map(item => item.id));
  localActivities.filter(item => !remoteActivityIds.has(item.id)).forEach(item => mirrorContent('activity', item));
  write(KEYS.activities, mergedActivities);
  const mergedAlbums = mergeById(localFolders, remote.albums || []);
  const remoteAlbumIds = new Set((remote.albums || []).map(item => item.id));
  localFolders.filter(item => !remoteAlbumIds.has(item.id)).forEach(item => mirrorContent('album', item));
  write(KEYS.folders, mergedAlbums);
  return true;
}
// 仅在资料仍为空、且用户从未处理过引导时，启动页才显示完善资料提示。
function shouldShowProfileGuide() {
  init();
  if (read(KEYS.profileGuideSeen, false)) return false;
  const profile = read(KEYS.profile, {});
  return !profile.name && !profile.bio && !(profile.tags || []).length && !profile.avatar;
}
// 无论选择“去编辑”还是“暂时跳过”，都记录为已处理，避免每次启动重复弹窗。
function markProfileGuideSeen() { write(KEYS.profileGuideSeen, true); }
// 作品与记录使用同一套足迹上下文筛选规则，便于从同一阶段进入各自列表。
function getWorks(context = {}) {
  init();
  return clone(read(KEYS.works, [])).filter(item => (!context.campId || item.campId === context.campId) && (!context.stageId || !item.stageId || item.stageId === context.stageId) && (!context.subcampId || !item.subcampId || item.subcampId === context.subcampId) && matchesActivity(item, context)).map(item => decorate('work', item)).sort((a, b) => b.date.localeCompare(a.date));
}
function getWork(id) { return getWorks().find(item => item.id === id); }
// 将小程序中统一使用的“2026.09.05”日期转换成可筛选的年月日信息。
function rankingDate(date) {
  const match = String(date || '').match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (!match) return { year: 0, month: 0, day: 0, timestamp: 0 };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return { year, month, day, timestamp: Date.UTC(year, month - 1, day) };
}
// “动态”热榜公式与云端一致：浏览 ×1 + 点赞 ×10 + 评论 ×5。
function contentHeat(item, comments) { return metric(item.views) + metric(item.likes) * 10 + metric(comments) * 5; }
function rankingEntry(kind, item) {
  const dateInfo = rankingDate(item.date);
  const camp = getCamp(item.campId) || {};
  const isPhoto = kind === 'photo';
  // 图片名称关闭时，排行榜也使用通用文案，避免在其他页面意外泄露名称。
  const title = isPhoto ? (item.showName === true && item.name ? item.name : '相册中的一段记忆') : (item.title || (kind === 'growth' ? '未命名记录' : '未命名作品'));
  const summary = isPhoto ? (camp.name || '相册中的一段记忆') : (item.body || item.fileName || camp.name || '一段成长记忆');
  const comments = getComments(kind, item.id).length;
  return {
    id: item.id,
    campId: item.campId || '',
    kind,
    kindLabel: kind === 'photo' ? '相册' : kind === 'growth' ? '记录' : '作品',
    title,
    summary,
    image: isPhoto ? item.image : kind === 'growth' ? item.image : item.cover,
    scene: camp.scene || 'rural',
    date: item.date || '',
    year: dateInfo.year,
    month: dateInfo.month,
    day: dateInfo.day,
    timestamp: dateInfo.timestamp,
    // 本地演示模式同样保留可搜索字段；照片关闭名称显示时不把其名称放入索引。
    searchText: [isPhoto && item.showName === true ? item.name : '', item.title, item.body, item.fileName, item.location, item.activityName, camp.name, item.campId, ...(Array.isArray(item.tags) ? item.tags : [])].join(' '),
    views: metric(item.views),
    likes: metric(item.likes),
    comments,
    heat: contentHeat(item, comments),
    publishedAt: Number(item.publishedAt) || dateInfo.timestamp
  };
}
function allRankingEntries() {
  // 三个栏目统一转成同一结构；动态页仅展示用户明确选择“公开”的已发布内容。
  return getPhotos({}).filter(isVisibleInFun).map(item => rankingEntry('photo', item))
    .concat(getGrowth().filter(isVisibleInFun).map(item => rankingEntry('growth', item)))
    .concat(getWorks().filter(item => item.status !== 'draft' && isVisibleInFun(item)).map(item => rankingEntry('work', item)));
}
// 筛选器可使用当前年份以及已有内容的年份，即使本月暂无内容也能切换查看。
function getHotRankingYears() {
  const years = [new Date().getFullYear()];
  allRankingEntries().forEach(item => { if (item.year && years.indexOf(item.year) < 0) years.push(item.year); });
  return years.sort((a, b) => b - a);
}
// 根据时间范围返回相册、记录、作品混合热榜；榜单按“浏览 + 点赞 ×10 + 评论 ×5”降序排列。
function getHotRanking(options = {}) {
  const range = options.range || 'latest';
  const now = new Date();
  const selectedYear = Number(options.year) || now.getFullYear();
  const selectedMonth = Number(options.month) || now.getMonth() + 1;
  const campId = options.campId || '';
  const weekStart = value => { const date = new Date(value || 0); date.setHours(0, 0, 0, 0); const weekday = date.getDay() || 7; date.setDate(date.getDate() - weekday + 1); return date.getTime(); };
  const currentWeek = weekStart(Date.now());
  const filtered = allRankingEntries().filter(item => {
    if (range === 'week') return weekStart(item.publishedAt) === currentWeek && (!campId || item.campId === campId);
    if (range === 'month') return item.year === selectedYear && item.month === selectedMonth && (!campId || item.campId === campId);
    if (range === 'year') return item.year === selectedYear && (!campId || item.campId === campId);
    return !campId || item.campId === campId;
  });
  return filtered.sort((a, b) => range === 'latest' ? b.publishedAt - a.publishedAt || a.title.localeCompare(b.title, 'zh-Hans-CN') : b.heat - a.heat || b.timestamp - a.timestamp || a.title.localeCompare(b.title, 'zh-Hans-CN')).map((item, index) => Object.assign(item, { rank: index + 1 }));
}
// 对任意可点赞内容切换状态，并返回切换后的 true/false。
function toggleFavorite(kind, id, ownerUid) {
  const all = favorites();
  const bucket = kind === 'photo' ? 'photo' : kind === 'growth' ? 'growth' : kind === 'comment' ? 'comment' : 'work';
  all[bucket] = all[bucket] || {};
  const isFavorite = !all[bucket][id];
  all[bucket][id] = isFavorite;
  write(KEYS.favorites, all);
  // 收藏与点赞是同一次操作，因此三种内容的点赞数也同步加减；评论保留原来的收藏逻辑。
  if (contentStorageKey(kind)) updateContentMetrics(kind, id, { likes: isFavorite ? 1 : -1 });
  if (contentStorageKey(kind)) cloud.toggleLike(kind, id, ownerUid);
  return isFavorite;
}
function saveGrowth(input) {
  const entries = getGrowth().map(({ favorite, visibilityLabel: ignoredVisibilityLabel, ...item }) => item);
  const id = input.id || `growth-${Date.now()}`;
  const index = entries.findIndex(item => item.id === id);
  // 编辑时先保留已有浏览/点赞统计，避免修改正文后统计被清零。
  const record = Object.assign({ id, date: today(), tags: [], campId: 'rural', stageId: '', subcampId: '', activityName: '', image: '', images: [], views: 0, likes: 0, visibility: 'friends', publishedAt: Date.now() }, index >= 0 ? entries[index] : {}, input, { id });
  record.activityName = normalizeActivityName(record.activityName);
  // 编辑器明确传 images 时，以数组为准，允许用户移除全部图片；旧调用仍沿用 image。
  record.images = normalizeImages(record.images, Array.isArray(input.images) ? '' : record.image);
  record.image = record.images[0] || '';
  if (index >= 0) entries.splice(index, 1, record); else entries.push(record);
  write(KEYS.growth, entries);
  mirrorContent('growth', record);
  return record;
}
function deleteGrowth(id) {
  init();
  write(KEYS.growth, getGrowth().filter(item => item.id !== id).map(({ favorite, visibilityLabel: ignoredVisibilityLabel, ...item }) => item));
  const all = favorites();
  if (all.growth && Object.prototype.hasOwnProperty.call(all.growth, id)) { delete all.growth[id]; write(KEYS.favorites, all); }
  return Promise.all([deleteCommentsForTarget('growth', id), cloud.deleteContent('growth', id)]);
}
function saveWork(input) {
  init();
  const works = read(KEYS.works, []);
  const id = input.id || `work-${Date.now()}`;
  const index = works.findIndex(item => item.id === id);
  // 新作品使用文件附件；cover 保留是为了兼容已经保存过旧版封面的作品。
  const record = Object.assign({ id, title: '', body: '', cover: '', filePath: '', fileName: '', fileSize: 0, fileType: '', campId: 'rural', stageId: '', subcampId: '', activityName: '', location: '', date: today(), views: 0, likes: 0, visibility: 'friends', status: 'published', publishedAt: Date.now() }, index >= 0 ? works[index] : {}, input, { id });
  record.activityName = normalizeActivityName(record.activityName);
  // 草稿第一次发布时才记为“最新发布”；后续编辑不应重新置顶。
  if (record.status === 'published' && index >= 0 && works[index].status === 'draft') record.publishedAt = Date.now();
  if (index >= 0) works.splice(index, 1, record); else works.push(record);
  write(KEYS.works, works);
  mirrorContent('work', record);
  return decorate('work', record);
}
function deleteWork(id) {
  init();
  write(KEYS.works, read(KEYS.works, []).filter(item => item.id !== id));
  const all = favorites();
  if (all.work && Object.prototype.hasOwnProperty.call(all.work, id)) { delete all.work[id]; write(KEYS.favorites, all); }
  return Promise.all([deleteCommentsForTarget('work', id), cloud.deleteContent('work', id)]);
}
// 保存伙伴资料；头像裁切参数会和图片路径一起保存，确保列表与编辑页显示一致。
function saveCompanion(input) {
  init();
  const companions = read(KEYS.companions, []);
  const id = input.id || `companion-${Date.now()}`;
  const index = companions.findIndex(item => item.id === id);
  const record = Object.assign({ id, name: '', avatar: '', avatarScale: 1.3, avatarOffsetX: 0, avatarOffsetY: 0, gender: '不透露', introduction: '', story: '', campId: 'rural', stageId: 'camper', activityName: '', visibility: 'friends' }, index >= 0 ? companions[index] : {}, input, { id });
  record.activityName = normalizeActivityName(record.activityName);
  if (index >= 0) companions.splice(index, 1, record); else companions.push(record);
  write(KEYS.companions, companions);
  mirrorContent('companion', record);
  return clone(record);
}
function deleteCompanion(id) { init(); write(KEYS.companions, read(KEYS.companions, []).filter(item => item.id !== id)); return cloud.deleteContent('companion', id); }
function savePhoto(input) {
  init();
  const photos = read(KEYS.photos, []);
  const id = input.id || `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const index = photos.findIndex(item => item.id === id);
  // 重新命名、移动图片等编辑不会影响已经累计的浏览与点赞。
  const record = Object.assign({ id, image: '', name: '', title: '', showName: false, folderId: '', campId: 'rural', stageId: 'camper', activityName: '', date: today(), views: 0, likes: 0, visibility: 'friends', publishedAt: Date.now() }, index >= 0 ? photos[index] : {}, input, { id });
  record.activityName = normalizeActivityName(record.activityName);
  // 兼容旧本地数据：旧版的图片说明字段会在下一次保存时彻底移除。
  delete record.comment;
  record.title = record.name;
  if (index >= 0) photos.splice(index, 1, record); else photos.push(record);
  write(KEYS.photos, photos);
  mirrorContent('photo', record);
  return decorate('photo', record);
}
function deletePhoto(id) {
  init();
  write(KEYS.photos, read(KEYS.photos, []).filter(item => item.id !== id));
  const all = favorites();
  if (all.photo && Object.prototype.hasOwnProperty.call(all.photo, id)) { delete all.photo[id]; write(KEYS.favorites, all); }
  return Promise.all([deleteCommentsForTarget('photo', id), cloud.deleteContent('photo', id)]);
}
// 批量删除复用单张删除逻辑，避免遗留对应的点赞和评论数据。
function deletePhotos(ids) { (ids || []).forEach(id => deletePhoto(id)); }
// 把多张照片放入同一个文件夹；空 folderId 表示“未归类”。
function movePhotos(ids, folderId) {
  init();
  const selected = {};
  (ids || []).forEach(id => { selected[id] = true; });
  const photos = read(KEYS.photos, []).map(item => selected[item.id] ? Object.assign({}, item, { folderId: folderId || '' }) : item);
  write(KEYS.photos, photos);
  photos.filter(item => selected[item.id]).forEach(item => mirrorContent('photo', item));
  return Object.keys(selected).length;
}
function matchesAlbumContext(item, context = {}) {
  return (!context.campId || item.campId === context.campId) && (!context.stageId || item.stageId === context.stageId) && (!context.subcampId || item.subcampId === context.subcampId) && matchesActivity(item, context);
}
function albumContextKey(item) { return [item.campId || '', item.stageId || '', item.subcampId || '', normalizeActivityName(item.activityName)].join('|'); }
// 旧版本允许照片不归入文件夹。升级为“先建相册再上传”后，把这些历史照片按原足迹
// 上下文装入自动生成的“回忆集”，既满足新结构，也避免旧照片突然消失。
function ensureLegacyAlbums(context = {}) {
  const photos = read(KEYS.photos, []);
  const pending = photos.filter(item => !item.folderId && matchesAlbumContext(item, context));
  const folders = read(KEYS.folders, []);
  const folderIds = new Set(folders.map(item => item.id));
  // 旧云端照片可能保存了 folderId，但旧版没有同步相册资料；按原 folderId 恢复占位相册，
  // 能保留照片原有分组，名称则使用默认的“回忆集”。
  const orphaned = photos.filter(item => item.folderId && !folderIds.has(item.folderId) && matchesAlbumContext(item, context));
  const orphanGroups = {};
  orphaned.forEach(item => { (orphanGroups[item.folderId] = orphanGroups[item.folderId] || []).push(item); });
  Object.keys(orphanGroups).forEach(folderId => {
    const sample = orphanGroups[folderId][0];
    const folder = { id: folderId, name: '回忆集', cover: sample.image || '', campId: sample.campId || 'rural', stageId: sample.stageId || '', subcampId: sample.subcampId || '', activityName: normalizeActivityName(sample.activityName), date: sample.date || today(), autoCreated: true, visibility: 'self', status: 'published' };
    folders.push(folder);
    folderIds.add(folderId);
    mirrorContent('album', folder);
  });
  if (!pending.length) {
    if (orphaned.length) write(KEYS.folders, folders);
    return;
  }
  const groups = {};
  pending.forEach(item => { const key = albumContextKey(item); (groups[key] = groups[key] || []).push(item); });
  const assignments = {};
  Object.keys(groups).forEach((key, index) => {
    const sample = groups[key][0];
    let folder = folders.find(item => item.autoCreated === true && albumContextKey(item) === key);
    if (!folder) {
      folder = { id: `folder-legacy-${Date.now()}-${index}`, name: '回忆集', cover: sample.image || '', campId: sample.campId || 'rural', stageId: sample.stageId || '', subcampId: sample.subcampId || '', activityName: normalizeActivityName(sample.activityName), date: sample.date || today(), autoCreated: true, visibility: 'self', status: 'published' };
      folders.push(folder);
      mirrorContent('album', folder);
    }
    groups[key].forEach(item => { assignments[item.id] = folder.id; });
  });
  const migrated = photos.map(item => assignments[item.id] ? Object.assign({}, item, { folderId: assignments[item.id] }) : item);
  write(KEYS.folders, folders);
  write(KEYS.photos, migrated);
  migrated.filter(item => assignments[item.id]).forEach(item => mirrorContent('photo', item));
}
function getFolders(context = {}) {
  init();
  ensureLegacyAlbums(context);
  return clone(read(KEYS.folders, []).filter(item => matchesAlbumContext(item, context)));
}
// 判断一个营地/阶段是否已有伙伴或相册内容，用于足迹页面显示红色路径提示。
function hasJourneyEdits(context = {}) {
  return getCompanions(context).length > 0 || getPhotos(context).length > 0 || getFolders(context).length > 0 || getGrowth(context).length > 0 || getWorks(context).length > 0;
}
function getFolder(id) { init(); const item = read(KEYS.folders, []).find(value => value.id === id); return item ? clone(Object.assign({}, item, { activityName: normalizeActivityName(item.activityName) })) : null; }
function saveFolder(input) {
  init();
  const folders = read(KEYS.folders, []);
  const id = input.id || `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const record = Object.assign({ id, name: '回忆集', cover: '', campId: 'rural', stageId: 'camper', subcampId: '', activityName: '', date: today(), visibility: 'self', status: 'published' }, input, { id, name: String(input.name || '').trim() || '回忆集', visibility: 'self', status: 'published' });
  record.activityName = normalizeActivityName(record.activityName);
  const index = folders.findIndex(item => item.id === id);
  if (index >= 0) folders.splice(index, 1, record); else folders.push(record);
  write(KEYS.folders, folders);
  mirrorContent('album', record);
  return clone(record);
}
function deleteFolder(id) {
  init();
  write(KEYS.folders, read(KEYS.folders, []).filter(item => item.id !== id));
  const photos = read(KEYS.photos, []).map(item => item.folderId === id ? Object.assign({}, item, { folderId: '' }) : item);
  write(KEYS.photos, photos);
  photos.filter(item => !item.folderId).forEach(item => mirrorContent('photo', item));
  cloud.deleteContent('album', id);
}
// “其他活动”先以活动文件夹承载，再进入营员/志愿者阶段。已有版本中已经填写过
// activityName 的内容会自动生成同名文件夹，因此升级后不会丢失原来的记录。
function activitySeed(name) {
  return Array.from(String(name || '')).reduce((value, char) => ((value * 31 + char.charCodeAt(0)) >>> 0), 7).toString(36);
}
function activityContent() {
  const groups = [read(KEYS.photos, []), read(KEYS.growth, []), read(KEYS.works, []), read(KEYS.companions, [])];
  return groups.reduce((all, list) => all.concat(list.filter(item => item.campId === 'other' && normalizeActivityName(item.activityName))), []);
}
function getActivities() {
  init();
  const saved = clone(read(KEYS.activities, [])).filter(item => item && normalizeActivityName(item.name));
  const byName = {};
  saved.forEach(item => { const name = normalizeActivityName(item.name); byName[name] = Object.assign({}, item, { name, contentCount: 0 }); });
  activityContent().forEach(item => {
    const name = normalizeActivityName(item.activityName);
    if (!byName[name]) byName[name] = { id: `activity-legacy-${activitySeed(name)}`, name, cover: '', campId: 'other', date: item.date || today(), contentCount: 0, legacy: true };
    byName[name].contentCount += 1;
    if (!byName[name].cover) byName[name].cover = item.image || (item.images || [])[0] || item.cover || item.avatar || '';
  });
  return Object.keys(byName).map(name => byName[name]).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}
function getActivity(id, name) {
  const normalizedName = normalizeActivityName(name);
  return getActivities().find(item => (id && item.id === id) || (normalizedName && item.name === normalizedName)) || null;
}
async function saveActivity(input) {
  init();
  const activities = read(KEYS.activities, []);
  const name = normalizeActivityName(input.name).slice(0, 30);
  const id = input.id || `activity-${Date.now()}`;
  const index = activities.findIndex(item => item.id === id);
  const originalName = normalizeActivityName(input.originalName || (index >= 0 ? activities[index].name : name));
  const record = Object.assign({ id, name, cover: '', campId: 'other', date: today(), visibility: 'self', status: 'published' }, index >= 0 ? activities[index] : {}, input, { id, name, campId: 'other', visibility: 'self', status: 'published' });
  delete record.originalName;
  const remoteJobs = [];

  // 活动相当于“其他活动”下的文件夹。改名时必须同步迁移所有关联内容，
  // 否则旧内容仍会挂在旧名称下，看起来就像从活动里消失了。
  if (originalName && originalName !== name) {
    [
      [KEYS.photos, 'photo'],
      [KEYS.growth, 'growth'],
      [KEYS.works, 'work'],
      [KEYS.companions, 'companion'],
      [KEYS.folders, 'album']
    ].forEach(entry => {
      const changed = [];
      const records = read(entry[0], []).map(item => {
        if (item.campId !== 'other' || normalizeActivityName(item.activityName) !== originalName) return item;
        const updated = Object.assign({}, item, { activityName: name });
        changed.push(updated);
        return updated;
      });
      write(entry[0], records);
      changed.forEach(item => remoteJobs.push(mirrorContent(entry[1], item)));
    });
  }

  // 清理同一活动在旧版本中可能留下的重名卡片，只保留当前这一条。
  const retained = activities.filter(item => {
    const duplicate = item.id !== id && [originalName, name].indexOf(normalizeActivityName(item.name)) >= 0;
    if (duplicate) remoteJobs.push(cloud.deleteContent('activity', item.id));
    return item.id !== id && !duplicate;
  });
  retained.push(record);
  write(KEYS.activities, retained);
  remoteJobs.push(mirrorContent('activity', record));
  // 等待云端迁移完成后再返回列表，防止列表刷新时又读回改名前的旧数据。
  await Promise.all(remoteJobs.filter(Boolean));
  return clone(record);
}
async function deleteActivity(id, name) {
  init();
  const selected = getActivity(id, name);
  const activityName = normalizeActivityName((selected && selected.name) || name);
  if (!activityName) return { photos: 0, growth: 0, works: 0, companions: 0, albums: 0 };
  const matches = item => item.campId === 'other' && normalizeActivityName(item.activityName) === activityName;
  const photoIds = read(KEYS.photos, []).filter(matches).map(item => item.id);
  const growthIds = read(KEYS.growth, []).filter(matches).map(item => item.id);
  const workIds = read(KEYS.works, []).filter(matches).map(item => item.id);
  const companionIds = read(KEYS.companions, []).filter(matches).map(item => item.id);
  const folders = read(KEYS.folders, []).filter(matches);

  // 复用各内容已有的删除流程，确保点赞、收藏、评论和云端镜像也同时清理。
  const remoteJobs = [];
  photoIds.forEach(value => remoteJobs.push(deletePhoto(value)));
  growthIds.forEach(value => remoteJobs.push(deleteGrowth(value)));
  workIds.forEach(value => remoteJobs.push(deleteWork(value)));
  companionIds.forEach(value => remoteJobs.push(deleteCompanion(value)));
  write(KEYS.folders, read(KEYS.folders, []).filter(item => !matches(item)));
  folders.forEach(item => remoteJobs.push(cloud.deleteContent('album', item.id)));

  const activities = read(KEYS.activities, []);
  const removedActivities = activities.filter(item => item.id === id || normalizeActivityName(item.name) === activityName);
  write(KEYS.activities, activities.filter(item => item.id !== id && normalizeActivityName(item.name) !== activityName));
  removedActivities.forEach(item => remoteJobs.push(cloud.deleteContent('activity', item.id)));
  if (id && !removedActivities.some(item => item.id === id) && String(id).indexOf('activity-legacy-') !== 0) remoteJobs.push(cloud.deleteContent('activity', id));
  const remoteResults = await Promise.all(remoteJobs.filter(Boolean));
  if (remoteResults.some(result => result && result.error)) throw new Error('ACTIVITY_DELETE_CLOUD_FAILED');
  return { photos: photoIds.length, growth: growthIds.length, works: workIds.length, companions: companionIds.length, albums: folders.length };
}
async function getActivitiesAsync() {
  const remote = await cloud.getOwnState();
  if (remote && !remote.error && Array.isArray(remote.activities)) {
    const local = read(KEYS.activities, []);
    const remoteIds = new Set(remote.activities.map(item => item.id));
    local.filter(item => !remoteIds.has(item.id)).forEach(item => mirrorContent('activity', item));
    write(KEYS.activities, mergeById(local, remote.activities));
  }
  return getActivities();
}
// 好友数据保留本地缓存以支持离线预览；部署云函数后，好友页面会优先读取云端的真实跨账号关系。
function getFriends() { init(); return clone(read(KEYS.friends, [])).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')); }
function getFriend(id) { init(); const item = read(KEYS.friends, []).find(value => value.id === id); return item ? clone(item) : null; }
function saveFriend(input) {
  init();
  const friends = read(KEYS.friends, []);
  const id = input.id || `friend-${Date.now()}`;
  const record = Object.assign({ id, name: '', gender: '未说明', bio: '', remark: '', tags: [], campIds: [], companions: [], photos: [], works: [], growth: [] }, input, { id });
  const index = friends.findIndex(item => item.id === id);
  if (index >= 0) friends.splice(index, 1, record); else friends.push(record);
  write(KEYS.friends, friends);
  if (record.uid) cloud.updateFriendRemark(record.uid, record.remark || '');
  return clone(record);
}
function deleteFriend(id) {
  init();
  const friend = getFriend(id);
  write(KEYS.friends, read(KEYS.friends, []).filter(item => item.id !== id));
  if (friend && friend.uid) cloud.deleteFriend(friend.uid);
}
function getFriendRequests(direction) {
  init();
  const uid = getProfile().uid;
  return clone(read(KEYS.friendRequests, []).filter(item => item.status === 'pending' && (!direction || (direction === 'incoming' ? item.toUid === uid : item.fromUid === uid))).sort((a, b) => b.createdAt - a.createdAt));
}
function createFriendRequest(input) {
  init();
  const profile = getProfile();
  const toUid = String(input.toUid || '').trim();
  if (!/^\d{7}$/.test(toUid)) return { error: '请填写 7 位好友 UID' };
  if (toUid === profile.uid) return { error: '不能添加自己为好友' };
  const requests = read(KEYS.friendRequests, []);
  const exists = requests.some(item => item.fromUid === profile.uid && item.toUid === toUid && item.status === 'pending');
  if (exists) return { error: '已发送过好友申请，请等待处理' };
  const record = { id: `request-${Date.now()}`, fromUid: profile.uid, fromName: profile.name, fromAvatar: profile.avatar || '/assets/images/profile-avatar-default.jpg', fromBio: profile.bio, toUid, reason: String(input.reason || '').trim(), status: 'pending', createdAt: Date.now(), date: today() };
  requests.push(record);
  write(KEYS.friendRequests, requests);
  return clone(record);
}
function acceptFriendRequest(id) {
  init();
  const requests = read(KEYS.friendRequests, []);
  const request = requests.find(item => item.id === id && item.toUid === getProfile().uid && item.status === 'pending');
  if (!request) return null;
  request.status = 'accepted';
  request.handledAt = Date.now();
  write(KEYS.friendRequests, requests);
  return saveFriend({ uid: request.fromUid, name: request.fromName || `好友 ${request.fromUid}`, bio: request.fromBio || '' });
}
function rejectFriendRequest(id) {
  init();
  const requests = read(KEYS.friendRequests, []);
  const request = requests.find(item => item.id === id && item.toUid === getProfile().uid && item.status === 'pending');
  if (!request) return false;
  request.status = 'rejected';
  request.handledAt = Date.now();
  write(KEYS.friendRequests, requests);
  return true;
}

// 下列异步方法供“动态”和“好友”页面使用。云函数部署后它们返回真实的跨账号数据；
// 本地演示或云函数不可用时，则保留原有的单机交互，方便继续开发页面样式。
async function getHotRankingAsync(options = {}) {
  const result = await getHotRankingPageAsync(options);
  return result.items;
}
async function getHotRankingPageAsync(options = {}) {
  const remote = await cloud.getPublicRanking(options);
  if (remote && !remote.error && Array.isArray(remote.items)) return remote;
  const kind = ['photo', 'growth', 'work'].indexOf(options.kind) >= 0 ? options.kind : '';
  const keyword = String(options.keyword || '').trim().toLocaleLowerCase();
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = 20;
  const ranked = getHotRanking(options).filter(item => !kind || item.kind === kind).filter(item => !keyword || [item.title, item.summary, item.kindLabel, item.searchText].join(' ').toLocaleLowerCase().indexOf(keyword) >= 0);
  const start = (page - 1) * pageSize;
  return { items: ranked.slice(start, start + pageSize), page, pageSize, total: ranked.length, hasNext: start + pageSize < ranked.length };
}
async function getHotRankingYearsAsync() {
  const remote = await cloud.getPublicYears();
  return remote && !remote.error && Array.isArray(remote.years) ? remote.years : getHotRankingYears();
}
async function getFriendsAsync() {
  const remote = await cloud.getFriends();
  return remote && !remote.error && Array.isArray(remote.friends) ? remote.friends : getFriends();
}
async function getFriendAsync(uid) {
  const remote = await cloud.getFriend(uid);
  return remote && !remote.error && remote.friend ? remote.friend : getFriend(uid);
}
async function deleteFriendAsync(uid) {
  const remote = await cloud.deleteFriend(uid);
  if (remote && !remote.error && remote.removed) return { removed: true };
  if (remote && remote.error) return { error: remote.message || '删除好友失败' };
  deleteFriend(uid);
  return { removed: true };
}
async function getFriendRequestsAsync(direction) {
  const remote = await cloud.getFriendRequests();
  if (remote && !remote.error && Array.isArray(remote.requests)) return direction === 'incoming' ? remote.requests : [];
  return getFriendRequests(direction);
}
async function createFriendRequestAsync(input) {
  const remote = await cloud.createFriendRequest(input.toUid, input.reason);
  if (remote && !remote.error && remote.request) return remote.request;
  if (remote && remote.error) return { error: remote.message || '好友申请发送失败' };
  return createFriendRequest(input);
}
async function acceptFriendRequestAsync(id) {
  const remote = await cloud.acceptFriendRequest(id);
  if (remote && !remote.error) return remote.accepted ? { accepted: true } : null;
  if (remote && remote.error) return { error: remote.message || '好友申请处理失败' };
  const friend = acceptFriendRequest(id);
  return friend ? { accepted: true, friend } : null;
}
async function rejectFriendRequestAsync(id) {
  const remote = await cloud.rejectFriendRequest(id);
  if (remote && !remote.error) return remote.rejected ? { rejected: true } : null;
  if (remote && remote.error) return { error: remote.message || '好友申请处理失败' };
  return rejectFriendRequest(id) ? { rejected: true } : null;
}
async function getFriendContentAsync(uid, type) {
  const remote = await cloud.getFriendContent(uid, type);
  if (remote && !remote.error) return remote;
  const friend = getFriend(uid);
  if (!friend) return remote && remote.error ? { error: remote.message || '无权访问此内容' } : null;
  const kinds = [
    ['companion', '伙伴', friend.companions || []],
    ['photo', '相册', friend.photos || []],
    ['growth', '记录', friend.growth || []],
    ['work', '作品', friend.works || []]
  ];
  const allRecords = kinds.reduce((list, entry) => list.concat(entry[2].filter(isVisibleToFriend).map(item => Object.assign({}, item, { kind: entry[0], contentLabel: entry[1], visibilityLabel: visibilityLabel(item.visibility), ownerUid: friend.uid || friend.id }))), []);
  const derivedCampIds = allRecords.map(item => item.campId).filter((item, index, all) => item && all.indexOf(item) === index);
  const friendCampIds = (friend.campIds || []).concat(derivedCampIds).filter((item, index, all) => all.indexOf(item) === index);
  const campList = camps().filter(item => friendCampIds.indexOf(item.id) >= 0);
  const records = type === 'growth' ? allRecords.filter(item => item.kind === 'growth' || item.kind === 'work') : (type === 'footprints' || type === 'module') ? allRecords : [];
  return { friend, type, camps: campList, records, albums: Array.isArray(friend.albums) ? clone(friend.albums) : [] };
}
// 收藏页的三个标签来自不同数据表，这里把它们整理成统一的列表格式。
function getFavoriteItems(type) {
  if (type === '照片') return getPhotos({}).filter(item => item.favorite);
  if (type === '成长') return getGrowth().filter(item => item.favorite).map(item => Object.assign(item, { kind: 'growth', contentLabel: '记录' })).concat(getWorks().filter(item => item.favorite).map(item => Object.assign(item, { kind: 'work', contentLabel: '作品' }))).sort((a, b) => b.date.localeCompare(a.date));
  if (type === '评论') return getComments().filter(item => item.favorite).map(item => {
    const target = item.targetType === 'photo' ? getPhoto(item.targetId) : item.targetType === 'growth' ? getGrowthById(item.targetId) : getWork(item.targetId);
    return Object.assign(item, { title: `评论 · ${(target && (target.name || target.title)) || '已删除内容'}`, targetTitle: (target && (target.name || target.title)) || '已删除内容', campId: target ? target.campId : '', targetType: item.targetType });
  });
  return [];
}
async function getFavoriteItemsAsync(type) {
  const cloudType = type === '照片' ? 'photo' : type === '成长' ? 'growth' : 'comment';
  const remote = await cloud.getFavoriteItems(cloudType);
  return remote && !remote.error && Array.isArray(remote.items) ? remote.items : getFavoriteItems(type);
}
function saveWorkDraft(id, value) { return saveWork(Object.assign({}, value, { id, status: 'draft' })); }
function getWorkDrafts() { return getWorks().filter(item => item.status === 'draft'); }

module.exports = { init, camps, getCamp, getCampName, getSubcamp, contextTitle, normalizeActivityName, visibilityOptions, visibilityLabel, isVisibleToFriend, getPhotos, getPhoto, savePhoto, deletePhoto, deletePhotos, movePhotos, getComments, saveComment, deleteComment, getFolders, getFolder, saveFolder, deleteFolder, getActivities, getActivity, saveActivity, deleteActivity, getActivitiesAsync, getCompanions, getCompanion, saveCompanion, deleteCompanion, hasJourneyEdits, getGrowth, getGrowthById, getProfile, applyCloudProfile, refreshCurrentProfileAsync, hasPendingProfile, saveProfile, saveProfileAsync, hydrateOwnCloudState, shouldShowProfileGuide, markProfileGuideSeen, getWorks, getWork, getHotRankingYears, getHotRanking, getHotRankingYearsAsync, getHotRankingAsync, getHotRankingPageAsync, toggleFavorite, recordContentView, saveGrowth, deleteGrowth, saveWork, deleteWork, getFriends, getFriend, getFriendsAsync, getFriendAsync, saveFriend, deleteFriend, deleteFriendAsync, getFriendRequests, getFriendRequestsAsync, createFriendRequest, createFriendRequestAsync, acceptFriendRequest, acceptFriendRequestAsync, rejectFriendRequest, rejectFriendRequestAsync, getFriendContentAsync, getFavoriteItems, getFavoriteItemsAsync, saveWorkDraft, getWorkDrafts, today };
