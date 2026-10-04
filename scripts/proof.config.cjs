// npm run proof 的检查范围。改动页面或商品下架时更新这里。

const CART_SEED = ['/products/demo-cotton-candy-yarn-50g', '/products/demo-pierre-penguin-crochet-kit', '/products/demo-flower-bouquet-blanket-finished'];

module.exports = {
  baseUrl: 'http://127.0.0.1:9292',

  locales: [
    { key: 'ja', prefix: '/ja', lang: 'ja' },
    { key: 'zh', prefix: '', lang: 'zh' },
    { key: 'en', prefix: '/en', lang: 'en' },
  ],

  viewports: [
    { key: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { key: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  ],

  pages: [
    { key: 'home', path: '/' },
    { key: 'yarn-collection', path: '/collections/yarn' },
    { key: 'yarn-pdp', path: '/products/demo-cotton-candy-yarn-50g' },
    { key: 'kit-pdp', path: '/products/demo-pierre-penguin-crochet-kit' },
    { key: 'finished-pdp', path: '/products/demo-flower-bouquet-blanket-finished' },
    // 先加入毛线 / 编织包 / 成品各一件：cart-drawer 在商品页点页头购物车打开抽屉，cart 是整页；cart-empty 是全新会话。
    { key: 'cart-drawer', path: '/products/demo-cotton-candy-yarn-50g', seedProducts: CART_SEED, openCart: true },
    { key: 'cart', path: '/cart', seedProducts: CART_SEED },
    { key: 'cart-empty', path: '/cart' },
    { key: 'search', path: '/search?q=demo' },
    { key: 'commercial-disclosure', path: '/pages/commercial-disclosure' },
    { key: 'returns-exchanges', path: '/pages/returns-exchanges' },
    { key: 'shipping', path: '/pages/shipping' },
    { key: 'faq', path: '/pages/faq' },
    { key: 'about', path: '/pages/about' },
    { key: 'contact', path: '/pages/contact' },
  ],

  // Shopify 内容层：商品、集合、作品、菜单等在后台维护的文字。混语言只报告，不判失败（归 #60 / #68）。
  contentSelectors: [
    '.card__heading', '.card__information', '.card__badge',
    '.yp-card__title', '.yp-card__summary', '.yp-card__price', '.yp-card__price-from',
    '.yx-product-card__title', '.yx-product-card__spec', '.yx-product-card__price', '.yx-product-card__reason',
    '.yx-content-card__title', '.yx-content-card__text',
    '.product__title', '.product__description', '.product__text', '.rte', '.price', '.yp-kitstory',
    '.product-form__input legend', '.product-form__input label', '.product-form__input option',
    '.cart-item__name', '.cart-item__details', '.cart-notification-product', '.yarn-cart-item__name', '.yarn-cart-item__meta',
    '.collection-hero__title', '.collection-hero__description',
    '.header__menu-item', '.menu-drawer__menu-item', '.list-menu__item', '.footer-block__details-content',
    '.predictive-search', '.yx-project-pick__title', '[data-proof-content]',
  ],

  // 有意显示多种语言或品牌名的区域：语言切换器、支付方式图标。
  ignoreSelectors: ['localization-form', '.disclosure__list', '.localization-selector', '.list-payment'],
};
