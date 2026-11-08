const guide = require('../../utils/feature-guide');

Component({
  properties: {
    step: { type: Object, value: null },
    index: { type: Number, value: 0 },
    total: { type: Number, value: 0 }
  },
  data: { dragX: 0, dragY: 0 },
  methods: {
    dragStart(event) {
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const drag = {
        touchX: touch.clientX,
        touchY: touch.clientY,
        x: this.data.dragX,
        y: this.data.dragY,
        rect: null
      };
      this._drag = drag;
      wx.createSelectorQuery().in(this).select('.feature-guide-panel').boundingClientRect(rect => {
        if (this._drag === drag) drag.rect = rect;
      }).exec();
    },
    dragMove(event) {
      const drag = this._drag;
      const touch = event.touches && event.touches[0];
      if (!drag || !drag.rect || !touch) return;
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const margin = 8;
      const bottomMargin = this.properties.step && this.properties.step.tabPage
        ? windowInfo.windowWidth * 205 / 750 : margin;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const x = clamp(drag.x + touch.clientX - drag.touchX,
        drag.x + margin - drag.rect.left,
        drag.x + windowInfo.windowWidth - margin - drag.rect.right);
      const y = clamp(drag.y + touch.clientY - drag.touchY,
        drag.y + margin - drag.rect.top,
        drag.y + windowInfo.windowHeight - bottomMargin - drag.rect.bottom);
      if (x !== this.data.dragX || y !== this.data.dragY) this.setData({ dragX: x, dragY: y });
    },
    dragEnd() { this._drag = null; },
    next() { guide.next(); },
    previous() { guide.previous(); },
    skip() { guide.finish(); }
  }
});
