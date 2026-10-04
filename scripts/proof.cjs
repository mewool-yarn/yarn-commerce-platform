#!/usr/bin/env node
// npm run proof：对本地预览（shopify theme dev）生成证据包，写到被忽略的 .proof/。
// 语言泄漏 + 首屏截图清单 + 横向溢出 / 图片 / 脚本错误断言。PR 只引用 .proof/report.md 的结论。
//
// 用法：npm run proof -- [--base <url>] [--pages home,kit-pdp] [--locales zh,en] [--viewports mobile]

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const config = require('./proof.config.cjs');
const { detectLeak } = require('./proof-lang.cjs');

const OUT = '.proof';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = argv[i].match(/^--(base|pages|locales|viewports|concurrency)$/);
    if (!match || argv[i + 1] === undefined) throw new Error(`未知参数：${argv[i]}`);
    args[match[1]] = argv[++i];
  }
  return args;
}

function pick(list, csv, label) {
  if (!csv) return list;
  const keys = csv.split(',');
  const unknown = keys.filter(key => !list.some(item => item.key === key));
  if (unknown.length) throw new Error(`未知${label}：${unknown.join(', ')}（可选：${list.map(item => item.key).join(', ')}）`);
  return list.filter(item => keys.includes(item.key));
}

// 在页面里运行：收集文字、溢出、图片与占位图。只收集，不判断语言。
async function inspectPage({ contentSelectors, ignoreSelectors }) {
  const content = contentSelectors.join(',');
  const ignore = ['script', 'style', 'noscript', 'template', ...ignoreSelectors].join(',');
  const pageLang = document.documentElement.lang.toLowerCase().slice(0, 2);
  const describe = element => {
    const parts = [];
    for (let node = element; node && node !== document.body && parts.length < 3; node = node.parentElement) {
      const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      parts.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '') + classes.map(c => `.${c}`).join(''));
    }
    return parts.join(' > ');
  };
  const skip = element => {
    if (!element || element.closest(ignore)) return true;
    const tagged = element.closest('[lang]');
    return tagged && tagged !== document.documentElement && tagged.lang.toLowerCase().slice(0, 2) !== pageLang;
  };

  const texts = new Map();
  const add = (text, element) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || skip(element)) return;
    const where = describe(element);
    texts.set(`${clean}\u0000${where}`, { text: clean, where, content: Boolean(element.closest(content)) });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) add(node.nodeValue, node.parentElement);
  for (const element of document.body.querySelectorAll('[aria-label],[placeholder]')) {
    add(element.getAttribute('aria-label') || '', element);
    add(element.getAttribute('placeholder') || '', element);
  }

  // 触发懒加载后再检查图片。
  const step = Math.max(300, window.innerHeight - 100);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  window.scrollTo(0, 0);
  const shown = element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const images = () => [...document.images].filter(img => img.currentSrc && shown(img));
  for (let waited = 0; waited < 8000 && images().some(img => !img.complete); waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const viewportWidth = document.documentElement.clientWidth;
  const overflowBy = document.documentElement.scrollWidth - viewportWidth;
  const offenders = [];
  if (overflowBy > 1) {
    // 被祖先裁切的、固定定位的（抽屉、弹层）不会撑出页面横向滚动，不算。
    const clips = element => {
      if (getComputedStyle(element).position === 'fixed') return true;
      for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed' || /(hidden|clip|auto|scroll)/.test(style.overflowX)) return true;
      }
      return false;
    };
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > viewportWidth + 1 && !clips(element)) offenders.push(`${describe(element)}（右缘 ${Math.round(box.right)}px）`);
      if (offenders.length >= 5) break;
    }
  }

  return {
    htmlLang: document.documentElement.lang,
    texts: [...texts.values()],
    overflowBy: overflowBy > 1 ? overflowBy : 0,
    offenders,
    brokenImages: images().filter(img => img.complete && img.naturalWidth === 0).map(img => img.currentSrc).slice(0, 5),
    pendingImages: images().filter(img => !img.complete).length,
    placeholders: [...document.querySelectorAll('svg.placeholder-svg')].filter(shown).length,
  };
}

// 购物车页需要先有商品：用同一会话的 Cookie 加购，只加可售的 Variant。
async function seedCart(context, baseUrl, products) {
  const items = [];
  for (const product of products) {
    const data = await (await context.request.get(`${baseUrl}${product}.js`)).json();
    const variant = data.variants.find(v => v.available);
    if (variant) items.push({ id: variant.id, quantity: 1 });
  }
  if (!items.length) throw new Error('预置商品都不可售，无法检查购物车');
  const response = await context.request.post(`${baseUrl}/cart/add.js`, { data: { items } });
  if (!response.ok()) throw new Error(`预置加购失败 ${response.status()}`);
}

// 打开抽屉并返回商品列表的横向溢出（列表是滚动容器，溢出会出现左右滚动）。
async function openCartDrawer(page) {
  await page.click('#cart-icon-bubble');
  await page.waitForSelector('cart-drawer.active', { timeout: 8000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const list = document.querySelector('cart-drawer-items');
    return list ? list.scrollWidth - list.clientWidth : 0;
  });
}

async function runJob(browser, job, baseUrl) {
  const { page: target, locale, viewport } = job;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
  });
  const page = await context.newPage();
  const url = `${baseUrl}${locale.prefix}${target.path === '/' && locale.prefix ? '' : target.path}`;
  const result = { page: target.key, locale: locale.key, viewport: viewport.key, url, failures: [], warnings: [], leaks: [], contentLeaks: [] };
  const origin = new URL(baseUrl).host;

  page.on('pageerror', error => result.failures.push(`脚本异常：${error.message.split('\n')[0]}`));
  // 本地预览固有的平台报错（shop.app 嵌入、Shopify 云端脚本跨域）不算；同源请求失败由下方 response 记录。
  const platformNoise = /Failed to load resource|shop\.app|shopifycloud|shopifysvc|origin_trials/;
  page.on('console', message => {
    if (message.type() === 'error' && !platformNoise.test(message.text())) result.warnings.push(`控制台错误：${message.text().slice(0, 160)}`);
  });
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).host === origin) {
      result.warnings.push(`请求失败 ${response.status()}：${new URL(response.url()).pathname}`);
    }
  });

  try {
    if (target.seedProducts) await seedCart(context, baseUrl, target.seedProducts);
    const response = await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    if (!response || response.status() !== 200) result.failures.push(`页面状态 ${response ? response.status() : '无响应'}`);
    if ((await page.content()).includes('Liquid error')) result.failures.push('页面含 Liquid error');
    await page.evaluate(() => document.fonts.ready);

    const found = await page.evaluate(inspectPage, { contentSelectors: config.contentSelectors, ignoreSelectors: config.ignoreSelectors });
    if (!found.htmlLang.toLowerCase().startsWith(locale.lang)) result.failures.push(`页面语言是 ${found.htmlLang}，应为 ${locale.lang}`);
    // 主题文案里嵌着的商品名等内容（如「Save 〈商品名〉 to favorites」）先去掉，只判断主题自己的字。
    const contentTexts = [...new Set(found.texts.filter(t => t.content && t.text.length >= 4).map(t => t.text))].sort((a, b) => b.length - a.length);
    for (const { text, where, content } of found.texts) {
      const own = content ? text : contentTexts.reduce((rest, piece) => rest.split(piece).join(' '), text);
      const leaked = detectLeak(own, locale.lang);
      if (leaked) (content ? result.contentLeaks : result.leaks).push({ text: text.slice(0, 80), leaked, where });
    }
    if (found.overflowBy) result.failures.push(`横向溢出 ${found.overflowBy}px：${found.offenders.join('；') || '未定位到元素'}`);
    if (found.brokenImages.length) result.failures.push(`图片加载失败：${found.brokenImages.join('、')}`);
    if (found.pendingImages) result.warnings.push(`${found.pendingImages} 张图片 8 秒内未加载完`);
    if (found.placeholders) result.warnings.push(`${found.placeholders} 个占位图（未设置图片）`);

    await page.evaluate(() => window.scrollTo(0, 0));
    if (target.openCart) {
      const drawerOverflow = await openCartDrawer(page);
      if (drawerOverflow > 0) result.failures.push(`购物车抽屉横向溢出 ${drawerOverflow}px`);
    }
    await page.waitForTimeout(300);
    result.shot = path.join('shots', viewport.key, `${locale.key}-${target.key}.png`);
    await page.screenshot({ path: path.join(OUT, result.shot) });
  } catch (error) {
    result.failures.push(`检查中断：${error.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}

function writeReport(results, meta) {
  const failed = results.filter(r => r.failures.length || r.leaks.length);
  const count = key => results.reduce((sum, r) => sum + r[key].length, 0);
  const lines = [
    `# 证据包`,
    '',
    `- 时间：${meta.time}`,
    `- 代码：${meta.git}`,
    `- 预览：${meta.baseUrl}`,
    `- 结论：**${failed.length ? '未通过' : '通过'}**（主题侧语言泄漏 ${count('leaks')}，失败项 ${count('failures')}；内容层混语言 ${count('contentLeaks')}、提醒 ${count('warnings')} 不阻塞）`,
    '',
    '## 截图清单',
    '',
    `| 页面 | 语言 | ${meta.viewports.map(v => `${v.key} ${v.width}`).join(' | ')} |`,
    `|---|---|${meta.viewports.map(() => '---').join('|')}|`,
  ];
  for (const page of meta.pages) {
    for (const locale of meta.locales) {
      const cells = meta.viewports.map(viewport => {
        const r = results.find(x => x.page === page.key && x.locale === locale.key && x.viewport === viewport.key);
        return r && r.shot ? `${r.failures.length || r.leaks.length ? '✗' : '✓'} ${r.shot}` : '✗ 无截图';
      });
      lines.push(`| ${page.key} | ${locale.key} | ${cells.join(' | ')} |`);
    }
  }
  const section = (title, key, format) => {
    const rows = results.flatMap(r => r[key].map(item => `- [${r.locale} · ${r.viewport}] ${r.page}：${format(item)}`));
    if (rows.length) lines.push('', `## ${title}`, '', ...[...new Set(rows)]);
  };
  section('主题侧语言泄漏（阻塞）', 'leaks', item => `「${item.text}」混入 ${item.leaked} — \`${item.where}\``);
  section('失败项（阻塞）', 'failures', item => item);
  section('内容层混语言（Shopify 后台内容，归 #60 / #68，不阻塞）', 'contentLeaks', item => `「${item.text}」混入 ${item.leaked}`);
  section('提醒（不阻塞）', 'warnings', item => item);
  fs.writeFileSync(path.join(OUT, 'report.md'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify({ meta, results }, null, 2)}\n`);
  return { failed: failed.length, leaks: count('leaks'), failures: count('failures'), contentLeaks: count('contentLeaks'), warnings: count('warnings') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args.base || process.env.PROOF_BASE_URL || config.baseUrl).replace(/\/$/, '');
  const pages = pick(config.pages, args.pages, '页面');
  const locales = pick(config.locales, args.locales, '语言');
  const viewports = pick(config.viewports, args.viewports, '视口');

  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(20000) });
  } catch {
    console.error(`无法打开 ${baseUrl}。先在另一个终端运行：npx shopify theme dev --store tutaka-54.myshopify.com --live-reload off`);
    process.exit(2);
  }

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: process.env.PROOF_BROWSER_CHANNEL || 'chrome' });
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const viewport of viewports) fs.mkdirSync(path.join(OUT, 'shots', viewport.key), { recursive: true });

  const jobs = pages.flatMap(page => locales.flatMap(locale => viewports.map(viewport => ({ page, locale, viewport }))));
  const results = [];
  const started = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      let result = await runJob(browser, job, baseUrl);
      // 本地预览偶发的网络请求失败（多为 Shopify 遥测）重跑一次；再失败就如实报告。
      if (result.failures.length && result.failures.every(f => f.startsWith('脚本异常：Failed to fetch'))) result = await runJob(browser, job, baseUrl);
      results.push(result);
    }
  };
  await Promise.all(Array.from({ length: Number(args.concurrency || 4) }, worker));
  await browser.close();

  const git = execSync('git log -1 --format="%h %s" && git status --porcelain | wc -l', { encoding: 'utf8' }).trim().split('\n');
  const meta = {
    time: new Date().toISOString(),
    git: `${git[0]}${Number(git[1]) ? `（另有 ${git[1].trim()} 个未提交改动）` : ''}`,
    baseUrl,
    pages, locales, viewports,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  const summary = writeReport(results, meta);
  console.log(`证据包：${OUT}/report.md（${jobs.length} 组截图，${meta.seconds} 秒）`);
  console.log(`主题侧语言泄漏 ${summary.leaks}，失败项 ${summary.failures}，内容层混语言 ${summary.contentLeaks}，提醒 ${summary.warnings}`);
  process.exit(summary.failed ? 1 : 0);
}

main().catch(error => {
  console.error(error.message);
  process.exit(2);
});
