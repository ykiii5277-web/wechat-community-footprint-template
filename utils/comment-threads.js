// 将平铺保存的评论整理成“主评论 + 回复”的楼层结构。
// 回复允许继续回复任意一条评论，但显示时都会收纳到最初的主评论下。
function getThreadRootId(comments, id) {
  const byId = {};
  (comments || []).forEach(item => { if (item && item.id) byId[item.id] = item; });
  let current = byId[id];
  const visited = {};
  while (current && current.parentId && byId[current.parentId] && !visited[current.id]) {
    visited[current.id] = true;
    current = byId[current.parentId];
  }
  return current && current.id ? current.id : id;
}

function buildCommentThreads(comments, expandedThreads = {}) {
  const list = Array.isArray(comments) ? comments.slice() : [];
  const roots = [];
  const replies = {};
  list.forEach(item => {
    if (!item || !item.id) return;
    const rootId = getThreadRootId(list, item.id);
    if (rootId === item.id) roots.push(item);
    else {
      replies[rootId] = replies[rootId] || [];
      replies[rootId].push(item);
    }
  });
  return roots.map(item => {
    const children = replies[item.id] || [];
    return Object.assign({}, item, { replies: children, replyCount: children.length, expanded: !!expandedThreads[item.id] });
  });
}

module.exports = { buildCommentThreads, getThreadRootId };
