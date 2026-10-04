const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const section = read('sections/main-cart-items.liquid');
const line = read('snippets/yarn-cart-line.liquid');
const drawer = read('snippets/cart-drawer.liquid');
const layout = read('layout/theme.liquid');
const cartJs = read('assets/cart.js');
const css = read('assets/yarn-cart.css');
const settings = read('config/settings_data.json');

const includesAll = (text, hooks, where) => {
  for (const hook of hooks) assert.ok(text.includes(hook), `${where}: missing ${hook}`);
};

test('add to cart keeps the Rise drawer; the cart page does not stack a second drawer', () => {
  assert.match(settings.slice(0, settings.indexOf('"presets"')), /"cart_type": "drawer"/);
  assert.match(layout, /settings\.cart_type == 'drawer' and template\.name != 'cart' -%\}\s*\{%- render 'cart-drawer' -%\}/);
  // With no drawer on /cart, the page itself must load cart.js.
  assert.match(section, /<script src="\{\{ 'cart\.js' \| asset_url \}\}" defer="defer"><\/script>/);
  assert.doesNotMatch(section, /unless settings\.cart_type == 'drawer'/);
});

test('cart page owns items, summary and heading count that cart.js refreshes', () => {
  includesAll(section, ['id="main-cart-items" data-id="{{ section.id }}"', 'id="main-cart-footer" data-id="{{ section.id }}"', 'id="YarnCartCount"', 'id="cart-errors"', 'id="cart-live-region-text"', 'id="shopping-cart-line-item-status"', 'name="checkout"', "render 'yarn-cart-line', item: item, context: 'page'"], 'page');
  // Both refreshable regions are .js-contents inside one section, so cart.js must scope its selectors.
  assert.match(cartJs, /selector: '#main-cart-items \.js-contents'/);
  assert.match(cartJs, /selector: '#main-cart-footer \.js-contents'/);
  assert.match(cartJs, /new Set\(sectionsToRender\.map/);
});

test('drawer and page share one line item with the id scheme cart.js expects for each', () => {
  includesAll(line, ["'CartItem-'", "'Quantity-'", "'Remove-'", "'Line-item-error-'", "'CartDrawer-Item-'", "'Drawer-quantity-'", "'CartDrawer-Remove-'", "'CartDrawer-LineItemError-'", 'class="cart-item yarn-cart-item', 'name="updates[]"', 'href="{{ item.url_to_remove }}"', '<cart-remove-button', "render 'loading-spinner'"], 'line');
  includesAll(drawer, ['id="CartDrawer"', 'id="CartDrawer-Overlay"', 'class="drawer__inner', '<cart-drawer-items', 'id="CartDrawer-CartItems"', 'id="CartDrawer-LiveRegionText"', 'id="CartDrawer-LineItemStatus"', 'class="cart-drawer__footer"', 'id="CartDrawer-Checkout"', 'form="CartDrawer-Form"', 'href="{{ routes.cart_url }}"', "render 'yarn-cart-line', item: item, context: 'drawer'"], 'drawer');
});

test('long titles are clamped by CSS, never cut in Liquid', () => {
  const title = line.match(/<a href="\{\{ item\.url \}\}" class="yarn-cart-item__name">[\s\S]*?<\/a>/)?.[0] || '';
  assert.match(title, /localized_cart_title \| escape/);
  assert.doesNotMatch(title, /truncate|slice:|truncatewords/);
  assert.match(css, /\.yarn-cart-item__name \{[^}]*-webkit-line-clamp: 3/);
});

test('empty-cart entries render only with a link', () => {
  assert.match(section, /section\.settings\.projects_link != blank/);
  assert.match(section, /section\.settings\.beginner_link != blank/);
  assert.match(section, /section\.settings\.help_link != blank/);
});
