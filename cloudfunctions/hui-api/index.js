// 同行足迹云端 API。
// 所有跨用户读取、好友关系和公开榜单都经由本函数处理，客户端不直接读写云数据库，
// 因而无法通过修改前端参数读取别人的私密内容。
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');
const mediaFiles = require('./media-files');
const { createManager } = require('./content-manager');
const { createFriendManager } = require('./friend-management');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  profiles: 'hui_profiles',
  uidClaims: 'hui_uid_claims',
  content: 'hui_contents',
  friendRequests: 'hui_friend_requests',
  friendships: 'hui_friendships',
  likes: 'hui_likes',
  comments: 'hui_comments',
  views: 'hui_content_views',
  messages: 'hui_chat_messages',
  reports: 'hui_reports',
  wallets: 'hui_item_wallets',
  gifts: 'hui_item_gifts',
  dailyTasks: 'hui_daily_tasks',
  weeklyClaims: 'hui_weekly_claims',
  mailbox: 'hui_mailbox',
  rewardRuns: 'hui_reward_runs'
};

const VISIBILITIES = ['self', 'friends', 'public'];
const DEFAULT_WORK_REJECTION_REASON = '您上传的内容不符合小程序规范，具体规范请查询“我的”栏下的“安全与协议”，修改后可自行重新提交。';
const contentManager = createManager({ db, collections: COLLECTIONS, ownProfile, ownerContentRecords, sanitizeContent, checkSubmission, exposeContent, now });
const friendManager = createFriendManager({ db, profiles: COLLECTIONS.profiles, friendships: COLLECTIONS.friendships, ownProfile, profileByUid, ensureFriend, checkSubmission });
const CONTENT_KINDS = ['photo', 'growth', 'work', 'companion', 'activity', 'album'];
const ITEM_CATALOG = {
  heart: { id: 'heart', name: '爱心', affection: 1 },
  star: { id: 'star', name: '星星', affection: 3 },
  envelope: { id: 'envelope', name: '信封', affection: 5 },
  gift_box: { id: 'gift_box', name: '礼盒', affectionMin: 1, affectionMax: 10 },
  memory_book: { id: 'memory_book', name: '纪念册', affection: 520 },
  mooncake: { id: 'mooncake', name: '月饼', affectionMin: 1, affectionMax: 5 },
  red_packet: { id: 'red_packet', name: '红包', affectionMin: 1, affectionMax: 10 }
};
function tieredRankingRewards(itemId, tiers) {
  const rewards = [];
  tiers.forEach(([lastRank, quantity]) => {
    while (rewards.length < lastRank) rewards.push({ itemId, quantity });
  });
  return rewards;
}
const RANKING_REWARDS = {
  day: tieredRankingRewards('star', [[3, 3], [6, 2], [10, 1]]),
  week: tieredRankingRewards('envelope', [[5, 3], [10, 2], [20, 1]]),
  month: tieredRankingRewards('gift_box', [[5, 6], [10, 4], [20, 2]]),
  year: tieredRankingRewards('memory_book', [[1, 3], [2, 2], [3, 1]])
};
const AFFECTION_TITLES = [
  [100, '一念永恒', '阅尽千帆，心中唯余一人，情意跨越空间与岁月。'],
  [70, '天涯比邻', '纵然关山万里，此心始终相伴如邻。'],
  [50, '比翼连枝', '历经风雨仍相依相伴，形影不离。'],
  [40, '执子之手', '许下誓言，从此风雨同行。'],
  [30, '两心相悦', '彼此心意已明，眉目间尽是温柔。'],
  [20, '莫逆于心', '志趣相投，心意相通，引为知己。'],
  [15, '情根深种', '情深难自抑，却还未说出口。'],
  [10, '暗生情愫', '不知从何时起，目光总不自觉追随那人。'],
  [5, '一见钟情', '初见刹那便心动，或许TA不一样？'],
  [1, '萍水相逢', '茫茫人海中命运交织，不过一面之缘。']
];
function now() { return Date.now(); }
function validUid(value) { return /^\d{7}$/.test(String(value || '')); }
// 旧账号在下一次启动时会自动升级；升级前暂时允许云端按 6 位旧 UID 找到既有好友关系。
function storedUid(value) { return /^\d{6,7}$/.test(String(value || '')); }
function safeText(value, max = 240) { return String(value == null ? '' : value).trim().slice(0, max); }
function metric(value) { return Math.max(0, Number(value) || 0); }
function visibility(value) { return VISIBILITIES.indexOf(value) >= 0 ? value : 'friends'; }
function pairKey(a, b) { return [a, b].sort().join(':'); }
function chinaDate(value = now()) { return new Date(value + 8 * 60 * 60 * 1000); }
function chinaDateKey(value = now()) { return chinaDate(value).toISOString().slice(0, 10); }
function weekKey(value = now()) {
  const date = chinaDate(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}
function affectionSummary(points) {
  const safePoints = metric(points);
  const level = Math.floor(safePoints / 3) + 1;
  const title = AFFECTION_TITLES.find(item => level >= item[0]) || AFFECTION_TITLES[AFFECTION_TITLES.length - 1];
  return { points: safePoints, level, title: title[1], description: title[2], nextLevelAt: level * 3 };
}
// 内容安全校验必须在云端执行，不能依赖可被绕过的前端判断。
// 文本按微信接口的单次长度分段；图片只校验已经上传到云存储或 HTTPS 的文件。
function securityError(error) {
  if (error && ['CONTENT_UNSAFE', 'CONTENT_REVIEW_REQUIRED', 'CONTENT_CHECK_UNAVAILABLE', 'IMAGE_SECURITY_SIZE_LIMIT'].includes(error.message)) return error;
  const raw = [error && error.message, error && error.errMsg, error && error.errCode, error && error.errcode].filter(Boolean).join(' ');
  // 只有明确的风险错误码表示未通过，权限/网络异常中的 review 等字样不能据此判违规。
  if (/(^|\D)87014(\D|$)/.test(raw)) return new Error('CONTENT_UNSAFE');
  return new Error('CONTENT_CHECK_UNAVAILABLE');
}

function checkSecurityResponse(response) {
  if (!response || typeof response !== 'object') throw new Error('CONTENT_CHECK_UNAVAILABLE');
  const value = response.errCode == null ? response.errcode : response.errCode;
  const code = value == null ? NaN : Number(value);
  if (code === 87014) throw new Error('CONTENT_UNSAFE');
  if (Number.isFinite(code) && code !== 0) throw new Error('CONTENT_CHECK_UNAVAILABLE');
  const result = response.result || response;
  const suggest = String(result.suggest || '').toLowerCase();
  if (suggest === 'risky') throw new Error('CONTENT_UNSAFE');
  if (suggest === 'review') throw new Error('CONTENT_REVIEW_REQUIRED');
  if (suggest && suggest !== 'pass' || !Number.isFinite(code) && suggest !== 'pass') throw new Error('CONTENT_CHECK_UNAVAILABLE');
}

function checkedSecurityError(error, type, response) {
  const result = securityError(error);
  result.securityType = type;
  // 不记录用户文字、图片、OpenID 或文件地址；只记录定位接口问题所需的结果。
  console.warn('content-security-check', {
    type, result: result.message,
    errCode: response && (response.errCode == null ? response.errcode : response.errCode) || error && (error.errCode || error.errcode) || '',
    suggest: String(response && (response.result || response).suggest || ''),
    traceId: String(response && (response.traceId || response.trace_id) || '')
  });
  return result;
}

function textChunks(values) {
  const chars = Array.from((Array.isArray(values) ? values : [values]).map(value => String(value || '').trim()).filter(Boolean).join('\n'));
  const chunks = [];
  for (let index = 0; index < chars.length; index += 1800) chunks.push(chars.slice(index, index + 1800).join(''));
  return chunks;
}

async function checkTextSafety(openid, values, scene = 3) {
  const chunks = textChunks(values);
  for (const content of chunks) {
    let response;
    try {
      response = await cloud.openapi.security.msgSecCheck({ content, version: 2, scene, openid });
      checkSecurityResponse(response);
    } catch (error) {
      throw checkedSecurityError(error, 'text', response);
    }
  }
}

function imageContentType(path) {
  const matched = String(path || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  if (matched && matched[1] === 'png') return 'image/png';
  if (matched && matched[1] === 'webp') return 'image/webp';
  if (matched && matched[1] === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function downloadHttpsBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(trustedImageUrl(url), response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        return resolve(downloadHttpsBuffer(new URL(response.headers.location, url).href, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`IMAGE_DOWNLOAD_FAILED:${response.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size <= 1024 * 1024) chunks.push(chunk);
        else request.destroy(new Error('IMAGE_SECURITY_SIZE_LIMIT'));
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('IMAGE_DOWNLOAD_TIMEOUT')));
  });
}

async function imageBuffer(path) {
  if (/^cloud:\/\//i.test(String(path || ''))) {
    const result = await cloud.downloadFile({ fileID: path });
    const content = result && result.fileContent;
    if (!content) throw new Error('IMAGE_DOWNLOAD_FAILED');
    if (content.length > 1024 * 1024) throw new Error('IMAGE_SECURITY_SIZE_LIMIT');
    return content;
  }
  if (/^https:\/\//i.test(String(path || ''))) return downloadHttpsBuffer(path);
  throw new Error('UNTRUSTED_MEDIA_SOURCE');
}

async function checkImageSafety(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const inspect = async path => {
    let response;
    try {
      const content = await imageBuffer(path);
      if (!content) return;
      response = await cloud.openapi.security.imgSecCheck({ media: { contentType: imageContentType(path), value: content } });
      checkSecurityResponse(response);
    } catch (error) {
      throw checkedSecurityError(error, 'image', response);
    }
  };
  // 九图逐张串行检查容易超过云函数执行时间；每批三张并行兼顾速度和内存占用。
  for (let index = 0; index < unique.length; index += 3) {
    await Promise.all(unique.slice(index, index + 3).map(inspect));
  }
}

async function checkSubmission(openid, text, images, scene) {
  const results = await Promise.allSettled([
    checkTextSafety(openid, text, scene),
    checkImageSafety(images)
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function contentTextValues(kind, item) {
  if (kind === 'activity' || kind === 'album') return [item.name];
  if (kind === 'photo') return [item.name, item.activityName];
  if (kind === 'growth') return [item.title, item.body, item.location, item.activityName].concat(item.tags || []);
  if (kind === 'work') return [item.title, item.body, item.location, item.fileName, item.activityName];
  return [item.name, item.introduction, item.story, item.activityName];
}

function contentImageValues(kind, item) {
  if (kind === 'work') return [item.cover].concat(mediaFiles.isImage(item) && item.filePath ? [item.filePath] : []);
  if (kind === 'activity' || kind === 'album') return [item.cover];
  if (kind === 'photo') return [item.image];
  if (kind === 'growth') return (item.images || []).concat(item.image || []);
  return [item.avatar];
}

function sanitizeProfile(input = {}) {
  const rawStats = input.stats || {};
  const numberOrEmpty = value => (/^(0|[1-9]\d*)$/.test(String(value == null ? '' : value)) ? Number(value) : '');
  return {
    name: safeText(input.name, 20),
    bio: safeText(input.bio, 240),
    tags: (Array.isArray(input.tags) ? input.tags : []).map(item => Array.from(safeText(item, 20)).slice(0, 10).join('')).filter(Boolean).slice(0, 6),
    avatar: safeText(input.avatar, 500),
    avatarScale: Math.max(1, Math.min(3, Number(input.avatarScale) || 1.3)),
    avatarOffsetX: Math.max(-90, Math.min(90, Number(input.avatarOffsetX) || 0)),
    avatarOffsetY: Math.max(-90, Math.min(90, Number(input.avatarOffsetY) || 0)),
    stats: { age: numberOrEmpty(rawStats.age), campCount: numberOrEmpty(rawStats.campCount) }
  };
}

function sanitizeContent(kind, input = {}) {
  const base = {
    id: safeText(input.id, 80),
    campId: safeText(input.campId, 40),
    stageId: safeText(input.stageId, 40),
    subcampId: safeText(input.subcampId, 40),
    // 自定义活动名只属于“其他活动”内的细分展示，不参与营地分类和权限判断。
    activityName: safeText(input.activityName, 60),
    date: safeText(input.date, 20),
    visibility: kind === 'companion' && input.visibility === 'public' ? 'friends' : visibility(input.visibility),
    status: kind === 'work' && input.status === 'draft' ? 'draft' : 'published'
  };
  if (kind === 'activity') return Object.assign(base, {
    name: safeText(input.name, 60), cover: safeText(input.cover, 500)
  });
  if (kind === 'album') return Object.assign(base, {
    name: safeText(input.name, 60) || '回忆集', cover: safeText(input.cover, 500), autoCreated: input.autoCreated === true
  });
  if (kind === 'photo') return Object.assign(base, {
    image: safeText(input.image, 500), fileSize: metric(input.fileSize), name: safeText(input.name, 80), title: safeText(input.name, 80), showName: input.showName === true, folderId: safeText(input.folderId, 80), hideUid: input.hideUid === true, nameAutoGenerated: input.nameAutoGenerated === true, albumSequence: Number.isSafeInteger(Number(input.albumSequence)) && Number(input.albumSequence) > 0 ? Number(input.albumSequence) : 0
  });
  if (kind === 'growth') return Object.assign(base, {
    title: safeText(input.title, 80), body: safeText(input.body, 2000), tags: (Array.isArray(input.tags) ? input.tags : []).map(item => safeText(item, 20)).filter(Boolean).slice(0, 8),
    images: (Array.isArray(input.images) ? input.images : []).map(item => safeText(item, 500)).filter(Boolean).slice(0, 9), image: safeText(input.image, 500), location: safeText(input.location, 80), hideUid: input.hideUid === true
  });
  if (kind === 'work') return Object.assign(base, {
    title: safeText(input.title, 80), body: safeText(input.body, 5000), cover: safeText(input.cover, 500), filePath: safeText(input.filePath, 500),
    fileName: safeText(input.fileName, 120), fileSize: metric(input.fileSize), fileType: safeText(input.fileType, 30), mediaType: mediaFiles.isVideo(input) ? 'video' : 'file', location: safeText(input.location, 80), hideUid: input.hideUid === true
  });
  return Object.assign(base, {
    name: safeText(input.name, 40), avatar: safeText(input.avatar, 500), avatarScale: Math.max(1, Math.min(3, Number(input.avatarScale) || 1.3)),
    avatarOffsetX: Math.max(-90, Math.min(90, Number(input.avatarOffsetX) || 0)), avatarOffsetY: Math.max(-90, Math.min(90, Number(input.avatarOffsetY) || 0)),
    gender: ['男', '女', '不透露'].indexOf(input.gender) >= 0 ? input.gender : '不透露', introduction: safeText(input.introduction, 500), story: safeText(input.story, 2000)
  });
}

function publicProfile(profile) {
  return { uid: profile.uid, name: profile.name || '未命名用户', bio: profile.bio || '', tags: profile.tags || [], avatar: profile.avatar || '', avatarScale: profile.avatarScale || 1.3, avatarOffsetX: profile.avatarOffsetX || 0, avatarOffsetY: profile.avatarOffsetY || 0, stats: profile.stats || { age: '', campCount: '' } };
}

// UID 只由云端分配：首位完成建档的用户使用指定号码，之后全部随机生成七位数。
const FIRST_USER_UID = '1000001';

async function uidExists(uid) {
  const found = await db.collection(COLLECTIONS.profiles).where({ uid: String(uid) }).limit(1).get();
  return found.data.length > 0;
}

// OpenID 是微信为每个小程序用户固定分配的身份主键；UID 只是可在后台调整的公开编号。
// 所有权限、好友关系和内容归属均使用 OpenID，绝不以 UID 作为授权依据。
function isMissingDocument(error) {
  return /not.exist|not.found|does not exist|DATABASE_DOCUMENT_NOT_EXIST|不存在/i.test(String(error && (error.errMsg || error.message)));
}
async function optionalDocument(reference) {
  try { return (await reference.get()).data || null; }
  catch (error) { if (isMissingDocument(error)) return null; throw error; }
}
function stableId(prefix, ...parts) { return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`; }
function workNeedsReview(record) {
  const item = record.payload || record;
  return record.visibility === 'public' && (record.kind === 'work' || !record.kind) && !!item.filePath && record.reviewStatus !== 'approved';
}
function isPendingWorkReview(record) {
  return record && record.kind === 'work' && record.status === 'published' &&
    record.payload && record.payload.status !== 'draft' && !mediaFiles.isImage(record.payload) &&
    record.reviewStatus !== 'rejected' && workNeedsReview(record);
}
function isPublished(record) { return record.status !== 'draft' && !(record.payload && record.payload.status === 'draft') && !workNeedsReview(record); }
function trustedImageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !/\.(tcb\.qcloud\.la|myqcloud\.com|tencentcos\.cn)$/i.test(url.hostname)) throw new Error('UNTRUSTED_MEDIA_SOURCE');
  return url.href;
}
async function profileByOpenid(openid) {
  if (!openid) return null;
  return optionalProfile(db.collection(COLLECTIONS.profiles).doc(String(openid)));
}
async function optionalProfile(reference) {
  try { return (await reference.get()).data || null; }
  catch (error) {
    if (/not.exist|not.found|does not exist|DATABASE_DOCUMENT_NOT_EXIST|不存在/i.test(String(error && (error.errMsg || error.message)))) return null;
    throw error;
  }
}

// 批量读取当前资料，专门用于把旧内容快照中的 UID 更新为后台当前设置的 UID。
async function profilesByOpenids(openids, resolveAvatars = true) {
  const result = {};
  const unique = [...new Set((openids || []).filter(Boolean))];
  const loaded = await Promise.all(unique.map(async openid => {
    const profile = await profileByOpenid(openid);
    return profile ? { openid, profile } : null;
  }));
  const available = loaded.filter(Boolean);
  if (!resolveAvatars) {
    available.forEach(item => { result[item.openid] = item.profile; });
    return result;
  }
  const resolved = await resolveSharedContentList(available.map(item => ({ avatar: item.profile.avatar || '' })));
  available.forEach((item, index) => { result[item.openid] = Object.assign({}, item.profile, publicProfile(item.profile), { avatar: resolved[index].avatar || item.profile.avatar || '' }); });
  return result;
}

async function createUid(openid) {
  if (!openid) throw new Error('INVALID_IDENTITY');
  // UID 集合由部署时创建，登录时直接使用。
  const ownerId = stableId('owner', openid);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? FIRST_USER_UID : String(crypto.randomInt(1000000, 10000000));
    if (await uidExists(candidate)) continue;
    const uid = await db.runTransaction(async transaction => {
      const ownerRef = transaction.collection(COLLECTIONS.uidClaims).doc(ownerId);
      const owner = await optionalDocument(ownerRef);
      if (owner) return owner.uid;
      const claimRef = transaction.collection(COLLECTIONS.uidClaims).doc(`uid_${candidate}`);
      if (await optionalDocument(claimRef)) return null;
      await claimRef.set({ data: { uid: candidate, ownerOpenid: openid, createdAt: now() } });
      await ownerRef.set({ data: { uid: candidate, ownerOpenid: openid, createdAt: now() } });
      return candidate;
    });
    if (uid) return uid;
  }
  throw new Error('UID_GENERATION_FAILED');
}

// UID 从旧版 6 位升级到 7 位时，同步更新资料快照，避免公开内容、申请单或聊天记录展示旧 UID。
async function syncUidReferences(openid, uid) {
  const tasks = [
    [COLLECTIONS.content, { ownerOpenid: openid }, { ownerUid: uid }],
    [COLLECTIONS.friendRequests, { fromOpenid: openid }, { fromUid: uid }],
    [COLLECTIONS.friendRequests, { toOpenid: openid }, { toUid: uid }],
    [COLLECTIONS.comments, { authorOpenid: openid }, { authorUid: uid }],
    [COLLECTIONS.messages, { senderOpenid: openid }, { senderUid: uid }]
  ];
  await Promise.all(tasks.map(([collection, where, update]) => db.collection(collection).where(where).update({ data: update }).catch(() => null)));
}

async function ownProfile(openid, providedProfile, completeProfile = false) {
  const reference = db.collection(COLLECTIONS.profiles).doc(openid);
  const existing = await optionalProfile(reference);
  if (providedProfile && Array.isArray(providedProfile.tags) && providedProfile.tags.some(item => Array.from(String(item || '').trim()).length > 10)) throw new Error('TAG_TOO_LONG');
  const clean = sanitizeProfile(providedProfile || {});
  if (completeProfile && (!existing || existing.profileCompleted === false) && (!clean.name || !clean.bio)) throw new Error('PROFILE_INCOMPLETE');
  if (!existing) {
    await checkSubmission(openid, [clean.name, clean.bio].concat(clean.tags || []), [clean.avatar], 1);
    // 不接受客户端上传的 UID，避免本地缓存或伪造参数抢占固定 UID。
    const profile = Object.assign({ openid, uid: await createUid(openid), createdAt: now(), profileOnboardingVersion: 1, profileCompleted: completeProfile }, clean, { updatedAt: now() });
    return db.runTransaction(async transaction => {
      const ref = transaction.collection(COLLECTIONS.profiles).doc(openid);
      const concurrent = await optionalDocument(ref);
      if (concurrent) return concurrent;
      await ref.set({ data: profile });
      return Object.assign({ _id: openid }, profile);
    });
  }
  const needsUidUpgrade = !validUid(existing.uid);
  if (providedProfile || needsUidUpgrade) {
    if (providedProfile) {
      const textChanged = clean.name !== safeText(existing.name, 20) || clean.bio !== safeText(existing.bio, 240) || JSON.stringify(clean.tags || []) !== JSON.stringify(existing.tags || []);
      const avatarChanged = clean.avatar !== safeText(existing.avatar, 500);
      await checkSubmission(openid, textChanged ? [clean.name, clean.bio].concat(clean.tags || []) : [], avatarChanged ? [clean.avatar] : [], 1);
    }
    const uid = needsUidUpgrade ? await createUid(openid) : existing.uid;
    // 不从客户端接收 uid；后台直接修改资料表中的 uid 后，此处会原样保留该值。
    const changes = Object.assign({}, providedProfile ? clean : {}, { openid, uid, updatedAt: now() });
    if (completeProfile) changes.profileCompleted = true;
    const profile = Object.assign({}, existing, changes);
    // get() 返回的数据含系统字段 _id；CloudBase 禁止在 set/update 的 data 中再次写入 _id。
    // 旧实现因此只能首次建档，之后所有简介编辑都会失败并继续显示“未命名用户”。
    delete profile._id;
    // 仅更新本次编辑的资料，保留并发修改的好友分组、排序和内容版本。
    await reference.update({ data: changes });
    // 每次资料同步都刷新旧快照。即使管理员刚在后台修改 UID，下一次启动也会同步旧内容、申请和聊天记录。
    await syncUidReferences(openid, uid);
    return Object.assign({ _id: openid }, profile);
  }
  return existing;
}

// 启动同步与主动编辑必须分开：新用户可用本机初始资料建档；已有用户启动时只读取云端，
// 否则另一台设备上的旧缓存会把刚编辑好的昵称、头像和简介覆盖回去。
async function bootstrapProfile(openid, providedProfile) {
  const existing = await profileByOpenid(openid);
  return { profile: existing || await ownProfile(openid, providedProfile || {}), isNewUser: !existing };
}

// 仅返回当前账号资料：不接收客户端资料，因而不会覆盖管理员在后台改过的 UID。
async function currentProfile(openid) {
  const profile = await profileByOpenid(openid);
  return ownPublicProfile(profile || await ownProfile(openid), openid);
}
function ownPublicProfile(profile, openid) {
  return Object.assign(publicProfile(profile), { cacheKey: crypto.createHash('sha256').update(String(openid)).digest('hex'), syncVersion: 2, profileCompleted: profile.profileCompleted !== false, profileOnboardingVersion: Number(profile.profileOnboardingVersion) || 0 });
}

async function profileByUid(uid) {
  if (!storedUid(uid)) return null;
  const result = await db.collection(COLLECTIONS.profiles).where({ uid: String(uid) }).limit(1).get();
  return result.data[0] || null;
}

async function findContent(openid, kind, id, ownerUid, recordId) {
  // 热榜会携带内容文档 ID。优先用它定位，既省去一次 UID 查询，也避免旧数据 UID 缺失时找不到详情。
  if (recordId) {
    const direct = await db.collection(COLLECTIONS.content).doc(String(recordId)).get().then(result => result.data).catch(() => null);
    if (direct && direct.kind === kind && String(direct.contentId) === String(id)) return Object.assign({ _id: String(recordId) }, direct);
  }
  const owner = ownerUid ? await profileByUid(ownerUid) : null;
  // 请求明确给出 UID 但查不到该用户时，不得退回到当前用户的内容，防止读取错对象。
  if (ownerUid && !owner) return null;
  const ownerOpenid = owner ? owner._id : openid;
  if (!ownerOpenid || CONTENT_KINDS.indexOf(kind) < 0 || !id) return null;
  const key = String(id);
  const numericKey = Number(key);
  // 兼容旧版用数字保存内容 ID 的记录，同时保留原本按 _id 选首条的规则。
  const contentId = Number.isSafeInteger(numericKey) && String(numericKey) === key ? _.in([key, numericKey]) : key;
  const result = await db.collection(COLLECTIONS.content)
    .where({ ownerOpenid, kind, contentId })
    .orderBy('_id', 'asc').limit(1).get();
  return result.data[0] || null;
}

async function ownerContentRecords(ownerOpenid, filters = {}) {
  const records = [];
  const where = Object.assign({}, filters, { ownerOpenid });
  for (let skip = 0; ; skip += 100) {
    const page = await db.collection(COLLECTIONS.content).where(where).orderBy('_id', 'asc').skip(skip).limit(100).get();
    records.push(...page.data);
    if (page.data.length < 100) break;
  }
  return { data: records };
}
async function friendship(openid, targetOpenid) {
  if (!targetOpenid || openid === targetOpenid) return null;
  const result = await db.collection(COLLECTIONS.friendships).where({ pairKey: pairKey(openid, targetOpenid) }).limit(1).get();
  return result.data[0] || null;
}

async function ensureFriend(openid, targetOpenid) {
  const relation = await friendship(openid, targetOpenid);
  if (!relation) throw new Error('FORBIDDEN');
  return relation;
}

function exposeContent(record, ownerProfile) {
  return Object.assign({}, record.payload || {}, {
    recordId: record._id || '',
    id: record.contentId,
    kind: record.kind,
    // 每次输出以资料表中的 UID 为准，后台改 UID 后旧内容不再显示历史快照。
    ownerUid: ownerProfile ? ownerProfile.uid : record.ownerUid,
    // 昵称和头像始终从当前简介读取，历史内容不会停留在发布时的资料快照。
    ownerName: ownerProfile ? (ownerProfile.name || '未命名用户') : (record.ownerName || '未命名用户'),
    ownerAvatar: ownerProfile ? (ownerProfile.avatar || '') : (record.ownerAvatar || ''),
    // 兼容旧版驳回记录：曾保留“公开”字段的作品也应显示为仅自己可见。
    visibility: record.kind === 'work' && record.reviewStatus === 'rejected' && record.visibility === 'public' ? 'self' : record.visibility,
    status: record.status,
    reviewStatus: record.kind === 'work' && record.reviewStatus === 'rejected' ? 'rejected' : workNeedsReview(record) ? 'pending' : 'approved',
    views: metric(record.views),
    likes: metric(record.likes),
    comments: metric(record.commentCount),
    publishedAt: Number(record.publishedAt) || 0,
    updatedAt: Number(record.updatedAt) || 0
  });
}

// 云存储文件 ID 在发布者设备上可直接预览，但其他用户受存储权限和客户端版本影响可能无法渲染。
// 详情、榜单和好友足迹返回前统一换成短期 HTTPS 地址；作品同时保留原 filePath 供 downloadFile 使用。
async function resolveSharedContentList(inputs) {
  const items = (inputs || []).map(input => Object.assign({}, input || {}));
  const candidates = items.flatMap(item => [item.image, item.avatar, item.cover, item.filePath, ...(Array.isArray(item.images) ? item.images : [])]);
  const fileIds = [...new Set(candidates.filter(value => /^cloud:\/\//i.test(String(value || ''))))];
  if (!fileIds.length) return items;
  const urls = {};
  // 每批独立处理，单批失败不会拖累后面的相册封面或头像。
  for (let index = 0; index < fileIds.length; index += 50) {
    try {
      const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) });
      (result.fileList || []).forEach(file => { if (file && file.fileID && file.tempFileURL) urls[file.fileID] = file.tempFileURL; });
    } catch { /* 保留该批原始地址。 */ }
  }
  items.forEach(item => {
    if (urls[item.image]) item.image = urls[item.image];
    if (urls[item.avatar]) item.avatar = urls[item.avatar];
    if (urls[item.cover]) item.cover = urls[item.cover];
    if (item.filePath) item.fileUrl = urls[item.filePath] || item.filePath;
    if (Array.isArray(item.images)) item.images = item.images.map(path => urls[path] || path);
  });
  return items;
}

async function resolveSharedContentFiles(input) {
  return (await resolveSharedContentList([input]))[0];
}

async function resolveProfileFile(profile) {
  const base = publicProfile(profile);
  if (!base.avatar) return base;
  const resolved = await resolveSharedContentFiles({ avatar: base.avatar });
  return Object.assign({}, base, { avatar: resolved.avatar || base.avatar });
}

// 热度公式：浏览 ×1 + 点赞 ×10 + 评论 ×5。
function heat(record) { return metric(record.views) + metric(record.likes) * 10 + metric(record.commentCount) * 5; }

async function canReadContent(openid, record) {
  if (!record) return false;
  if (record.ownerOpenid === openid) return true;
  if (!isPublished(record)) return false;
  if (record.visibility === 'public') return true;
  return record.visibility === 'friends' && !!(await friendship(openid, record.ownerOpenid));
}

async function upsertContent(openid, payload, namingAttempt = 0) {
  const kind = payload.kind;
  if (CONTENT_KINDS.indexOf(kind) < 0) throw new Error('INVALID_KIND');
  const profile = await ownProfile(openid);
  const item = sanitizeContent(kind, payload.item || {});
  if (kind === 'album' && !safeText((payload.item || {}).name, 60)) throw new Error('ALBUM_NAME_REQUIRED');
  if (!item.id) throw new Error('INVALID_CONTENT_ID');
  if (kind === 'activity') {
    const result = await contentManager.manage(openid, { operation: 'saveActivity', item: Object.assign({}, payload.item, item) });
    return result.upserts.find(entry => entry.kind === 'activity').item;
  }
  // 文件大小必须由云端再校验一次，避免绕过编辑页直接提交超大作品。
  const mediaLimit = mediaFiles.fileLimit(kind, item);
  const mediaSizeError = mediaLimit === mediaFiles.MAX_IMAGE_BYTES ? 'IMAGE_FILE_TOO_LARGE' : mediaLimit === mediaFiles.MAX_VIDEO_BYTES ? 'VIDEO_FILE_TOO_LARGE' : 'MEDIA_FILE_TOO_LARGE';
  if (['work', 'photo'].indexOf(kind) >= 0 && item.fileSize > mediaLimit) throw new Error(mediaSizeError);
  const old = await findContent(openid, kind, item.id);
  const previousAssets = old ? contentImageValues(kind, old.payload).concat(kind === 'work' ? [old.payload.filePath] : []) : [];
  const assets = contentImageValues(kind, item).concat(kind === 'work' ? [item.filePath] : []);
  for (const value of assets.filter(Boolean)) {
    if (/^cloud:\/\//i.test(value)) continue;
    if (previousAssets.includes(value) && /^https:\/\//i.test(value)) { trustedImageUrl(value); continue; }
    throw new Error('UNTRUSTED_MEDIA_SOURCE');
  }
  let namingRevision;
  if (kind === 'photo' && item.folderId) {
    const folder = await findContent(openid, 'album', item.folderId);
    if (!folder) throw new Error('ALBUM_NOT_FOUND');
    if (['campId', 'stageId', 'subcampId', 'activityName'].some(field => String(folder.payload[field] || '') !== String(item[field] || ''))) throw new Error('ALBUM_CONTEXT_MISMATCH');
    if (item.nameAutoGenerated || !item.name) {
      const previous = old && old.payload;
      const alreadyNamed = previous && previous.nameAutoGenerated && previous.albumSequence > 0 && previous.folderId === item.folderId;
      const records = alreadyNamed ? [] : (await ownerContentRecords(openid, { kind: 'photo', 'payload.folderId': item.folderId })).data;
      require('./photo-names').assignPhotoName(item, folder.payload, records, previous);
      if (!alreadyNamed) namingRevision = Number(profile.contentRevision) || 0;
    }
  }
  const oldItem = old && old.payload || {};
  if (kind === 'work' || kind === 'photo') {
    const path = kind === 'work' ? item.filePath : item.image;
    const previousPath = kind === 'work' ? oldItem.filePath : oldItem.image;
    if (/^cloud:\/\//i.test(path || '') && (path !== previousPath || !oldItem.fileSize)) item.fileSize = await mediaFiles.storedFileSize(cloud, path);
    else if (path === previousPath && oldItem.fileSize) item.fileSize = oldItem.fileSize;
    if (item.fileSize > mediaLimit) throw new Error(mediaSizeError);
  }
  for (const path of [...new Set(contentImageValues(kind, item))]) {
    if (/^cloud:\/\//i.test(path || '') && (kind !== 'photo' || path !== item.image) && !(old && contentImageValues(kind, oldItem).includes(path))) {
      if (await mediaFiles.storedFileSize(cloud, path) > mediaFiles.MAX_IMAGE_BYTES) throw new Error('IMAGE_FILE_TOO_LARGE');
    }
  }
  const textChanged = !old || JSON.stringify(contentTextValues(kind, oldItem)) !== JSON.stringify(contentTextValues(kind, item));
  const needsAttachmentCheck = kind === 'work' && item.filePath && mediaFiles.isImage(item) && (!old || old.reviewStatus !== 'approved');
  const rejectedResubmission = kind === 'work' && old && old.reviewStatus === 'rejected' && item.visibility === 'public';
  const unchanged = !rejectedResubmission && !needsAttachmentCheck && old && JSON.stringify(sanitizeContent(kind, oldItem)) === JSON.stringify(item);
  if (old && payload.item.updatedAt && Number(payload.item.updatedAt) !== Number(old.updatedAt) && !unchanged) throw new Error('CONTENT_CONFLICT');
  if (unchanged) return exposeContent(old, profile);
  const previousImages = contentImageValues(kind, oldItem);
  const changedImages = contentImageValues(kind, item).filter(path => path && (previousImages.indexOf(path) < 0 || needsAttachmentCheck && path === item.filePath));
  await checkSubmission(openid, textChanged ? contentTextValues(kind, item) : [], changedImages, 3);
  let reviewStatus = 'approved';
  if (kind === 'work' && item.filePath && !mediaFiles.isImage(item)) {
    const alreadyApproved = old && old.visibility === 'public' && old.status === 'published' &&
      old.reviewStatus === 'approved' && oldItem.filePath === item.filePath && !mediaFiles.isImage(oldItem);
    if (item.visibility !== 'public' || item.status === 'draft') reviewStatus = 'not_required';
    else if (!alreadyApproved) reviewStatus = 'pending';
  }
  const record = {
    ownerOpenid: openid,
    ownerUid: profile.uid,
    ownerName: profile.name || '未命名用户',
    ownerAvatar: profile.avatar || '',
    reviewStatus,
    kind,
    contentId: item.id,
    visibility: item.visibility,
    status: item.status,
    payload: item,
    updatedAt: now(),
    createdAt: old ? old.createdAt : now(),
    // “最新”按首次发布的时间，而非互动热度或后来编辑的时间排列。
    publishedAt: item.status === 'published' && reviewStatus !== 'pending' ? (Number(old && old.publishedAt) || now()) : Number(old && old.publishedAt) || 0,
    views: old ? metric(old.views) : 0,
    likes: old ? metric(old.likes) : 0,
    commentCount: old ? metric(old.commentCount) : 0
  };
  try { await contentManager.commit(openid, [{ old, record }], [], namingRevision); }
  catch (error) {
    if (namingRevision != null && error.message === 'CONTENT_CONFLICT' && namingAttempt < 2) return upsertContent(openid, payload, namingAttempt + 1);
    throw error;
  }
  return exposeContent(record, profile);
}

async function removeContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id);
  if (!record) return { deleted: true };
  if (record.ownerOpenid !== openid) throw new Error('FORBIDDEN');
  if (record.kind === 'activity' || record.kind === 'album') {
    const result = await contentManager.manage(openid, { operation: record.kind === 'album' ? 'deleteAlbum' : 'deleteActivity', kind: record.kind, id: record.contentId });
    return { deleted: true, upserts: result.upserts, removed: result.deleted };
  }
  // 旧版并发上传可能留下相同逻辑ID的多份文档；删除时一起处理，避免旧副本再次出现。
  const duplicates = (await ownerContentRecords(openid)).data.filter(item => item.kind === record.kind && item.contentId === record.contentId);
  await contentManager.commit(openid, [], duplicates.map(old => ({ old })));
  for (const removed of duplicates) {
    await db.collection(COLLECTIONS.likes).where({ contentRef: removed._id }).remove();
    await db.collection(COLLECTIONS.comments).where({ contentRef: removed._id }).remove();
  }
  return { deleted: true };
}

async function viewContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const legacy = (await db.collection(COLLECTIONS.views).where({ contentRef: record._id, viewerOpenid: openid }).limit(100).get()).data;
  const result = await db.runTransaction(async transaction => {
    const contentRef = transaction.collection(COLLECTIONS.content).doc(record._id);
    const current = await optionalDocument(contentRef);
    if (!current || current.ownerOpenid !== openid && (!isPublished(current) || current.visibility !== record.visibility)) throw new Error('FORBIDDEN');
    const ref = transaction.collection(COLLECTIONS.views).doc(stableId('view', record._id, openid));
    const previous = await optionalDocument(ref);
    const last = Math.max(Number(previous && previous.lastViewedAt) || 0, ...legacy.map(item => Number(item.lastViewedAt) || 0));
    if (now() - last < 5 * 60 * 1000) return { views: metric(current.views), counted: false };
    await ref.set({ data: { contentRef: record._id, viewerOpenid: openid, lastViewedAt: now() } });
    await contentRef.update({ data: { views: _.inc(1) } });
    return { views: metric(current.views) + 1, counted: true };
  });
  if (record.ownerOpenid !== openid) await markDailyTask(openid, 'view');
  return result;
}

async function getContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const [likedResult, owner] = await Promise.all([
    db.collection(COLLECTIONS.likes).where({ contentRef: record._id, actorOpenid: openid }).limit(1).get(),
    profileByOpenid(record.ownerOpenid)
  ]);
  const liked = likedResult.data.find(item => item.actorOpenid === openid);
  // 编辑权由云端按 OPENID 判定，不能只依赖前端传来的 UID。
  const item = exposeContent(record, owner);
  // 公开内容可通过 recordId 定位；作者选择隐蔽 UID 时，客户端不会收到可展示的 UID。
  if (item.hideUid) item.ownerUid = '';
  return { item: await resolveSharedContentFiles(Object.assign(item, { favorite: !!liked, canEdit: record.ownerOpenid === openid })) };
}

async function likeContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const legacy = await queryWhereAll(COLLECTIONS.likes, { contentRef: record._id, actorOpenid: openid });
  const result = await db.runTransaction(async transaction => {
    const contentRef = transaction.collection(COLLECTIONS.content).doc(record._id);
    const current = await optionalDocument(contentRef);
    if (!current || current.ownerOpenid !== openid && (!isPublished(current) || current.visibility !== record.visibility)) throw new Error('FORBIDDEN');
    const canonicalId = stableId('like', record._id, openid);
    const ids = [...new Set([canonicalId, ...legacy.map(item => item._id)])];
    const existing = [];
    for (const id of ids) { const item = await optionalDocument(transaction.collection(COLLECTIONS.likes).doc(id)); if (item) existing.push(id); }
    const favorite = typeof payload.favorite === 'boolean' ? payload.favorite : existing.length === 0;
    for (const id of existing) await transaction.collection(COLLECTIONS.likes).doc(id).remove();
    if (favorite) await transaction.collection(COLLECTIONS.likes).doc(canonicalId).set({ data: { contentRef: record._id, actorOpenid: openid, createdAt: now() } });
    const likes = Math.max(0, metric(current.likes) + (favorite ? 1 : 0) - existing.length);
    await contentRef.update({ data: { likes } });
    return { favorite, likes };
  });
  if (result.favorite && record.ownerOpenid !== openid) await markDailyTask(openid, 'like');
  return result;
}

async function loadPublicContents() {
  const all = [];
  const batchSize = 100;
  for (let skip = 0; ; skip += batchSize) {
    const result = await db.collection(COLLECTIONS.content).where({ visibility: 'public' }).orderBy('_id', 'asc').skip(skip).limit(batchSize).get();
    all.push(...result.data.filter(item => item.status === 'published' && isPublished(item)));
    if (result.data.length < batchSize) break;
  }
  // 旧内容没有 commentCount 字段；读取榜单时用评论表补齐，保证新热度公式立即对历史内容生效。
  if (all.some(item => item.commentCount == null)) {
    const comments = [];
    for (let skip = 0; ; skip += 100) {
      const result = await db.collection(COLLECTIONS.comments).orderBy('_id', 'asc').skip(skip).limit(100).get();
      comments.push(...result.data);
      if (result.data.length < 100) break;
    }
    const counts = {};
    comments.forEach(item => { counts[item.contentRef] = (counts[item.contentRef] || 0) + 1; });
    all.forEach(item => { item.commentCount = Math.max(metric(item.commentCount), counts[item._id] || 0); });
  }
  return all;
}

async function publicList(payload = {}) {
  const result = await loadPublicContents();
  const range = payload.range || 'latest';
  const years = payload.includeYears ? publicYearsFromRecords(result) : null;
  const requestedYear = Number(payload.year) || 0;
  const selectedYear = years && !years.includes(requestedYear) ? years[0] : requestedYear || chinaDate().getUTCFullYear();
  const selectedMonth = Number(payload.month) || chinaDate().getUTCMonth() + 1;
  const campId = safeText(payload.campId, 40);
  const kind = ['photo', 'growth', 'work'].indexOf(payload.kind) >= 0 ? payload.kind : '';
  const keyword = safeText(payload.keyword, 60).toLocaleLowerCase();
  const page = Math.max(1, Number(payload.page) || 1);
  const pageSize = 20;
  const currentWeek = weekKey();
  const dateParts = value => { const match = String(value || '').match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/); return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : { year: 0, month: 0, day: 0 }; };
  const ranked = result.filter(item => ['photo', 'growth', 'work'].indexOf(item.kind) >= 0 && (!kind || item.kind === kind)).filter(item => {
    const date = dateParts(contentDateKey(item));
    if (range === 'week') return weekKey(item.publishedAt || item.createdAt) === currentWeek && (!campId || (item.payload && item.payload.campId) === campId);
    if (range === 'month') return date.year === selectedYear && date.month === selectedMonth && (!campId || (item.payload && item.payload.campId) === campId);
    if (range === 'year') return date.year === selectedYear && (!campId || (item.payload && item.payload.campId) === campId);
    return !campId || (item.payload && item.payload.campId) === campId;
  }).filter(item => {
    if (!keyword) return true;
    const content = item.payload || {};
    // 公开图片始终展示图片名；相册卡片的名称开关不影响公开榜单搜索。
    const searchable = [item.kind === 'photo' || content.showName === true ? content.name : '', content.title, content.body, content.fileName, content.location, content.activityName, content.campId, ...(Array.isArray(content.tags) ? content.tags : [])].join(' ').toLocaleLowerCase();
    return searchable.indexOf(keyword) >= 0;
  }).sort((a, b) => range === 'latest'
    ? (Number(b.publishedAt) || Number(b.updatedAt) || 0) - (Number(a.publishedAt) || Number(a.updatedAt) || 0)
    : compareRankings(a, b));
  const start = (page - 1) * pageSize;
  const pageRecords = ranked.slice(start, start + pageSize);
  const owners = await profilesByOpenids(pageRecords.map(item => item.ownerOpenid));
  const items = pageRecords.map((item, index) => {
    const exposed = exposeContent(item, owners[item.ownerOpenid]);
    const payloadItem = item.payload || {};
    const title = item.kind === 'photo' ? (payloadItem.name || payloadItem.title || '未命名图片') : (payloadItem.title || (item.kind === 'growth' ? '未命名记录' : '未命名作品'));
    const summary = item.kind === 'photo' ? (payloadItem.hideUid || !exposed.ownerUid ? '' : `UID：${exposed.ownerUid}`) : (payloadItem.body || payloadItem.fileName || '一段成长记忆');
    const image = item.kind === 'photo' ? payloadItem.image : item.kind === 'growth' ? (payloadItem.image || (payloadItem.images || [])[0] || '') : payloadItem.cover || '';
    // 榜单详情统一用 recordId 打开，因此隐蔽 UID 不影响详情、浏览、点赞或评论。
    if (payloadItem.hideUid) exposed.ownerUid = '';
    return Object.assign(exposed, { title, summary, image, rank: start + index + 1, heat: heat(item), kindLabel: item.kind === 'photo' ? '相册' : item.kind === 'growth' ? '记录' : '作品' });
  });
  const response = { items: await resolveSharedContentList(items), page, pageSize, total: ranked.length, hasNext: start + pageSize < ranked.length };
  if (years) Object.assign(response, { years, selectedYear });
  return response;
}

function publicYearsFromRecords(records) {
  const years = new Set([chinaDate().getUTCFullYear()]);
  records.forEach(item => { const match = contentDateKey(item).match(/^(\d{4})/); if (match) years.add(Number(match[1])); });
  return [...years].sort((a, b) => b - a);
}

async function publicYears() { return { years: publicYearsFromRecords(await loadPublicContents()) }; }

// 同一用户更换手机或清理本地缓存后，用云端状态恢复“足迹”“好友”“我的”中的私人内容。
async function ownState(openid) {
  const profile = await ownProfile(openid);
  const result = await ownerContentRecords(openid);
  const state = { profile: ownPublicProfile(profile, openid), photos: [], growth: [], works: [], companions: [], activities: [], albums: [] };
  result.data.forEach(record => {
    const item = exposeContent(record, profile);
    if (record.kind === 'photo') state.photos.push(item);
    else if (record.kind === 'growth') state.growth.push(item);
    else if (record.kind === 'work') state.works.push(item);
    else if (record.kind === 'companion') state.companions.push(item);
    else if (record.kind === 'activity') state.activities.push(item);
    else if (record.kind === 'album') state.albums.push(item);
  });
  return state;
}
// 作品页面单独刷新自己的作品，避免为审核状态下载整个相册等数据。
async function ownWorks(openid) {
  const profile = await profileByOpenid(openid);
  if (!profile) throw new Error('PROFILE_REQUIRED');
  const result = await ownerContentRecords(openid, { kind: 'work' });
  return { works: result.data.map(record => exposeContent(record, profile)), cacheKey: ownPublicProfile(profile, openid).cacheKey };
}

async function saveComment(openid, payload) {
  const input = payload.comment || {};
  const record = await findContent(openid, input.targetType, input.targetId, input.ownerUid, input.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const profile = await ownProfile(openid);
  const body = safeText(input.body, 240);
  if (!body) throw new Error('EMPTY_COMMENT');
  await checkTextSafety(openid, [body], 2);
  const parentId = safeText(input.parentId, 80);
  const parent = parentId ? await db.collection(COLLECTIONS.comments).doc(parentId).get().then(result => result.data).catch(() => null) : null;
  // 回复必须指向同一条内容下的既有评论，前端伪造其他内容的评论 ID 不会生效。
  if (parentId && (!parent || parent.contentRef !== record._id)) throw new Error('INVALID_REPLY');
  const data = { contentRef: record._id, targetType: record.kind, targetId: record.contentId, ownerOpenid: record.ownerOpenid, authorOpenid: openid, authorUid: profile.uid, author: profile.name || '我', authorAvatar: profile.avatar || '', authorAvatarScale: profile.avatarScale || 1.3, authorAvatarOffsetX: profile.avatarOffsetX || 0, authorAvatarOffsetY: profile.avatarOffsetY || 0, parentId: parent ? parent._id : '', replyToOpenid: parent ? parent.authorOpenid || '' : '', replyToName: parent ? parent.author || '我' : '', replyToUid: parent ? parent.authorUid || '' : '', body, date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), createdAt: now(), likes: 0 };
  // 本地详情页会生成 clientId；沿用它作为云端文档 ID，后续“回复”可在本地和云端稳定对应。
  const clientId = safeText(input.id, 80);
  if (clientId) {
    return await db.runTransaction(async transaction => {
      const reference = transaction.collection(COLLECTIONS.comments).doc(clientId);
      const existing = await reference.get().then(result => result.data).catch(error => {
        if (/not.exist|not.found|does not exist|DATABASE_DOCUMENT_NOT_EXIST|不存在/i.test(String(error && (error.errMsg || error.message)))) return null;
        throw error;
      });
      if (existing) {
        if (existing.authorOpenid !== openid || existing.contentRef !== record._id) throw new Error('FORBIDDEN');
        if (existing.body !== body || (existing.parentId || '') !== parentId) throw new Error('CONTENT_CONFLICT');
        return Object.assign({ id: clientId }, existing);
      }
      await reference.set({ data });
      await transaction.collection(COLLECTIONS.content).doc(record._id).update({ data: { commentCount: _.inc(1) } });
      return Object.assign({ id: clientId }, data);
    });
  }
  const added = await db.collection(COLLECTIONS.comments).add({ data });
  await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { commentCount: _.inc(1) } });
  return Object.assign({ id: added._id }, data);
}

async function listComments(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const result = { data: await queryWhereAll(COLLECTIONS.comments, { contentRef: record._id }) };
  result.data.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const ids = new Set(result.data.map(item => item._id));
  const [likes, authors] = await Promise.all([
    ids.size ? queryWhereAll(COLLECTIONS.likes, { actorOpenid: openid }) : [],
    profilesByOpenids(result.data.flatMap(item => [item.authorOpenid, item.replyToOpenid]))
  ]);
  const favoriteIds = new Set(likes.map(item => item.commentRef).filter(id => ids.has(id)));
  // 兼容早期只保存 UID、尚未保存 authorOpenid 的评论，避免旧评论永久停留在“未命名用户”。
  const legacyUids = [...new Set(result.data.flatMap(item => [
    authors[item.authorOpenid] ? '' : item.authorUid,
    authors[item.replyToOpenid] ? '' : item.replyToUid
  ]).filter(Boolean))];
  const legacyProfiles = {};
  const loadedLegacy = (await Promise.all(legacyUids.map(async uid => {
    const profile = await profileByUid(uid);
    return profile ? { uid, profile } : null;
  }))).filter(Boolean);
  const resolvedLegacy = await resolveSharedContentList(loadedLegacy.map(item => ({ avatar: item.profile.avatar || '' })));
  loadedLegacy.forEach((item, index) => { legacyProfiles[item.uid] = Object.assign({}, item.profile, publicProfile(item.profile), { avatar: resolvedLegacy[index].avatar || item.profile.avatar || '' }); });
  return { comments: result.data.map(item => {
    const author = authors[item.authorOpenid] || legacyProfiles[item.authorUid];
    const replyTo = authors[item.replyToOpenid] || legacyProfiles[item.replyToUid];
    return Object.assign({ id: item._id, authorInitial: (item.author || '我').slice(0, 1), favorite: favoriteIds.has(item._id), likes: metric(item.likes), isMine: item.authorOpenid === openid }, item, {
      authorUid: author ? author.uid : item.authorUid,
      author: author ? (author.name || '未命名用户') : (item.author || '未命名用户'),
      authorAvatar: author ? (author.avatar || '') : (item.authorAvatar || ''),
      authorAvatarScale: author ? (author.avatarScale || 1.3) : (item.authorAvatarScale || 1.3),
      authorAvatarOffsetX: author ? (author.avatarOffsetX || 0) : (item.authorAvatarOffsetX || 0),
      authorAvatarOffsetY: author ? (author.avatarOffsetY || 0) : (item.authorAvatarOffsetY || 0),
      authorInitial: (author ? (author.name || '未') : (item.author || '未')).slice(0, 1),
      replyToUid: replyTo ? replyTo.uid : (item.replyToUid || ''),
      replyToName: replyTo ? (replyTo.name || '未命名用户') : (item.replyToName || '')
    });
  }) };
}

async function likeComment(openid, payload) {
  const comment = await optionalDocument(db.collection(COLLECTIONS.comments).doc(payload.id));
  if (!comment) throw new Error('COMMENT_NOT_FOUND');
  const content = await optionalDocument(db.collection(COLLECTIONS.content).doc(comment.contentRef));
  if (!(await canReadContent(openid, content))) throw new Error('FORBIDDEN');
  const legacy = await queryWhereAll(COLLECTIONS.likes, { commentRef: comment._id, actorOpenid: openid });
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.comments).doc(comment._id);
    const current = await optionalDocument(ref);
    const currentContent = await optionalDocument(transaction.collection(COLLECTIONS.content).doc(comment.contentRef));
    if (!current || !currentContent || currentContent.ownerOpenid !== openid && (!isPublished(currentContent) || currentContent.visibility !== content.visibility)) throw new Error('FORBIDDEN');
    const canonicalId = stableId('comment_like', comment._id, openid);
    const ids = [...new Set([canonicalId, ...legacy.map(item => item._id)])];
    const existing = [];
    for (const id of ids) if (await optionalDocument(transaction.collection(COLLECTIONS.likes).doc(id))) existing.push(id);
    const favorite = typeof payload.favorite === 'boolean' ? payload.favorite : existing.length === 0;
    for (const id of existing) await transaction.collection(COLLECTIONS.likes).doc(id).remove();
    if (favorite) await transaction.collection(COLLECTIONS.likes).doc(canonicalId).set({ data: { commentRef: comment._id, actorOpenid: openid, createdAt: now() } });
    const likes = Math.max(0, metric(current.likes) + (favorite ? 1 : 0) - existing.length);
    await ref.update({ data: { likes } });
    return { favorite, likes };
  });
}

// 收藏页以 hui_likes 为唯一事实来源：内容点赞使用 contentRef，评论点赞使用 commentRef。
// 因此跨设备、给他人公开内容点赞后，也能在“我的收藏”中恢复。
async function favoriteList(openid, payload = {}) {
  const type = ['photo', 'growth', 'comment'].indexOf(payload.type) >= 0 ? payload.type : 'photo';
  // 本地排序可避免首次部署还要额外创建复合索引；收藏量达到分页规模后再扩展游标接口。
  const result = { data: await queryWhereAll(COLLECTIONS.likes, { actorOpenid: openid }) };
  const likes = result.data.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

  if (type === 'comment') {
    const commentLikes = likes.filter(item => item.commentRef);
    const loaded = (await Promise.all(commentLikes.map(async like => {
      const comment = await db.collection(COLLECTIONS.comments).doc(like.commentRef).get().then(value => value.data).catch(() => null);
      const content = comment ? await db.collection(COLLECTIONS.content).doc(comment.contentRef).get().then(value => value.data).catch(() => null) : null;
      return comment && content && await canReadContent(openid, content) ? { like, comment, content } : null;
    }))).filter(Boolean);
    const authors = await profilesByOpenids(loaded.map(item => item.comment.authorOpenid));
    const owners = await profilesByOpenids(loaded.map(item => item.content.ownerOpenid));
    return { items: loaded.map(({ like, comment, content }) => {
      const contentPayload = content.payload || {};
      const author = authors[comment.authorOpenid];
      const owner = owners[content.ownerOpenid];
      const targetTitle = content.kind === 'photo'
        ? (contentPayload.showName === true && contentPayload.name ? contentPayload.name : '相册中的一段记忆')
        : (contentPayload.title || (content.kind === 'growth' ? '未命名记录' : '未命名作品'));
      return {
        id: comment._id,
        kind: 'comment',
        body: comment.body || '',
        date: comment.date || '',
        author: author ? author.name : (comment.author || '未命名用户'),
        authorAvatar: author ? author.avatar : (comment.authorAvatar || ''),
        title: `评论 · ${targetTitle}`,
        targetTitle,
        targetType: content.kind,
        targetId: content.contentId,
        targetRecordId: content._id,
        targetOwnerUid: contentPayload.hideUid ? '' : (owner ? owner.uid : content.ownerUid),
        campId: contentPayload.campId || '',
        likedAt: Number(like.createdAt) || 0,
        favorite: true,
        remote: true
      };
    }) };
  }

  const allowedKinds = type === 'photo' ? ['photo'] : ['growth', 'work'];
  const contentLikes = likes.filter(item => item.contentRef);
  const loaded = (await Promise.all(contentLikes.map(async like => {
    const content = await db.collection(COLLECTIONS.content).doc(like.contentRef).get().then(value => value.data).catch(() => null);
    return content && allowedKinds.indexOf(content.kind) >= 0 && await canReadContent(openid, content) ? { like, content } : null;
  }))).filter(Boolean);
  const owners = await profilesByOpenids(loaded.map(item => item.content.ownerOpenid));
  const items = loaded.map(({ like, content }) => {
    const item = exposeContent(content, owners[content.ownerOpenid]);
    if (item.hideUid) item.ownerUid = '';
    const title = content.kind === 'photo'
      ? (item.showName === true && item.name ? item.name : '相册中的一段记忆')
      : (item.title || (content.kind === 'growth' ? '未命名记录' : '未命名作品'));
    return Object.assign(item, {
      title,
      contentLabel: content.kind === 'photo' ? '相册' : content.kind === 'growth' ? '记录' : '作品',
      likedAt: Number(like.createdAt) || 0,
      favorite: true,
      remote: true
    });
  });
  return { items: await resolveSharedContentList(items) };
}

async function removeCommentsForTarget(openid, payload) {
  const record = await findContent(openid, payload.targetType, payload.targetId);
  if (!record || record.ownerOpenid !== openid) throw new Error('FORBIDDEN');
  await db.collection(COLLECTIONS.comments).where({ contentRef: record._id }).remove();
  await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { commentCount: 0 } }).catch(() => null);
  return { deleted: true };
}

// 内容发布者可以管理自己内容下的单条评论。删除主评论时，连同其下全部层级回复和点赞一起清理。
async function removeComment(openid, payload) {
  const id = safeText(payload.id, 80);
  const comment = id ? await db.collection(COLLECTIONS.comments).doc(id).get().then(result => result.data).catch(() => null) : null;
  if (!comment) throw new Error('COMMENT_NOT_FOUND');
  const content = await db.collection(COLLECTIONS.content).doc(comment.contentRef).get().then(result => result.data).catch(() => null);
  if (!content || content.ownerOpenid !== openid) throw new Error('COMMENT_DELETE_FORBIDDEN');

  const removedIds = [];
  const queuedIds = [comment._id];
  const seenIds = {};
  while (queuedIds.length) {
    const commentId = queuedIds.shift();
    if (!commentId || seenIds[commentId]) continue;
    seenIds[commentId] = true;
    removedIds.push(commentId);
    const children = { data: await queryWhereAll(COLLECTIONS.comments, { parentId: commentId }) };
    children.data.forEach(child => queuedIds.push(child._id));
  }

  for (const commentId of removedIds) {
    await db.collection(COLLECTIONS.likes).where({ commentRef: commentId }).remove().catch(() => null);
    await db.collection(COLLECTIONS.comments).doc(commentId).remove().catch(() => null);
  }
  await db.collection(COLLECTIONS.content).doc(content._id).update({
    data: { commentCount: Math.max(0, metric(content.commentCount) - removedIds.length) }
  }).catch(() => null);
  return { deleted: true, ids: removedIds };
}

// 举报记录到独立集合，供运营人员在云开发后台处理。
// 不把举报写到内容本身，避免举报次数反向暴露给普通用户。
async function saveReport(openid, payload) {
  const reason = safeText(payload.reason, 200) || '未填写原因';
  if (payload.type === 'comment') {
    const comment = await db.collection(COLLECTIONS.comments).doc(String(payload.id || '')).get().then(result => result.data).catch(() => null);
    const content = comment ? await db.collection(COLLECTIONS.content).doc(comment.contentRef).get().then(result => result.data).catch(() => null) : null;
    if (!comment || !(await canReadContent(openid, content))) throw new Error('COMMENT_NOT_FOUND');
    const exists = await db.collection(COLLECTIONS.reports).where({ reporterOpenid: openid }).limit(100).get();
    if (exists.data.some(item => item.commentRef === comment._id && item.status === 'pending')) throw new Error('REPORT_EXISTS');
    await db.collection(COLLECTIONS.reports).add({ data: { type: 'comment', reporterOpenid: openid, commentRef: comment._id, contentRef: content._id, reportedOpenid: comment.authorOpenid, reason, status: 'pending', createdAt: now() } });
    return { reported: true };
  }
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  if (record.ownerOpenid === openid) throw new Error('CANNOT_REPORT_SELF');
  const exists = await db.collection(COLLECTIONS.reports).where({ reporterOpenid: openid }).limit(100).get();
  if (exists.data.some(item => item.contentRef === record._id && item.status === 'pending')) throw new Error('REPORT_EXISTS');
  await db.collection(COLLECTIONS.reports).add({ data: { type: 'content', reporterOpenid: openid, contentRef: record._id, contentKind: record.kind, contentId: record.contentId, reportedOpenid: record.ownerOpenid, reason, status: 'pending', createdAt: now() } });
  return { reported: true };
}

// 注销/数据删除先生成可追踪工单，避免用户误触后立刻执行不可恢复的级联删除。
// 开发者核验身份并按隐私指引处理后，再在后台把状态改为 resolved。
async function requestAccountDeletion(openid, payload = {}) {
  const profile = await ownProfile(openid);
  const id = `account_delete_${openid}`;
  const reference = db.collection(COLLECTIONS.reports).doc(id);
  const existing = await reference.get().then(result => result.data).catch(() => null);
  if (existing && existing.status === 'pending') return { requested: true, repeated: true, requestedAt: existing.createdAt || 0 };
  const createdAt = now();
  await reference.set({ data: { type: 'account_deletion_request', reporterOpenid: openid, reporterUid: profile.uid, reason: safeText(payload.reason, 200) || '用户从设置页申请注销账号并删除相关个人数据', status: 'pending', createdAt, updatedAt: createdAt } });
  return { requested: true, requestedAt: createdAt };
}

function emptyItemCounts() { return { heart: 0, star: 0, envelope: 0, gift_box: 0, memory_book: 0, mooncake: 0, red_packet: 0 }; }

function rollGiftAffection(item, quantity) {
  const fixed = Math.max(0, Number(item.affection) || 0);
  const min = Math.max(0, Number(item.affectionMin) || fixed);
  const max = Math.max(min, Number(item.affectionMax) || min);
  const rolls = [];
  for (let index = 0; index < quantity; index += 1) rolls.push(min + Math.floor(Math.random() * (max - min + 1)));
  return { rolls, total: rolls.reduce((sum, value) => sum + value, 0) };
}

// 每个礼盒分别进行三次独立抽取，因此一次赠送多个礼盒时，每个礼盒都有同样的掉落概率。
function rollGiftBoxBonuses(quantity) {
  const bonuses = { heart: 0, star: 0, envelope: 0 };
  for (let index = 0; index < quantity; index += 1) {
    if (Math.random() < 0.3) bonuses.heart += 1;
    if (Math.random() < 0.2) bonuses.star += 1;
    if (Math.random() < 0.1) bonuses.envelope += 1;
  }
  return bonuses;
}

function giftBoxBonusText(bonuses) {
  const names = { heart: '爱心', star: '星星', envelope: '信封' };
  const rewards = Object.keys(names).filter(id => metric(bonuses[id]) > 0).map(id => `${names[id]} × ${bonuses[id]}`);
  return rewards.length ? `礼盒额外开出：${rewards.join('、')}` : '本次礼盒没有开出额外道具。';
}

async function ensureWallet(openid) {
  const reference = db.collection(COLLECTIONS.wallets).doc(openid);
  const existing = await reference.get().then(result => result.data).catch(() => null);
  if (existing) return Object.assign({ items: emptyItemCounts(), received: emptyItemCounts() }, existing, { items: Object.assign(emptyItemCounts(), existing.items || {}), received: Object.assign(emptyItemCounts(), existing.received || {}) });
  let wallet = null;
  // 钱包与固定 ID 的登录福利邮件在同一事务中创建，重复登录或并发初始化都不会重复发放。
  await db.runTransaction(async transaction => {
    const walletRef = transaction.collection(COLLECTIONS.wallets).doc(openid);
    const concurrent = await walletRef.get().then(result => result.data).catch(() => null);
    if (concurrent) { wallet = concurrent; return; }
    const createdAt = now();
    wallet = { openid, items: emptyItemCounts(), received: emptyItemCounts(), loginBonusIssued: true, loginBonusGranted: false, createdAt, updatedAt: createdAt };
    await walletRef.set({ data: wallet });
    await transaction.collection(COLLECTIONS.mailbox).doc(`login_bonus_${openid}`).set({ data: {
      recipientOpenid: openid,
      type: 'login_bonus',
      title: '欢迎来到同行足迹',
      body: '欢迎来到“同行足迹”，请收下你的登录福利，领取后可在“背包”中使用它，请送给你身边重要的人，并写下想对TA说的话吧！愿属于你们的故事能在“同行足迹”中书写，望下一个盛夏你们还会相见！',
      itemId: 'envelope',
      quantity: 2,
      status: 'pending',
      createdAt,
      date: chinaDateKey(createdAt)
    } });
  });
  return Object.assign({ items: emptyItemCounts(), received: emptyItemCounts() }, wallet, { items: Object.assign(emptyItemCounts(), wallet && wallet.items || {}), received: Object.assign(emptyItemCounts(), wallet && wallet.received || {}) });
}

async function inventoryGet(openid) {
  const wallet = await ensureWallet(openid);
  return { wallet: { items: wallet.items, received: wallet.received, loginBonusGranted: !!wallet.loginBonusGranted } };
}

async function queryWhereAll(collection, filter) {
  const all = [];
  for (let skip = 0; ; skip += 100) {
    const page = await db.collection(collection).where(filter).orderBy('_id', 'asc').skip(skip).limit(100).get();
    all.push(...page.data);
    if (page.data.length < 100) return all;
  }
}
async function queryAllByField(collection, field, value, maxRecords = Infinity) {
  const all = [];
  for (let skip = 0; skip < maxRecords; skip += 100) {
    const result = await db.collection(collection).where({ [field]: value }).orderBy('_id', 'asc').skip(skip).limit(100).get();
    all.push(...result.data);
    if (result.data.length < 100) break;
  }
  return all;
}

async function ensureDailyTask(openid) {
  const date = chinaDateKey();
  const id = `${openid}_${date}`;
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.dailyTasks).doc(id);
    let record = await optionalDocument(ref);
    if (!record) {
      record = { openid, date, weekKey: weekKey(), progress: { login: true, view: false, like: false }, claimed: { login: false, view: false, like: false }, allComplete: false, createdAt: now(), updatedAt: now() };
      await ref.set({ data: record });
    } else if (!record.progress || !record.progress.login) {
      record.progress = Object.assign({}, record.progress || {}, { login: true });
      record.allComplete = !!(record.progress.view && record.progress.like);
      await ref.update({ data: { progress: record.progress, allComplete: record.allComplete, updatedAt: now() } });
    }
    return Object.assign({ _id: id }, record);
  });
}

async function markDailyTask(openid, key) {
  if (!['login', 'view', 'like'].includes(key)) return;
  const initial = await ensureDailyTask(openid);
  await db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.dailyTasks).doc(initial._id);
    const current = await optionalDocument(ref);
    if (!current) throw new Error('TASK_NOT_COMPLETE');
    const progress = Object.assign({ login: true, view: false, like: false }, current.progress, { [key]: true });
    const allComplete = !!(progress.login && progress.view && progress.like);
    await ref.update({ data: { progress, allComplete, completedAt: allComplete ? Number(current.completedAt) || now() : 0, updatedAt: now() } });
  });
}

async function taskStatus(openid) {
  const current = await ensureDailyTask(openid);
  await ensureWallet(openid);
  const progress = Object.assign({ login: false, view: false, like: false }, current.progress || {});
  const claimed = Object.assign({ login: false, view: false, like: false }, current.claimed || {});
  const definitions = [
    { key: 'login', icon: '☀', title: '登录小程序', description: '今天打开小程序即完成' },
    { key: 'view', icon: '◉', title: '浏览他人内容', description: '浏览任意一条其他用户发布的内容' },
    { key: 'like', icon: '♥', title: '点赞他人内容', description: '点赞任意一条其他用户发布的内容' }
  ];
  const weeklyRecords = (await db.collection(COLLECTIONS.dailyTasks).where({ openid, weekKey: current.weekKey }).limit(100).get()).data;
  const daysCompleted = weeklyRecords.filter(item => item.weekKey === current.weekKey && item.allComplete).length;
  const claimId = `${openid}_${current.weekKey}`;
  const giftBoxClaimId = `${openid}_${current.weekKey}_gift_box`;
  const [weeklyClaim, giftBoxClaim] = await Promise.all([
    db.collection(COLLECTIONS.weeklyClaims).doc(claimId).get().then(result => result.data).catch(() => null),
    db.collection(COLLECTIONS.weeklyClaims).doc(giftBoxClaimId).get().then(result => result.data).catch(() => null)
  ]);
  return {
    date: current.date,
    tasks: definitions.map(item => Object.assign(item, { complete: !!progress[item.key], claimed: !!claimed[item.key] })),
    weekly: { weekKey: current.weekKey, daysCompleted, remaining: Math.max(0, 4 - daysCompleted), eligible: daysCompleted >= 4, claimed: !!weeklyClaim },
    perfectWeek: { weekKey: current.weekKey, daysCompleted, remaining: Math.max(0, 7 - daysCompleted), eligible: daysCompleted >= 7, claimed: !!giftBoxClaim }
  };
}

async function taskClaim(openid, payload) {
  const key = safeText(payload.key, 20);
  const wallet = await ensureWallet(openid);
  const current = await ensureDailyTask(openid);
  if (key === 'weekly') {
    const status = await taskStatus(openid);
    if (!status.weekly.eligible) throw new Error('TASK_NOT_COMPLETE');
    if (status.weekly.claimed) throw new Error('TASK_ALREADY_CLAIMED');
    const claimId = `${openid}_${current.weekKey}`;
    await db.runTransaction(async transaction => {
      const claimRef = transaction.collection(COLLECTIONS.weeklyClaims).doc(claimId);
      const existing = await claimRef.get().then(result => result.data).catch(() => null);
      if (existing) throw new Error('TASK_ALREADY_CLAIMED');
      await transaction.collection(COLLECTIONS.wallets).doc(openid).update({ data: { 'items.star': _.inc(1), updatedAt: now() } });
      await claimRef.set({ data: { openid, weekKey: current.weekKey, itemId: 'star', quantity: 1, claimedAt: now() } });
    });
    return { claimed: true, rewardText: '已领取 1 个星星' };
  }
  if (key === 'weekly_gift_box') {
    const status = await taskStatus(openid);
    if (!status.perfectWeek.eligible) throw new Error('TASK_NOT_COMPLETE');
    if (status.perfectWeek.claimed) throw new Error('TASK_ALREADY_CLAIMED');
    const claimId = `${openid}_${current.weekKey}_gift_box`;
    await db.runTransaction(async transaction => {
      const claimRef = transaction.collection(COLLECTIONS.weeklyClaims).doc(claimId);
      const existing = await claimRef.get().then(result => result.data).catch(() => null);
      if (existing) throw new Error('TASK_ALREADY_CLAIMED');
      await transaction.collection(COLLECTIONS.wallets).doc(openid).update({ data: { 'items.gift_box': _.inc(1), updatedAt: now() } });
      await claimRef.set({ data: { openid, weekKey: current.weekKey, itemId: 'gift_box', quantity: 1, claimedAt: now() } });
    });
    return { claimed: true, rewardText: '已领取 1 个礼盒' };
  }
  if (['login', 'view', 'like'].indexOf(key) < 0) throw new Error('INVALID_TASK');
  if (!current.progress || !current.progress[key]) throw new Error('TASK_NOT_COMPLETE');
  if (current.claimed && current.claimed[key]) throw new Error('TASK_ALREADY_CLAIMED');
  await db.runTransaction(async transaction => {
    const taskRef = transaction.collection(COLLECTIONS.dailyTasks).doc(current._id);
    const latest = (await taskRef.get()).data;
    if (!latest.progress || !latest.progress[key]) throw new Error('TASK_NOT_COMPLETE');
    if (latest.claimed && latest.claimed[key]) throw new Error('TASK_ALREADY_CLAIMED');
    const nextClaimed = Object.assign({ login: false, view: false, like: false }, latest.claimed || {}, { [key]: true });
    await taskRef.update({ data: { claimed: nextClaimed, updatedAt: now() } });
    await transaction.collection(COLLECTIONS.wallets).doc(openid).update({ data: { 'items.heart': _.inc(1), updatedAt: now() } });
  });
  return { claimed: true, rewardText: '已领取 1 个爱心', wallet: wallet.items };
}

async function loadGiftTotals(openid) {
  const [sent, received] = await Promise.all([
    queryAllByField(COLLECTIONS.gifts, 'senderOpenid', openid),
    queryAllByField(COLLECTIONS.gifts, 'receiverOpenid', openid)
  ]);
  const totals = {};
  sent.concat(received).forEach(gift => {
    const other = gift.senderOpenid === openid ? gift.receiverOpenid : gift.senderOpenid;
    if (other) totals[other] = (totals[other] || 0) + metric(gift.totalAffection);
  });
  return totals;
}

async function giftSend(openid, payload) {
  const item = ITEM_CATALOG[safeText(payload.itemId, 30)];
  if (!item) throw new Error('INVALID_ITEM');
  const requestId = safeText(payload.requestId, 100) || `legacy_${now()}_${crypto.randomBytes(8).toString('hex')}`;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('INVALID_REQUEST_ID');
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(payload.quantity)) || 1));
  const target = await profileByUid(payload.toUid);
  if (!target) throw new Error('UID_NOT_FOUND');
  if (target._id === openid) throw new Error('CANNOT_GIFT_SELF');
  const sender = await ownProfile(openid);
  const messageLimit = item.id === 'memory_book' ? 5000 : item.id === 'envelope' ? 3000 : 0;
  const rawMessage = String(payload.message || '').trim();
  if (messageLimit && Array.from(rawMessage).length > messageLimit) throw new Error('GIFT_MESSAGE_TOO_LONG');
  const message = messageLimit ? Array.from(rawMessage).slice(0, messageLimit).join('') : '';
  const images = item.id === 'memory_book' ? (Array.isArray(payload.images) ? payload.images : []).map(value => safeText(value, 500)).filter(value => /^cloud:\/\//i.test(value)).slice(0, 9) : [];
  await checkSubmission(openid, [message], images, 2);
  await Promise.all([ensureWallet(openid), ensureWallet(target._id)]);
  const giftId = stableId('gift', openid, requestId);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([target._id, item.id, quantity, message, images])).digest('hex');
  // 随机道具的结果只能由云端生成，并把每个道具的点数一并存档，防止客户端伪造好感度。
  const affection = rollGiftAffection(item, quantity);
  const bonusItems = item.id === 'gift_box' ? rollGiftBoxBonuses(quantity) : {};
  const bonusText = item.id === 'gift_box' ? giftBoxBonusText(bonusItems) : '';
  const gift = { requestId, fingerprint, senderOpenid: openid, senderUid: sender.uid, senderName: sender.name || '未命名用户', receiverOpenid: target._id, receiverUid: target.uid, receiverName: target.name || '未命名用户', itemId: item.id, itemName: item.name, quantity, unitAffection: quantity === 1 ? affection.rolls[0] : 0, affectionRolls: affection.rolls, totalAffection: affection.total, bonusItems, message, images, createdAt: now(), date: chinaDateKey() };
  const confirmed = await db.runTransaction(async transaction => {
    const giftRef = transaction.collection(COLLECTIONS.gifts).doc(giftId);
    const previous = await optionalDocument(giftRef);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('CONTENT_CONFLICT'); return previous; }
    const senderRef = transaction.collection(COLLECTIONS.wallets).doc(openid);
    const receiverRef = transaction.collection(COLLECTIONS.wallets).doc(target._id);
    const senderWallet = (await senderRef.get()).data;
    if (metric(senderWallet.items && senderWallet.items[item.id]) < quantity) throw new Error('ITEM_NOT_ENOUGH');
    await senderRef.update({ data: { [`items.${item.id}`]: _.inc(-quantity), updatedAt: now() } });
    // 赠礼本体仍是一次性消耗；只有礼盒概率开出的额外奖励会进入接收者背包。
    const receiverUpdate = { [`received.${item.id}`]: _.inc(quantity), updatedAt: now() };
    Object.keys(bonusItems).forEach(id => { if (bonusItems[id] > 0) receiverUpdate[`items.${id}`] = _.inc(bonusItems[id]); });
    await receiverRef.update({ data: receiverUpdate });
    await transaction.collection(COLLECTIONS.gifts).doc(giftId).set({ data: gift });
    await transaction.collection(COLLECTIONS.mailbox).doc(`gift_${giftId}`).set({ data: { recipientOpenid: target._id, type: 'gift', title: `${sender.name || '一位用户'}送来${item.name}`, body: `收到 ${item.name} × ${quantity}${bonusText ? `；${bonusText}` : ''}`, message, images, itemId: item.id, quantity, bonusItems, senderUid: sender.uid, status: 'delivered', createdAt: now(), date: chinaDateKey() } });
    return gift;
  });
  const relation = await friendship(openid, target._id);
  const totals = relation ? await loadGiftTotals(openid).catch(() => ({})) : {};
  return { sent: true, giftId, bonusItems: confirmed.bonusItems || {}, bonusText: giftBoxBonusText(confirmed.bonusItems || {}), affection: relation ? affectionSummary(totals[target._id] || 0) : null };
}

function isExpiredRewardMail(mail, asOf = now()) {
  const expiresAt = Number(mail && (mail.expiresPendingAt || mail.expiresAt));
  return !!(mail && mail.type === 'developer_reward' && mail.status === 'pending' && expiresAt > 0 && expiresAt <= asOf);
}

// 删除前在事务中再次核对状态，避免用户正在领取时被定时任务误删。
async function cleanupExpiredRewardMail(id, asOf, recipientOpenid = '') {
  let deleted = false;
  await db.runTransaction(async transaction => {
    const reference = transaction.collection(COLLECTIONS.mailbox).doc(id);
    const mail = await reference.get().then(result => result.data).catch(() => null);
    if (!mail || (recipientOpenid && mail.recipientOpenid !== recipientOpenid)) return;
    if (isExpiredRewardMail(mail, asOf)) {
      await reference.remove();
      deleted = true;
      return;
    }
    // 只有待领取开发者福利应保留该索引字段；清掉异常残留可避免定时任务重复扫描。
    if (mail.expiresPendingAt != null) await reference.update({ data: { expiresPendingAt: _.remove() } });
  });
  return deleted;
}

async function cleanupExpiredRewardMails(recipientOpenid = '') {
  const asOf = now();
  let scanned = 0;
  let deleted = 0;
  if (recipientOpenid) {
    const records = await queryAllByField(COLLECTIONS.mailbox, 'recipientOpenid', recipientOpenid, 500);
    const expired = records.filter(mail => isExpiredRewardMail(mail, asOf));
    const results = await Promise.all(expired.map(mail => cleanupExpiredRewardMail(mail._id, asOf, recipientOpenid)));
    return { scanned: expired.length, deleted: results.filter(Boolean).length };
  }
  // 每小时分批处理，控制单次函数时长；未处理完的记录会在下次触发或用户打开邮箱时继续清理。
  for (let page = 0; page < 10; page += 1) {
    const result = await db.collection(COLLECTIONS.mailbox).where({ expiresPendingAt: _.lt(asOf) }).limit(20).get();
    const records = result.data || [];
    if (!records.length) break;
    scanned += records.length;
    const results = await Promise.all(records.map(mail => cleanupExpiredRewardMail(mail._id, asOf)));
    deleted += results.filter(Boolean).length;
    if (records.length < 20) break;
  }
  return { cleaned: true, scanned, deleted, asOf };
}

async function mailList(openid) {
  await cleanupExpiredRewardMails(openid);
  const records = await queryAllByField(COLLECTIONS.mailbox, 'recipientOpenid', openid, 500);
  const ordered = records.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).map(item => Object.assign({ id: item._id, images: [] }, item,
    item.type === 'work_review' ? workReviewMailContent(item.workTitle, item.reviewReason) : {},
    { itemName: ITEM_CATALOG[item.itemId] ? ITEM_CATALOG[item.itemId].name : item.itemName || '' }));
  return { mails: await resolveSharedContentList(ordered) };
}

async function mailClaim(openid, payload) {
  const id = safeText(payload.id, 100);
  await ensureWallet(openid);
  let response = null;
  let expired = false;
  await db.runTransaction(async transaction => {
    const mailRef = transaction.collection(COLLECTIONS.mailbox).doc(id);
    const mail = await mailRef.get().then(result => result.data).catch(() => null);
    if (!mail || mail.recipientOpenid !== openid) throw new Error('MAIL_NOT_FOUND');
    if (mail.status !== 'pending') throw new Error('MAIL_ALREADY_CLAIMED');
    if (isExpiredRewardMail(mail)) {
      await mailRef.remove();
      expired = true;
      return;
    }
    const item = ITEM_CATALOG[mail.itemId];
    const quantity = Math.max(1, Number(mail.quantity) || 1);
    if (!item) throw new Error('INVALID_ITEM');
    const claimedAt = now();
    const walletUpdate = { [`items.${item.id}`]: _.inc(quantity), updatedAt: claimedAt };
    if (mail.type === 'login_bonus') Object.assign(walletUpdate, { loginBonusGranted: true, loginBonusClaimedAt: claimedAt });
    await transaction.collection(COLLECTIONS.wallets).doc(openid).update({ data: walletUpdate });
    const mailUpdate = { status: 'claimed', claimedAt };
    if (mail.expiresPendingAt != null) mailUpdate.expiresPendingAt = _.remove();
    await mailRef.update({ data: mailUpdate });
    response = { claimed: true, itemId: item.id, quantity };
  });
  if (expired) throw new Error('MAIL_EXPIRED');
  return response;
}

async function mailRead(openid) {
  const records = await queryAllByField(COLLECTIONS.mailbox, 'recipientOpenid', openid, 500);
  const unread = records.filter(item => !item.readAt).length;
  if (unread) await db.collection(COLLECTIONS.mailbox).where({ recipientOpenid: openid }).update({ data: { readAt: now() } });
  return { read: unread };
}

async function mailDelete(openid, payload) {
  const id = safeText(payload.id, 100);
  const mail = await db.collection(COLLECTIONS.mailbox).doc(id).get().then(result => result.data).catch(() => null);
  if (!mail || mail.recipientOpenid !== openid) throw new Error('MAIL_NOT_FOUND');
  await db.collection(COLLECTIONS.mailbox).doc(id).remove();
  return { deleted: true, id };
}

// 管理员身份只能来自云函数环境变量或资料表中的服务端字段，客户端提交的资料无法写入 isAdmin。
async function hasAdminAccess(openid) {
  if (!openid) return false;
  const configured = String(process.env.HUI_ADMIN_OPENID || '').split(',').map(value => value.trim()).filter(Boolean);
  if (configured.indexOf(openid) >= 0) return true;
  const profile = await profileByOpenid(openid);
  return !!(profile && profile.isAdmin === true);
}

async function adminOpenids() {
  const values = new Set(String(process.env.HUI_ADMIN_OPENID || '').split(',').map(value => value.trim()).filter(Boolean));
  const profiles = await queryAllByField(COLLECTIONS.profiles, 'isAdmin', true, 1000);
  profiles.forEach(profile => {
    const openid = profile._id || profile.openid;
    if (openid) values.add(openid);
  });
  return Array.from(values);
}

// 用户反馈同时存档到举报/工单集合，并以特殊邮件分发给所有管理员。
// 邮件只携带处理反馈所需的基本资料，不向管理员页面暴露 OpenID。
async function sendFeedback(openid, payload = {}) {
  const rawContent = String(payload.content || '').trim();
  if (!rawContent) throw new Error('EMPTY_FEEDBACK');
  if (Array.from(rawContent).length > 1000) throw new Error('FEEDBACK_TOO_LONG');
  await checkTextSafety(openid, [rawContent], 2);
  const recent = await queryAllByField(COLLECTIONS.reports, 'reporterOpenid', openid, 500);
  if (recent.some(item => item.type === 'user_feedback' && now() - Number(item.createdAt) < 60 * 1000)) throw new Error('FEEDBACK_TOO_FREQUENT');
  const administrators = await adminOpenids();
  if (!administrators.length) throw new Error('NO_ADMIN_CONFIGURED');
  const profile = await ownProfile(openid);
  const content = Array.from(rawContent).slice(0, 1000).join('');
  const createdAt = now();
  const feedbackId = `feedback_${createdAt}_${crypto.randomBytes(4).toString('hex')}`;
  const sender = {
    senderUid: profile.uid,
    senderName: profile.name || '未命名用户',
    senderInitial: (profile.name || '未').slice(0, 1),
    senderAvatar: profile.avatar || '',
    senderAvatarScale: Number(profile.avatarScale) || 1,
    senderAvatarOffsetX: Number(profile.avatarOffsetX) || 0,
    senderAvatarOffsetY: Number(profile.avatarOffsetY) || 0,
    senderBio: profile.bio || '',
    senderTags: Array.isArray(profile.tags) ? profile.tags.slice(0, 6) : [],
    senderStats: profile.stats || { age: '', campCount: '' },
    senderSince: profile.createdAt ? chinaDateKey(Number(profile.createdAt)) : ''
  };
  await db.collection(COLLECTIONS.reports).doc(feedbackId).set({ data: Object.assign({ type: 'user_feedback', reporterOpenid: openid, content, status: 'pending', recipients: administrators, createdAt, updatedAt: createdAt }, sender) });
  await Promise.all(administrators.map(administratorOpenid => {
    const recipientHash = crypto.createHash('sha1').update(administratorOpenid).digest('hex').slice(0, 20);
    return db.collection(COLLECTIONS.mailbox).doc(`${feedbackId}_${recipientHash}`).set({ data: Object.assign({ recipientOpenid: administratorOpenid, type: 'user_feedback', feedbackId, title: '收到新的用户反馈', body: content, status: 'message', createdAt, date: chinaDateKey(createdAt) }, sender) });
  }));
  return { sent: true, recipientCount: administrators.length, feedbackId };
}

async function requireAdmin(openid) {
  if (!(await hasAdminAccess(openid))) throw new Error('ADMIN_FORBIDDEN');
}

async function adminStatus(openid) {
  const isAdmin = await hasAdminAccess(openid);
  if (!isAdmin) return { isAdmin: false, totalUsers: 0, pendingWorkCount: 0 };
  const [counted, pendingWorkCount] = await Promise.all([
    db.collection(COLLECTIONS.profiles).count(), countPendingWorkReviews().catch(() => null)
  ]);
  return { isAdmin: true, totalUsers: Number(counted.total) || 0, pendingWorkCount };
}

async function queryAllDocuments(collection, maxRecords = 5000) {
  const records = [];
  for (let skip = 0; skip <= maxRecords; skip += 100) {
    const limit = Math.min(100, maxRecords - skip + 1);
    const result = await db.collection(collection).skip(skip).limit(limit).get();
    records.push(...result.data);
    if (records.length > maxRecords) throw new Error('ACCOUNT_DELETE_SCAN_LIMIT');
    if (result.data.length < limit) break;
  }
  return records;
}

function uniqueDocuments(records) {
  const result = {};
  (records || []).forEach(record => { if (record && record._id) result[record._id] = record; });
  return Object.keys(result).map(id => result[id]);
}

function hasAny(values, expected) {
  return (Array.isArray(values) ? values : []).some(value => expected.has(String(value || '')));
}

function collectCloudFiles(value, files, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'string') {
    if (/^cloud:\/\//i.test(value)) files.add(value);
    return;
  }
  if (Array.isArray(value)) return value.forEach(item => collectCloudFiles(item, files, depth + 1));
  if (typeof value === 'object') Object.keys(value).forEach(key => collectCloudFiles(value[key], files, depth + 1));
}

async function removeDocumentRecords(collection, records, summary) {
  const unique = uniqueDocuments(records);
  let removed = 0;
  let failed = 0;
  for (let index = 0; index < unique.length; index += 20) {
    const results = await Promise.all(unique.slice(index, index + 20).map(record => db.collection(collection).doc(record._id).remove().then(() => true).catch(() => false)));
    removed += results.filter(Boolean).length;
    failed += results.filter(result => !result).length;
  }
  summary[collection] = { removed, failed };
  return failed;
}

async function deleteOwnedCloudFiles(fileIds) {
  const files = Array.from(fileIds);
  let removed = 0;
  let failed = 0;
  for (let index = 0; index < files.length; index += 50) {
    const batch = files.slice(index, index + 50);
    try {
      const result = await cloud.deleteFile({ fileList: batch });
      const returned = result && result.fileList || [];
      if (!returned.length) { removed += batch.length; continue; }
      returned.forEach(item => {
        const success = Number(item && item.status) === 0 || /not exist|not found|不存在/i.test(String(item && item.errMsg || ''));
        if (success) removed += 1; else failed += 1;
      });
    } catch (error) { failed += batch.length; }
  }
  return { removed, failed };
}

function incrementAdjustment(adjustments, id, field, quantity = 1) {
  if (!id) return;
  adjustments[id] = adjustments[id] || { likes: 0, commentCount: 0, views: 0 };
  adjustments[id][field] += quantity;
}

async function applyCleanupCounterAdjustments(contents, comments, adjustments, commentLikeAdjustments) {
  const contentById = {};
  contents.forEach(record => { contentById[record._id] = record; });
  const commentById = {};
  comments.forEach(record => { commentById[record._id] = record; });
  let failed = 0;
  for (const id of Object.keys(adjustments)) {
    const record = contentById[id];
    if (!record) continue;
    const change = adjustments[id];
    const data = {
      likes: Math.max(0, metric(record.likes) - change.likes),
      commentCount: Math.max(0, metric(record.commentCount) - change.commentCount),
      views: Math.max(0, metric(record.views) - change.views)
    };
    await db.collection(COLLECTIONS.content).doc(id).update({ data }).catch(() => { failed += 1; });
  }
  for (const id of Object.keys(commentLikeAdjustments)) {
    const record = commentById[id];
    if (!record) continue;
    await db.collection(COLLECTIONS.comments).doc(id).update({ data: { likes: Math.max(0, metric(record.likes) - commentLikeAdjustments[id]) } }).catch(() => { failed += 1; });
  }
  return failed;
}

// UID 只用于定位当前资料；删除始终绑定 OpenID 和建档时间，不能从旧内容快照推断账号归属。
async function accountDeletionTarget(openid, targetUid) {
  await requireAdmin(openid);
  const uid = safeText(targetUid, 20);
  if (!validUid(uid)) throw new Error('INVALID_DELETE_UID');
  const matches = await db.collection(COLLECTIONS.profiles).where({ uid }).limit(2).get();
  if (!matches.data.length) throw new Error('UID_NOT_FOUND');
  if (matches.data.length !== 1) throw new Error('ACCOUNT_DELETE_DUPLICATE_UID');
  const profile = matches.data[0];
  const targetOpenid = String(profile._id || profile.openid || '');
  if (!targetOpenid || targetOpenid === openid || await hasAdminAccess(targetOpenid)) throw new Error('ACCOUNT_DELETE_PROTECTED');
  const accountKey = crypto.createHash('sha256').update(`${targetOpenid}|${uid}|${Number(profile.createdAt) || 0}`).digest('hex');
  return { uid, profile, targetOpenid, accountKey };
}

async function previewAccountDeletion(openid, payload = {}) {
  const target = await accountDeletionTarget(openid, payload.targetUid);
  return { target: { uid: target.uid, name: target.profile.name || '未命名用户', accountKey: target.accountKey } };
}

async function deleteAccountByUid(openid, payload = {}) {
  const target = await accountDeletionTarget(openid, payload.targetUid);
  if (safeText(payload.accountKey, 64) !== target.accountKey || safeText(payload.confirmation, 30) !== `DELETE:${target.uid}`) throw new Error('ACCOUNT_DELETE_CONFIRMATION_REQUIRED');
  const runRef = db.collection(COLLECTIONS.rewardRuns).doc(`account_delete_${target.accountKey.slice(0, 32)}`);
  const existingRun = await runRef.get().then(result => result.data).catch(() => null);
  if (existingRun && existingRun.status === 'running' && now() - Number(existingRun.updatedAt) < 120000) throw new Error('ACCOUNT_DELETE_IN_PROGRESS');
  if (existingRun && existingRun.status === 'complete') throw new Error('ACCOUNT_DELETE_ALREADY_COMPLETE');

  const keys = Object.keys(COLLECTIONS).filter(key => !['rewardRuns', 'uidClaims'].includes(key));
  const loaded = await Promise.all(keys.map(key => queryAllDocuments(COLLECTIONS[key])));
  const all = {};
  keys.forEach((key, index) => { all[key] = loaded[index]; });
  const latestProfile = await profileByOpenid(target.targetOpenid);
  if (!latestProfile || String(latestProfile.uid) !== target.uid || Number(latestProfile.createdAt) !== (Number(target.profile.createdAt) || 0) || await hasAdminAccess(target.targetOpenid)) throw new Error('ACCOUNT_DELETE_TARGET_CHANGED');
  const startedAt = now();
  await runRef.set({ data: { status: 'running', startedAt, updatedAt: startedAt } });
  const targetOpenids = new Set([target.targetOpenid]);

  const profiles = all.profiles.filter(record => targetOpenids.has(String(record._id || record.openid || '')));
  if (profiles.length !== 1 || Number(profiles[0].createdAt) !== (Number(target.profile.createdAt) || 0)) throw new Error('ACCOUNT_DELETE_TARGET_CHANGED');
  const contents = all.content.filter(record => targetOpenids.has(String(record.ownerOpenid || '')));
  const contentIds = new Set(contents.map(record => record._id));
  const commentIds = new Set();
  all.comments.forEach(record => {
    if (contentIds.has(record.contentRef) || targetOpenids.has(String(record.authorOpenid || '')) || targetOpenids.has(String(record.replyToOpenid || ''))) commentIds.add(record._id);
  });
  let expanded = true;
  while (expanded) {
    expanded = false;
    all.comments.forEach(record => {
      if (!commentIds.has(record._id) && commentIds.has(record.parentId)) { commentIds.add(record._id); expanded = true; }
    });
  }
  const comments = all.comments.filter(record => commentIds.has(record._id));
  const likes = all.likes.filter(record => targetOpenids.has(String(record.actorOpenid || '')) || contentIds.has(record.contentRef) || commentIds.has(record.commentRef));
  const views = all.views.filter(record => targetOpenids.has(String(record.viewerOpenid || '')) || contentIds.has(record.contentRef));
  const reports = all.reports.filter(record => targetOpenids.has(String(record.reporterOpenid || '')) || targetOpenids.has(String(record.reportedOpenid || '')) || contentIds.has(record.contentRef) || commentIds.has(record.commentRef));
  const feedbackIds = new Set(reports.filter(record => record.type === 'user_feedback').map(record => record._id));
  const friendRequests = all.friendRequests.filter(record => targetOpenids.has(String(record.fromOpenid || '')) || targetOpenids.has(String(record.toOpenid || '')));
  const friendships = all.friendships.filter(record => hasAny(record.members, targetOpenids));
  const messages = all.messages.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetOpenids.has(String(record.receiverOpenid || '')));
  const gifts = all.gifts.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetOpenids.has(String(record.receiverOpenid || '')));
  const giftMailIds = new Set(gifts.map(record => `gift_${record._id}`));
  const mailbox = all.mailbox.filter(record => targetOpenids.has(String(record.recipientOpenid || '')) || targetOpenids.has(String(record.issuedBy || '')) || feedbackIds.has(record.feedbackId) || giftMailIds.has(record._id));
  const dailyTasks = all.dailyTasks.filter(record => targetOpenids.has(String(record.openid || '')));
  const weeklyClaims = all.weeklyClaims.filter(record => targetOpenids.has(String(record.openid || '')));
  const wallets = all.wallets.filter(record => targetOpenids.has(String(record._id || record.openid || '')));

  const ownedFiles = new Set();
  [profiles, contents,
    all.comments.filter(record => targetOpenids.has(String(record.authorOpenid || ''))),
    all.friendRequests.filter(record => targetOpenids.has(String(record.fromOpenid || ''))),
    all.messages.filter(record => targetOpenids.has(String(record.senderOpenid || ''))),
    all.gifts.filter(record => targetOpenids.has(String(record.senderOpenid || ''))),
    all.reports.filter(record => targetOpenids.has(String(record.reporterOpenid || '')))
  ].forEach(records => records.forEach(record => collectCloudFiles(record, ownedFiles)));
  const removedIds = {
    profiles, content: contents, friendRequests, friendships, likes, comments, views,
    messages, reports, wallets, gifts, dailyTasks, weeklyClaims, mailbox
  };
  const retainedFiles = new Set();
  keys.forEach(key => {
    const deleting = new Set((removedIds[key] || []).map(record => record._id));
    all[key].forEach(record => { if (!deleting.has(record._id)) collectCloudFiles(record, retainedFiles); });
  });
  let sharedFiles = 0;
  retainedFiles.forEach(file => { if (ownedFiles.delete(file)) sharedFiles += 1; });
  const storage = await deleteOwnedCloudFiles(ownedFiles);
  storage.sharedRetained = sharedFiles;
  if (storage.failed) {
    const finishedAt = now();
    await runRef.set({ data: { status: 'partial', failed: storage.failed, storageRemoved: storage.removed, storageFailed: storage.failed, startedAt, finishedAt, updatedAt: finishedAt } });
    return { completed: false, targetUid: target.uid, targetAccounts: profiles.length, failed: storage.failed, storage, summary: {} };
  }

  const contentAdjustments = {};
  const commentLikeAdjustments = {};
  likes.forEach(record => {
    if (record.contentRef && !contentIds.has(record.contentRef)) incrementAdjustment(contentAdjustments, record.contentRef, 'likes');
    if (record.commentRef && !commentIds.has(record.commentRef)) commentLikeAdjustments[record.commentRef] = (commentLikeAdjustments[record.commentRef] || 0) + 1;
  });
  comments.forEach(record => { if (record.contentRef && !contentIds.has(record.contentRef)) incrementAdjustment(contentAdjustments, record.contentRef, 'commentCount'); });
  views.forEach(record => { if (record.contentRef && !contentIds.has(record.contentRef)) incrementAdjustment(contentAdjustments, record.contentRef, 'views'); });

  const summary = {};
  let failed = 0;
  const groups = [
    [COLLECTIONS.likes, likes], [COLLECTIONS.views, views], [COLLECTIONS.reports, reports],
    [COLLECTIONS.comments, comments], [COLLECTIONS.content, contents],
    [COLLECTIONS.friendRequests, friendRequests], [COLLECTIONS.friendships, friendships],
    [COLLECTIONS.messages, messages], [COLLECTIONS.gifts, gifts], [COLLECTIONS.mailbox, mailbox],
    [COLLECTIONS.dailyTasks, dailyTasks], [COLLECTIONS.weeklyClaims, weeklyClaims]
  ];
  for (const [collection, records] of groups) failed += await removeDocumentRecords(collection, records, summary);
  failed += await applyCleanupCounterAdjustments(all.content.filter(record => !contentIds.has(record._id)), all.comments.filter(record => !commentIds.has(record._id)), contentAdjustments, commentLikeAdjustments);
  if (!failed) failed += await removeDocumentRecords(COLLECTIONS.wallets, wallets, summary);
  if (!failed) {
    const claims = await queryWhereAll(COLLECTIONS.uidClaims, { ownerOpenid: target.targetOpenid });
    for (const claim of claims) {
      const ref = db.collection(COLLECTIONS.uidClaims).doc(claim._id);
      if (claim._id.startsWith('uid_')) await ref.set({ data: { uid: claim.uid, retired: true, retiredAt: now() } });
      else await ref.remove();
    }
    const plans = await queryWhereAll(COLLECTIONS.rewardRuns, { 'winners.openid': target.targetOpenid });
    for (const plan of plans) {
      await db.runTransaction(async transaction => {
        const ref = transaction.collection(COLLECTIONS.rewardRuns).doc(plan._id);
        const current = await optionalDocument(ref);
        if (current && Array.isArray(current.winners)) await ref.update({ data: { winners: current.winners.filter(winner => winner.openid !== target.targetOpenid) } });
      });
    }
    failed += await removeDocumentRecords(COLLECTIONS.profiles, profiles, summary);
  }

  const completed = failed === 0;
  const finishedAt = now();
  await runRef.set({ data: { status: completed ? 'complete' : 'partial', removedProfiles: summary[COLLECTIONS.profiles] ? summary[COLLECTIONS.profiles].removed : 0, failed, storageRemoved: storage.removed, storageFailed: storage.failed, startedAt, finishedAt, updatedAt: finishedAt } });
  return { completed, targetUid: target.uid, targetAccounts: profiles.length, failed, storage, summary };
}

function rewardDocumentId(campaignKey, recipientOpenid) {
  const campaignHash = crypto.createHash('sha1').update(campaignKey).digest('hex').slice(0, 16);
  const recipientHash = crypto.createHash('sha1').update(recipientOpenid).digest('hex').slice(0, 24);
  return `developer_${campaignHash}_${recipientHash}`;
}

function rewardDeadline(value) {
  const expiresDate = safeText(value, 10);
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresDate);
  if (!matched) throw new Error('INVALID_REWARD_DEADLINE');
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  // 截止日按北京时间计算，用户在当天 23:59:59.999 前仍可领取。
  const expiresAt = Date.UTC(year, month - 1, day, 15, 59, 59, 999);
  if (chinaDateKey(expiresAt) !== expiresDate) throw new Error('INVALID_REWARD_DEADLINE');
  if (expiresAt <= now()) throw new Error('REWARD_DEADLINE_PASSED');
  return { expiresDate, expiresAt };
}

function adminRewardPayload(payload) {
  const campaignKey = safeText(payload.campaignKey, 60);
  if (!/^[a-zA-Z0-9_-]{3,60}$/.test(campaignKey)) throw new Error('INVALID_CAMPAIGN_KEY');
  const item = ITEM_CATALOG[safeText(payload.itemId, 30)];
  if (!item) throw new Error('INVALID_ITEM');
  const quantity = Math.floor(Number(payload.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) throw new Error('INVALID_REWARD_QUANTITY');
  const deadline = rewardDeadline(payload.expiresDate);
  return {
    campaignKey,
    item,
    quantity,
    expiresDate: deadline.expiresDate,
    expiresAt: deadline.expiresAt,
    title: safeText(payload.title, 40) || '开发者赠予',
    body: safeText(payload.body, 300) || `请领取 ${item.name} × ${quantity}`
  };
}

async function createAdminRewardMail(issuedBy, recipientOpenid, reward) {
  const reference = db.collection(COLLECTIONS.mailbox).doc(rewardDocumentId(reward.campaignKey, recipientOpenid));
  const existing = await reference.get().then(result => result.data).catch(() => null);
  if (existing) return false;
  const createdAt = now();
  await reference.set({ data: {
    recipientOpenid,
    type: 'developer_reward',
    campaignKey: reward.campaignKey,
    title: reward.title,
    body: reward.body,
    itemId: reward.item.id,
    quantity: reward.quantity,
    status: 'pending',
    expiresDate: reward.expiresDate,
    expiresAt: reward.expiresAt,
    expiresPendingAt: reward.expiresAt,
    issuedBy,
    createdAt,
    date: chinaDateKey(createdAt)
  } });
  return true;
}

// 每次只处理一页用户，客户端会自动继续下一页；固定文档 ID 让同一批次可安全重试而不会重复领取。
async function adminBroadcastReward(openid, payload) {
  await requireAdmin(openid);
  const reward = adminRewardPayload(payload);
  const offset = Math.max(0, Math.floor(Number(payload.offset) || 0));
  const batchSize = 50;
  const [profiles, counted] = await Promise.all([
    db.collection(COLLECTIONS.profiles).orderBy('_id', 'asc').skip(offset).limit(batchSize).get(),
    db.collection(COLLECTIONS.profiles).count()
  ]);
  let created = 0;
  let skipped = 0;
  for (const profile of profiles.data) {
    const recipientOpenid = profile._id || profile.openid;
    if (!recipientOpenid) { skipped += 1; continue; }
    if (await createAdminRewardMail(openid, recipientOpenid, reward)) created += 1;
    else skipped += 1;
  }
  const totalUsers = Number(counted.total) || 0;
  const nextOffset = offset + profiles.data.length;
  return { campaignKey: reward.campaignKey, itemId: reward.item.id, quantity: reward.quantity, expiresDate: reward.expiresDate, processed: profiles.data.length, created, skipped, nextOffset, totalUsers, hasMore: nextOffset < totalUsers };
}

async function adminUserReward(openid, payload) {
  await requireAdmin(openid);
  const reward = adminRewardPayload(payload);
  const targetUid = safeText(payload.targetUid, 20);
  if (!validUid(targetUid)) throw new Error('INVALID_TARGET_UID');
  const target = await profileByUid(targetUid);
  if (!target) throw new Error('UID_NOT_FOUND');
  const recipientOpenid = target._id || target.openid;
  const created = await createAdminRewardMail(openid, recipientOpenid, reward);
  return {
    campaignKey: reward.campaignKey,
    itemId: reward.item.id,
    quantity: reward.quantity,
    expiresDate: reward.expiresDate,
    processed: 1,
    created: created ? 1 : 0,
    skipped: created ? 0 : 1,
    target: { uid: target.uid, name: target.name || '未命名用户' }
  };
}

async function createRewardMail(id, openid, title, body, itemId, quantity) {
  return db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.mailbox).doc(id);
    if (await optionalDocument(ref)) return false;
    if (!await optionalDocument(transaction.collection(COLLECTIONS.profiles).doc(openid))) return false;
    await ref.set({ data: { recipientOpenid: openid, type: 'ranking_reward', title, body, itemId, quantity, status: 'pending', createdAt: now(), date: chinaDateKey() } });
    return true;
  });
}
function contentDateKey(record) { return chinaDateKey(Number(record.publishedAt) || Number(record.createdAt) || 0); }
function compareRankings(a, b) {
  return heat(b) - heat(a) || (Number(b.publishedAt) || 0) - (Number(a.publishedAt) || 0) || String(a._id || a.contentId || a.ownerOpenid).localeCompare(String(b._id || b.contentId || b.ownerOpenid));
}
async function awardRankingPeriod(type, periodKey, records, rewards) {
  const refId = stableId('ranking', type, periodKey);
  let snapshot = await optionalDocument(db.collection(COLLECTIONS.rewardRuns).doc(refId));
  if (!snapshot) {
    // Existing legacy rewards make this historical period settled. Never issue a fresh set over them.
    const previous = await queryWhereAll(COLLECTIONS.mailbox, { type: 'ranking_reward' });
    const legacy = previous.some(item => String(item._id).startsWith(`rank_${type}_${periodKey}_`));
    const owners = new Set(), winners = [];
    records.slice().sort(compareRankings).slice(0, rewards.length).forEach((record, index) => {
      if (!record.ownerOpenid || owners.has(record.ownerOpenid)) return;
      owners.add(record.ownerOpenid);
      winners.push({ openid: record.ownerOpenid, rank: index + 1, itemId: rewards[index].itemId, quantity: rewards[index].quantity });
    });
    snapshot = await db.runTransaction(async transaction => {
      const ref = transaction.collection(COLLECTIONS.rewardRuns).doc(refId);
      const existing = await optionalDocument(ref);
      if (existing) return existing;
      const plan = { type, periodKey, winners: legacy ? [] : winners, legacySettled: legacy, status: legacy ? 'complete' : 'pending', createdAt: now() };
      await ref.set({ data: plan });
      return plan;
    });
  }
  if (snapshot.status === 'complete') return 0;
  let created = 0;
  for (const winner of snapshot.winners) {
    const { openid, rank, itemId, quantity } = winner;
    if (await createRewardMail(`rank_${type}_${periodKey}_${rank}_${openid}`, openid, `${periodKey} ${type}热度榜第 ${rank} 名`, `恭喜获得 ${ITEM_CATALOG[itemId].name} × ${quantity}，请领取到背包。`, itemId, quantity)) created++;
  }
  await db.collection(COLLECTIONS.rewardRuns).doc(refId).update({ data: { status: 'complete', completedAt: now() } });
  return created;
}

async function runRankingRewards() {
  const current = chinaDate();
  const yesterday = new Date(current.getTime());
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const records = (await loadPublicContents()).filter(record => ['photo', 'growth', 'work'].includes(record.kind));
  let created = await awardRankingPeriod('日', yesterdayKey, records.filter(record => contentDateKey(record) === yesterdayKey), RANKING_REWARDS.day);
  if (current.getUTCDay() === 1) {
    const targetWeek = weekKey(yesterday.getTime() - 8 * 60 * 60 * 1000);
    created += await awardRankingPeriod('周', targetWeek, records.filter(record => weekKey(Date.parse(`${contentDateKey(record)}T00:00:00Z`) - 8 * 60 * 60 * 1000) === targetWeek), RANKING_REWARDS.week);
  }
  if (current.getUTCDate() === 1) {
    const previousMonth = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}`;
    created += await awardRankingPeriod('月', previousMonth, records.filter(record => contentDateKey(record).slice(0, 7) === previousMonth), RANKING_REWARDS.month);
    if (current.getUTCMonth() === 0) {
      const previousYear = String(yesterday.getUTCFullYear());
      created += await awardRankingPeriod('年', previousYear, records.filter(record => contentDateKey(record).slice(0, 4) === previousYear), RANKING_REWARDS.year);
    }
  }
  await db.collection(COLLECTIONS.rewardRuns).doc(yesterdayKey).set({ data: { date: yesterdayKey, created, ranAt: now() } });
  return { date: yesterdayKey, created };
}

async function requestFriend(openid, payload) {
  const reason = safeText(payload.reason, 120);
  if (!reason.replace(/[\s\u200B-\u200D\uFEFF]/g, '')) throw new Error('FRIEND_REQUEST_REASON_REQUIRED');
  const from = await ownProfile(openid);
  if (!validUid(payload.toUid)) throw new Error('INVALID_UID');
  const target = await profileByUid(payload.toUid);
  if (!target) throw new Error('UID_NOT_FOUND');
  if (target._id === openid) throw new Error('SELF_REQUEST');
  if (await friendship(openid, target._id)) throw new Error('ALREADY_FRIENDS');
  await checkTextSafety(openid, [reason], 2);
  const existing = { data: await queryWhereAll(COLLECTIONS.friendRequests, { fromOpenid: openid, toOpenid: target._id, status: 'pending' }) };
  if (existing.data.some(item => item.toOpenid === target._id && item.status === 'pending')) throw new Error('REQUEST_EXISTS');
  const request = { fromOpenid: openid, fromUid: from.uid, fromName: from.name || '未命名用户', fromAvatar: from.avatar || '', fromBio: from.bio || '', toOpenid: target._id, toUid: target.uid, reason, status: 'pending', createdAt: now() };
  const added = await db.collection(COLLECTIONS.friendRequests).add({ data: request });
  return Object.assign({ id: added._id }, request);
}

async function listRequests(openid) {
  const result = { data: await queryWhereAll(COLLECTIONS.friendRequests, { toOpenid: openid, status: 'pending' }) };
  const pending = result.data.filter(item => item.status === 'pending').sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  const applicants = await profilesByOpenids(pending.map(item => item.fromOpenid));
  return { requests: pending.map(item => {
    const applicant = applicants[item.fromOpenid];
    return Object.assign({ id: item._id }, item, {
      fromUid: applicant ? applicant.uid : item.fromUid,
      fromName: applicant ? (applicant.name || '未命名用户') : item.fromName,
      fromAvatar: applicant ? (applicant.avatar || '') : item.fromAvatar,
      fromAvatarScale: applicant ? (applicant.avatarScale || 1.3) : (item.fromAvatarScale || 1.3),
      fromAvatarOffsetX: applicant ? (applicant.avatarOffsetX || 0) : (item.fromAvatarOffsetX || 0),
      fromAvatarOffsetY: applicant ? (applicant.avatarOffsetY || 0) : (item.fromAvatarOffsetY || 0),
      fromBio: applicant ? (applicant.bio || '') : item.fromBio
    });
  }) };
}

async function acceptRequest(openid, payload) {
  const request = await optionalDocument(db.collection(COLLECTIONS.friendRequests).doc(payload.id));
  if (!request || request.toOpenid !== openid || !['pending', 'accepted'].includes(request.status)) throw new Error('REQUEST_NOT_FOUND');
  const key = pairKey(openid, request.fromOpenid);
  const legacy = (await db.collection(COLLECTIONS.friendships).where({ pairKey: key }).limit(1).get()).data[0];
  return db.runTransaction(async transaction => {
    const reqRef = transaction.collection(COLLECTIONS.friendRequests).doc(payload.id);
    const current = await optionalDocument(reqRef);
    const ref = transaction.collection(COLLECTIONS.friendships).doc(legacy ? legacy._id : stableId('friend', key));
    const existing = await optionalDocument(ref);
    if (!current || current.toOpenid !== openid || !['pending', 'accepted'].includes(current.status)) throw new Error('REQUEST_NOT_FOUND');
    if (current.status === 'accepted') { if (!existing) throw new Error('REQUEST_NOT_FOUND'); return { accepted: true }; }
    if (!existing) await ref.set({ data: { pairKey: key, members: [openid, request.fromOpenid], remarks: {}, createdAt: now() } });
    await reqRef.update({ data: { status: 'accepted', handledAt: now() } });
    return { accepted: true };
  });
}

async function rejectRequest(openid, payload) {
  const request = await db.collection(COLLECTIONS.friendRequests).doc(payload.id).get().then(result => result.data).catch(() => null);
  if (!request || request.toOpenid !== openid || request.status !== 'pending') throw new Error('REQUEST_NOT_FOUND');
  await db.collection(COLLECTIONS.friendRequests).doc(request._id).update({ data: { status: 'rejected', handledAt: now() } });
  return { rejected: true };
}

async function friendList(openid) {
  const [relations, management, giftTotals] = await Promise.all([
    queryWhereAll(COLLECTIONS.friendships, { members: _.in([openid]) }),
    friendManager.read(openid),
    loadGiftTotals(openid)
  ]);
  const loaded = (await Promise.all(relations.map(async relation => {
    const targetOpenid = (relation.members || []).find(item => item !== openid);
    const target = targetOpenid ? await db.collection(COLLECTIONS.profiles).doc(targetOpenid).get().then(result => result.data).catch(() => null) : null;
    return target ? { target, remark: (relation.remarks || {})[openid] || '', addedAt: Number(relation.createdAt) || 0, groupId: management.assignments[targetOpenid] || 'camp-friends' } : null;
  }))).filter(Boolean);
  const resolved = await resolveSharedContentList(loaded.map(item => ({ avatar: item.target.avatar || '' })));
  const list = loaded.map((item, index) => Object.assign(publicProfile(item.target), { avatar: resolved[index].avatar || item.target.avatar || '', id: item.target.uid, remark: item.remark, addedAt: item.addedAt, groupId: item.groupId, affection: affectionSummary(giftTotals[item.target._id] || 0) }));
  return { friends: list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')), management: friendManager.view(management) };
}

async function friendGet(openid, payload) {
  const target = await profileByUid(payload.uid);
  if (!target) throw new Error('FRIEND_NOT_FOUND');
  const relation = await ensureFriend(openid, target._id);
  const giftTotals = await loadGiftTotals(openid);
  const wallet = await db.collection(COLLECTIONS.wallets).doc(target._id).get().then(result => result.data).catch(() => null);
  const received = Object.assign(emptyItemCounts(), wallet && wallet.received || {});
  return { friend: Object.assign(await resolveProfileFile(target), { id: target.uid, remark: (relation.remarks || {})[openid] || '', affection: affectionSummary(giftTotals[target._id] || 0), received }) };
}

async function friendRemark(openid, payload) {
  const target = await profileByUid(payload.uid);
  const relation = target ? await ensureFriend(openid, target._id) : null;
  if (!relation) throw new Error('FRIEND_NOT_FOUND');
  const remarks = Object.assign({}, relation.remarks || {}, { [openid]: safeText(payload.remark, 30) });
  await db.collection(COLLECTIONS.friendships).doc(relation._id).update({ data: { remarks } });
  return { remark: remarks[openid] };
}

async function friendRemove(openid, payload) {
  const target = await profileByUid(payload.uid);
  const relation = target ? await ensureFriend(openid, target._id) : null;
  if (!relation) throw new Error('FRIEND_NOT_FOUND');
  await db.collection(COLLECTIONS.friendships).doc(relation._id).remove();
  return { removed: true };
}

async function friendContent(openid, payload) {
  const target = await profileByUid(payload.uid);
  if (!target) throw new Error('FRIEND_NOT_FOUND');
  await ensureFriend(openid, target._id);
  const type = payload.type || 'intro';
  if (type === 'intro') return { friend: await resolveProfileFile(target), type, camps: [], records: [] };
  // 先按用户查询、再在函数内过滤可见范围，可避免新环境缺少组合索引时整页读取失败。
  const records = await ownerContentRecords(target._id);
  const visible = records.data.filter(record => ['friends', 'public'].includes(record.visibility) && record.status === 'published' && isPublished(record)).map(record => exposeContent(record, target));
  // 相册目录本身是私有的管理数据，但好友需要先选择相册再看其中公开的照片。
  // 这里只返回至少含有一张可见照片的目录，不会暴露空相册或全为私密照片的目录。
  const visibleFolderIds = new Set(visible.filter(item => item.kind === 'photo' && item.folderId).map(item => item.folderId));
  const folders = records.data.filter(record => record.kind === 'album' && visibleFolderIds.has(record.contentId)).map(record => exposeContent(record, target));
  const friend = publicProfile(target);
  const media = await resolveSharedContentList(visible.concat(folders, [{ avatar: friend.avatar }]));
  const allVisible = media.slice(0, visible.length);
  const albums = media.slice(visible.length, -1);
  friend.avatar = media[media.length - 1].avatar;
  const usable = allVisible.filter(item => item.kind !== 'companion');
  const campIds = allVisible.map(item => item.campId).filter((item, index, all) => item && all.indexOf(item) === index);
  const contentForPage = type === 'growth' ? usable.filter(item => item.kind === 'growth' || item.kind === 'work') : (type === 'footprints' || type === 'module') ? allVisible : [];
  return { friend, type, campIds, records: contentForPage, albums };
}

// 聊天记录只以好友关系的 pairKey 为索引。每次读取、发送都会再次验证好友关系，
// 因此即使用户通过前端伪造 UID，也无法访问非好友的会话。
async function chatTarget(openid, uid) {
  const target = await profileByUid(uid);
  if (!target) throw new Error('FRIEND_NOT_FOUND');
  const relation = await ensureFriend(openid, target._id);
  return { target, relation };
}

async function chatList(openid, payload) {
  const { target, relation } = await chatTarget(openid, payload.uid);
  const conversationId = pairKey(openid, target._id);
  const cursor = payload.before;
  let rows;
  if (cursor && Number.isFinite(Number(cursor.time)) && cursor.id) {
    const sameTime = await db.collection(COLLECTIONS.messages).where({ conversationId, createdAt: Number(cursor.time), _id: _.lt(String(cursor.id)) }).orderBy('_id', 'desc').limit(101).get();
    const older = sameTime.data.length >= 101 ? [] : (await db.collection(COLLECTIONS.messages).where({ conversationId, createdAt: _.lt(Number(cursor.time)) }).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(101 - sameTime.data.length).get()).data;
    rows = sameTime.data.concat(older);
  } else {
    rows = (await db.collection(COLLECTIONS.messages).where({ conversationId }).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(101).get()).data;
  }
  const hasMore = rows.length > 100;
  const ordered = rows.slice(0, 100).reverse();
  const senders = await profilesByOpenids(ordered.map(item => item.senderOpenid).filter(sender => sender !== target._id), false);
  senders[target._id] = target;
  const messages = ordered.map(item => {
    const sender = senders[item.senderOpenid] || {};
    return { id: item._id, body: item.body, createdAt: item.createdAt, senderUid: sender.uid || item.senderUid,
      senderName: sender.name || item.senderName || '未命名用户', senderAvatar: sender.avatar || item.senderAvatar || '',
      senderAvatarScale: sender.avatarScale || 1.3, senderAvatarOffsetX: sender.avatarOffsetX || 0, senderAvatarOffsetY: sender.avatarOffsetY || 0, isMine: item.senderOpenid === openid };
  });
  const friend = Object.assign(publicProfile(target), { id: target.uid, remark: (relation.remarks || {})[openid] || '' });
  const version = cursor ? '' : stableId('chat', friend, hasMore, messages);
  const unread = ordered.filter(item => item.receiverOpenid === openid && !item.readAt);
  await Promise.all(unread.map(item => db.collection(COLLECTIONS.messages).doc(item._id).update({ data: { readAt: now() } })));
  if (version && payload.version === version) return { unchanged: true, version, markedRead: unread.length };
  const media = await resolveSharedContentList(messages.map(item => ({ avatar: item.senderAvatar })).concat({ avatar: friend.avatar }));
  messages.forEach((message, index) => { message.senderAvatar = media[index].avatar; });
  friend.avatar = media[messages.length].avatar;
  // 临时头像地址生成失败时，下次轮询仍会尝试生成。
  const reusableVersion = media.some(item => /^cloud:\/\//i.test(item.avatar)) ? '' : version;
  const oldest = ordered[0];
  return { friend, messages, hasMore, before: oldest ? { time: oldest.createdAt, id: oldest._id } : null, version: reusableVersion, markedRead: unread.length };
}
async function chatUnread(openid, includeByUid = true) {
  const rows = await queryWhereAll(COLLECTIONS.messages, { receiverOpenid: openid, readAt: 0 });
  if (!rows.length) return { total: 0, byUid: {} };
  const relations = await queryWhereAll(COLLECTIONS.friendships, { members: _.in([openid]) });
  const friends = new Set(relations.map(item => item.members.find(member => member !== openid)));
  const unread = rows.filter(item => friends.has(item.senderOpenid));
  if (!includeByUid) return { total: unread.length };
  const senders = await profilesByOpenids(unread.map(item => item.senderOpenid), false);
  const byUid = {};
  unread.forEach(item => { const uid = (senders[item.senderOpenid] || {}).uid || item.senderUid; if (uid) byUid[uid] = (byUid[uid] || 0) + 1; });
  return { total: unread.length, byUid };
}
async function friendBadge(openid) {
  const [requests, unread, reviewCount] = await Promise.all([
    db.collection(COLLECTIONS.friendRequests).where({ toOpenid: openid, status: 'pending' }).count(),
    chatUnread(openid, false),
    hasAdminAccess(openid).then(isAdmin => isAdmin ? countPendingWorkReviews() : 0).catch(() => null)
  ]);
  return { count: metric(requests.total) + unread.total, reviewCount };
}
async function chatSend(openid, payload) {
  const { target } = await chatTarget(openid, payload.uid);
  const body = safeText(payload.body, 500);
  if (!body) throw new Error('EMPTY_MESSAGE');
  const requestId = safeText(payload.requestId, 100) || `legacy_${now()}_${crypto.randomBytes(8).toString('hex')}`;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('INVALID_REQUEST_ID');
  const id = stableId('message', openid, requestId);
  await checkTextSafety(openid, [body], 2);
  const sender = await ownProfile(openid);
  const record = { conversationId: pairKey(openid, target._id), senderOpenid: openid, senderUid: sender.uid, senderName: sender.name || '我', senderAvatar: sender.avatar || '', receiverOpenid: target._id, body, createdAt: now(), readAt: 0 };
  const confirmed = await db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.messages).doc(id);
    const previous = await optionalDocument(ref);
    if (previous) { if (previous.body !== body || previous.receiverOpenid !== target._id) throw new Error('CONTENT_CONFLICT'); return previous; }
    await ref.set({ data: record }); return record;
  });
  return { message: Object.assign({ id, isMine: true }, confirmed) };
}

async function countPendingWorkReviews() {
  let count = 0;
  // 只查询尚未处理的公开作品，并只读取判断审核状态所需的字段，不签发附件链接。
  const filter = { kind: 'work', visibility: 'public', status: 'published', reviewStatus: _.nin(['approved', 'rejected']) };
  const fields = { kind: true, visibility: true, status: true, reviewStatus: true,
    'payload.status': true, 'payload.filePath': true, 'payload.fileName': true, 'payload.fileType': true };
  for (let skip = 0; ; skip += 100) {
    const page = await db.collection(COLLECTIONS.content).where(filter).field(fields).orderBy('_id', 'asc').skip(skip).limit(100).get();
    count += page.data.filter(isPendingWorkReview).length;
    if (page.data.length < 100) return count;
  }
}
async function pendingWorkReviews(openid) {
  await requireAdmin(openid);
  const rows = await queryWhereAll(COLLECTIONS.content, { kind: 'work' });
  return { items: await resolveSharedContentList(rows.filter(isPendingWorkReview).map(row => exposeContent(row))) };
}
function workReviewMailContent(title, reason) {
  const workTitle = safeText(title, 120) || '未命名作品';
  const reviewReason = String(reason == null ? '' : reason).trim() || DEFAULT_WORK_REJECTION_REASON;
  const reviewIntro = `你提交的作品《${workTitle}》未通过公开审核，当前仅自己可见。`;
  const reviewAdvice = reviewReason === DEFAULT_WORK_REJECTION_REASON ? '' : '可修改作品后重新提交审核。';
  return { workTitle, reviewReason, reviewIntro, reviewAdvice,
    body: `${reviewIntro}\n不通过原因：${reviewReason}${reviewAdvice ? '\n' + reviewAdvice : ''}` };
}
async function reviewWork(openid, payload) {
  await requireAdmin(openid);
  if (!['approved', 'rejected'].includes(payload.decision)) throw new Error('INVALID_REVIEW');
  const reason = payload.decision === 'rejected' ? String(payload.reason == null ? '' : payload.reason).trim() || DEFAULT_WORK_REJECTION_REASON : '';
  if (reason.length > 200) throw new Error('REVIEW_REASON_TOO_LONG');
  const reference = db.collection(COLLECTIONS.content).doc(safeText(payload.recordId, 160));
  const existing = await optionalDocument(reference);
  if (!existing) throw new Error('INVALID_REVIEW');
  if (Number(existing.updatedAt) !== Number(payload.updatedAt)) throw new Error('CONTENT_CONFLICT');
  if (!isPendingWorkReview(existing)) throw new Error('INVALID_REVIEW');
  await db.runTransaction(async transaction => {
    const ref = transaction.collection(COLLECTIONS.content).doc(existing._id);
    const current = await optionalDocument(ref);
    const profileRef = transaction.collection(COLLECTIONS.profiles).doc(existing.ownerOpenid);
    const owner = await optionalDocument(profileRef);
    if (!owner || !isPendingWorkReview(current) || Number(current.updatedAt) !== Number(existing.updatedAt) || JSON.stringify(current.payload) !== JSON.stringify(existing.payload)) throw new Error('CONTENT_CONFLICT');
    const reviewedAt = now();
    const reviewUpdate = { reviewStatus: payload.decision, reviewReason: reason, reviewedBy: openid, reviewedAt, updatedAt: reviewedAt, publishedAt: payload.decision === 'approved' ? Number(current.publishedAt) || reviewedAt : Number(current.publishedAt) || 0 };
    if (payload.decision === 'rejected') Object.assign(reviewUpdate, { visibility: 'self', 'payload.visibility': 'self' });
    await ref.update({ data: reviewUpdate });
    if (payload.decision === 'rejected') {
      const mailContent = workReviewMailContent(current.payload && (current.payload.title || current.payload.fileName), reason);
      // 审核和通知共同提交，重复点击或事务重试不会多发邮件。
      const mailId = stableId('work_review', current._id, current.updatedAt);
      await transaction.collection(COLLECTIONS.mailbox).doc(mailId).set({ data: Object.assign({
        recipientOpenid: current.ownerOpenid, type: 'work_review', title: '作品审核未通过',
        contentRef: current._id, contentId: current.contentId,
        status: 'message', createdAt: reviewedAt, date: chinaDateKey(reviewedAt)
      }, mailContent) });
    }
    await profileRef.update({ data: { contentRevision: (Number(owner.contentRevision) || 0) + 1 } });
  });
  return { reviewed: true };
}

function errorMessage(error) {
  const code = error && error.message || 'UNKNOWN';
  const priorityErrors = { UNTRUSTED_MEDIA_SOURCE: '请重新选择并上传文件，不支持直接引用外部文件地址', INVALID_REQUEST_ID: '请更新小程序后重新提交', INVALID_REVIEW: '审核内容不存在或操作无效', REVIEW_REASON_TOO_LONG: '不通过原因最多填写200字' };
  if (priorityErrors[code]) return { error: code, message: priorityErrors[code] };
  const checkType = error && error.securityType;
  const subject = checkType === 'image' ? '图片' : checkType === 'text' ? '文字' : '内容';
  if (code === 'CONTENT_UNSAFE') return { error: code, message: `微信${subject}安全检测未通过，请修改或更换后重试`, securityType: checkType || '' };
  if (code === 'CONTENT_REVIEW_REQUIRED') return { error: code, message: `微信${subject}安全检测建议进一步复核，本次未保存，请联系开发者核查`, securityType: checkType || '' };
  if (code === 'CONTENT_CHECK_UNAVAILABLE') return { error: code, message: `微信${subject}安全检测服务暂时不可用，请稍后重试`, securityType: checkType || '' };
  const syncErrors = { CONTENT_CONFLICT: '内容已在另一处更新，请刷新后重试', ACTIVITY_NAME_EXISTS: '已存在同名活动', ALBUM_NOT_FOUND: '目标相册不存在，请刷新后重试', ALBUM_CONTEXT_MISMATCH: '只能移动到同一活动和阶段下的相册' };
  if (syncErrors[code]) return { error: code, message: syncErrors[code] };
  const photoVisibilityErrors = { INVALID_VISIBILITY: '请选择公开、仅好友可见或仅自己可见', INVALID_PHOTO_SELECTION: '请先选择需要修改的照片', PHOTO_SELECTION_CHANGED: '部分所选照片已删除或移动，请刷新相册后重试' };
  if (photoVisibilityErrors[code]) return { error: code, message: photoVisibilityErrors[code] };
  const friendManagementErrors = { FRIEND_REQUEST_REASON_REQUIRED: '请填写申请内容后再提交', DEFAULT_FRIEND_GROUP: '默认分组不能删除', INVALID_FRIEND_GROUP_NAME: '分组名称需为1至20个字', INVALID_FRIEND_GROUP: '分组标识无效', FRIEND_GROUP_EXISTS: '已存在同名分组', FRIEND_GROUP_NOT_FOUND: '分组不存在，请刷新后重试', INVALID_FRIEND_SORT: '请选择有效的好友排序方式' };
  if (friendManagementErrors[code]) return { error: code, message: friendManagementErrors[code] };
  if (code === 'MEDIA_FILE_TOO_LARGE') return { error: code, message: '单个文件不能超过1000M' };
  if (code === 'IMAGE_FILE_TOO_LARGE') return { error: code, message: '单张图片不能超过20M' };
  if (code === 'PROFILE_INCOMPLETE') return { error: code, message: '请填写昵称和个人简介后保存' };
  if (code === 'PROFILE_REQUIRED') return { error: code, message: '请先完善并保存个人简介' };
  if (code === 'ALBUM_NAME_REQUIRED') return { error: code, message: '请填写相册名称' };
  if (code === 'VIDEO_FILE_TOO_LARGE') return { error: code, message: '压缩后的视频不能超过500M' };
  if (code === 'FILE_SIZE_UNAVAILABLE') return { error: code, message: '暂时无法核对云端文件大小，请稍后重试' };
  // 新环境若尚未在控制台创建集合，云 SDK 会返回不同版本的“集合不存在”错误。
  // 单独提示可避免把初始化问题误认为好友功能故障。
  const raw = [code, error && error.errMsg, error && error.errCode].filter(Boolean).join(' ');
  if (/collection.*not.*exist|collection.*not.*found|集合.*不存在|-502005/i.test(raw)) {
    return { error: 'COLLECTION_MISSING', message: '云数据库集合尚未创建，请按 CLOUD_SETUP.md 创建后重试' };
  }
  const messages = { FORBIDDEN: '无权访问此内容', ADMIN_FORBIDDEN: '当前账号没有开发者管理权限', TEST_CLEANUP_CONFIRMATION_REQUIRED: '测试账号清理确认信息不匹配', INVALID_CAMPAIGN_KEY: '批次标识只能填写字母、数字、横线或下划线', INVALID_REWARD_QUANTITY: '奖励数量必须是 1 至 999 的整数', INVALID_REWARD_DEADLINE: '请选择有效的领取截止日期', REWARD_DEADLINE_PASSED: '领取截止日期必须晚于当前时间', INVALID_TARGET_UID: '请输入接收福利账号的 7 位 UID', UID_NOT_FOUND: '未找到该 UID 用户', INVALID_UID: '请输入 7 位好友 UID', SELF_REQUEST: '不能添加自己为好友', ALREADY_FRIENDS: '对方已经是你的好友', REQUEST_EXISTS: '已发送过好友申请，请等待处理', REQUEST_NOT_FOUND: '申请不存在或已处理', FRIEND_NOT_FOUND: '好友不存在', INVALID_CONTENT_ID: '内容标识无效', TAG_TOO_LONG: '每个标签不能超过 10 个字', WORK_FILE_TOO_LARGE: '作品文件不能大于 20MB', SHARED_FILE_NOT_UPLOADED: '图片或作品文件尚未成功上传云端，请重新选择后保存', CONTENT_UNSAFE: '内容包含不适宜信息，请修改后重试', CONTENT_CHECK_UNAVAILABLE: '内容安全服务暂时不可用，请稍后重试', IMAGE_SECURITY_SIZE_LIMIT: '图片需压缩到 1MB 以内后再上传', EMPTY_COMMENT: '评论不能为空', EMPTY_MESSAGE: '消息不能为空', EMPTY_FEEDBACK: '请先填写想反馈的问题', FEEDBACK_TOO_LONG: '反馈内容不能超过 1000 个字', FEEDBACK_TOO_FREQUENT: '反馈发送得太频繁，请一分钟后再试', NO_ADMIN_CONFIGURED: '暂未配置接收反馈的管理员账号', INVALID_REPLY: '回复对象无效', COMMENT_NOT_FOUND: '评论不存在或已删除', COMMENT_DELETE_FORBIDDEN: '只有内容发布者可以删除这条评论', CANNOT_REPORT_SELF: '不能举报自己发布的内容', REPORT_EXISTS: '你已经举报过该内容，等待处理即可', INVALID_ITEM: '道具不存在', ITEM_NOT_ENOUGH: '背包中的道具数量不足', CANNOT_GIFT_SELF: '不能给自己赠送道具', GIFT_MESSAGE_TOO_LONG: '留言字数超过限制', TASK_NOT_COMPLETE: '任务尚未完成', TASK_ALREADY_CLAIMED: '该奖励已经领取', INVALID_TASK: '任务不存在', MAIL_NOT_FOUND: '邮件不存在', MAIL_ALREADY_CLAIMED: '该邮件已经领取', MAIL_EXPIRED: '该奖励邮件已过期并自动删除' };
  const accountDeleteMessages = {
    INVALID_DELETE_UID: '请输入要删除账号的 7 位 UID',
    ACCOUNT_DELETE_DUPLICATE_UID: '该 UID 对应多条资料，请先在后台核查',
    ACCOUNT_DELETE_PROTECTED: '不能删除当前管理员或其他管理员账号，请先撤销目标账号的管理员权限',
    ACCOUNT_DELETE_CONFIRMATION_REQUIRED: '账号核对信息已变化，请重新查询并确认',
    ACCOUNT_DELETE_IN_PROGRESS: '该账号正在删除中，请稍后核对结果',
    ACCOUNT_DELETE_ALREADY_COMPLETE: '该账号已完成删除，请重新查询当前资料',
    ACCOUNT_DELETE_TARGET_CHANGED: '目标账号资料已变化，删除已取消',
    ACCOUNT_DELETE_SCAN_LIMIT: '关联记录过多，为避免遗漏已中止删除，请联系开发者分批处理'
  };
  return { error: code, message: accountDeleteMessages[code] || messages[code] || '操作未完成，请稍后重试' };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action;
  const payload = event && event.payload || {};
  try {
    if (event && (event.Type === 'Timer' || /^hui[A-Za-z]+$/.test(String(event.TriggerName || '')))) {
      if (OPENID) throw new Error('FORBIDDEN');
      if (event.TriggerName === 'huiExpiredRewardCleanup') return await cleanupExpiredRewardMails();
      return await runRankingRewards();
    }
    if (!OPENID) throw new Error('FORBIDDEN');
    if (action === 'profile.bootstrap') { const { profile, isNewUser } = await bootstrapProfile(OPENID, payload.profile || {}); await Promise.all([ensureDailyTask(OPENID), ensureWallet(OPENID)]); return { profile: ownPublicProfile(profile, OPENID), isNewUser }; }
    if (action === 'profile.upsert') return { profile: ownPublicProfile(await ownProfile(OPENID, payload.profile || {}, true), OPENID) };
    if (action === 'profile.current') return { profile: await currentProfile(OPENID) };
    if (action === 'state.mine') return await ownState(OPENID);
    if (action === 'state.works') return await ownWorks(OPENID);
    if ((await ownProfile(OPENID)).profileCompleted === false && action !== 'account.deleteRequest') throw new Error('PROFILE_REQUIRED');
    if (action === 'content.upsert') return { item: await upsertContent(OPENID, payload) };
    if (action === 'content.manage') return await contentManager.manage(OPENID, payload);
    if (action === 'content.delete') return await removeContent(OPENID, payload);
    if (action === 'content.get') return await getContent(OPENID, payload);
    if (action === 'content.view') return await viewContent(OPENID, payload);
    if (action === 'content.like') return await likeContent(OPENID, payload);
    if (action === 'content.publicList') return await publicList(payload);
    if (action === 'content.publicYears') return await publicYears();
    if (action === 'comment.upsert') return { comment: await saveComment(OPENID, payload) };
    if (action === 'comment.list') return await listComments(OPENID, payload);
    if (action === 'comment.like') return await likeComment(OPENID, payload);
    if (action === 'favorite.list') return await favoriteList(OPENID, payload);
    if (action === 'comment.delete') return await removeComment(OPENID, payload);
    if (action === 'comment.deleteForTarget') return await removeCommentsForTarget(OPENID, payload);
    if (action === 'report.create') return await saveReport(OPENID, payload);
    if (action === 'feedback.send') return await sendFeedback(OPENID, payload);
    if (action === 'account.deleteRequest') return await requestAccountDeletion(OPENID, payload);
    if (action === 'friend.request') return { request: await requestFriend(OPENID, payload) };
    if (action === 'friend.requests') return await listRequests(OPENID);
    if (action === 'friend.badge') return await friendBadge(OPENID);
    if (action === 'friend.accept') return await acceptRequest(OPENID, payload);
    if (action === 'friend.reject') return await rejectRequest(OPENID, payload);
    if (action === 'friend.list') return await friendList(OPENID);
    if (action === 'friend.manage') return await friendManager.manage(OPENID, payload);
    if (action === 'friend.get') return await friendGet(OPENID, payload);
    if (action === 'friend.remark') return await friendRemark(OPENID, payload);
    if (action === 'friend.remove') return await friendRemove(OPENID, payload);
    if (action === 'friend.content') return await friendContent(OPENID, payload);
    if (action === 'chat.list') return await chatList(OPENID, payload);
    if (action === 'chat.unread') return await chatUnread(OPENID);
    if (action === 'chat.send') return await chatSend(OPENID, payload);
    if (action === 'inventory.get') return await inventoryGet(OPENID);
    if (action === 'gift.send') return await giftSend(OPENID, payload);
    if (action === 'task.status') return await taskStatus(OPENID);
    if (action === 'task.claim') return await taskClaim(OPENID, payload);
    if (action === 'mail.list') return await mailList(OPENID);
    if (action === 'mail.claim') return await mailClaim(OPENID, payload);
    if (action === 'mail.read') return await mailRead(OPENID);
    if (action === 'mail.delete') return await mailDelete(OPENID, payload);
    if (action === 'admin.work.pending') return await pendingWorkReviews(OPENID);
    if (action === 'admin.work.review') return await reviewWork(OPENID, payload);
    if (action === 'admin.status') return await adminStatus(OPENID);
    if (action === 'admin.account.previewDeletion') return await previewAccountDeletion(OPENID, payload);
    if (action === 'admin.account.deleteByUid') return await deleteAccountByUid(OPENID, payload);
    if (action === 'admin.reward.broadcast') return await adminBroadcastReward(OPENID, payload);
    if (action === 'admin.reward.user') return await adminUserReward(OPENID, payload);
    return { error: 'UNKNOWN_ACTION', message: '未知请求' };
  } catch (error) {
    return errorMessage(error);
  }
};
