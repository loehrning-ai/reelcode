// static.mjs: comment-aware banned-API scan for templates and engine modules (used by lint.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const regexAllowed = (code) => {
  const t = code.trimEnd(), prev = t.slice(-1), word = (t.match(/\b(\w+)$/) || [])[1];
  return !prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || word === 'return' || word === 'typeof';
};

/**
 * Strip comments (keeping newlines so line numbers survive) and collect string literal contents.
 * Regions between `// @lint-allow-begin <name>` and `// @lint-allow-end` are blanked first.
 */
export function scanSource(src) {
  src = src.replace(/\/\/ @lint-allow-begin[^\n]*\n[\s\S]*?\/\/ @lint-allow-end[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  let code = '', i = 0, line = 1;
  const strings = [];
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2), stop = end < 0 ? n : end + 2;
      code += src.slice(i, stop).replace(/[^\n]/g, ' '); line += (src.slice(i, stop).match(/\n/g) || []).length; i = stop; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, body = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { body += src[j] + (src[j + 1] || ''); j += 2; continue; } body += src[j]; j++; }
      strings.push({ s: body, line });
      const lit = src.slice(i, j + 1);
      code += lit; line += (lit.match(/\n/g) || []).length; i = j + 1; continue;
    }
    if (c === '/' && regexAllowed(code)) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      if (src[j] === '/') { code += src.slice(i, j + 1); i = j + 1; continue; }
    }
    if (c === '\n') line++;
    code += c; i++;
  }
  return { code, strings };
}

const ALL = [
  { re: /\b(Math\.random|Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame)\b/g, msg: (m) => `${m} is banned (render must be a pure function of time)` },
  { re: /\bnew Date\b/g, msg: () => 'new Date is banned (non-deterministic)' },
  { re: /\bshadowBlur\s*=(?!=)(?!\s*0\b)/g, msg: () => 'shadowBlur is banned (glow)' },
  { re: /\bshadowColor\s*=(?!=)(?!\s*['"]transparent['"])/g, msg: () => 'shadowColor is banned (glow)' },
  { re: /\bfilter\s*=\s*[^;\n]*(blur|drop-shadow)/g, msg: () => 'blur/drop-shadow filters are banned (glow)' },
];
const SCENE = [
  { re: /\bcreate(Linear|Radial|Conic)Gradient\b/g, msg: () => 'gradients are banned in scene code (gradient backgrounds)' },
  { re: /\b(1080|1920)\b/g, msg: (m) => `raw ${m}: sizes come from F / layout` },
  { re: /#[0-9a-fA-F]{3,8}\b/g, msg: (m) => `raw colour ${m}: colours come from theme` },
  { re: /\bglobalAlpha\s*=(?!=)/g, msg: () => 'globalAlpha in scene code: entrances use motion or masks, not opacity' },
];
const CSS = /(^|[;{\s"'])(transition|animation)\s*:\s*(?!none\b)/;

const lineOf = (code, idx) => code.slice(0, idx).split('\n').length;

/** lintSource(src, {file, scene}) -> [{file, line, msg}] ; scene=true adds template-only rules. */
export function lintSource(src, { file = '<src>', scene = false } = {}) {
  const { code, strings } = scanSource(src);
  const out = [];
  for (const rule of scene ? [...ALL, ...SCENE] : ALL) {
    for (const m of code.matchAll(rule.re)) out.push({ file, line: lineOf(code, m.index), msg: rule.msg(m[0]) });
  }
  for (const s of strings) if (CSS.test(s.s)) out.push({ file, line: s.line, msg: 'CSS transition/animation is banned' });
  return out;
}

/** HTML: CSS transition/animation other than the `none` kill switch. */
export function lintHtml(src, file) {
  const out = [];
  src.split('\n').forEach((l, i) => { if (/(transition|animation)\s*:\s*(?!none\b)/.test(l)) out.push({ file, line: i + 1, msg: 'CSS transition/animation is banned' }); });
  return out;
}

export function lintFiles(files, root) {
  const out = [];
  for (const { path, scene, html } of files) {
    const src = readFileSync(path, 'utf8'), file = relative(root, path);
    out.push(...(html ? lintHtml(src, file) : lintSource(src, { file, scene })));
  }
  return out;
}

/** Every .js module in a template folder (recursively): scene.js and any helper it imports run in the page. */
export function templateModules(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...templateModules(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}
