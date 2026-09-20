// 同行足迹模板云端 API。
// 所有跨用户读取、好友关系和公开榜单都经由本函数处理，客户端不直接读写云数据库，
// 因而无法通过修改前端参数读取别人的私密内容。
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  profiles: 'hui_profiles',
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
  payOrders: 'hui_pay_orders',
  paymentEvents: 'hui_payment_events',
  rewardRuns: 'hui_reward_runs'
};

const VISIBILITIES = ['self', 'friends', 'public'];
const CONTENT_KINDS = ['photo', 'growth', 'work', 'companion', 'activity', 'album'];
const ITEM_CATALOG = {
  heart: { id: 'heart', name: '爱心', affection: 1, priceFen: 100, purchasable: true },
  star: { id: 'star', name: '星星', affection: 3, priceFen: 300, purchasable: true },
  envelope: { id: 'envelope', name: '信封', affection: 5, priceFen: 500, purchasable: true },
  gift_box: { id: 'gift_box', name: '礼盒', affectionMin: 1, affectionMax: 10, priceFen: 500, purchasable: true },
  memory_book: { id: 'memory_book', name: '纪念册', affection: 520, priceFen: 0, purchasable: false },
  mooncake: { id: 'mooncake', name: '月饼', affectionMin: 1, affectionMax: 5, priceFen: 0, purchasable: false },
  red_packet: { id: 'red_packet', name: '红包', affectionMin: 1, affectionMax: 10, priceFen: 0, purchasable: false }
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
// 支付标识与密钥全部由部署者在云函数环境变量中配置，公开模板不提供生产值。
const PAY_APP_ID = process.env.HUI_WX_APP_ID || '';
const PAY_OFFER_ID = process.env.HUI_PAY_OFFER_ID || '';

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
function payEnvironment() { return String(process.env.HUI_PAY_ENV || '0') === '1' ? 1 : 0; }
function payAppKey() { return payEnvironment() === 1 ? process.env.HUI_PAY_SANDBOX_APP_KEY || '' : process.env.HUI_PAY_APP_KEY || ''; }
function hmac(key, value) { return crypto.createHmac('sha256', key).update(value).digest('hex'); }
function httpsJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? '' : String(options.body);
    const request = https.request(url, { method: options.method || (body ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json' }, body ? { 'Content-Length': Buffer.byteLength(body) } : {}, options.headers || {}) }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text || '{}')); } catch (error) { reject(new Error(`WECHAT_RESPONSE_INVALID:${text.slice(0, 80)}`)); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('WECHAT_REQUEST_TIMEOUT')));
    if (body) request.write(body);
    request.end();
  });
}

// 内容安全校验必须在云端执行，不能依赖可被绕过的前端判断。
// 文本按微信接口的单次长度分段；图片只校验已经上传到云存储或 HTTPS 的文件。
function securityError(error) {
  const raw = [error && error.message, error && error.errMsg, error && error.errCode, error && error.errcode].filter(Boolean).join(' ');
  if (/87014|risky|review|不合规|违规/i.test(raw)) return new Error('CONTENT_UNSAFE');
  return new Error('CONTENT_CHECK_UNAVAILABLE');
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
    try {
      const response = await cloud.openapi.security.msgSecCheck({ content, version: 2, scene, openid });
      const result = response && (response.result || response);
      const code = Number(response && (response.errCode == null ? response.errcode : response.errCode));
      if (code === 87014) throw new Error('CONTENT_UNSAFE');
      if (Number.isFinite(code) && code !== 0) throw new Error('CONTENT_CHECK_UNAVAILABLE');
      const suggest = String(result && result.suggest || '').toLowerCase();
      if (suggest && suggest !== 'pass') throw new Error('CONTENT_UNSAFE');
    } catch (error) {
      if (error && error.message === 'CONTENT_UNSAFE') throw error;
      throw securityError(error);
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
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        return resolve(downloadHttpsBuffer(response.headers.location, redirects + 1));
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
  return null;
}

async function checkImageSafety(paths) {
  const unique = [...new Set((paths || []).filter(path => /^(cloud:\/\/|https:\/\/)/i.test(String(path || ''))))];
  const inspect = async path => {
    try {
      const content = await imageBuffer(path);
      if (!content) return;
      const response = await cloud.openapi.security.imgSecCheck({ media: { contentType: imageContentType(path), value: content } });
      const code = Number(response && (response.errCode == null ? response.errcode : response.errCode));
      if (code === 87014) throw new Error('CONTENT_UNSAFE');
      if (Number.isFinite(code) && code !== 0) throw new Error('CONTENT_CHECK_UNAVAILABLE');
    } catch (error) {
      if (error && (error.message === 'CONTENT_UNSAFE' || error.message === 'CONTENT_CHECK_UNAVAILABLE' || error.message === 'IMAGE_SECURITY_SIZE_LIMIT')) throw error;
      throw securityError(error);
    }
  };
  // 九图逐张串行检查容易超过云函数执行时间；每批三张并行兼顾速度和内存占用。
  for (let index = 0; index < unique.length; index += 3) {
    await Promise.all(unique.slice(index, index + 3).map(inspect));
  }
}

async function checkSubmission(openid, text, images, scene) {
  await checkTextSafety(openid, text, scene);
  await checkImageSafety(images);
}

function contentTextValues(kind, item) {
  if (kind === 'activity' || kind === 'album') return [item.name];
  if (kind === 'photo') return [item.name, item.activityName];
  if (kind === 'growth') return [item.title, item.body, item.location, item.activityName].concat(item.tags || []);
  if (kind === 'work') return [item.title, item.body, item.location, item.fileName, item.activityName];
  return [item.name, item.introduction, item.story, item.activityName];
}

function contentImageValues(kind, item) {
  if (kind === 'activity' || kind === 'album' || kind === 'work') return [item.cover];
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
    visibility: visibility(input.visibility),
    status: kind === 'work' && input.status === 'draft' ? 'draft' : 'published'
  };
  if (kind === 'activity') return Object.assign(base, {
    name: safeText(input.name, 60), cover: safeText(input.cover, 500)
  });
  if (kind === 'album') return Object.assign(base, {
    name: safeText(input.name, 60) || '回忆集', cover: safeText(input.cover, 500), autoCreated: input.autoCreated === true
  });
  if (kind === 'photo') return Object.assign(base, {
    image: safeText(input.image, 500), name: safeText(input.name, 60), title: safeText(input.name, 60), showName: input.showName === true, folderId: safeText(input.folderId, 80), hideUid: input.hideUid === true
  });
  if (kind === 'growth') return Object.assign(base, {
    title: safeText(input.title, 80), body: safeText(input.body, 2000), tags: (Array.isArray(input.tags) ? input.tags : []).map(item => safeText(item, 20)).filter(Boolean).slice(0, 8),
    images: (Array.isArray(input.images) ? input.images : []).map(item => safeText(item, 500)).filter(Boolean).slice(0, 9), image: safeText(input.image, 500), location: safeText(input.location, 80), hideUid: input.hideUid === true
  });
  if (kind === 'work') return Object.assign(base, {
    title: safeText(input.title, 80), body: safeText(input.body, 5000), cover: safeText(input.cover, 500), filePath: safeText(input.filePath, 500),
    fileName: safeText(input.fileName, 120), fileSize: metric(input.fileSize), fileType: safeText(input.fileType, 30), location: safeText(input.location, 80), hideUid: input.hideUid === true
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

// UID 只由云端分配，模板默认始终生成未被占用的七位随机数。
const CONFIRMED_TEST_ACCOUNT_UIDS = [];
const CONFIRMED_TEST_CLEANUP_RUN_ID = 'disabled_template_cleanup';

async function uidExists(uid) {
  const found = await db.collection(COLLECTIONS.profiles).where({ uid: String(uid) }).limit(1).get();
  return found.data.length > 0;
}

// OpenID 是微信为每个小程序用户固定分配的身份主键；UID 只是可在后台调整的公开编号。
// 所有权限、好友关系和内容归属均使用 OpenID，绝不以 UID 作为授权依据。
async function profileByOpenid(openid) {
  if (!openid) return null;
  return db.collection(COLLECTIONS.profiles).doc(String(openid)).get().then(result => result.data).catch(() => null);
}

// 批量读取当前资料，专门用于把旧内容快照中的 UID 更新为后台当前设置的 UID。
async function profilesByOpenids(openids) {
  const result = {};
  const unique = [...new Set((openids || []).filter(Boolean))];
  const loaded = await Promise.all(unique.map(async openid => {
    const profile = await profileByOpenid(openid);
    return profile ? { openid, profile } : null;
  }));
  const available = loaded.filter(Boolean);
  const resolved = await resolveSharedContentList(available.map(item => ({ avatar: item.profile.avatar || '' })));
  available.forEach((item, index) => { result[item.openid] = Object.assign({}, item.profile, publicProfile(item.profile), { avatar: resolved[index].avatar || item.profile.avatar || '' }); });
  return result;
}

async function createUid() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const uid = String(Math.floor(1000000 + Math.random() * 9000000));
    if (!(await uidExists(uid))) return uid;
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

async function ownProfile(openid, providedProfile) {
  const reference = db.collection(COLLECTIONS.profiles).doc(openid);
  let existing = null;
  try { existing = (await reference.get()).data; } catch (error) { existing = null; }
  if (providedProfile && Array.isArray(providedProfile.tags) && providedProfile.tags.some(item => Array.from(String(item || '').trim()).length > 10)) throw new Error('TAG_TOO_LONG');
  const clean = sanitizeProfile(providedProfile || {});
  if (!existing) {
    await checkSubmission(openid, [clean.name, clean.bio].concat(clean.tags || []), [clean.avatar], 1);
    // 不接受客户端上传的 UID，避免本地缓存或伪造参数抢占固定 UID。
    const profile = Object.assign({ openid, uid: await createUid(), createdAt: now() }, clean, { updatedAt: now() });
    await reference.set({ data: profile });
    return Object.assign({ _id: openid }, profile);
  }
  const needsUidUpgrade = !validUid(existing.uid);
  if (providedProfile || needsUidUpgrade) {
    if (providedProfile) {
      const textChanged = clean.name !== safeText(existing.name, 20) || clean.bio !== safeText(existing.bio, 240) || JSON.stringify(clean.tags || []) !== JSON.stringify(existing.tags || []);
      const avatarChanged = clean.avatar !== safeText(existing.avatar, 500);
      await checkSubmission(openid, textChanged ? [clean.name, clean.bio].concat(clean.tags || []) : [], avatarChanged ? [clean.avatar] : [], 1);
    }
    const uid = needsUidUpgrade ? await createUid() : existing.uid;
    // 不从客户端接收 uid；后台直接修改资料表中的 uid 后，此处会原样保留该值。
    const profile = Object.assign({}, existing, clean, { openid, uid, updatedAt: now() });
    // get() 返回的数据含系统字段 _id；CloudBase 禁止在 set/update 的 data 中再次写入 _id。
    // 旧实现因此只能首次建档，之后所有简介编辑都会失败并继续显示“未命名用户”。
    delete profile._id;
    await reference.set({ data: profile });
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
  return existing || ownProfile(openid, providedProfile || {});
}

// 仅返回当前账号资料：不接收客户端资料，因而不会覆盖管理员在后台改过的 UID。
async function currentProfile(openid) {
  const profile = await profileByOpenid(openid);
  return publicProfile(profile || await ownProfile(openid));
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
  // 只使用单字段查询，避免新云环境尚未建立组合索引时详情页直接失败。
  const result = await db.collection(COLLECTIONS.content).where({ ownerOpenid }).limit(100).get();
  return result.data.find(item => item.kind === kind && String(item.contentId) === String(id)) || null;
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
    visibility: record.visibility,
    status: record.status,
    views: metric(record.views),
    likes: metric(record.likes),
    comments: metric(record.commentCount),
    publishedAt: Number(record.publishedAt) || 0
  });
}

// 云存储文件 ID 在发布者设备上可直接预览，但其他用户受存储权限和客户端版本影响可能无法渲染。
// 详情、榜单和好友足迹返回前统一换成短期 HTTPS 地址；作品同时保留原 filePath 供 downloadFile 使用。
async function resolveSharedContentList(inputs) {
  const items = (inputs || []).map(input => Object.assign({}, input || {}));
  const candidates = items.reduce((all, item) => all.concat(item.image || [], item.avatar || [], item.cover || [], item.filePath || [], Array.isArray(item.images) ? item.images : []), []);
  const fileIds = [...new Set(candidates.filter(value => /^cloud:\/\//i.test(String(value || ''))))];
  if (!fileIds.length) return items;
  const urls = {};
  try {
    // CloudBase 单次文件列表存在数量上限，分批转换能兼顾九图记录和较长的好友足迹。
    for (let index = 0; index < fileIds.length; index += 50) {
      const result = await cloud.getTempFileURL({ fileList: fileIds.slice(index, index + 50) });
      (result.fileList || []).forEach(file => { if (file && file.fileID && file.tempFileURL) urls[file.fileID] = file.tempFileURL; });
    }
  } catch (error) {
    // 地址转换失败不应阻止文字内容加载，客户端还会再尝试一次转换。
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
  if (record.ownerOpenid === openid || record.visibility === 'public') return true;
  return record.visibility === 'friends' && !!(await friendship(openid, record.ownerOpenid));
}

async function upsertContent(openid, payload) {
  const kind = payload.kind;
  if (CONTENT_KINDS.indexOf(kind) < 0) throw new Error('INVALID_KIND');
  const profile = await ownProfile(openid);
  const item = sanitizeContent(kind, payload.item || {});
  if (!item.id) throw new Error('INVALID_CONTENT_ID');
  // 文件大小必须由云端再校验一次，避免绕过编辑页直接提交超大作品。
  if (kind === 'work' && item.fileSize > 20 * 1024 * 1024) throw new Error('WORK_FILE_TOO_LARGE');
  // 好友/公开内容不能引用发布者设备上的 wxfile、http://tmp 等临时路径。
  // 这类地址仅发布者自己能访问，是“别人看不到图片、打不开作品”的根因。
  if (item.visibility !== 'self') {
    const portable = value => !value || /^(cloud:\/\/|https?:\/\/)/i.test(String(value));
    const assets = contentImageValues(kind, item).concat(kind === 'work' ? [item.filePath] : []);
    if (assets.some(value => !portable(value))) throw new Error('SHARED_FILE_NOT_UPLOADED');
  }
  const old = await findContent(openid, kind, item.id);
  const oldItem = old && old.payload || {};
  const textChanged = !old || JSON.stringify(contentTextValues(kind, oldItem)) !== JSON.stringify(contentTextValues(kind, item));
  const previousImages = contentImageValues(kind, oldItem);
  const changedImages = contentImageValues(kind, item).filter(path => path && previousImages.indexOf(path) < 0);
  await checkSubmission(openid, textChanged ? contentTextValues(kind, item) : [], changedImages, 3);
  const record = {
    ownerOpenid: openid,
    ownerUid: profile.uid,
    ownerName: profile.name || '未命名用户',
    ownerAvatar: profile.avatar || '',
    kind,
    contentId: item.id,
    visibility: item.visibility,
    status: item.status,
    payload: item,
    updatedAt: now(),
    createdAt: old ? old.createdAt : now(),
    // “最新”按首次发布的时间，而非互动热度或后来编辑的时间排列。
    publishedAt: old && old.status === 'published' ? (Number(old.publishedAt) || Number(old.updatedAt) || now()) : (item.status === 'published' ? now() : 0),
    views: old ? metric(old.views) : 0,
    likes: old ? metric(old.likes) : 0,
    commentCount: old ? metric(old.commentCount) : 0
  };
  let recordId = old && old._id;
  if (old) await db.collection(COLLECTIONS.content).doc(old._id).set({ data: record });
  else recordId = (await db.collection(COLLECTIONS.content).add({ data: record }))._id;
  return exposeContent(Object.assign({ _id: recordId }, record), profile);
}

async function removeContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id);
  if (!record || record.ownerOpenid !== openid) throw new Error('FORBIDDEN');
  await db.collection(COLLECTIONS.content).doc(record._id).remove();
  await db.collection(COLLECTIONS.likes).where({ contentRef: record._id }).remove();
  await db.collection(COLLECTIONS.comments).where({ contentRef: record._id }).remove();
  return { deleted: true };
}

async function viewContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  if (record.ownerOpenid !== openid) await markDailyTask(openid, 'view');
  // 同一微信用户对同一内容的浏览，5 分钟内只计一次，避免反复打开刷热度。
  const existingResult = await db.collection(COLLECTIONS.views).where({ contentRef: record._id }).limit(100).get();
  const existing = existingResult.data.find(item => item.viewerOpenid === openid);
  const lastViewedAt = existing ? Number(existing.lastViewedAt) || 0 : 0;
  if (now() - lastViewedAt < 5 * 60 * 1000) return { views: metric(record.views), counted: false };
  if (existing) await db.collection(COLLECTIONS.views).doc(existing._id).update({ data: { lastViewedAt: now() } });
  else await db.collection(COLLECTIONS.views).add({ data: { contentRef: record._id, viewerOpenid: openid, lastViewedAt: now() } });
  await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { views: _.inc(1) } });
  return { views: metric(record.views) + 1, counted: true };
}

async function getContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const likedResult = await db.collection(COLLECTIONS.likes).where({ contentRef: record._id }).limit(100).get();
  const liked = likedResult.data.find(item => item.actorOpenid === openid);
  // 编辑权由云端按 OPENID 判定，不能只依赖前端传来的 UID。
  const item = exposeContent(record, await profileByOpenid(record.ownerOpenid));
  // 公开内容可通过 recordId 定位；作者选择隐蔽 UID 时，客户端不会收到可展示的 UID。
  if (item.hideUid) item.ownerUid = '';
  return { item: await resolveSharedContentFiles(Object.assign(item, { favorite: !!liked, canEdit: record.ownerOpenid === openid })) };
}

async function likeContent(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const existingResult = await db.collection(COLLECTIONS.likes).where({ contentRef: record._id }).limit(100).get();
  const existing = existingResult.data.find(item => item.actorOpenid === openid);
  if (existing) {
    await db.collection(COLLECTIONS.likes).doc(existing._id).remove();
    await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { likes: _.inc(-1) } });
    return { favorite: false, likes: Math.max(0, metric(record.likes) - 1) };
  }
  await db.collection(COLLECTIONS.likes).add({ data: { contentRef: record._id, actorOpenid: openid, createdAt: now() } });
  await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { likes: _.inc(1) } });
  if (record.ownerOpenid !== openid) await markDailyTask(openid, 'like');
  return { favorite: true, likes: metric(record.likes) + 1 };
}

// 热度需要由浏览和点赞共同排序，无法直接交给数据库单字段排序；按批读取公开内容后再分页。
async function loadPublicContents() {
  const all = [];
  const batchSize = 100;
  const maxRecords = 1000;
  for (let skip = 0; skip < maxRecords; skip += batchSize) {
    const result = await db.collection(COLLECTIONS.content).where({ visibility: 'public' }).skip(skip).limit(batchSize).get();
    all.push(...result.data.filter(item => item.status === 'published'));
    if (result.data.length < batchSize) break;
  }
  // 旧内容没有 commentCount 字段；读取榜单时用评论表补齐，保证新热度公式立即对历史内容生效。
  if (all.some(item => item.commentCount == null)) {
    const comments = [];
    for (let skip = 0; skip < 1000; skip += 100) {
      const result = await db.collection(COLLECTIONS.comments).skip(skip).limit(100).get();
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
  const selectedYear = Number(payload.year) || new Date().getFullYear();
  const selectedMonth = Number(payload.month) || new Date().getMonth() + 1;
  const campId = safeText(payload.campId, 40);
  const kind = ['photo', 'growth', 'work'].indexOf(payload.kind) >= 0 ? payload.kind : '';
  const keyword = safeText(payload.keyword, 60).toLocaleLowerCase();
  const page = Math.max(1, Number(payload.page) || 1);
  const pageSize = 20;
  const weekStart = timestamp => {
    const date = new Date(timestamp || 0);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date.getTime();
  };
  const currentWeek = weekStart(now());
  const dateParts = value => { const match = String(value || '').match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/); return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : { year: 0, month: 0, day: 0 }; };
  const ranked = result.filter(item => ['photo', 'growth', 'work'].indexOf(item.kind) >= 0 && (!kind || item.kind === kind)).filter(item => {
    const date = dateParts(item.payload && item.payload.date);
    if (range === 'week') return weekStart(item.publishedAt || item.updatedAt || item.createdAt) === currentWeek && (!campId || (item.payload && item.payload.campId) === campId);
    if (range === 'month') return date.year === selectedYear && date.month === selectedMonth && (!campId || (item.payload && item.payload.campId) === campId);
    if (range === 'year') return date.year === selectedYear && (!campId || (item.payload && item.payload.campId) === campId);
    return !campId || (item.payload && item.payload.campId) === campId;
  }).filter(item => {
    if (!keyword) return true;
    const content = item.payload || {};
    // 隐藏名称的图片不会因名称被搜索到；其余公开文字内容均可匹配。
    const searchable = [content.showName === true ? content.name : '', content.title, content.body, content.fileName, content.location, content.activityName, content.campId, ...(Array.isArray(content.tags) ? content.tags : [])].join(' ').toLocaleLowerCase();
    return searchable.indexOf(keyword) >= 0;
  }).sort((a, b) => range === 'latest'
    ? (Number(b.publishedAt) || Number(b.updatedAt) || 0) - (Number(a.publishedAt) || Number(a.updatedAt) || 0)
    : heat(b) - heat(a) || b.updatedAt - a.updatedAt);
  const start = (page - 1) * pageSize;
  const pageRecords = ranked.slice(start, start + pageSize);
  const owners = await profilesByOpenids(pageRecords.map(item => item.ownerOpenid));
  const items = pageRecords.map((item, index) => {
    const exposed = exposeContent(item, owners[item.ownerOpenid]);
    const payloadItem = item.payload || {};
    const title = item.kind === 'photo' ? (payloadItem.showName === true && payloadItem.name ? payloadItem.name : '相册中的一段记忆') : (payloadItem.title || (item.kind === 'growth' ? '未命名记录' : '未命名作品'));
    const summary = item.kind === 'photo' ? (payloadItem.campId || '相册记忆') : (payloadItem.body || payloadItem.fileName || '一段成长记忆');
    const image = item.kind === 'photo' ? payloadItem.image : item.kind === 'growth' ? (payloadItem.image || (payloadItem.images || [])[0] || '') : payloadItem.cover || '';
    // 榜单详情统一用 recordId 打开，因此隐蔽 UID 不影响详情、浏览、点赞或评论。
    if (payloadItem.hideUid) exposed.ownerUid = '';
    return Object.assign(exposed, { title, summary, image, rank: start + index + 1, heat: heat(item), kindLabel: item.kind === 'photo' ? '相册' : item.kind === 'growth' ? '记录' : '作品' });
  });
  return { items: await resolveSharedContentList(items), page, pageSize, total: ranked.length, hasNext: start + pageSize < ranked.length };
}

async function publicYears() {
  const result = await loadPublicContents();
  const years = [new Date().getFullYear()];
  result.forEach(item => { const match = String(item.payload && item.payload.date || '').match(/^(\d{4})/); const year = match ? Number(match[1]) : 0; if (year && years.indexOf(year) < 0) years.push(year); });
  return { years: years.sort((a, b) => b - a) };
}

// 同一用户更换手机或清理本地缓存后，用云端状态恢复“足迹”“好友”“我的”中的私人内容。
async function ownState(openid) {
  const profile = await ownProfile(openid);
  const result = await db.collection(COLLECTIONS.content).where({ ownerOpenid: openid }).limit(100).get();
  const state = { profile: publicProfile(profile), photos: [], growth: [], works: [], companions: [], activities: [], albums: [] };
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
    const existing = await db.collection(COLLECTIONS.comments).doc(clientId).get().then(result => result.data).catch(() => null);
    await db.collection(COLLECTIONS.comments).doc(clientId).set({ data });
    if (!existing) await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { commentCount: _.inc(1) } });
    return Object.assign({ id: clientId }, data);
  }
  const added = await db.collection(COLLECTIONS.comments).add({ data });
  await db.collection(COLLECTIONS.content).doc(record._id).update({ data: { commentCount: _.inc(1) } });
  return Object.assign({ id: added._id }, data);
}

async function listComments(openid, payload) {
  const record = await findContent(openid, payload.kind, payload.id, payload.ownerUid, payload.recordId);
  if (!(await canReadContent(openid, record))) throw new Error('FORBIDDEN');
  const result = await db.collection(COLLECTIONS.comments).where({ contentRef: record._id }).limit(100).get();
  result.data.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const ids = result.data.map(item => item._id);
  const likedResult = ids.length ? await db.collection(COLLECTIONS.likes).where({ actorOpenid: openid }).limit(100).get() : { data: [] };
  const liked = { data: likedResult.data.filter(item => ids.indexOf(item.commentRef) >= 0) };
  const favoriteIds = {};
  liked.data.forEach(item => { favoriteIds[item.commentRef] = true; });
  const authors = await profilesByOpenids(result.data.reduce((all, item) => all.concat(item.authorOpenid || [], item.replyToOpenid || []), []));
  // 兼容早期只保存 UID、尚未保存 authorOpenid 的评论，避免旧评论永久停留在“未命名用户”。
  const legacyUids = [...new Set(result.data.reduce((all, item) => all.concat(item.authorUid || [], item.replyToUid || []), []).filter(Boolean))];
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
    return Object.assign({ id: item._id, authorInitial: (item.author || '我').slice(0, 1), favorite: !!favoriteIds[item._id], likes: metric(item.likes), isMine: item.authorOpenid === openid }, item, {
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
  const comment = await db.collection(COLLECTIONS.comments).doc(payload.id).get().then(result => result.data).catch(() => null);
  if (!comment) throw new Error('COMMENT_NOT_FOUND');
  const content = await db.collection(COLLECTIONS.content).doc(comment.contentRef).get().then(result => result.data).catch(() => null);
  if (!(await canReadContent(openid, content))) throw new Error('FORBIDDEN');
  const existingResult = await db.collection(COLLECTIONS.likes).where({ commentRef: comment._id }).limit(100).get();
  const existing = existingResult.data.find(item => item.actorOpenid === openid);
  if (existing) {
    await db.collection(COLLECTIONS.likes).doc(existing._id).remove();
    await db.collection(COLLECTIONS.comments).doc(comment._id).update({ data: { likes: _.inc(-1) } });
    return { favorite: false, likes: Math.max(0, metric(comment.likes) - 1) };
  }
  await db.collection(COLLECTIONS.likes).add({ data: { commentRef: comment._id, actorOpenid: openid, createdAt: now() } });
  await db.collection(COLLECTIONS.comments).doc(comment._id).update({ data: { likes: _.inc(1) } });
  return { favorite: true, likes: metric(comment.likes) + 1 };
}

// 收藏页以 hui_likes 为唯一事实来源：内容点赞使用 contentRef，评论点赞使用 commentRef。
// 因此跨设备、给他人公开内容点赞后，也能在“我的收藏”中恢复。
async function favoriteList(openid, payload = {}) {
  const type = ['photo', 'growth', 'comment'].indexOf(payload.type) >= 0 ? payload.type : 'photo';
  // 本地排序可避免首次部署还要额外创建复合索引；收藏量达到分页规模后再扩展游标接口。
  const result = await db.collection(COLLECTIONS.likes).where({ actorOpenid: openid }).limit(100).get();
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
    const children = await db.collection(COLLECTIONS.comments).where({ parentId: commentId }).limit(100).get();
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
      body: '欢迎来到“同行足迹”，请收下登录福利。领取后可在“背包”中使用，也可以把心意送给重要的人。愿每一段同行的故事都能被认真记录。',
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

async function queryAllByField(collection, field, value, maxRecords = 1000) {
  const all = [];
  for (let skip = 0; skip < maxRecords; skip += 100) {
    const result = await db.collection(collection).where({ [field]: value }).skip(skip).limit(100).get();
    all.push(...result.data);
    if (result.data.length < 100) break;
  }
  return all;
}

async function ensureDailyTask(openid) {
  const date = chinaDateKey();
  const id = `${openid}_${date}`;
  const reference = db.collection(COLLECTIONS.dailyTasks).doc(id);
  let record = await reference.get().then(result => result.data).catch(() => null);
  if (!record) {
    record = { openid, date, weekKey: weekKey(), progress: { login: true, view: false, like: false }, claimed: { login: false, view: false, like: false }, allComplete: false, createdAt: now(), updatedAt: now() };
    await reference.set({ data: record });
  } else if (!record.progress || !record.progress.login) {
    record.progress = Object.assign({ login: false, view: false, like: false }, record.progress || {}, { login: true });
    record.allComplete = !!(record.progress.login && record.progress.view && record.progress.like);
    await reference.update({ data: { progress: record.progress, allComplete: record.allComplete, updatedAt: now() } });
  }
  return Object.assign({ _id: id }, record);
}

async function markDailyTask(openid, key) {
  if (['login', 'view', 'like'].indexOf(key) < 0) return;
  const record = await ensureDailyTask(openid);
  if (record.progress[key]) return;
  const progress = Object.assign({ login: true, view: false, like: false }, record.progress || {}, { [key]: true });
  const allComplete = !!(progress.login && progress.view && progress.like);
  await db.collection(COLLECTIONS.dailyTasks).doc(record._id).update({ data: { progress, allComplete, completedAt: allComplete ? now() : Number(record.completedAt) || 0, updatedAt: now() } });
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
  const weeklyRecords = await queryAllByField(COLLECTIONS.dailyTasks, 'openid', openid, 100);
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
  const giftId = `G${now()}${crypto.randomBytes(4).toString('hex')}`;
  // 随机道具的结果只能由云端生成，并把每个道具的点数一并存档，防止客户端伪造好感度。
  const affection = rollGiftAffection(item, quantity);
  const bonusItems = item.id === 'gift_box' ? rollGiftBoxBonuses(quantity) : {};
  const bonusText = item.id === 'gift_box' ? giftBoxBonusText(bonusItems) : '';
  const gift = { senderOpenid: openid, senderUid: sender.uid, senderName: sender.name || '未命名用户', receiverOpenid: target._id, receiverUid: target.uid, receiverName: target.name || '未命名用户', itemId: item.id, itemName: item.name, quantity, unitAffection: quantity === 1 ? affection.rolls[0] : 0, affectionRolls: affection.rolls, totalAffection: affection.total, bonusItems, message, images, createdAt: now(), date: chinaDateKey() };
  await db.runTransaction(async transaction => {
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
  });
  const relation = await friendship(openid, target._id);
  const totals = relation ? await loadGiftTotals(openid) : {};
  return { sent: true, giftId, bonusItems, bonusText, affection: relation ? affectionSummary(totals[target._id] || 0) : null };
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
  const ordered = records.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).map(item => Object.assign({ id: item._id, images: [] }, item, { itemName: ITEM_CATALOG[item.itemId] ? ITEM_CATALOG[item.itemId].name : item.itemName || '' }));
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
  if (!isAdmin) return { isAdmin: false, totalUsers: 0 };
  const counted = await db.collection(COLLECTIONS.profiles).count();
  return { isAdmin: true, totalUsers: Number(counted.total) || 0 };
}

async function queryAllDocuments(collection, maxRecords = 5000) {
  const records = [];
  for (let skip = 0; skip < maxRecords; skip += 100) {
    const result = await db.collection(collection).skip(skip).limit(100).get();
    records.push(...result.data);
    if (result.data.length < 100) break;
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

function objectContainsExact(value, expected, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') return expected.has(value);
  if (Array.isArray(value)) return value.some(item => objectContainsExact(item, expected, depth + 1));
  if (typeof value === 'object') return Object.keys(value).some(key => objectContainsExact(value[key], expected, depth + 1));
  return false;
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

// 原项目的一次性测试数据清理逻辑保留为不可达的迁移辅助代码；公开模板未暴露调用入口，
// 且目标列表为空，避免任何部署者误删自己的用户数据。
async function cleanupConfirmedTestAccounts(openid, payload = {}) {
  await requireAdmin(openid);
  const confirmation = `DELETE:${CONFIRMED_TEST_ACCOUNT_UIDS.join(',')}`;
  if (safeText(payload.confirmation, 100) !== confirmation) throw new Error('TEST_CLEANUP_CONFIRMATION_REQUIRED');
  const runRef = db.collection(COLLECTIONS.rewardRuns).doc(CONFIRMED_TEST_CLEANUP_RUN_ID);
  const existingRun = await runRef.get().then(result => result.data).catch(() => null);
  if (existingRun && existingRun.status === 'complete') return { completed: true, repeated: true, targetUids: CONFIRMED_TEST_ACCOUNT_UIDS };

  const startedAt = now();
  await runRef.set({ data: { status: 'running', targetCount: CONFIRMED_TEST_ACCOUNT_UIDS.length, startedAt, updatedAt: startedAt } });
  const keys = Object.keys(COLLECTIONS).filter(key => key !== 'rewardRuns');
  const loaded = await Promise.all(keys.map(key => queryAllDocuments(COLLECTIONS[key])));
  const all = {};
  keys.forEach((key, index) => { all[key] = loaded[index]; });
  const targetUids = new Set(CONFIRMED_TEST_ACCOUNT_UIDS);
  const targetOpenids = new Set();
  const remember = value => { if (value) targetOpenids.add(String(value)); };
  all.profiles.filter(record => targetUids.has(String(record.uid || ''))).forEach(record => remember(record._id || record.openid));
  all.content.forEach(record => { if (targetUids.has(String(record.ownerUid || ''))) remember(record.ownerOpenid); });
  all.friendRequests.forEach(record => {
    if (targetUids.has(String(record.fromUid || ''))) remember(record.fromOpenid);
    if (targetUids.has(String(record.toUid || ''))) remember(record.toOpenid);
  });
  all.comments.forEach(record => {
    if (targetUids.has(String(record.authorUid || ''))) remember(record.authorOpenid);
    if (targetUids.has(String(record.replyToUid || ''))) remember(record.replyToOpenid);
  });
  all.messages.forEach(record => { if (targetUids.has(String(record.senderUid || ''))) remember(record.senderOpenid); });
  all.gifts.forEach(record => {
    if (targetUids.has(String(record.senderUid || ''))) remember(record.senderOpenid);
    if (targetUids.has(String(record.receiverUid || ''))) remember(record.receiverOpenid);
  });
  all.reports.forEach(record => { if (targetUids.has(String(record.reporterUid || ''))) remember(record.reporterOpenid); });

  const profiles = all.profiles.filter(record => targetOpenids.has(String(record._id || record.openid || '')) || targetUids.has(String(record.uid || '')));
  const contents = all.content.filter(record => targetOpenids.has(String(record.ownerOpenid || '')) || targetUids.has(String(record.ownerUid || '')));
  const contentIds = new Set(contents.map(record => record._id));
  const commentIds = new Set();
  all.comments.forEach(record => {
    if (contentIds.has(record.contentRef) || targetOpenids.has(String(record.authorOpenid || '')) || targetUids.has(String(record.authorUid || '')) || targetOpenids.has(String(record.replyToOpenid || ''))) commentIds.add(record._id);
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
  const friendRequests = all.friendRequests.filter(record => targetOpenids.has(String(record.fromOpenid || '')) || targetOpenids.has(String(record.toOpenid || '')) || targetUids.has(String(record.fromUid || '')) || targetUids.has(String(record.toUid || '')));
  const friendships = all.friendships.filter(record => hasAny(record.members, targetOpenids));
  const messages = all.messages.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetOpenids.has(String(record.receiverOpenid || '')) || targetUids.has(String(record.senderUid || '')));
  const gifts = all.gifts.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetOpenids.has(String(record.receiverOpenid || '')) || targetUids.has(String(record.senderUid || '')) || targetUids.has(String(record.receiverUid || '')));
  const mailbox = all.mailbox.filter(record => targetOpenids.has(String(record.recipientOpenid || '')) || targetOpenids.has(String(record.issuedBy || '')) || targetUids.has(String(record.senderUid || '')) || feedbackIds.has(record.feedbackId));
  const dailyTasks = all.dailyTasks.filter(record => targetOpenids.has(String(record.openid || '')));
  const weeklyClaims = all.weeklyClaims.filter(record => targetOpenids.has(String(record.openid || '')));
  const payOrders = all.payOrders.filter(record => targetOpenids.has(String(record.openid || '')));
  const orderIds = new Set(payOrders.reduce((values, record) => values.concat(record._id || [], record.outTradeNo || [], record.wxOrderId || []), []).filter(Boolean).map(String));
  const paymentValues = new Set([...targetOpenids, ...orderIds]);
  const paymentEvents = all.paymentEvents.filter(record => objectContainsExact(record, paymentValues));
  const wallets = all.wallets.filter(record => targetOpenids.has(String(record._id || record.openid || '')));

  const ownedFiles = new Set();
  [profiles, contents,
    all.comments.filter(record => targetOpenids.has(String(record.authorOpenid || '')) || targetUids.has(String(record.authorUid || ''))),
    all.friendRequests.filter(record => targetOpenids.has(String(record.fromOpenid || '')) || targetUids.has(String(record.fromUid || ''))),
    all.messages.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetUids.has(String(record.senderUid || ''))),
    all.gifts.filter(record => targetOpenids.has(String(record.senderOpenid || '')) || targetUids.has(String(record.senderUid || ''))),
    all.reports.filter(record => targetOpenids.has(String(record.reporterOpenid || '')) || targetUids.has(String(record.reporterUid || '')))
  ].forEach(records => records.forEach(record => collectCloudFiles(record, ownedFiles)));
  const storage = await deleteOwnedCloudFiles(ownedFiles);
  if (storage.failed) {
    const finishedAt = now();
    await runRef.set({ data: { status: 'partial', targetCount: CONFIRMED_TEST_ACCOUNT_UIDS.length, failed: storage.failed, storageRemoved: storage.removed, storageFailed: storage.failed, startedAt, finishedAt, updatedAt: finishedAt } });
    return { completed: false, repeated: false, targetUids: CONFIRMED_TEST_ACCOUNT_UIDS, targetAccounts: profiles.length, failed: storage.failed, storage, summary: {} };
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
    [COLLECTIONS.dailyTasks, dailyTasks], [COLLECTIONS.weeklyClaims, weeklyClaims],
    [COLLECTIONS.paymentEvents, paymentEvents], [COLLECTIONS.payOrders, payOrders]
  ];
  for (const [collection, records] of groups) failed += await removeDocumentRecords(collection, records, summary);
  failed += await applyCleanupCounterAdjustments(all.content.filter(record => !contentIds.has(record._id)), all.comments.filter(record => !commentIds.has(record._id)), contentAdjustments, commentLikeAdjustments);
  if (!failed) failed += await removeDocumentRecords(COLLECTIONS.wallets, wallets, summary);
  if (!failed) failed += await removeDocumentRecords(COLLECTIONS.profiles, profiles, summary);

  const completed = failed === 0;
  const finishedAt = now();
  await runRef.set({ data: { status: completed ? 'complete' : 'partial', targetCount: CONFIRMED_TEST_ACCOUNT_UIDS.length, removedProfiles: summary[COLLECTIONS.profiles] ? summary[COLLECTIONS.profiles].removed : 0, failed, storageRemoved: storage.removed, storageFailed: storage.failed, startedAt, finishedAt, updatedAt: finishedAt } });
  return { completed, repeated: false, targetUids: CONFIRMED_TEST_ACCOUNT_UIDS, targetAccounts: profiles.length, failed, storage, summary };
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

let accessTokenCache = { value: '', expiresAt: 0 };
async function getAccessToken() {
  if (accessTokenCache.value && accessTokenCache.expiresAt > now() + 60000) return accessTokenCache.value;
  if (!process.env.HUI_WX_APP_SECRET) throw new Error('PAY_CONFIG_MISSING');
  const result = await httpsJson('https://api.weixin.qq.com/cgi-bin/stable_token', { body: JSON.stringify({ grant_type: 'client_credential', appid: PAY_APP_ID, secret: process.env.HUI_WX_APP_SECRET, force_refresh: false }) });
  if (!result.access_token) throw new Error(`WECHAT_ACCESS_TOKEN_FAILED:${result.errcode || ''}`);
  accessTokenCache = { value: result.access_token, expiresAt: now() + (Number(result.expires_in) || 7200) * 1000 };
  return accessTokenCache.value;
}

function paymentStatus() {
  return { configured: !!(PAY_APP_ID && PAY_OFFER_ID && process.env.HUI_WX_APP_SECRET && payAppKey()), env: payEnvironment(), mode: 'short_series_goods' };
}

async function createPaymentOrder(openid, payload) {
  const product = ITEM_CATALOG[safeText(payload.productId, 30)];
  if (!product || !product.purchasable) throw new Error('INVALID_PRODUCT');
  const config = paymentStatus();
  if (!config.configured) throw new Error('PAY_CONFIG_MISSING');
  const loginCode = safeText(payload.loginCode, 160);
  if (!loginCode) throw new Error('LOGIN_CODE_REQUIRED');
  const session = await httpsJson(`https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(PAY_APP_ID)}&secret=${encodeURIComponent(process.env.HUI_WX_APP_SECRET)}&js_code=${encodeURIComponent(loginCode)}&grant_type=authorization_code`);
  if (!session.session_key) throw new Error(`SESSION_EXCHANGE_FAILED:${Number(session.errcode) || 0}`);
  if (session.openid !== openid) throw new Error('SESSION_OPENID_MISMATCH');
  await ensureWallet(openid);
  const outTradeNo = `T${now()}${crypto.randomBytes(4).toString('hex')}`;
  const attach = JSON.stringify({ orderId: outTradeNo });
  const signData = JSON.stringify({ offerId: PAY_OFFER_ID, buyQuantity: 1, env: config.env, currencyType: 'CNY', productId: product.id, goodsPrice: product.priceFen, outTradeNo, attach });
  const payData = { signData, paySig: hmac(payAppKey(), `requestVirtualPayment&${signData}`), signature: hmac(session.session_key, signData), mode: 'short_series_goods' };
  await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).set({ data: { outTradeNo, openid, productId: product.id, productName: product.name, quantity: 1, goodsPrice: product.priceFen, env: config.env, status: 'pending', createdAt: now(), updatedAt: now() } });
  return { outTradeNo, payData, env: config.env };
}

async function deliverPurchase(input) {
  const outTradeNo = safeText(input.outTradeNo, 40);
  const wxOrderId = safeText(input.wxOrderId, 100) || `order_${outTradeNo}`;
  let delivered = false;
  await db.runTransaction(async transaction => {
    const eventRef = transaction.collection(COLLECTIONS.paymentEvents).doc(wxOrderId);
    const processed = await eventRef.get().then(result => result.data).catch(() => null);
    if (processed && processed.type === 'delivered') { delivered = true; return; }
    const orderRef = transaction.collection(COLLECTIONS.payOrders).doc(outTradeNo);
    let order = await orderRef.get().then(result => result.data).catch(() => null);
    const productId = safeText(input.productId || (order && order.productId), 30);
    const product = ITEM_CATALOG[productId];
    const targetOpenid = safeText(input.openid || (order && order.openid), 100);
    const quantity = Math.max(1, Number(input.quantity || (order && order.quantity)) || 1);
    if (!product || !product.purchasable || !targetOpenid) throw new Error('INVALID_DELIVERY');
    if (order && order.status === 'delivered') { await eventRef.set({ data: { type: 'delivered', outTradeNo, openid: targetOpenid, processedAt: now() } }); delivered = true; return; }
    const walletRef = transaction.collection(COLLECTIONS.wallets).doc(targetOpenid);
    const wallet = await walletRef.get().then(result => result.data).catch(() => null);
    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    await walletRef.update({ data: { [`items.${product.id}`]: _.inc(quantity), updatedAt: now() } });
    const orderData = Object.assign({}, order || {}, { outTradeNo, openid: targetOpenid, productId: product.id, productName: product.name, quantity, goodsPrice: product.priceFen, env: order ? order.env : payEnvironment(), status: 'delivered', wxOrderId, deliveredAt: now(), updatedAt: now() });
    delete orderData._id;
    await orderRef.set({ data: orderData });
    await eventRef.set({ data: { type: 'delivered', outTradeNo, wxOrderId, openid: targetOpenid, productId: product.id, quantity, processedAt: now() } });
    delivered = true;
  });
  return { delivered };
}

async function markPurchaseRefunded(outTradeNo, wxOrderId) {
  const order = await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).get().then(result => result.data).catch(() => null);
  if (!order || order.status === 'refunded') return { refunded: !!order };
  const wallet = await ensureWallet(order.openid);
  const available = metric(wallet.items && wallet.items[order.productId]);
  const revoke = Math.min(available, Math.max(1, Number(order.quantity) || 1));
  await db.runTransaction(async transaction => {
    if (revoke) await transaction.collection(COLLECTIONS.wallets).doc(order.openid).update({ data: { [`items.${order.productId}`]: _.inc(-revoke), updatedAt: now() } });
    await transaction.collection(COLLECTIONS.payOrders).doc(outTradeNo).update({ data: { status: 'refunded', wxOrderId: wxOrderId || order.wxOrderId || '', refundedAt: now(), unrecoveredQuantity: Math.max(0, Number(order.quantity) - revoke), updatedAt: now() } });
  });
  return { refunded: true };
}

async function notifyProvideGoods(orderId, wxOrderId, env) {
  const token = await getAccessToken();
  const result = await httpsJson(`https://api.weixin.qq.com/xpay/notify_provide_goods?access_token=${encodeURIComponent(token)}`, { body: JSON.stringify({ order_id: orderId, wx_order_id: wxOrderId || '', env }) });
  if (Number(result.errcode) !== 0) throw new Error(`PAY_NOTIFY_FAILED:${result.errcode || ''}`);
  await db.collection(COLLECTIONS.payOrders).doc(orderId).update({ data: { platformNotifiedAt: now(), updatedAt: now() } }).catch(() => null);
  return result;
}

async function queryPayment(openid, payload) {
  const outTradeNo = safeText(payload.outTradeNo, 40);
  const order = await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).get().then(result => result.data).catch(() => null);
  if (!order || order.openid !== openid) throw new Error('ORDER_NOT_FOUND');
  if (order.status === 'delivered' && order.platformNotifiedAt) return { delivered: true, status: order.status, outTradeNo };
  const body = JSON.stringify({ openid, env: Number(order.env) || 0, order_id: outTradeNo });
  const token = await getAccessToken();
  const paySig = hmac(payAppKey(), `/xpay/query_order&${body}`);
  const result = await httpsJson(`https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(token)}&pay_sig=${paySig}`, { body });
  if (Number(result.errcode) !== 0) throw new Error(`PAY_QUERY_FAILED:${result.errcode || ''}`);
  const official = result.order || {};
  if ([2, 3, 4].indexOf(Number(official.status)) >= 0) {
    const delivered = await deliverPurchase({ outTradeNo, wxOrderId: official.wx_order_id, openid, productId: order.productId, quantity: order.quantity });
    // 2/3 表示已支付但微信侧尚未确认发货。通知失败时保留本地幂等发货结果，
    // 并由 reconcilePayments 在下次启动时继续补发确认，不能静默吞掉失败。
    if (Number(official.status) !== 4) await notifyProvideGoods(outTradeNo, official.wx_order_id, Number(order.env) || 0);
    else await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).update({ data: { platformNotifiedAt: now(), updatedAt: now() } }).catch(() => null);
    return Object.assign({ status: 'delivered', outTradeNo }, delivered);
  }
  if ([5, 8].indexOf(Number(official.status)) >= 0) await markPurchaseRefunded(outTradeNo, official.wx_order_id);
  if (Number(official.status) === 6) await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).update({ data: { status: 'closed', closedAt: now(), updatedAt: now() } }).catch(() => null);
  if (Number(official.status) === 7) await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).update({ data: { status: 'refund_failed', updatedAt: now() } }).catch(() => null);
  return { delivered: false, status: Number(official.status), outTradeNo };
}

async function reconcilePayments(openid) {
  if (!paymentStatus().configured) return { checked: 0, configured: false };
  const orders = await queryAllByField(COLLECTIONS.payOrders, 'openid', openid, 100);
  const pending = orders.filter(item => item.status === 'pending' || (item.status === 'delivered' && !item.platformNotifiedAt)).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).slice(0, 5);
  let delivered = 0;
  for (const order of pending) {
    const result = await queryPayment(openid, { outTradeNo: order.outTradeNo }).catch(() => null);
    if (result && result.delivered) delivered += 1;
  }
  return { checked: pending.length, delivered, configured: true };
}

// 官方建议对可能遗漏推送的订单周期查单。该定时任务只处理未完成订单，
// 并复用 queryPayment 的归属校验、发货幂等与微信侧确认逻辑。
async function reconcileAllPayments() {
  if (!paymentStatus().configured) return { checked: 0, delivered: 0, configured: false };
  const [pending, deliveredUnconfirmed] = await Promise.all([
    queryAllByField(COLLECTIONS.payOrders, 'status', 'pending', 500),
    queryAllByField(COLLECTIONS.payOrders, 'status', 'delivered', 500)
  ]);
  const candidates = pending.concat(deliveredUnconfirmed.filter(item => !item.platformNotifiedAt))
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).slice(0, 100);
  let delivered = 0;
  let failed = 0;
  for (const order of candidates) {
    const result = await queryPayment(order.openid, { outTradeNo: order.outTradeNo }).catch(() => { failed += 1; return null; });
    if (result && result.delivered) delivered += 1;
  }
  return { checked: candidates.length, delivered, failed, configured: true };
}

async function handlePaymentEvent(event) {
  // 云开发消息推送在不同接入方式下可能直接传字段，也可能把业务体放在 Payload 中。
  // 两种结构统一展开后再处理，避免回调已经到达却因字段层级不同而漏发货。
  let payload = {};
  if (event && typeof event.Payload === 'string') {
    try { payload = JSON.parse(event.Payload); } catch (error) { payload = {}; }
  } else if (event && event.Payload && typeof event.Payload === 'object') payload = event.Payload;
  const input = Object.assign({}, event || {}, payload || {});
  const eventName = input.Event || input.event || '';
  const payInfo = input.WeChatPayInfo || input.wechatPayInfo || {};
  const goods = input.GoodsInfo || input.goodsInfo || {};
  const outTradeNo = input.OutTradeNo || input.outTradeNo || input.OrderId || input.MchOrderId || input.mchOrderId || '';
  const wxOrderId = input.WxOrderId || input.wxOrderId || payInfo.MchOrderNo || payInfo.mchOrderNo || payInfo.TransactionId || payInfo.transactionId || '';
  if (eventName === 'xpay_goods_deliver_notify') {
    await deliverPurchase({ outTradeNo, wxOrderId, openid: input.OpenId || input.openid, productId: goods.ProductId || goods.productId, quantity: goods.Quantity || goods.quantity || 1 });
    await db.collection(COLLECTIONS.payOrders).doc(outTradeNo).update({ data: { platformNotifiedAt: now(), updatedAt: now() } }).catch(() => null);
    return { ErrCode: 0, ErrMsg: 'success' };
  }
  if (eventName === 'xpay_refund_notify') {
    await markPurchaseRefunded(outTradeNo, wxOrderId);
    return { ErrCode: 0, ErrMsg: 'success' };
  }
  const id = `event_${safeText(wxOrderId || outTradeNo || `${eventName}_${now()}`, 100)}`;
  await db.collection(COLLECTIONS.paymentEvents).doc(id).set({ data: { type: eventName || 'unknown', payload: input, processedAt: now() } }).catch(() => null);
  return { ErrCode: 0, ErrMsg: 'success' };
}

async function createRewardMail(id, openid, title, body, itemId, quantity) {
  const reference = db.collection(COLLECTIONS.mailbox).doc(id);
  const exists = await reference.get().then(result => result.data).catch(() => null);
  if (exists) return false;
  await reference.set({ data: { recipientOpenid: openid, type: 'ranking_reward', title, body, itemId, quantity, status: 'pending', createdAt: now(), date: chinaDateKey() } });
  return true;
}

function contentDateKey(record) {
  const match = String(record.payload && record.payload.date || '').match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  return chinaDateKey(Number(record.publishedAt) || Number(record.createdAt) || 0);
}

async function awardRankingPeriod(type, periodKey, records, rewards) {
  const uniqueOwners = [];
  records.sort((a, b) => heat(b) - heat(a) || Number(b.publishedAt) - Number(a.publishedAt)).forEach(record => {
    if (uniqueOwners.length < rewards.length && !uniqueOwners.some(item => item.ownerOpenid === record.ownerOpenid)) uniqueOwners.push(record);
  });
  let created = 0;
  for (let index = 0; index < uniqueOwners.length; index += 1) {
    const reward = rewards[index];
    const item = ITEM_CATALOG[reward.itemId];
    if (await createRewardMail(`rank_${type}_${periodKey}_${index + 1}_${uniqueOwners[index].ownerOpenid}`, uniqueOwners[index].ownerOpenid, `${periodKey} ${type}热度榜第 ${index + 1} 名`, `恭喜获得 ${item.name} × ${reward.quantity}，请领取到背包。`, reward.itemId, reward.quantity)) created += 1;
  }
  return created;
}

async function runRankingRewards() {
  const current = chinaDate();
  const yesterday = new Date(current.getTime());
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const records = await loadPublicContents();
  const comments = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const result = await db.collection(COLLECTIONS.comments).skip(skip).limit(100).get();
    comments.push(...result.data);
    if (result.data.length < 100) break;
  }
  const counts = {};
  comments.forEach(comment => { counts[comment.contentRef] = (counts[comment.contentRef] || 0) + 1; });
  records.forEach(record => { record.commentCount = Math.max(metric(record.commentCount), counts[record._id] || 0); });
  let created = await awardRankingPeriod('日', yesterdayKey, records.filter(record => contentDateKey(record) === yesterdayKey), [{ itemId: 'star', quantity: 1 }]);
  if (current.getUTCDay() === 1) {
    const targetWeek = weekKey(yesterday.getTime() - 8 * 60 * 60 * 1000);
    created += await awardRankingPeriod('周', targetWeek, records.filter(record => weekKey(Date.parse(`${contentDateKey(record)}T00:00:00Z`) - 8 * 60 * 60 * 1000) === targetWeek), [{ itemId: 'star', quantity: 3 }, { itemId: 'star', quantity: 2 }, { itemId: 'star', quantity: 1 }]);
  }
  if (current.getUTCDate() === 1) {
    const previousMonth = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}`;
    created += await awardRankingPeriod('月', previousMonth, records.filter(record => contentDateKey(record).slice(0, 7) === previousMonth), [{ itemId: 'envelope', quantity: 6 }, { itemId: 'envelope', quantity: 4 }, { itemId: 'envelope', quantity: 2 }]);
    if (current.getUTCMonth() === 0) {
      const previousYear = String(yesterday.getUTCFullYear());
      created += await awardRankingPeriod('年', previousYear, records.filter(record => contentDateKey(record).slice(0, 4) === previousYear), [{ itemId: 'memory_book', quantity: 3 }, { itemId: 'memory_book', quantity: 2 }, { itemId: 'memory_book', quantity: 1 }]);
    }
  }
  await db.collection(COLLECTIONS.rewardRuns).doc(yesterdayKey).set({ data: { date: yesterdayKey, created, ranAt: now() } });
  return { date: yesterdayKey, created };
}

async function requestFriend(openid, payload) {
  const from = await ownProfile(openid);
  if (!validUid(payload.toUid)) throw new Error('INVALID_UID');
  const target = await profileByUid(payload.toUid);
  if (!target) throw new Error('UID_NOT_FOUND');
  if (target._id === openid) throw new Error('SELF_REQUEST');
  if (await friendship(openid, target._id)) throw new Error('ALREADY_FRIENDS');
  const reason = safeText(payload.reason, 120);
  await checkTextSafety(openid, [reason], 2);
  const existing = await db.collection(COLLECTIONS.friendRequests).where({ fromOpenid: openid }).limit(100).get();
  if (existing.data.some(item => item.toOpenid === target._id && item.status === 'pending')) throw new Error('REQUEST_EXISTS');
  const request = { fromOpenid: openid, fromUid: from.uid, fromName: from.name || '未命名用户', fromAvatar: from.avatar || '', fromBio: from.bio || '', toOpenid: target._id, toUid: target.uid, reason, status: 'pending', createdAt: now() };
  const added = await db.collection(COLLECTIONS.friendRequests).add({ data: request });
  return Object.assign({ id: added._id }, request);
}

async function listRequests(openid) {
  const result = await db.collection(COLLECTIONS.friendRequests).where({ toOpenid: openid }).limit(100).get();
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
  const request = await db.collection(COLLECTIONS.friendRequests).doc(payload.id).get().then(result => result.data).catch(() => null);
  if (!request || request.toOpenid !== openid || request.status !== 'pending') throw new Error('REQUEST_NOT_FOUND');
  const key = pairKey(openid, request.fromOpenid);
  const exists = await db.collection(COLLECTIONS.friendships).where({ pairKey: key }).limit(1).get();
  if (!exists.data.length) await db.collection(COLLECTIONS.friendships).add({ data: { pairKey: key, members: [openid, request.fromOpenid], remarks: {}, createdAt: now() } });
  await db.collection(COLLECTIONS.friendRequests).doc(request._id).update({ data: { status: 'accepted', handledAt: now() } });
  return { accepted: true };
}

async function rejectRequest(openid, payload) {
  const request = await db.collection(COLLECTIONS.friendRequests).doc(payload.id).get().then(result => result.data).catch(() => null);
  if (!request || request.toOpenid !== openid || request.status !== 'pending') throw new Error('REQUEST_NOT_FOUND');
  await db.collection(COLLECTIONS.friendRequests).doc(request._id).update({ data: { status: 'rejected', handledAt: now() } });
  return { rejected: true };
}

async function friendList(openid) {
  const relations = await db.collection(COLLECTIONS.friendships).where({ members: _.in([openid]) }).limit(100).get();
  const loaded = (await Promise.all(relations.data.map(async relation => {
    const targetOpenid = (relation.members || []).find(item => item !== openid);
    const target = targetOpenid ? await db.collection(COLLECTIONS.profiles).doc(targetOpenid).get().then(result => result.data).catch(() => null) : null;
    return target ? { target, remark: (relation.remarks || {})[openid] || '' } : null;
  }))).filter(Boolean);
  const giftTotals = await loadGiftTotals(openid);
  const resolved = await resolveSharedContentList(loaded.map(item => ({ avatar: item.target.avatar || '' })));
  const list = loaded.map((item, index) => Object.assign(publicProfile(item.target), { avatar: resolved[index].avatar || item.target.avatar || '', id: item.target.uid, remark: item.remark, affection: affectionSummary(giftTotals[item.target._id] || 0) }));
  return { friends: list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')) };
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
  const records = await db.collection(COLLECTIONS.content).where({ ownerOpenid: target._id }).limit(100).get();
  const allVisible = await resolveSharedContentList(records.data.filter(record => ['friends', 'public'].indexOf(record.visibility) >= 0 && record.status === 'published').map(record => exposeContent(record, target)));
  // 相册目录本身是私有的管理数据，但好友需要先选择相册再看其中公开的照片。
  // 这里只返回至少含有一张可见照片的目录，不会暴露空相册或全为私密照片的目录。
  const visibleFolderIds = new Set(allVisible.filter(item => item.kind === 'photo' && item.folderId).map(item => item.folderId));
  const albums = await resolveSharedContentList(records.data.filter(record => record.kind === 'album' && visibleFolderIds.has(record.contentId)).map(record => exposeContent(record, target)));
  const usable = allVisible.filter(item => item.kind !== 'companion');
  const campIds = allVisible.map(item => item.campId).filter((item, index, all) => item && all.indexOf(item) === index);
  const contentForPage = type === 'growth' ? usable.filter(item => item.kind === 'growth' || item.kind === 'work') : (type === 'footprints' || type === 'module') ? allVisible : [];
  return { friend: await resolveProfileFile(target), type, campIds, records: contentForPage, albums };
}

// 聊天记录只以好友关系的 pairKey 为索引。每次读取、发送都会再次验证好友关系，
// 因此即使用户通过前端伪造 UID，也无法访问非好友的会话。
async function chatTarget(openid, uid) {
  const target = await profileByUid(uid);
  if (!target) throw new Error('FRIEND_NOT_FOUND');
  await ensureFriend(openid, target._id);
  return target;
}

async function chatList(openid, payload) {
  const target = await chatTarget(openid, payload.uid);
  const conversationId = pairKey(openid, target._id);
  // 倒序取最近 100 条后再翻转，确保对话窗口展示的是最新一段消息。
  const result = await db.collection(COLLECTIONS.messages).where({ conversationId }).limit(100).get();
  const ordered = result.data.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const senders = await profilesByOpenids(ordered.map(item => item.senderOpenid));
  const messages = ordered.map(item => {
    const sender = senders[item.senderOpenid];
    return {
    id: item._id,
    body: item.body,
    createdAt: item.createdAt,
    senderUid: sender ? sender.uid : item.senderUid,
    senderName: sender ? (sender.name || '未命名用户') : (item.senderName || '未命名用户'),
    senderAvatar: sender ? (sender.avatar || '') : (item.senderAvatar || ''),
    senderAvatarScale: sender ? (sender.avatarScale || 1.3) : 1.3,
    senderAvatarOffsetX: sender ? (sender.avatarOffsetX || 0) : 0,
    senderAvatarOffsetY: sender ? (sender.avatarOffsetY || 0) : 0,
    isMine: item.senderOpenid === openid
  }; });
  // 打开会话即把对方发来的未读消息标记为已读。
  const unread = ordered.filter(item => item.receiverOpenid === openid && !item.readAt);
  await Promise.all(unread.map(item => db.collection(COLLECTIONS.messages).doc(item._id).update({ data: { readAt: now() } })));
  return { friend: Object.assign(publicProfile(target), { id: target.uid }), messages };
}

async function chatUnread(openid) {
  const result = await db.collection(COLLECTIONS.messages).where({ receiverOpenid: openid }).limit(100).get();
  // 只提醒仍处于好友关系中的会话；删除好友后，历史未读消息不会形成无法清除的红点。
  const relations = await db.collection(COLLECTIONS.friendships).where({ members: _.in([openid]) }).limit(100).get();
  const friendOpenids = new Set(relations.data.map(item => (item.members || []).find(member => member !== openid)).filter(Boolean));
  const unread = result.data.filter(item => !item.readAt && friendOpenids.has(item.senderOpenid));
  const senders = await profilesByOpenids(unread.map(item => item.senderOpenid));
  const byUid = {};
  unread.forEach(item => {
    const sender = senders[item.senderOpenid];
    const uid = sender ? sender.uid : item.senderUid;
    if (uid) byUid[uid] = (byUid[uid] || 0) + 1;
  });
  return { total: unread.length, byUid };
}

async function chatSend(openid, payload) {
  const target = await chatTarget(openid, payload.uid);
  const body = safeText(payload.body, 500);
  if (!body) throw new Error('EMPTY_MESSAGE');
  await checkTextSafety(openid, [body], 2);
  const sender = await ownProfile(openid);
  const record = { conversationId: pairKey(openid, target._id), senderOpenid: openid, senderUid: sender.uid, senderName: sender.name || '我', senderAvatar: sender.avatar || '', receiverOpenid: target._id, body, createdAt: now(), readAt: 0 };
  const added = await db.collection(COLLECTIONS.messages).add({ data: record });
  return { message: Object.assign({ id: added._id, isMine: true }, record) };
}

function errorMessage(error) {
  const code = error && error.message || 'UNKNOWN';
  // 新环境若尚未在控制台创建集合，云 SDK 会返回不同版本的“集合不存在”错误。
  // 单独提示可避免把初始化问题误认为好友功能故障。
  const raw = [code, error && error.errMsg, error && error.errCode].filter(Boolean).join(' ');
  if (/collection.*not.*exist|collection.*not.*found|集合.*不存在|-502005/i.test(raw)) {
    return { error: 'COLLECTION_MISSING', message: '云数据库集合尚未创建，请按 CLOUD_SETUP.md 创建后重试' };
  }
  const messages = { FORBIDDEN: '无权访问此内容', ADMIN_FORBIDDEN: '当前账号没有开发者管理权限', TEST_CLEANUP_CONFIRMATION_REQUIRED: '测试账号清理确认信息不匹配', INVALID_CAMPAIGN_KEY: '批次标识只能填写字母、数字、横线或下划线', INVALID_REWARD_QUANTITY: '奖励数量必须是 1 至 999 的整数', INVALID_REWARD_DEADLINE: '请选择有效的领取截止日期', REWARD_DEADLINE_PASSED: '领取截止日期必须晚于当前时间', INVALID_TARGET_UID: '请输入接收福利账号的 7 位 UID', UID_NOT_FOUND: '未找到该 UID 用户', INVALID_UID: '请输入 7 位好友 UID', SELF_REQUEST: '不能添加自己为好友', ALREADY_FRIENDS: '对方已经是你的好友', REQUEST_EXISTS: '已发送过好友申请，请等待处理', REQUEST_NOT_FOUND: '申请不存在或已处理', FRIEND_NOT_FOUND: '好友不存在', INVALID_CONTENT_ID: '内容标识无效', TAG_TOO_LONG: '每个标签不能超过 10 个字', WORK_FILE_TOO_LARGE: '作品文件不能大于 20MB', SHARED_FILE_NOT_UPLOADED: '图片或作品文件尚未成功上传云端，请重新选择后保存', CONTENT_UNSAFE: '内容包含不适宜信息，请修改后重试', CONTENT_CHECK_UNAVAILABLE: '内容安全服务暂时不可用，请稍后重试', IMAGE_SECURITY_SIZE_LIMIT: '图片需压缩到 1MB 以内后再上传', EMPTY_COMMENT: '评论不能为空', EMPTY_MESSAGE: '消息不能为空', EMPTY_FEEDBACK: '请先填写想反馈的问题', FEEDBACK_TOO_LONG: '反馈内容不能超过 1000 个字', FEEDBACK_TOO_FREQUENT: '反馈发送得太频繁，请一分钟后再试', NO_ADMIN_CONFIGURED: '暂未配置接收反馈的管理员账号', INVALID_REPLY: '回复对象无效', COMMENT_NOT_FOUND: '评论不存在或已删除', COMMENT_DELETE_FORBIDDEN: '只有内容发布者可以删除这条评论', CANNOT_REPORT_SELF: '不能举报自己发布的内容', REPORT_EXISTS: '你已经举报过该内容，等待处理即可', INVALID_ITEM: '道具不存在', INVALID_PRODUCT: '该道具不可购买', ITEM_NOT_ENOUGH: '背包中的道具数量不足', CANNOT_GIFT_SELF: '不能给自己赠送道具', GIFT_MESSAGE_TOO_LONG: '留言字数超过限制', TASK_NOT_COMPLETE: '任务尚未完成', TASK_ALREADY_CLAIMED: '该奖励已经领取', INVALID_TASK: '任务不存在', MAIL_NOT_FOUND: '邮件不存在', MAIL_ALREADY_CLAIMED: '该邮件已经领取', MAIL_EXPIRED: '该奖励邮件已过期并自动删除', PAY_CONFIG_MISSING: '云函数尚未配置支付密钥', LOGIN_CODE_REQUIRED: '登录凭证缺失，请重新下单', SESSION_KEY_FAILED: '登录态校验失败，请重新下单', SESSION_OPENID_MISMATCH: '当前登录身份与云环境不一致，请确认项目 AppID 后重新编译', ORDER_NOT_FOUND: '订单不存在', WALLET_NOT_FOUND: '用户背包尚未初始化', INVALID_DELIVERY: '发货参数无效' };
  if (/^SESSION_EXCHANGE_FAILED:40125/.test(code)) return { error: 'APP_SECRET_INVALID', message: 'AppSecret 无效或与当前 AppID 不匹配，请重新生成并更新云函数环境变量' };
  if (/^SESSION_EXCHANGE_FAILED:40013/.test(code)) return { error: 'APP_ID_INVALID', message: '支付环境变量中的 AppID 无效，请核对小程序 AppID' };
  if (/^SESSION_EXCHANGE_FAILED:(40029|40163)/.test(code)) return { error: 'LOGIN_CODE_INVALID', message: '微信临时登录凭证已失效，请重新进入商店后再试' };
  if (/^SESSION_EXCHANGE_FAILED:/.test(code)) return { error: 'SESSION_EXCHANGE_FAILED', message: `微信登录态换取失败（错误码 ${code.split(':')[1]}）` };
  if (/^PAY_QUERY_FAILED/.test(code)) return { error: 'PAY_QUERY_FAILED', message: '订单查询失败，请稍后在背包中确认到账' };
  if (/^WECHAT_ACCESS_TOKEN_FAILED|^WECHAT_REQUEST_TIMEOUT|^WECHAT_RESPONSE_INVALID/.test(code)) return { error: 'WECHAT_API_FAILED', message: '微信支付服务暂时不可用，请稍后重试' };
  return { error: code, message: messages[code] || '操作未完成，请稍后重试' };
}

function pushedEventName(event) {
  if (!event) return '';
  if (event.Event || event.event) return String(event.Event || event.event);
  if (typeof event.Payload === 'string') {
    try { const payload = JSON.parse(event.Payload); return String(payload.Event || payload.event || ''); } catch (error) { return ''; }
  }
  if (event.Payload && typeof event.Payload === 'object') return String(event.Payload.Event || event.Payload.event || '');
  return '';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event && event.action;
  const payload = event && event.payload || {};
  try {
    // 消息推送与定时触发都没有用户 OPENID；小程序客户端始终带 OPENID，因此不能伪造支付发货事件。
    if (/^xpay_/.test(pushedEventName(event))) {
      if (OPENID) throw new Error('FORBIDDEN');
      return await handlePaymentEvent(event);
    }
    if (event && (event.Type === 'Timer' || /^hui[A-Za-z]+$/.test(String(event.TriggerName || '')))) {
      if (OPENID) throw new Error('FORBIDDEN');
      if (event.TriggerName === 'huiPendingPaymentReconcile') return await reconcileAllPayments();
      if (event.TriggerName === 'huiExpiredRewardCleanup') return await cleanupExpiredRewardMails();
      return await runRankingRewards();
    }
    if (action === 'profile.bootstrap') { const profile = await bootstrapProfile(OPENID, payload.profile || {}); await Promise.all([ensureDailyTask(OPENID), ensureWallet(OPENID)]); return { profile: publicProfile(profile) }; }
    if (action === 'profile.upsert') return { profile: publicProfile(await ownProfile(OPENID, payload.profile || {})) };
    if (action === 'profile.current') return { profile: await currentProfile(OPENID) };
    if (action === 'state.mine') return await ownState(OPENID);
    if (action === 'content.upsert') return { item: await upsertContent(OPENID, payload) };
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
    if (action === 'friend.accept') return await acceptRequest(OPENID, payload);
    if (action === 'friend.reject') return await rejectRequest(OPENID, payload);
    if (action === 'friend.list') return await friendList(OPENID);
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
    if (action === 'admin.status') return await adminStatus(OPENID);
    if (action === 'admin.reward.broadcast') return await adminBroadcastReward(OPENID, payload);
    if (action === 'admin.reward.user') return await adminUserReward(OPENID, payload);
    if (action === 'pay.status') return paymentStatus();
    if (action === 'pay.create') return await createPaymentOrder(OPENID, payload);
    if (action === 'pay.query') return await queryPayment(OPENID, payload);
    if (action === 'pay.reconcile') return await reconcilePayments(OPENID);
    return { error: 'UNKNOWN_ACTION', message: '未知请求' };
  } catch (error) {
    return errorMessage(error);
  }
};
