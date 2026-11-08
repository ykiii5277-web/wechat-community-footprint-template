// 仅在当前进程保存预览会话和回调，不把好友图片或临时链接写入持久缓存。
const sessions = new Map();
function create(images, current, onClose) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  sessions.set(id, { images, current, onClose });
  return id;
}
function get(id) { return sessions.get(id); }
function discard(id) { sessions.delete(id); }
function finish(id, current) {
  const session = sessions.get(id);
  sessions.delete(id);
  if (!session) return;
  const image = session.images[current] || session.images[session.current];
  if (image && typeof session.onClose === 'function') return session.onClose(image.index);
}
module.exports = { create, get, discard, finish };
