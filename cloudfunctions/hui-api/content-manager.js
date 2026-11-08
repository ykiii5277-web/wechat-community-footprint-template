const crypto = require('crypto');
const recordId = (owner, kind, id) => `content_${crypto.createHash('sha256').update(`${owner}:${kind}:${id}`).digest('hex')}`;
const clean = record => { const item = Object.assign({}, record); delete item._id; return item; };

function createManager({ db, collections, ownProfile, ownerContentRecords, sanitizeContent, checkSubmission, exposeContent, now }) {
  async function revision(openid) {
    const result = await db.collection(collections.profiles).doc(openid).get();
    return Number(result.data.contentRevision) || 0;
  }
  async function commit(openid, writes, removals = [], expectedRevision) {
    await db.runTransaction(async transaction => {
      const profileRef = transaction.collection(collections.profiles).doc(openid);
      const current = (await profileRef.get()).data;
      if (expectedRevision != null && (Number(current.contentRevision) || 0) !== expectedRevision) throw new Error('CONTENT_CONFLICT');
      for (const job of writes.concat(removals)) {
        if (!job.old) continue;
        const saved = await transaction.collection(collections.content).doc(job.old._id).get();
        if (!saved.data || saved.data.updatedAt !== job.old.updatedAt || JSON.stringify(saved.data.payload) !== JSON.stringify(job.old.payload)) throw new Error('CONTENT_CONFLICT');
        if (job.record) ['views', 'likes', 'commentCount'].forEach(field => { job.record[field] = Number(saved.data[field]) || 0; });
      }
      for (const job of writes) {
        const id = job.old ? job.old._id : recordId(openid, job.record.kind, job.record.contentId);
        const ref = transaction.collection(collections.content).doc(id);
        if (!job.old) {
          const existing = await ref.get().catch(error => {
            if (/not.exist|not.found|does not exist|DATABASE_DOCUMENT_NOT_EXIST|不存在/i.test(String(error && (error.errMsg || error.message)))) return null;
            throw error;
          });
          if (existing && existing.data) throw new Error('CONTENT_CONFLICT');
        }
        await ref.set({ data: clean(job.record) });
        job.record._id = id;
      }
      for (const job of removals) await transaction.collection(collections.content).doc(job.old._id).remove();
      await profileRef.update({ data: { contentRevision: (Number(current.contentRevision) || 0) + 1 } });
    });
  }
  async function manage(openid, payload) {
    const profile = await ownProfile(openid);
    const version = await revision(openid);
    const records = (await ownerContentRecords(openid)).data.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const writes = [], removals = [], acknowledged = [];
    const nameOf = value => { let text = String(value || '').trim(); for (let i = 0; i < 3; i++) { try { const decoded = decodeURIComponent(text).trim(); if (text === decoded) break; text = decoded; } catch (error) { break; } } return text; };
    const sameContext = (a, b) => ['campId', 'stageId', 'subcampId', 'activityName'].every(key => nameOf(a[key]) === nameOf(b[key]));
    const put = (kind, input, old) => {
      const item = sanitizeContent(kind, input);
      const record = old ? Object.assign({}, old, { payload: item, visibility: item.visibility, status: item.status, updatedAt: now() }) : {
        ownerOpenid: openid, ownerUid: profile.uid, ownerName: profile.name || '未命名用户', ownerAvatar: profile.avatar || '', kind,
        contentId: item.id, payload: item, visibility: item.visibility, status: item.status, createdAt: now(), updatedAt: now(), publishedAt: now(), views: 0, likes: 0, commentCount: 0
      };
      writes.push({ old, record });
    };
    const remove = old => {
      if (!old) return;
      records.filter(item => item.kind === old.kind && item.contentId === old.contentId).forEach(item => { if (!removals.some(job => job.old._id === item._id)) removals.push({ old: item }); });
    };
    const selected = records.find(record => record.kind === payload.kind && record.contentId === payload.id);
    if (payload.operation === 'saveActivity') {
      const input = payload.item || {};
      const old = records.find(record => record.kind === 'activity' && record.contentId === input.id);
      const name = nameOf(input.name);
      if (!input.id || !name) throw new Error('INVALID_CONTENT_ID');
      if (old && input.updatedAt && input.updatedAt !== old.updatedAt && (old.payload.name !== name || old.payload.cover !== input.cover)) throw new Error('CONTENT_CONFLICT');
      if (records.some(record => record.kind === 'activity' && record.contentId !== input.id && nameOf(record.payload.name) === name)) throw new Error('ACTIVITY_NAME_EXISTS');
      const originalName = nameOf(old ? old.payload.name : input.originalName);
      await checkSubmission(openid, [name], input.cover && (!old || input.cover !== old.payload.cover) ? [input.cover] : [], 3);
      put('activity', Object.assign({}, old && old.payload, input, { name, campId: 'other', visibility: 'self' }), old);
      if (originalName && originalName !== name) records.filter(record => record.kind !== 'activity' && record.payload.campId === 'other' && nameOf(record.payload.activityName) === originalName).forEach(record => put(record.kind, Object.assign({}, record.payload, { activityName: name }), record));
    } else if (payload.operation === 'deleteActivity') {
      const old = records.find(record => record.kind === 'activity' && record.contentId === payload.id);
      const name = nameOf(old ? old.payload.name : payload.name);
      if (!old && !String(payload.id || '').startsWith('activity-legacy-')) return { deleted: [], upserts: [] };
      if (!name) throw new Error('INVALID_CONTENT_ID');
      records.filter(record => record._id === (old && old._id) || record.payload.campId === 'other' && (record.kind === 'activity' ? nameOf(record.payload.name) === name : nameOf(record.payload.activityName) === name)).forEach(remove);
    } else if (payload.operation === 'deleteAlbum') {
      if (selected) {
        const photos = records.filter(record => record.kind === 'photo' && record.payload.folderId === selected.contentId);
        if (photos.length) {
          const folder = records.find(record => record.kind === 'album' && record.contentId !== selected.contentId && record.payload.autoCreated && sameContext(record.payload, selected.payload));
          const folderId = folder ? folder.contentId : `folder-recovered-${crypto.createHash('sha256').update(selected.contentId).digest('hex').slice(0, 20)}`;
          if (!folder) put('album', Object.assign({}, selected.payload, { id: folderId, name: '回忆集', cover: '', autoCreated: true, visibility: 'self' }));
          photos.forEach(record => put('photo', Object.assign({}, record.payload, { folderId }), record));
        }
        remove(selected);
      }
    } else if (payload.operation === 'movePhotos') {
      const folder = records.find(record => record.kind === 'album' && record.contentId === payload.folderId);
      if (!folder) throw new Error('ALBUM_NOT_FOUND');
      const ids = new Set(payload.ids || []);
      const photos = records.filter(record => record.kind === 'photo' && ids.has(record.contentId));
      if (photos.length !== ids.size || photos.some(record => !sameContext(record.payload, folder.payload))) throw new Error('ALBUM_CONTEXT_MISMATCH');
      photos.forEach(record => put('photo', Object.assign({}, record.payload, { folderId: folder.contentId }), record));
    } else if (payload.operation === 'setPhotoVisibility') {
      if (!['public', 'friends', 'self'].includes(payload.visibility)) throw new Error('INVALID_VISIBILITY');
      if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.some(id => typeof id !== 'string' || !id || id.length > 160)) throw new Error('INVALID_PHOTO_SELECTION');
      const folder = records.find(record => record.kind === 'album' && record.contentId === payload.folderId);
      if (!folder) throw new Error('ALBUM_NOT_FOUND');
      const ids = new Set(payload.ids);
      const photos = records.filter(record => record.kind === 'photo' && ids.has(record.contentId));
      if (new Set(photos.map(record => record.contentId)).size !== ids.size || photos.some(record => record.payload.folderId !== folder.contentId || !sameContext(record.payload, folder.payload))) throw new Error('PHOTO_SELECTION_CHANGED');
      const portable = value => !value || /^(cloud:\/\/|https?:\/\/)/i.test(String(value)) && !/^https?:\/\/(tmp|usr|store|localhost|127\.0\.0\.1)([/:]|$)/i.test(String(value));
      if (payload.visibility !== 'self' && photos.some(record => !portable(record.payload.image))) throw new Error('SHARED_FILE_NOT_UPLOADED');
      const versions = payload.versions || {};
      const updatesUid = payload.visibility === 'public' && typeof payload.hideUid === 'boolean';
      const matchesTarget = record => record.visibility === payload.visibility && record.payload.visibility === payload.visibility && (!updatesUid || (record.payload.hideUid === true) === payload.hideUid);
      if ([...ids].some(id => {
        const matches = photos.filter(record => record.contentId === id);
        return versions[id] != null && !matches.some(record => Number(versions[id]) === Number(record.updatedAt)) && matches.some(record => !matchesTarget(record));
      })) throw new Error('CONTENT_CONFLICT');
      // 图片及文字内容未改动，不重复上传、压缩或更换文件；保留点赞、浏览和评论。
      // 同一个逻辑照片若有历史重复文档，全部改成一致的可见范围，避免残留公开副本。
      photos.forEach(record => {
        if (matchesTarget(record)) acknowledged.push(record);
        else put('photo', Object.assign({}, record.payload, { visibility: payload.visibility }, updatesUid ? { hideUid: payload.hideUid } : {}), record);
      });
    } else if (payload.operation === 'repairAlbums') {
      const folders = new Map(records.filter(record => record.kind === 'album').map(record => [record.contentId, record]));
      records.filter(record => record.kind === 'photo' && record.payload.image && !folders.has(record.payload.folderId)).forEach(record => {
        const item = record.payload;
        const context = ['campId', 'stageId', 'subcampId', 'activityName'].map(key => item[key] || '').join('|');
        const folderId = item.folderId || `folder-legacy-${crypto.createHash('sha256').update(context).digest('hex').slice(0, 20)}`;
        if (!folders.has(folderId)) { put('album', Object.assign({}, item, { id: folderId, name: '回忆集', cover: '', autoCreated: true, visibility: 'self' })); folders.set(folderId, true); }
        if (item.folderId !== folderId) put('photo', Object.assign({}, item, { folderId }), record);
      });
    } else if (payload.operation === 'deleteBatch') {
      if (payload.kind !== 'photo') throw new Error('INVALID_KIND');
      const ids = new Set(payload.ids || []);
      records.filter(record => record.kind === 'photo' && ids.has(record.contentId)).forEach(remove);
    } else throw new Error('UNKNOWN_ACTION');
    if (writes.length || removals.length) await commit(openid, writes, removals, version);
    return { upserts: writes.map(job => ({ kind: job.record.kind, item: exposeContent(job.record, profile) })).concat(acknowledged.map(record => ({ kind: record.kind, item: exposeContent(record, profile) }))), deleted: removals.map(job => ({ kind: job.old.kind, id: job.old.contentId })) };
  }
  return { commit, manage };
}
module.exports = { createManager, recordId };
