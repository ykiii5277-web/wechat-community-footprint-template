// 已发布缓存只存云端回执；失败请求保存在独立的账号草稿队列中。
function createSync({ cloud, keys, init, today, normalizeActivityName, getProfile }) {
  const kinds = { photo: 'photos', growth: 'growth', work: 'works', companion: 'companions', album: 'folders', activity: 'activities' };
  const labels = { photo: '照片', growth: '记录', work: '作品', companion: '伙伴', album: '相册', activity: '活动', profile: '个人资料' };
  const ownerKey = 'hui_time_cache_owner_v2';
  const prefix = `hui_time_sync_v2_${cloud.CLOUD_ENV_ID || 'cloud'}_`;
  let uid = '', tail = Promise.resolve(), epoch = 0, protocolVersion = 0, backgroundRun = null, friendManagementEpoch = 0, worksRun = null;
  const read = (key, fallback) => { const value = wx.getStorageSync(key); return value === '' || value == null ? fallback : value; };
  const write = (key, value) => wx.setStorageSync(key, value);
  const accountKey = suffix => `${prefix}${uid}_${suffix}`;
  const serial = task => { const run = tail.then(task); tail = run.catch(() => {}); return run; };
  const newId = kind => `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  function bind(profile) {
    if (!profile || !profile.uid) throw new Error('请先连接云端账号');
    const next = String(profile.cacheKey || profile.uid);
    protocolVersion = Number(profile.syncVersion) || 0;
    if (uid === next) { write(keys.profile, Object.assign({}, getProfile(), profile)); return; }
    const previous = read(ownerKey, '') || String(read(keys.profile, {}).uid || 'unbound');
    const legacySameAccount = /^\d{7}$/.test(previous) && previous === String(profile.uid);
    if (legacySameAccount && previous !== next) {
      ['pending', 'legacyBackup', 'lastSync', 'accountBackup'].forEach(suffix => {
        const value = read(`${prefix}${previous}_${suffix}`, null);
        if (value != null && read(`${prefix}${next}_${suffix}`, null) == null) write(`${prefix}${next}_${suffix}`, value);
      });
    }
    if (previous !== next && !legacySameAccount) {
      const snapshot = {};
      Object.values(keys).forEach(key => { snapshot[key] = read(key, null); });
      write(`${prefix}${previous}_accountBackup`, snapshot);
      const restored = read(`${prefix}${next}_accountBackup`, {});
      Object.values(keys).forEach(key => { if (restored[key] != null) write(key, restored[key]); else wx.removeStorageSync(key); });
      init();
      wx.removeStorageSync('hui_time_public_preview_v1');
    }
    uid = next; epoch++;
    write(ownerKey, uid);
    write(keys.profile, profile);
  }
  async function ready() {
    if (uid) {
      if (protocolVersion < 2) throw new Error('同步服务尚未更新，请联系开发者；本机内容已保留');
      return uid;
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    const result = app && app.globalData && await app.globalData.bootstrapPromise;
    if (!result || result.error || !result.profile) throw new Error('尚未连接云端账号，请联网后重新进入小程序');
    bind(result.profile);
    if (protocolVersion < 2) throw new Error('同步服务尚未更新，请联系开发者；本机内容已保留');
    return uid;
  }
  function verify(result) {
    if (!result || result.error) throw new Error(result && result.message || '云端未确认成功，请检查网络后重试');
    return result;
  }
  const pending = () => read(accountKey('pending'), []);
  function queue(job) {
    const jobs = pending().filter(item => item.key !== job.key);
    jobs.push(Object.assign({ time: Date.now(), error: '', review: false }, job));
    write(accountKey('pending'), jobs);
  }
  function finish(key) { write(accountKey('pending'), pending().filter(job => job.key !== key)); }
  function failed(key, error) { write(accountKey('pending'), pending().map(job => job.key === key ? Object.assign({}, job, { error: error.message || '同步失败' }) : job)); }
  function supersedePhotoVisibility(ids, visibility, completed, hideUid) {
    const selected = new Set(ids);
    write(accountKey('pending'), pending().flatMap(job => {
      if (job.key === completed.key || Number(job.time) > Number(completed.time)) return [job];
      // 保留旧草稿中的其他编辑，但不能让其自动重试恢复旧的可见范围。
      if (job.action === 'save' && job.kind === 'photo' && selected.has(job.item.id)) return [Object.assign({}, job, { item: Object.assign({}, job.item, { visibility }, visibility === 'public' && typeof hideUid === 'boolean' ? { hideUid } : {}) })];
      if (job.action === 'manage' && job.payload.operation === 'setPhotoVisibility') {
        const remaining = job.payload.ids.filter(id => !selected.has(id));
        if (!remaining.length) return [];
        return [Object.assign({}, job, { payload: Object.assign({}, job.payload, { ids: remaining }) })];
      }
      return [job];
    }));
  }
  function reconcile(remote) {
    const stable = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item))) : Object.keys(value).sort().reduce((result, key) => { if (value[key] !== undefined) result[key] = JSON.parse(stable(value[key])); return result; }, {}) : value);
    const common = ['campId', 'stageId', 'subcampId', 'activityName', 'date', 'visibility', 'status'];
    const fields = { photo: ['image', 'name', 'folderId', 'showName', 'hideUid'], growth: ['title', 'body', 'images', 'location', 'tags', 'hideUid'], work: ['title', 'body', 'filePath', 'fileName', 'cover', 'mediaType', 'hideUid'], companion: ['name', 'avatar', 'avatarScale', 'avatarOffsetX', 'avatarOffsetY', 'gender', 'introduction', 'story'], album: ['name', 'cover'], activity: ['name', 'cover'], profile: ['name', 'bio', 'tags', 'avatar', 'avatarScale', 'avatarOffsetX', 'avatarOffsetY', 'stats'] };
    const list = kind => remote[kind === 'album' ? 'albums' : kinds[kind]] || [];
    pending().forEach(job => {
      if (job.action === 'save') {
        const saved = job.kind === 'profile' ? remote.profile : list(job.kind).find(item => item.id === job.item.id);
        const compared = (job.kind === 'profile' ? [] : common).concat(fields[job.kind] || []);
        if (saved && compared.every(field => field === 'name' && job.kind === 'photo' && job.item.nameAutoGenerated === true && saved.nameAutoGenerated === true || job.item[field] === undefined || stable(job.item[field]) === stable(saved[field]))) finish(job.key);
      } else if (job.action === 'delete' && !list(job.kind).some(item => item.id === job.id)) finish(job.key);
      else if (job.action === 'manage' && !job.review) {
        const body = job.payload;
        if ((body.operation === 'deleteAlbum' || body.operation === 'deleteActivity') && !list(body.operation === 'deleteAlbum' ? 'album' : 'activity').some(item => item.id === body.id)) finish(job.key);
        if (body.operation === 'deleteBatch' && !(body.ids || []).some(id => list('photo').some(item => item.id === id))) finish(job.key);
        if (body.operation === 'movePhotos' && (body.ids || []).every(id => list('photo').some(item => item.id === id && item.folderId === body.folderId))) finish(job.key);
        if (body.operation === 'setPhotoVisibility' && (body.ids || []).every(id => list('photo').some(item => item.id === id && item.folderId === body.folderId && item.visibility === body.visibility && (body.visibility !== 'public' || typeof body.hideUid !== 'boolean' || (item.hideUid === true) === body.hideUid)))) { supersedePhotoVisibility(body.ids, body.visibility, job, body.hideUid); finish(job.key); }
      }
    });
  }
  function cache(kind, item, preserveOrder = false) {
    const key = keys[kinds[kind]];
    if (!key) return;
    const old = read(key, []), position = old.findIndex(value => value.id === item.id);
    const items = old.filter(value => value.id !== item.id);
    items.splice(preserveOrder && position >= 0 ? Math.min(position, items.length) : items.length, 0, item);
    write(key, items);
  }
  function erase(kind, id) {
    const key = keys[kinds[kind]];
    if (key) write(key, read(key, []).filter(item => item.id !== id));
    const removedComments = read(keys.comments, []).filter(item => item.targetType === kind && item.targetId === id).map(item => item.id);
    write(keys.comments, read(keys.comments, []).filter(item => !(item.targetType === kind && item.targetId === id)));
    const favorites = read(keys.favorites, {});
    if (favorites[kind]) delete favorites[kind][id];
    if (favorites.comment) removedComments.forEach(commentId => delete favorites.comment[commentId]);
    write(keys.favorites, favorites);
  }
  async function assets(kind, item, background) {
    const result = Object.assign({}, item);
    const category = { photo: 'photos', growth: 'growth', companion: 'companion-avatars', album: 'folder-covers', activity: 'activity-covers', profile: 'avatars' }[kind];
    for (const field of ['image', 'avatar', 'cover']) {
      const value = result[field];
      if (value && !cloud.isRemoteFile(value)) result[field] = await cloud.persistFile(value, category || 'images', '', { silent: !!background });
      if (/^https?:\/\/(tmp|usr|localhost|127\.0\.0\.1)([/:]|$)/i.test(result[field] || '')) throw new Error('本地临时文件已失效，请重新选择图片');
    }
    if (Array.isArray(result.images)) {
      const uploaded = [];
      for (const value of result.images) uploaded.push(cloud.isRemoteFile(value) ? value : await cloud.persistFile(value, 'growth', '', { silent: !!background }));
      result.images = uploaded;
      result.images = result.images.slice(0, 9); result.image = result.images[0] || '';
    }
    if (kind === 'work' && result.filePath && !cloud.isRemoteFile(result.filePath)) {
      if (require('./work-media').isVideo(result)) {
        const prepared = await require('./work-media').prepareVideo(result.filePath);
        result.filePath = await cloud.persistFile(prepared.path, 'work-videos', 'video.mp4', { silent: !!background }); result.fileSize = prepared.size; result.mediaType = 'video'; result.fileType = 'mp4';
      } else result.filePath = await cloud.persistFile(result.filePath, 'work-files', result.fileName, { silent: !!background });
    }
    return result;
  }
  async function executeOnce(job) {
    const session = uid;
    try {
      let result;
      if (job.action === 'save') {
        const item = await assets(job.kind, job.item, job.background);
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        // 已完成文件上传的草稿使用云文件ID重试，不依赖会过期的本地路径。
        queue(Object.assign({}, job, { item }));
        if (job.kind === 'profile') {
          result = verify(await cloud.saveProfile(item));
          if (!result.profile) throw new Error('个人资料未保存到云端');
          if (result.profile.cacheKey && result.profile.cacheKey !== uid) throw new Error('账号身份已变化，请重新进入小程序');
          if (uid !== session) throw new Error('账号已切换，请重新进入');
          write(keys.profile, Object.assign({}, getProfile(), result.profile)); wx.removeStorageSync(keys.profilePending);
        } else if (job.kind === 'activity') {
          result = verify(await cloud.call('content.manage', { operation: 'saveActivity', item }));
        } else {
          result = verify(await cloud.upsertContent(job.kind, item));
          if (!result.item) throw new Error('云端没有返回已保存的内容');
          if (uid !== session) throw new Error('账号已切换，请重新进入');
          cache(job.kind, result.item);
        }
      } else if (job.action === 'delete') {
        result = verify(await cloud.deleteContent(job.kind, job.id));
        if (!result.deleted) throw new Error('云端没有确认删除');
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        erase(job.kind, job.id);
        finish(`save:${job.kind}:${job.id}`);
      } else {
        const response = await cloud.call('content.manage', job.payload);
        if (job.payload.operation === 'setPhotoVisibility' && response && response.error === 'UNKNOWN_ACTION') throw new Error('批量可见范围服务尚未更新，请先更新云函数');
        result = verify(response);
        if (job.payload.operation === 'setPhotoVisibility' && !(job.payload.ids || []).every(id => (result.upserts || []).some(entry => entry.kind === 'photo' && entry.item.id === id && entry.item.folderId === job.payload.folderId && entry.item.visibility === job.payload.visibility && (job.payload.visibility !== 'public' || typeof job.payload.hideUid !== 'boolean' || (entry.item.hideUid === true) === job.payload.hideUid)))) throw new Error('云端尚未确认全部照片的可见范围及 UID 设置，请重试');
      }
      if (uid !== session) throw new Error('账号已切换，请重新进入');
      (result.upserts || []).forEach(entry => cache(entry.kind, entry.item, job.action === 'manage' && job.payload.operation === 'setPhotoVisibility'));
      (result.deleted && Array.isArray(result.deleted) ? result.deleted : []).forEach(entry => { erase(entry.kind, entry.id); finish(`save:${entry.kind}:${entry.id}`); });
      if (job.action === 'manage') {
        const body = job.payload;
        if (body.operation === 'setPhotoVisibility') supersedePhotoVisibility(body.ids, body.visibility, job, body.hideUid);
        if (body.operation === 'deleteAlbum' || body.operation === 'deleteActivity') {
          const kind = body.operation === 'deleteAlbum' ? 'album' : 'activity';
          erase(kind, body.id); finish(`save:${kind}:${body.id}`);
        }
        if (body.operation === 'deleteBatch') (body.ids || []).forEach(id => { erase('photo', id); finish(`save:photo:${id}`); });
      }
      if (job.action === 'save' && job.kind === 'photo' && result.item) supersedePhotoVisibility([result.item.id], result.item.visibility, job, result.item.hideUid);
      epoch++; finish(job.key);
      write(accountKey('lastSync'), Date.now());
      return result.item || result.profile || result;
    } catch (error) { if (uid === session) failed(job.key, error); throw error; }
  }
  async function execute(job) {
    const session = uid;
    try {
      return await require('./retry').run(() => {
        if (uid !== session) throw require('./retry').cancelled(new Error('账号已切换，请重新进入'));
        return executeOnce(pending().find(item => item.key === job.key) || job);
      }, {
        title: job.action === 'save' ? '保存失败' : '操作未完成',
        message: error => `${job.action === 'save' && job.kind === 'photo' ? `当前照片：${String(job.item.name || '未命名照片').slice(0, 60)}\n` : ''}${error && error.message || '网络暂时不可用，请重试'}`
      });
    } catch (error) {
      if (uid === session && error.cancelled) write(accountKey('pending'), pending().map(item => item.key === job.key ? Object.assign({}, item, { cancelled: true, autoResume: false }) : item));
      throw error;
    }
  }
  async function save(kind, input) {
    const session = await ready();
    return serial(async () => {
      if (uid !== session) throw new Error('账号已切换，请重新进入');
      const existing = kind === 'profile' ? getProfile() : read(keys[kinds[kind]], []).find(item => item.id === input.id) || {};
      const item = Object.assign({ campId: 'rural', stageId: '', subcampId: '', date: today(), visibility: 'friends', status: 'published' }, existing, input);
      item.id = kind === 'profile' ? uid : item.id || newId(kind);
      item.activityName = normalizeActivityName(item.activityName);
      if (kind === 'album') { item.name = String(item.name || '').trim(); if (!item.name) throw new Error('请填写相册名称'); item.visibility = 'self'; }
      if (kind === 'activity') { item.campId = 'other'; item.visibility = 'self'; }
      const job = { key: `save:${kind}:${item.id}`, action: 'save', kind, item, autoResume: true };
      queue(job); return execute(job);
    });
  }
  async function remove(kind, id) {
    const session = await ready();
    return serial(() => {
      if (uid !== session) throw new Error('账号已切换，请重新进入');
      const old = read(keys[kinds[kind]], []).find(item => item.id === id);
      const job = { key: `delete:${kind}:${id}`, action: 'delete', kind, id, autoResume: true, description: old && (old.title || old.name || old.fileName) || `${labels[kind] || kind} ${id}` };
      queue(job); return execute(job);
    });
  }
  async function manage(operation, payload) {
    const session = await ready();
    return serial(() => {
      if (uid !== session) throw new Error('账号已切换，请重新进入');
      const body = Object.assign({ operation }, payload);
      const old = operation === 'deleteAlbum' ? read(keys.folders, []).find(item => item.id === payload.id) : operation === 'deleteActivity' ? read(keys.activities, []).find(item => item.id === payload.id) : null;
      const description = operation === 'movePhotos' ? `移动 ${(payload.ids || []).length} 张照片` : operation === 'deleteBatch' ? `删除 ${(payload.ids || []).length} 张照片` : operation === 'setPhotoVisibility' ? `修改 ${(payload.ids || []).length} 张照片的可见范围` : old && old.name || payload.name || payload.id || '内容管理';
      const job = { key: `manage:${operation}:${JSON.stringify(body)}`, action: 'manage', payload: body, description, autoResume: true };
      queue(job); return execute(job);
    });
  }
  async function refresh() {
    const expectedSession = await ready();
    return serial(async () => {
      if (uid !== expectedSession) throw new Error('账号已切换，请重新进入');
      const session = uid, version = epoch;
      const remote = verify(await cloud.getOwnState());
      if (uid !== session || epoch !== version) throw new Error('账号已切换，请重新进入');
      if (!remote.profile || Object.keys(kinds).some(kind => !Array.isArray(remote[kind === 'album' ? 'albums' : kinds[kind]]))) throw new Error('云端数据不完整，已保留本机缓存，请更新云函数后重试');
      if (remote.profile.cacheKey && remote.profile.cacheKey !== uid) throw new Error('账号身份已变化，请重新进入小程序');
      const folderIds = new Set(remote.albums.map(item => item.id));
      if (remote.photos.some(item => item.image && !folderIds.has(item.folderId))) {
        const repair = verify(await cloud.call('content.manage', { operation: 'repairAlbums' }));
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        (repair.upserts || []).forEach(entry => {
          const field = entry.kind === 'album' ? 'albums' : kinds[entry.kind];
          remote[field] = remote[field].filter(item => item.id !== entry.item.id).concat(entry.item);
        });
      }
      const snapshot = {};
      Object.keys(kinds).forEach(kind => { snapshot[kind] = read(keys[kinds[kind]], []); });
      if (!read(accountKey('legacyBackup'), null)) {
        write(accountKey('legacyBackup'), snapshot);
        const removedFolders = new Set(read(keys.pendingFolderDeletes, []));
        removedFolders.forEach(id => queue({ key: `legacy-delete-album:${id}`, action: 'manage', payload: { operation: 'deleteAlbum', kind: 'album', id }, review: true, error: '旧版相册删除尚未确认，请核对后重试' }));
        const oldProfile = read(keys.profilePending, null);
        if (oldProfile) queue({ key: `save:profile:${uid}`, action: 'save', kind: 'profile', item: oldProfile, review: true, error: '旧版资料尚未同步，请核对后重试' });
        Object.keys(kinds).forEach(kind => {
          const remoteList = remote[kind === 'album' ? 'albums' : kinds[kind]] || [];
          const known = new Set(remoteList.map(item => item.id));
          snapshot[kind].filter(item => !known.has(item.id) && !(kind === 'album' && removedFolders.has(item.id))).forEach(item => {
            const key = `save:${kind}:${item.id}`;
            if (!pending().some(job => job.key === key || job.action === 'delete' && job.kind === kind && job.id === item.id)) queue({ key, action: 'save', kind, item, review: true, error: '旧本地内容在云端未找到，请核对是否曾主动删除，再决定补传' });
          });
        });
      }
      if (!remote.profile) throw new Error('云端未返回账号数据');
      Object.keys(kinds).forEach(kind => write(keys[kinds[kind]], remote[kind === 'album' ? 'albums' : kinds[kind]] || []));
      write(keys.profile, Object.assign({}, getProfile(), remote.profile));
      reconcile(remote);
      write(accountKey('lastSync'), Date.now()); epoch++;
      return true;
    });
  }
  function refreshOwnWorks() {
    if (worksRun && worksRun.session === uid) return worksRun.promise;
    const run = { session: uid };
    run.promise = (async () => {
      const session = await ready();
      return serial(async () => {
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        let result = await cloud.call('state.works');
        if (result && result.error === 'UNKNOWN_ACTION') result = await cloud.getOwnState();
        const remote = verify(result);
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        const cacheKey = remote.cacheKey || remote.profile && remote.profile.cacheKey;
        if (cacheKey && cacheKey !== uid) throw new Error('账号身份已变化，请重新进入小程序');
        if (!Array.isArray(remote.works)) throw new Error('云端作品数据不完整，已保留本机缓存');
        const changed = JSON.stringify(read(keys.works, [])) !== JSON.stringify(remote.works);
        if (changed) { write(keys.works, remote.works); epoch++; }
        return changed;
      });
    })().finally(() => { if (worksRun === run) worksRun = null; });
    worksRun = run;
    return run.promise;
  }
  function status() {
    const items = uid ? pending() : [];
    return { uid: uid ? String(getProfile().uid || '') : '', lastSync: uid ? read(accountKey('lastSync'), 0) : 0, items: items.map(job => Object.assign({}, job, { title: job.description || job.item && (job.item.title || job.item.name || job.item.fileName) || (labels[job.kind] || '内容管理'), label: job.action === 'delete' ? '删除未完成' : job.action === 'manage' ? '管理操作未完成' : '待同步内容' })) };
  }
  async function relationship(call, payload, expected) {
    try { const session = await ready(); const result = verify(await call(payload)); if (uid !== session) throw new Error('账号已切换，请重新进入'); if (expected && !result[expected]) throw new Error('云端未确认操作成功'); return result; }
    catch (error) { return { error: error.message }; }
  }
  function backgroundSync() {
    if (backgroundRun) return backgroundRun;
    const task = (async () => {
      const session = await ready();
      const refreshed = Date.now() - read(accountKey('lastSync'), 0) > 5000 && await refresh();
      let attempted = false;
      await serial(async () => {
        if (uid !== session) return;
        for (const queued of pending().filter(item => item.autoResume && !item.cancelled && !item.review)) {
          if (uid !== session) break;
          const job = pending().find(item => item.key === queued.key);
          if (!job || !job.autoResume || job.cancelled || job.review) continue;
          attempted = true;
          try { await executeOnce(Object.assign({}, job, { background: true })); } catch (error) { /* 保留请求，下一次联网再核验；不弹窗、不连续重试。 */ }
        }
      });
      if (uid === session && attempted) return refresh();
      return uid === session && refreshed;
    })();
    backgroundRun = task.finally(() => { backgroundRun = null; });
    return backgroundRun;
  }
  return {
    bindCloudAccount: bind, resetCloudSession() { uid = ''; protocolVersion = 0; epoch++; }, newContentId: newId,
    isCloudSessionReady: () => !!uid,
    hydrateOwnCloudState: refresh,
    refreshOwnWorks,
    runBackgroundSync: backgroundSync,
    getActivitiesAsync: async () => { await refresh(); return read(keys.activities, []); },
    async getFriendsAsync() {
      try {
        const session = await ready(), version = friendManagementEpoch;
        const result = verify(await cloud.getFriends());
        if (uid === session && version === friendManagementEpoch && Array.isArray(result.friends)) {
          write(keys.friends, result.friends);
          if (result.management) write(accountKey('friendManagement'), require('./friend-management').normalize(result.management));
        }
      }
      catch (error) { /* 已核对账号的只读缓存可继续显示；写操作仍必须云端确认。 */ }
      return uid ? read(keys.friends, []) : [];
    },
    getFriendManagement() { return require('./friend-management').normalize(uid ? read(accountKey('friendManagement'), {}) : {}); },
    async saveFriendManagement(payload) {
      const session = await ready();
      return serial(async () => {
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        friendManagementEpoch++;
        try {
          const response = await cloud.call('friend.manage', payload);
          if (response && response.error === 'UNKNOWN_ACTION') throw new Error('好友分组服务尚未更新，请先更新 hui-api 云函数');
          const result = verify(response);
          if (!result.management || !Array.isArray(result.management.groups)) throw new Error('云端未确认好友管理设置，请重试');
          if (uid !== session) throw new Error('账号已切换，请重新进入');
          const management = require('./friend-management').normalize(result.management);
          write(accountKey('friendManagement'), management);
          const ids = new Set(management.groups.map(group => group.id));
          write(keys.friends, read(keys.friends, []).map(friend => Object.assign({}, friend, { groupId: result.assigned && String(friend.uid || friend.id) === String(result.assigned.uid) ? result.assigned.groupId : ids.has(friend.groupId) ? friend.groupId : 'camp-friends' })));
          return management;
        } finally { friendManagementEpoch++; }
      });
    },
    async getFriendAsync(id) { try { const session = await ready(); const result = verify(await cloud.getFriend(id)); return uid === session ? result.friend || null : null; } catch (error) { return null; } },
    async getFriendContentAsync(id, type) { try { const session = await ready(); const result = verify(await cloud.getFriendContent(id, type)); if (uid !== session) throw new Error('账号已切换，请重新进入'); return result; } catch (error) { return { error: error.message }; } },
    async getHotRankingPageAsync(options = {}) {
      const result = await cloud.getPublicRanking(options);
      if (result && !result.error && Array.isArray(result.items)) return result;
      return { items: [], page: Math.max(1, Number(options.page) || 1), total: 0, hasNext: false, error: result && result.message || '云端内容暂时无法加载，请稍后重试' };
    },
    async getHotRankingYearsAsync() { const result = await cloud.getPublicYears(); return result && !result.error && Array.isArray(result.years) && result.years.length ? result.years : [new Date().getFullYear()]; },
    refreshCurrentProfileAsync: async () => {
      try { const session = await ready(); return await serial(async () => { if (uid !== session) throw new Error('账号已切换，请重新进入'); const result = verify(await cloud.getCurrentProfile()); if (uid !== session) throw new Error('账号已切换，请重新进入'); if (result.profile && (!result.profile.cacheKey || result.profile.cacheKey === uid)) write(keys.profile, Object.assign({}, getProfile(), result.profile)); return getProfile(); }); }
      catch (error) { return uid ? getProfile() : { uid: '', name: '', bio: '', tags: [], avatar: '', stats: { age: '', campCount: '' } }; }
    },
    saveGrowth: input => save('growth', input), saveCompanion: input => save('companion', input), saveFolder: input => save('album', input), saveActivity: input => save('activity', input),
    saveWorkAsync: input => save('work', input), savePhotoAsync: input => save('photo', input),
    saveWork: input => save('work', input), savePhoto: input => save('photo', input),
    saveWorkDraft: (id, input) => save('work', Object.assign({}, input, { id, status: 'draft' })),
    deleteGrowth: id => remove('growth', id), deleteCompanion: id => remove('companion', id), deleteWork: id => remove('work', id), deletePhoto: id => remove('photo', id),
    deletePhotos: ids => manage('deleteBatch', { kind: 'photo', ids }),
    deleteFolder: id => manage('deleteAlbum', { kind: 'album', id }),
    deleteActivity: (id, name) => manage('deleteActivity', { id, name }),
    movePhotos: (ids, folderId) => manage('movePhotos', { ids, folderId }),
    changePhotosVisibility: (ids, visibility, folderId, versions = {}, hideUid) => manage('setPhotoVisibility', Object.assign({ ids, visibility, folderId, versions }, visibility === 'public' && typeof hideUid === 'boolean' ? { hideUid } : {})),
    saveProfileAsync: input => save('profile', input), saveProfile: input => save('profile', input),
    async toggleFavorite(kind, id, ownerUid) {
      const session = await ready();
      return serial(async () => {
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        const knownFavorites = read(keys.favorites, {});
        const desired = !(knownFavorites[kind] && knownFavorites[kind][id]);
        const result = verify(await (kind === 'comment' ? cloud.toggleCommentLike(id, desired) : cloud.toggleLike(kind, id, ownerUid, '', desired)));
        if (uid !== session) throw new Error('账号已切换，请重新进入');
        if (typeof result.favorite !== 'boolean') throw new Error('云端未确认点赞状态');
        const favorites = read(keys.favorites, {});
        favorites[kind] = favorites[kind] || {}; favorites[kind][id] = result.favorite; write(keys.favorites, favorites);
        const key = keys[kinds[kind]];
        if (key) write(key, read(key, []).map(item => item.id === id ? Object.assign({}, item, { likes: result.likes == null ? item.likes : result.likes }) : item));
        return result.favorite;
      });
    },
    async createFriendRequestAsync(input) {
      const reason = String(input.reason || '').trim();
      if (!reason.replace(/[\s\u200B-\u200D\uFEFF]/g, '')) return { error: '请填写申请内容后再提交' };
      return relationship(() => cloud.createFriendRequest(String(input.toUid || '').trim(), reason), null, 'request');
    },
    acceptFriendRequestAsync: id => relationship(() => cloud.acceptFriendRequest(id), null, 'accepted'),
    rejectFriendRequestAsync: id => relationship(() => cloud.rejectFriendRequest(id), null, 'rejected'),
    async deleteFriendAsync(id) { const result = await relationship(() => cloud.deleteFriend(id), null, 'removed'); if (!result.error) write(keys.friends, read(keys.friends, []).filter(item => item.id !== id && item.uid !== id)); return result; },
    async saveFriend(input) {
      const session = await ready(); verify(await cloud.updateFriendRemark(input.uid || input.id, input.remark || ''));
      if (uid !== session) throw new Error('账号已切换，请重新进入');
      const friends = read(keys.friends, []); const id = input.id || input.uid;
      const old = friends.find(item => item.id === id || item.uid === input.uid) || {};
      write(keys.friends, friends.filter(item => item.id !== id && item.uid !== input.uid).concat(Object.assign({}, old, input, { id })));
      return input;
    },
    async deleteFriend(id) { const friend = read(keys.friends, []).find(item => item.id === id || item.uid === id); const result = await relationship(() => cloud.deleteFriend(friend ? friend.uid : id), null, 'removed'); if (result.error) throw new Error(result.error); write(keys.friends, read(keys.friends, []).filter(item => item.id !== id && item.uid !== id)); return result; },
    getSyncStatus: status,
    getSyncDraft(key) { const job = pending().find(item => item.key === key); return job && job.action === 'save' ? Object.assign({}, job.item) : null; },
    stageDraft(kind, item) {
      if (!uid) return;
      const value = Object.assign({ date: today(), visibility: 'friends', status: 'published' }, item);
      value.id = kind === 'profile' ? uid : value.id || newId(kind);
      queue({ key: `save:${kind}:${value.id}`, action: 'save', kind, item: value, autoResume: false, error: '内容尚未提交成功，可继续编辑或重试' });
      return value.id;
    },
    async retrySync(key) { await ready(); return serial(() => { const job = pending().find(item => item.key === key); if (!job) throw new Error('待同步内容不存在'); return execute(job); }); },
    discardSync(key) { finish(key); }
  };
}
module.exports = { createSync };
