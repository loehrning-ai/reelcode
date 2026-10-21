// new.mjs: scaffold projects/<name> from templates/<t>/template.json (docs/SPEC.md §5.1).
// npx reelcode new --template X --name Y [--title T] [--formats 9x16,1x1,4x5,16x9] [--duration S] [--bpm N]
//      [--style S] [--key "A minor"] [--seed N] [--loop|--no-loop] [--brand @id] [--force]
// npx reelcode new --page --name Y [...same flags]   bespoke page scaffold (project.page = page.html)
// npx reelcode new --list [--all]   (--all also shows the internal _test templates)
// Names: ^_?[a-z0-9][a-z0-9-]{1,40}$ (a leading _ marks an internal project).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, UsageError } from './lib/args.mjs';
import { STUDIO_ROOT } from './lib/server.mjs';
import { resolveProject, PAGE_TEMPLATE } from '../schema.js';
import { loadBrands } from './lib/project.mjs';

const USAGE = 'npx reelcode new --template <t> | --page  --name <name> [--title T] [--formats 9x16,1x1,4x5,16x9] [--duration S] [--bpm N] [--style S] [--key K] [--seed N] [--loop|--no-loop] [--brand @id] [--force] | --list [--all]';
const SPEC = {
  template: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, formats: { type: 'list' },
  duration: { type: 'number' }, bpm: { type: 'number' }, style: { type: 'string' }, key: { type: 'string' },
  seed: { type: 'number' }, loop: { type: 'boolean' }, force: { type: 'boolean', default: false }, list: { type: 'boolean', default: false }, all: { type: 'boolean', default: false },
  brand: { type: 'string' }, page: { type: 'boolean', default: false },
};
const NAME = /^_?[a-z0-9][a-z0-9-]{1,40}$/;
const PAGE_SCAFFOLD = join(STUDIO_ROOT, 'engine', 'scaffold', 'page.html');
/** The bespoke-page project skeleton (new --page). */
const PAGE_EXAMPLE = { title: 'Bespoke film', formats: ['9x16', '1x1', '4x5', '16x9'], duration: 8, bpm: 120, loop: false, brand: '@studio',
  audio: { music: 'synth', style: 'minimal-tech', key: 'A minor', sfx: true } };
const TEMPLATES = join(STUDIO_ROOT, 'templates');

function readTemplate(id) {
  const f = join(TEMPLATES, id, 'template.json');
  if (!/^_?[a-z0-9][a-z0-9-]*$/.test(id) || !existsSync(f)) {
    const have = listTemplates().filter((t) => !t.id.startsWith('_')).map((t) => t.id).join(', ') || 'none';
    throw new UsageError(`unknown template "${id}" (available: ${have})`);
  }
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`templates/${id}/template.json: invalid JSON (${e.message})`); }
}

function listTemplates() {
  return readdirSync(TEMPLATES, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(TEMPLATES, d.name, 'template.json')))
    .map((d) => { try { return JSON.parse(readFileSync(join(TEMPLATES, d.name, 'template.json'), 'utf8')); } catch { return { id: d.name, description: '(invalid template.json)' }; } })
    .sort((x, y) => (x.id.startsWith('_') - y.id.startsWith('_')) || x.id.localeCompare(y.id));
}

/** {template, ...example} (or {page, ...}) with the CLI flags applied; flags win over the example. */
function scaffold(t, a) {
  const ex = JSON.parse(JSON.stringify(t.page ? PAGE_EXAMPLE : t.example || {}));
  const p = t.page ? { $schema: '../../docs/project.schema.json', page: 'page.html', ...ex } : { $schema: '../../docs/project.schema.json', template: t.id, ...ex };
  if (a.brand !== undefined) p.brand = a.brand;
  if (a.title !== undefined) p.title = a.title;
  if (a.formats) p.formats = a.formats;
  if (a.duration !== undefined) p.duration = a.duration;
  if (a.bpm !== undefined) p.bpm = a.bpm;
  if (a.seed !== undefined) p.seed = a.seed;
  if (a.loop !== undefined) p.loop = a.loop;
  if (a.style !== undefined || a.key !== undefined) {
    p.audio = { ...(p.audio || {}) };
    if (a.style !== undefined) p.audio.style = a.style;
    if (a.key !== undefined) p.audio.key = a.key;
  }
  if (!p.title) p.title = a.name;
  return withPrepare(p, t);
}

const FIXTURE_MEDIA = ['ridge.jpg', 'harbor.jpg', 'canopy.jpg', 'ridge.webm'];

/**
 * Give a fresh scaffold the generator steps it needs to build out of the box: the shared procedural photos when the
 * example uses them (copied into the project's assets/), and a capture of the demo app when the template needs
 * screens or a logo. Replace fixture:mock-product with your own http://localhost:PORT/ app.
 */
function withPrepare(p, t) {
  const steps = [];
  let text = JSON.stringify(p);
  if (text.includes('../../fixtures/media/')) {
    text = text.replaceAll('../../fixtures/media/', 'assets/');
    steps.push({ run: 'fixtures/media/make_media.py', args: ['--out', '{project}/assets'], creates: FIXTURE_MEDIA.map((f) => `assets/${f}`) });
  }
  const out = JSON.parse(text);
  const req = t.requires || [];
  if (req.includes('screens') || req.includes('logo')) {
    steps.push({ capture: 'fixture:mock-product', args: ['--apply-brand'], creates: ['assets/assets.json', 'assets/logo.png'] });
  }
  if (steps.length) out.prepare = [...steps, ...(out.prepare || [])];
  return out;
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [0, 0] });
  if (a.list) {
    const all = listTemplates(), shown = a.all ? all : all.filter((t) => !t.id.startsWith('_'));
    for (const t of shown) {
      const d = t.defaults || {};
      console.log(`${t.id.padEnd(18)} ${String(d.duration ?? '-').padStart(3)}s ${String(d.bpm ?? '-').padStart(3)}bpm ${((d.formats || []).join(',') || '-').padEnd(15)} ${(t.requires || []).length ? `[needs ${t.requires.join('+')}] ` : ''}${t.description || ''}`);
    }
    const hidden = all.length - shown.length;
    if (hidden) console.log(`(${hidden} internal test template${hidden > 1 ? 's' : ''} hidden; --all shows them)`);
    return 0;
  }
  if (!a.template && !a.page) throw new UsageError('--template is required (see --list), or --page for a bespoke page');
  if (a.template && a.page) throw new UsageError('use --template or --page, not both');
  if (!a.name) throw new UsageError('--name is required');
  if (!NAME.test(a.name)) throw new UsageError(`--name "${a.name}" must match ${NAME} (lowercase letters, digits and -, 2-41 chars; a leading _ for internal projects)`);
  if (a.brand !== undefined && !/^@[a-z0-9][a-z0-9-]{0,40}$/.test(a.brand)) throw new UsageError(`--brand must be a preset ref like @studio (got ${a.brand})`);
  const t = a.page ? PAGE_TEMPLATE : readTemplate(a.template);
  if (!t.page && (!t.example || typeof t.example !== 'object')) throw new Error(`templates/${a.template}/template.json has no example to start from`);
  const dir = join(STUDIO_ROOT, 'projects', a.name), file = join(dir, 'project.json');
  if (existsSync(file) && !a.force) throw new Error(`projects/${a.name}/project.json already exists (use --force to overwrite it; assets/ and audio/ are kept)`);
  const project = scaffold(t, a);
  const { brands, errors: brandErrors } = loadBrands(project, t);
  const { errors } = resolveProject(project, t, undefined, { brands });
  errors.unshift(...brandErrors);
  for (const fmt of (project.formats || t.defaults?.formats || [])) for (const e of resolveProject(project, t, fmt, { brands }).errors) if (!errors.includes(e)) errors.push(e);
  if (errors.length) throw new Error(`the scaffolded project would be invalid:\n  - ${errors.join('\n  - ')}`);
  for (const sub of ['assets', 'audio', 'out']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
  if (t.page) {
    const pf = join(dir, 'page.html');
    if (!existsSync(pf) || a.force) copyFileSync(PAGE_SCAFFOLD, pf);
    console.log(`wrote projects/${a.name}/project.json + page.html (bespoke page: window.seek(t), canvas #c; see docs/SPEC.md §8)`);
  } else console.log(`wrote projects/${a.name}/project.json (template ${t.id}${t.description ? `: ${t.description}` : ''})`);
  const next = [];
  if ((project.prepare || []).some((x) => x.capture)) next.push(`# the UI comes from the demo app (prepare: capture fixture:mock-product); point it at your own http://localhost:PORT/`);
  next.push(`npx reelcode make ${a.name}            # draft: every format, sound, critique sheets in projects/${a.name}/out/`,
    `npx reelcode preview ${a.name}         # scrub it in a browser`);
  console.log(`next:\n  ${next.join('\n  ')}`);
  return 0;
});
