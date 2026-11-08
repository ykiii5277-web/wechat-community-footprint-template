// 浏览期间保留已加载页的顺序和筛选条件；会话结束后释放，不持久化公开内容快照。
const sessions = new Map();
function key(item) { return item && `${item.kind}:${item.recordId || `${item.ownerUid || ''}:${item.id}`}`; }
function entry(item, position) { return { id: item.id, kind: item.kind, ownerUid: item.ownerUid || '', recordId: item.recordId || '', rank: Number(item.rank) || position }; }
function create(config) {
  const pages = new Map();
  const unavailable = new Set();
  const startPage = Math.max(1, Number(config.page) || 1);
  const options = Object.assign({}, config.options);
  const pageSize = Number(config.pageSize) || 20;
  let total = Number(config.total) || config.items.length;
  let cursor = { page: startPage, index: Math.max(0, Math.min(config.items.length - 1, Number(config.index) || 0)) };
  pages.set(startPage, { items: config.items.map((item, index) => entry(item, (startPage - 1) * pageSize + index + 1)), hasNext: !!config.hasNext });
  async function load(page) {
    if (pages.has(page)) return pages.get(page);
    const result = await config.loadPage(Object.assign({}, options, { page }));
    if (!result || result.error || !Array.isArray(result.items)) throw new Error(result && (result.message || result.error) || '内容列表加载失败，请稍后重试');
    const known = new Set();
    pages.forEach(value => value.items.forEach(item => known.add(key(item))));
    const items = [];
    result.items.forEach((item, index) => { if (!known.has(key(item))) { known.add(key(item)); items.push(entry(item, (page - 1) * pageSize + index + 1)); } });
    const value = { items, hasNext: !!result.hasNext };
    if (Number.isFinite(Number(result.total))) total = Number(result.total);
    pages.set(page, value);
    return value;
  }
  function hasNeighbor(direction) {
    let page = cursor.page, index = cursor.index;
    for (;;) {
      const list = pages.get(page);
      if (!list) return true;
      index += direction;
      if (index >= 0 && index < list.items.length) { if (!unavailable.has(key(list.items[index]))) return true; continue; }
      if (direction > 0) { if (!list.hasNext) return false; page++; index = -1; }
      else { if (page <= 1) return false; page--; const previous = pages.get(page); if (!previous) return true; index = previous.items.length; }
    }
  }
  const browser = {
    current() { return pages.get(cursor.page).items[cursor.index]; },
    state() {
      const item = browser.current();
      return { hasPrevious: hasNeighbor(-1), hasNext: hasNeighbor(1), position: item && item.rank || (cursor.page - 1) * pageSize + cursor.index + 1, total };
    },
    commit(position) { cursor = Object.assign({}, position); },
    markUnavailable(item) { unavailable.add(key(item)); },
    async seek(position) {
      if (!Number.isSafeInteger(position) || position < 1 || position > total) throw new Error(`请输入 1–${total} 的整数序号`);
      const find = () => {
        for (const [page, list] of pages) {
          const index = list.items.findIndex(item => item.rank === position);
          if (index >= 0) return { item: list.items[index], cursor: { page, index }, unavailable: unavailable.has(key(list.items[index])) };
        }
        return null;
      };
      const cached = find();
      if (cached) return cached;
      // 根据条目序号直接取对应页，不顺序加载前面所有页面。
      await load(Math.floor((position - 1) / pageSize) + 1);
      if (position > total) return null;
      return find();
    },
    async neighbor(direction, from = cursor) {
      let page = from.page, index = from.index;
      for (;;) {
        const list = await load(page);
        index += direction;
        if (index >= 0 && index < list.items.length) {
          if (!unavailable.has(key(list.items[index]))) return { item: list.items[index], cursor: { page, index } };
          continue;
        }
        if (direction > 0) {
          if (!list.hasNext) return null;
          page++; index = -1;
        } else {
          if (page <= 1) return null;
          page--;
          index = (await load(page)).items.length;
        }
      }
    }
  };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  sessions.set(id, browser);
  return id;
}
function get(id) { return sessions.get(id); }
function discard(id) { sessions.delete(id); }
module.exports = { create, get, discard, key };
