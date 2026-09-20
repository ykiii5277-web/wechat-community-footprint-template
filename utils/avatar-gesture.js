// 微信式头像裁切交互：单指拖动位置，双指捏合缩放。
const MIN_SCALE = 1;
const MAX_SCALE = 3;

function point(touch) {
  return {
    x: Number(touch && (touch.clientX != null ? touch.clientX : touch.pageX)) || 0,
    y: Number(touch && (touch.clientY != null ? touch.clientY : touch.pageY)) || 0
  };
}

function distance(first, second) {
  const a = point(first);
  const b = point(second);
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function positionLimit(scale) { return Math.min(90, Math.max(0, (scale - 1) * 100)); }
function rounded(value, digits) { return Number(Number(value).toFixed(digits)); }

function start(e) {
  const touches = e.touches || [];
  if (!touches.length) return;
  const scale = clamp(Number(this.data.avatarScale) || 1.3, MIN_SCALE, MAX_SCALE);
  if (touches.length > 1) {
    this._avatarGesture = { mode: 'pinch', distance: Math.max(1, distance(touches[0], touches[1])), scale };
    return;
  }
  const current = point(touches[0]);
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  this._avatarGesture = {
    mode: 'move',
    x: current.x,
    y: current.y,
    offsetX: Number(this.data.avatarOffsetX) || 0,
    offsetY: Number(this.data.avatarOffsetY) || 0,
    rpxPerPx: 750 / Math.max(1, Number(windowInfo.windowWidth) || 375)
  };
}

function move(e) {
  const touches = e.touches || [];
  if (!touches.length) return;
  const state = this._avatarGesture;
  if (touches.length > 1) {
    if (!state || state.mode !== 'pinch') return start.call(this, e);
    const scale = clamp(state.scale * distance(touches[0], touches[1]) / state.distance, MIN_SCALE, MAX_SCALE);
    const limit = positionLimit(scale);
    this.setData({
      avatarScale: rounded(scale, 2),
      avatarOffsetX: rounded(clamp(Number(this.data.avatarOffsetX) || 0, -limit, limit), 1),
      avatarOffsetY: rounded(clamp(Number(this.data.avatarOffsetY) || 0, -limit, limit), 1)
    });
    return;
  }
  if (!state || state.mode !== 'move') return start.call(this, e);
  const current = point(touches[0]);
  const limit = positionLimit(Number(this.data.avatarScale) || 1.3);
  this.setData({
    avatarOffsetX: rounded(clamp(state.offsetX + (current.x - state.x) * state.rpxPerPx, -limit, limit), 1),
    avatarOffsetY: rounded(clamp(state.offsetY + (current.y - state.y) * state.rpxPerPx, -limit, limit), 1)
  });
}

function end(e) {
  this._avatarGesture = null;
  if (e.touches && e.touches.length) start.call(this, e);
}

module.exports = { start, move, end };
