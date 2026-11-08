const DEFAULT_GROUP = { id: 'camp-friends', name: '营地好友', isDefault: true };
const SORTS = [{ id: 'name', name: '名称字母' }, { id: 'affection', name: '好感度' }, { id: 'added', name: '添加时间' }];
let collator;
try { if (typeof Intl !== 'undefined' && Intl.Collator) collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' }); } catch (error) { /* 旧客户端使用 localeCompare。 */ }
const compareText = (a, b) => collator ? collator.compare(a, b) : a.localeCompare(b, 'zh-Hans-CN');
function sortFriends(friends, sort = 'name') {
  return friends.slice().sort((a, b) => {
    const difference = sort === 'affection' ? (Number(b.affection && b.affection.points) || 0) - (Number(a.affection && a.affection.points) || 0) : sort === 'added' ? (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0) : 0;
    return difference || compareText(String(a.name || '').trim(), String(b.name || '').trim()) || String(a.uid || a.id).localeCompare(String(b.uid || b.id));
  });
}
function normalize(input = {}) {
  const savedDefault = (Array.isArray(input.groups) ? input.groups : []).find(group => group && group.id === DEFAULT_GROUP.id);
  const groups = [Object.assign({}, DEFAULT_GROUP, { name: savedDefault && String(savedDefault.name || '').trim() || DEFAULT_GROUP.name })];
  (Array.isArray(input.groups) ? input.groups : []).forEach(group => { if (group && group.id && group.name && !groups.some(item => item.id === group.id)) groups.push(Object.assign({}, group, { isDefault: false })); });
  return { groups, sort: SORTS.some(sort => sort.id === input.sort) ? input.sort : 'name' };
}
function grouped(friends, management, expanded = {}) {
  const state = normalize(management), ids = new Set(state.groups.map(group => group.id));
  return state.groups.map(group => Object.assign({}, group, { expanded: expanded[group.id] === true, friends: friends.filter(friend => (ids.has(friend.groupId) ? friend.groupId : DEFAULT_GROUP.id) === group.id) }));
}
module.exports = { DEFAULT_GROUP, SORTS, normalize, sortFriends, grouped };
