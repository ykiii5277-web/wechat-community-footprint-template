const DEFAULT_GROUP = { id: 'camp-friends', name: '营地好友', isDefault: true };
const SORTS = ['name', 'affection', 'added'];
function normalize(input = {}) {
  const savedDefault = (Array.isArray(input.groups) ? input.groups : []).find(group => group && group.id === DEFAULT_GROUP.id);
  const groups = [Object.assign({}, DEFAULT_GROUP, { name: savedDefault && String(savedDefault.name || '').trim() || DEFAULT_GROUP.name })];
  for (const group of Array.isArray(input.groups) ? input.groups : []) {
    if (group && group.id && group.name && !groups.some(item => item.id === group.id)) groups.push({ id: String(group.id), name: String(group.name), isDefault: false });
  }
  const ids = new Set(groups.map(group => group.id));
  const assignments = Object.fromEntries(Object.entries(input.assignments || {}).filter(([, id]) => ids.has(id)));
  return { groups, assignments, sort: SORTS.includes(input.sort) ? input.sort : 'name' };
}
const view = state => ({ groups: state.groups, sort: state.sort });
function createFriendManager({ db, profiles, friendships, ownProfile, profileByUid, ensureFriend, checkSubmission }) {
  async function read(openid) { return normalize((await ownProfile(openid)).friendManagement); }
  async function manage(openid, payload) {
    await ownProfile(openid);
    const operation = payload.operation;
    if (!['create', 'rename', 'delete', 'assign', 'sort'].includes(operation)) throw new Error('INVALID_FRIEND_MANAGEMENT');
    let target, relation;
    if (operation === 'assign') {
      target = await profileByUid(payload.uid);
      if (!target) throw new Error('FRIEND_NOT_FOUND');
      relation = await ensureFriend(openid, target._id);
    }
    let name;
    if (operation === 'create' || operation === 'rename') {
      name = String(payload.name || '').trim();
      if (!name || Array.from(name).length > 20) throw new Error('INVALID_FRIEND_GROUP_NAME');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(payload.groupId || ''))) throw new Error('INVALID_FRIEND_GROUP');
      await checkSubmission(openid, [name], [], 3);
    }
    const state = await db.runTransaction(async transaction => {
      const ref = transaction.collection(profiles).doc(openid);
      const profile = (await ref.get()).data;
      const current = normalize(profile.friendManagement);
      if (operation === 'sort') {
        if (!SORTS.includes(payload.sort)) throw new Error('INVALID_FRIEND_SORT');
        current.sort = payload.sort;
      } else if (operation === 'assign') {
        if (!current.groups.some(group => group.id === payload.groupId)) throw new Error('FRIEND_GROUP_NOT_FOUND');
        const saved = (await transaction.collection(friendships).doc(relation._id).get()).data;
        if (!saved || !saved.members.includes(openid) || !saved.members.includes(target._id)) throw new Error('FRIEND_NOT_FOUND');
        current.assignments[target._id] = payload.groupId;
      } else {
        const index = current.groups.findIndex(group => group.id === payload.groupId);
        if (payload.groupId === DEFAULT_GROUP.id && operation !== 'rename') throw new Error('DEFAULT_FRIEND_GROUP');
        if (operation === 'create') {
          if (index >= 0) {
            if (current.groups[index].name !== name) throw new Error('FRIEND_GROUP_EXISTS');
          } else {
            if (current.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('FRIEND_GROUP_EXISTS');
            current.groups.push({ id: payload.groupId, name, isDefault: false });
          }
        } else if (operation === 'rename') {
          if (index < 0) throw new Error('FRIEND_GROUP_NOT_FOUND');
          if (current.groups.some(group => group.id !== payload.groupId && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('FRIEND_GROUP_EXISTS');
          current.groups[index].name = name;
        } else {
          current.groups = current.groups.filter(group => group.id !== payload.groupId);
          Object.keys(current.assignments).forEach(key => { if (current.assignments[key] === payload.groupId) delete current.assignments[key]; });
        }
      }
      await ref.update({ data: { friendManagement: current } });
      return current;
    });
    return { management: view(state), assigned: operation === 'assign' ? { uid: target.uid, groupId: payload.groupId } : null };
  }
  return { read, manage, view };
}
module.exports = { createFriendManager, normalize, DEFAULT_GROUP };
