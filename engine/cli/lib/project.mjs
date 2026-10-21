// project.mjs: load + resolve + validate a project in Node (the same rules the page applies).
// v2: brand presets (brands/<id>.json), renditions (variant x cutdown) and bespoke pages (project.page).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, join, relative, sep } from 'node:path';
import { resolveProject, brandIds, renditions, PAGE_TEMPLATE } from '../../schema.js';
import { STUDIO_ROOT } from './server.mjs';

const NAME = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
export const BRANDS_DIR = join(STUDIO_ROOT, 'brands');
const readJSON = (p, what) => {
  if (!existsSync(p)) throw new Error(`${what} not found: ${relative(STUDIO_ROOT, p) || p}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Error(`${relative(STUDIO_ROOT, p)}: invalid JSON (${e.message})`); }
};

/** Load every brand preset a project references (transitively). Returns {brands, files, errors}. */
export function loadBrands(project, template) {
  const brands = {}, files = [], errors = [];
  for (let ids = brandIds(project, template, brands); ids.length; ids = brandIds(project, template, brands)) {
    for (const id of ids) {
      const f = join(BRANDS_DIR, `${id}.json`);
      try { brands[id] = readJSON(f, `brand preset "@${id}"`); files.push(f); if (existsSync(join(BRANDS_DIR, id))) files.push(join(BRANDS_DIR, id)); }
      catch (e) { brands[id] = null; errors.push(`project.brand: ${e.message}`); }
    }
  }
  return { brands, files, errors };
}

/** A project argument -> its folder: a bare name means projects/<name>; paths resolve against the repository root. */
export function projectDir(arg) {
  const bare = /^[a-z0-9_][a-z0-9_-]{0,63}$/.test(arg) && !existsSync(resolve(STUDIO_ROOT, arg, 'project.json'));
  return resolve(STUDIO_ROOT, bare ? join('projects', arg) : arg);
}

/**
 * loadProject('projects/<name>', {variant='main', cutdown='full'}?) -> P
 * P = {dir, name, project, template, templateDir, base, errors, formats, resolved(fmt), outDir(fmt?), rel(p),
 *      variant, cutdown, cut, fullDuration, legacy, audioDir, page, pageOpts, brandFiles, renditions}
 * Everything is for the selected rendition: base has the variant and cutdown applied, outDir/audioDir are the
 * rendition's folders (v1 paths for projects without variants/cutdowns). Throws only when files cannot be read;
 * validation problems are returned in errors.
 */
export function loadProject(arg, { variant = 'main', cutdown = 'full' } = {}) {
  if (!arg) throw new Error('missing project (a name, or projects/<name>)');
  const dir = projectDir(arg);
  if (!dir.startsWith(join(STUDIO_ROOT, 'projects') + sep)) throw new Error(`project must live under projects/ (got ${arg})`);
  const name = basename(dir);
  if (!NAME.test(name)) throw new Error(`bad project name "${name}" (lowercase letters, digits, - and _)`);
  const project = readJSON(join(dir, 'project.json'), 'project.json');
  const page = typeof project.page === 'string' ? project.page : null;
  let template, tdir = null;
  if (page) {
    template = PAGE_TEMPLATE;
    const pf = resolve(dir, page);
    if (!pf.startsWith(dir + sep)) throw new Error(`${name}/project.json: page "${page}" must be inside the project folder`);
    if (!existsSync(pf)) throw new Error(`${name}/project.json: page ${page} not found`);
  } else {
    if (typeof project.template !== 'string' || !NAME.test(project.template)) throw new Error(`${name}/project.json: template is required (or page for a bespoke page)`);
    tdir = join(STUDIO_ROOT, 'templates', project.template);
    template = readJSON(join(tdir, 'template.json'), `template "${project.template}"`);
    if (!existsSync(join(tdir, 'scene.js'))) throw new Error(`template "${project.template}" has no scene.js`);
  }
  const { brands, files: brandFiles, errors: brandErrors } = loadBrands(project, template);
  const opts = { variant, cutdown, brands };
  const r0 = resolveProject(project, template, undefined, opts);
  const { base, cutdown: cut, fullDuration, dirs } = r0;
  const errors = [...brandErrors];
  for (const e of r0.errors) if (!errors.includes(e)) errors.push(e);
  const formats = Array.isArray(base.formats) ? base.formats : [];
  const perFormat = {};
  for (const fmt of formats) {
    const r = resolveProject(project, template, fmt, opts);
    perFormat[fmt] = r.resolved;
    for (const e of r.errors) if (!errors.includes(e)) errors.push(e);
  }
  const outRoot = join(dir, dirs.out);
  return {
    dir, name, project, template, templateDir: tdir, base, errors, formats,
    variant: dirs.variant, cutdown: dirs.cutdown, cut, fullDuration, legacy: dirs.legacy,
    audioDir: join(dir, dirs.audio), page, brandFiles,
    /** openPage() options for this project/rendition: the bespoke page path and the rendition query. */
    pageOpts: { page: page ? `/projects/${name}/${page}` : undefined, variant: dirs.variant, cutdown: dirs.cutdown },
    renditions: renditions(project),
    resolved: (fmt) => perFormat[fmt] || resolveProject(project, template, fmt, opts).resolved,
    outDir: (fmt) => (fmt ? join(outRoot, fmt) : outRoot),
    rel: (p) => relative(STUDIO_ROOT, p),
  };
}

/** Expand a --format/--formats value against the project's list ('all' = project.formats). */
export function pickFormats(P, want) {
  const list = !want || (Array.isArray(want) ? want : [want]).includes('all') ? P.formats : [].concat(want);
  for (const f of list) if (!P.formats.includes(f)) throw new Error(`format ${f} is not in project.formats (${P.formats.join(', ')})`);
  if (!list.length) throw new Error('no formats to process');
  return list;
}

/**
 * pickRenditions(P, {variant, cutdown}) -> [{variant, cutdown}]
 * variant: undefined -> 'main'; 'all' -> main + every variant; else that id (checked). Same for cutdown with 'full'.
 */
export function pickRenditions(P, { variant, cutdown } = {}) {
  const vs = [...new Set(P.renditions.map((r) => r.variant))], cs = [...new Set(P.renditions.map((r) => r.cutdown))];
  const pick = (want, all, dflt, what) => {
    const ws = !want ? [dflt] : [].concat(want);
    if (ws.includes('all')) return all;
    for (const w of ws) if (!all.includes(w)) throw new Error(`${what} "${w}" is not in project.${what}s (${all.join(', ')})`);
    return ws;
  };
  const V = pick(variant, vs, 'main', 'variant'), C = pick(cutdown, cs, 'full', 'cutdown');
  return V.flatMap((v) => C.map((c) => ({ variant: v, cutdown: c })));
}
