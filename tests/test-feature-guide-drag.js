const assert = require('assert');

let definition;
let rect = { left: 63, top: 400, right: 355, bottom: 580 };
global.Component = options => { definition = options; };
global.wx = {
  getWindowInfo: () => ({ windowWidth: 363, windowHeight: 785 }),
  createSelectorQuery: () => ({
    in() { return this; },
    select() { return this; },
    boundingClientRect(callback) { callback(rect); return this; },
    exec() {}
  })
};
require('../components/feature-guide-overlay/index');

const component = {
  data: { dragX: 0, dragY: 0 },
  properties: { step: { tabPage: true } },
  setData(values) { Object.assign(this.data, values); }
};
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });

definition.methods.dragStart.call(component, touch(200, 500));
definition.methods.dragMove.call(component, touch(100, 350));
assert.strictEqual(component.data.dragX, -55, 'left edge remains on screen');
assert.strictEqual(component.data.dragY, -150, 'card can move vertically');
definition.methods.dragMove.call(component, touch(200, 900));
assert.strictEqual(component.data.dragY, 785 - 363 * 205 / 750 - 580, 'tab bar remains uncovered');
definition.methods.dragEnd.call(component);
assert.strictEqual(component._drag, null);
console.log('feature guide card dragging passed');
