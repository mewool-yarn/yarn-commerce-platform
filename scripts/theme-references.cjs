// 找出主题里没有任何在用文件引用的 section / snippet / asset。
// 从 layout、templates、section group 出发，沿 Liquid 的 section / render / 资源文件名、
// JSON 的 "type"、JS 里按名字取的 section（section_id=…）逐层找到所有在用文件。
// 被 tests/theme-references.test.cjs 使用；直接运行会打印未被引用的文件。

const fs = require('node:fs');
const path = require('node:path');

// 暂不被引用但有意保留的文件，写明原因。
const KEEP = {
  'sections/yarn-content-pick.liquid': '内容精选，首页方案 C 暂不使用（#93），保留待内容入口决策',
  'sections/yarn-hero.liquid': '保留旧 hero section，兼容商家已保存的模板配置；默认首页改用 hitoami-home（#110）',
  'assets/mewoolmew-logo-reference.png': '历史 Logo 原始稿，docs/brand/logo-reference.md 仍引用；新页眉使用用户提供的 hitoami 字标（#110）',
  'sections/yarn-project-library.liquid': '作品库，用户 2026-09-23 决定保留（#65）',
  'sections/yarn-project-discovery.liquid': '作品发现，用户 2026-09-23 决定保留（#65）',
  'sections/yarn-starter-project.liquid': '新手作品，用户 2026-09-23 决定保留（#65）',
  'sections/yarn-cart-assurance.liquid': '购物车保障条，购物车整页改版后不在模板中，用户 2026-10-03 决定保留可加回（#124）',
};

const list = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : [])
  .filter(name => fs.statSync(path.join(dir, name)).isFile())
  .map(name => path.join(dir, name).split(path.sep).join('/'));

function scan(root = '.') {
  const at = rel => path.join(root, rel);
  const read = rel => fs.readFileSync(at(rel), 'utf8');
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const sections = list(at('sections')).map(rel);
  const snippets = list(at('snippets')).map(rel);
  const blocks = list(at('blocks')).map(rel);
  // .shopifyignore 排除的不上传到主题（如 assets/plates/ 是生成图的来源记录），不参与检查。
  const ignored = fs.existsSync(at('.shopifyignore'))
    ? read('.shopifyignore').split('\n').map(line => line.trim()).filter(line => line.endsWith('/**')).map(line => line.slice(0, -2))
    : [];
  const assets = list(at('assets')).map(rel).filter(file => !ignored.some(prefix => file.startsWith(prefix)));
  const textAssets = assets.filter(file => /\.(css|js|liquid|svg|json)$/.test(file));
  const byName = files => new Map(files.map(file => [path.basename(file).replace(/\.(liquid|json)$/, ''), file]));
  const sectionByName = byName(sections.filter(file => file.endsWith('.liquid')));
  const groupByName = byName(sections.filter(file => file.endsWith('.json')));
  const snippetByName = byName(snippets);
  const blockByName = byName(blocks);

  const live = new Set([
    ...list(at('layout')).map(rel),
    ...list(at('templates')).map(rel),
    ...groupByName.values(),
    ...Object.keys(KEEP).filter(file => fs.existsSync(at(file))),
  ]);
  const done = new Set();
  const mark = file => file && live.add(file);
  const mentions = (text, name) => new RegExp(`(^|[^\\w.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text);

  for (let changed = true; changed;) {
    changed = false;
    for (const file of [...live]) {
      if (done.has(file)) continue;
      done.add(file);
      changed = true;
      const text = read(file);
      if (file.endsWith('.json')) {
        for (const [, type] of text.matchAll(/"type"\s*:\s*"([\w-]+)"/g)) {
          mark(sectionByName.get(type));
          mark(blockByName.get(type));
        }
      }
      if (file.endsWith('.liquid')) {
        for (const [, name] of text.matchAll(/\bsection\s+['"]([\w-]+)['"]/g)) mark(sectionByName.get(name));
        for (const [, name] of text.matchAll(/\bsections\s+['"]([\w-]+)['"]/g)) mark(groupByName.get(name));
        for (const [, name] of text.matchAll(/\b(?:render|include)\s+['"]([\w-]+)['"]/g)) mark(snippetByName.get(name));
        for (const [, name] of text.matchAll(/"type"\s*:\s*"([\w-]+)"/g)) mark(blockByName.get(name));
      }
      if (file.endsWith('.js')) {
        // Section Rendering API：JS 按名字取 section（如 section_id=cart-drawer、section: 'cart-drawer'）。
        for (const [name, section] of sectionByName) if (mentions(text, name) && new RegExp(`['"=]${name}['"&\`,]`).test(text)) mark(section);
      }
      for (const asset of assets) if (!live.has(asset) && mentions(text, path.basename(asset))) mark(asset);
    }
    // icon-accordion 按 section 设置里的图标选项拼出文件名（icon-<选项>.svg）。
    if (live.has('snippets/icon-accordion.liquid')) {
      for (const file of [...live].filter(f => f.startsWith('sections/') || f.startsWith('blocks/'))) {
        for (const [, value] of read(file).matchAll(/"value"\s*:\s*"([\w-]+)"/g)) {
          const icon = `assets/icon-${value.replace(/_/g, '-')}.svg`;
          if (assets.includes(icon) && !live.has(icon)) { live.add(icon); changed = true; }
        }
      }
    }
  }

  // 图片旁的来源记录（x.png.source.json、x.webp.json、x.json）跟随图片是否在用。
  for (const asset of assets.filter(file => file.endsWith('.json'))) {
    const base = asset.replace(/(\.source|\.provenance)?\.json$/, '');
    const images = /\.(png|webp|jpe?g|svg)$/.test(base) ? [base] : [`${base}.png`, `${base}.webp`];
    if (images.some(image => live.has(image))) live.add(asset);
  }

  const unreferenced = [...sections, ...snippets, ...blocks, ...assets].filter(file => !live.has(file)).sort();
  return { unreferenced, keep: KEEP, textAssets };
}

module.exports = { scan, KEEP };

if (require.main === module) {
  const { unreferenced } = scan();
  console.log(unreferenced.join('\n') || '没有未被引用的文件');
}
