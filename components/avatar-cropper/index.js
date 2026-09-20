const cloud = require('../../utils/cloud-service');

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const OUTPUT_SIZE = 600;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function point(touch) { return { x: Number(touch && (touch.clientX != null ? touch.clientX : touch.pageX)) || 0, y: Number(touch && (touch.clientY != null ? touch.clientY : touch.pageY)) || 0 }; }
function distance(first, second) { const a = point(first); const b = point(second); return Math.hypot(a.x - b.x, a.y - b.y); }
function imageInfo(src) { return new Promise((resolve, reject) => wx.getImageInfo({ src, success: resolve, fail: reject })); }

Component({
  properties: {
    visible: { type: Boolean, value: false },
    source: { type: String, value: '' },
    initialScale: { type: Number, value: 1 },
    initialOffsetX: { type: Number, value: 0 },
    initialOffsetY: { type: Number, value: 0 }
  },
  data: { ready: false, exporting: false, cropSource: '', framePx: 300, baseWidth: 300, baseHeight: 300, naturalWidth: 1, naturalHeight: 1, cropScale: 1, panX: 0, panY: 0, imageLeft: 0, imageTop: 0 },
  observers: {
    'visible,source': function (visible, source) {
      if (visible && source && source !== this._preparedSource) this.prepare(source);
      if (!visible) this._preparedSource = '';
    }
  },
  methods: {
    stop() {},
    limits(scale) {
      return {
        x: Math.max(0, (this.data.baseWidth * scale - this.data.framePx) / 2),
        y: Math.max(0, (this.data.baseHeight * scale - this.data.framePx) / 2)
      };
    },
    setTransform(scale, panX, panY) {
      const safeScale = clamp(Number(scale) || 1, MIN_SCALE, MAX_SCALE);
      const limit = this.limits(safeScale);
      const safeX = clamp(Number(panX) || 0, -limit.x, limit.x);
      const safeY = clamp(Number(panY) || 0, -limit.y, limit.y);
      this.setData({
        cropScale: Number(safeScale.toFixed(3)),
        panX: Number(safeX.toFixed(2)),
        panY: Number(safeY.toFixed(2)),
        imageLeft: Number(((this.data.framePx - this.data.baseWidth) / 2 + safeX).toFixed(2)),
        imageTop: Number(((this.data.framePx - this.data.baseHeight) / 2 + safeY).toFixed(2))
      });
    },
    async prepare(source) {
      this._preparedSource = source;
      this.setData({ ready: false, exporting: false });
      try {
        const resolved = /^cloud:\/\//i.test(source) ? (await cloud.resolveCloudFiles([source]))[0] || source : source;
        const info = await imageInfo(resolved);
        if (!this.properties.visible || this._preparedSource !== source) return;
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const framePx = Math.max(220, Math.min(Number(windowInfo.windowWidth) - 32, Number(windowInfo.windowHeight) - 220));
        const naturalWidth = Math.max(1, Number(info.width) || 1);
        const naturalHeight = Math.max(1, Number(info.height) || 1);
        const fit = Math.max(framePx / naturalWidth, framePx / naturalHeight);
        const baseWidth = naturalWidth * fit;
        const baseHeight = naturalHeight * fit;
        const scale = clamp(Number(this.properties.initialScale) || 1, MIN_SCALE, MAX_SCALE);
        // 旧版位移以 rpx 保存；这里只在首次全屏调整时做一次等效换算，完成后会烘焙进头像图片。
        const pxPerRpx = Math.max(1, Number(windowInfo.windowWidth)) / 750;
        this.setData({ cropSource: info.path || resolved, framePx, baseWidth, baseHeight, naturalWidth, naturalHeight, ready: true }, () => {
          this.setTransform(scale, Number(this.properties.initialOffsetX) * pxPerRpx, Number(this.properties.initialOffsetY) * pxPerRpx);
        });
      } catch (error) {
        this.cancel();
        wx.showToast({ title: '头像图片读取失败，请重新选择', icon: 'none' });
      }
    },
    touchStart(e) {
      const touches = e.touches || [];
      if (!touches.length || !this.data.ready) return;
      if (touches.length > 1) {
        this._gesture = { mode: 'pinch', distance: Math.max(1, distance(touches[0], touches[1])), scale: this.data.cropScale, panX: this.data.panX, panY: this.data.panY };
      } else {
        const current = point(touches[0]);
        this._gesture = { mode: 'move', x: current.x, y: current.y, panX: this.data.panX, panY: this.data.panY };
      }
    },
    touchMove(e) {
      const touches = e.touches || [];
      if (!touches.length || !this.data.ready) return;
      const state = this._gesture;
      if (touches.length > 1) {
        if (!state || state.mode !== 'pinch') return this.touchStart(e);
        return this.setTransform(state.scale * distance(touches[0], touches[1]) / state.distance, state.panX, state.panY);
      }
      if (!state || state.mode !== 'move') return this.touchStart(e);
      const current = point(touches[0]);
      this.setTransform(this.data.cropScale, state.panX + current.x - state.x, state.panY + current.y - state.y);
    },
    touchEnd(e) {
      this._gesture = null;
      if (e.touches && e.touches.length) this.touchStart(e);
    },
    cancel() {
      if (this.data.exporting) return;
      this._preparedSource = '';
      this.setData({ ready: false });
      this.triggerEvent('cancel');
    },
    complete() {
      if (!this.data.ready || this.data.exporting) return;
      this.setData({ exporting: true });
      const scale = this.data.cropScale;
      const renderedWidth = this.data.baseWidth * scale;
      const renderedHeight = this.data.baseHeight * scale;
      const left = (this.data.framePx - renderedWidth) / 2 + this.data.panX;
      const top = (this.data.framePx - renderedHeight) / 2 + this.data.panY;
      const sourceWidth = this.data.framePx * this.data.naturalWidth / renderedWidth;
      const sourceHeight = this.data.framePx * this.data.naturalHeight / renderedHeight;
      const sourceX = clamp(-left * this.data.naturalWidth / renderedWidth, 0, Math.max(0, this.data.naturalWidth - sourceWidth));
      const sourceY = clamp(-top * this.data.naturalHeight / renderedHeight, 0, Math.max(0, this.data.naturalHeight - sourceHeight));
      const context = wx.createCanvasContext('avatarCropCanvas', this);
      context.setFillStyle('#F7F3EA');
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.drawImage(this.data.cropSource, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: 'avatarCropCanvas',
          x: 0,
          y: 0,
          width: OUTPUT_SIZE,
          height: OUTPUT_SIZE,
          destWidth: OUTPUT_SIZE,
          destHeight: OUTPUT_SIZE,
          fileType: 'jpg',
          quality: 0.9,
          success: result => {
            this._preparedSource = '';
            this.setData({ ready: false, exporting: false });
            this.triggerEvent('complete', { tempFilePath: result.tempFilePath });
          },
          fail: () => {
            this.setData({ exporting: false });
            wx.showToast({ title: '头像生成失败，请重试', icon: 'none' });
          }
        }, this);
      });
    }
  }
});
