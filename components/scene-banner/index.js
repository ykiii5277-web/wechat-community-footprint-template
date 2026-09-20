// 营地场景组件：每个 scene 名称映射一张水彩背景图，图片加载失败时显示 CSS 备用场景。
const images = {
  rural: '/assets/images/rural-hero-v2.jpg',
  school: '/assets/images/summer-hero-v2.jpg',
  changsha: '/assets/images/changsha-hero-v2.jpg',
  shanghai: '/assets/images/shanghai-hero-v2.jpg',
  winter: '/assets/images/other-footprints-watercolor-v1.jpg',
  spark: '/assets/images/other-footprints-watercolor-v1.jpg',
  other: '/assets/images/other-footprints-watercolor-v1.jpg'
};

Component({
  properties: {
    scene: { type: String, value: 'rural', observer() { this.setSceneImage(); } },
    compact: { type: Boolean, value: false }
  },
  data: { imageSrc: '', imageFailed: false },
  lifetimes: { attached() { this.setSceneImage(); } },
  methods: {
    setSceneImage() { this.setData({ imageSrc: images[this.properties.scene] || images.rural, imageFailed: false }); },
    showFallback() { this.setData({ imageFailed: true }); }
  }
});
