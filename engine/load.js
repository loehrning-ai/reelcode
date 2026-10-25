// load.js: page-side project loading shared by runtime.js (engine page) and bespoke.js (bespoke pages).
// Fetches project.json, the brand presets it references (/brands/<id>.json) and resolves one rendition.
import { resolveProject, brandIds } from './schema.js';

export async function fetchJSON(url, optional = false) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) { if (optional) return null; throw new Error(`fetch ${url}: HTTP ${r.status}`); }
  try { return await r.json(); } catch (e) { throw new Error(`${url}: invalid JSON (${e.message})`); }
}

/** Every brand preset the project references (transitively), as {id: preset}. A missing preset is left out (resolveProject reports it). */
export async function fetchBrands(project, template) {
  const brands = {};
  for (let ids = brandIds(project, template, brands); ids.length; ids = brandIds(project, template, brands))
    for (const id of ids) brands[id] = (await fetchJSON(`/brands/${id}.json`, true)) || null;
  return brands;
}

/** Query of a reelcode page: {name, format, mode, variant, cutdown, alpha, w, h}. */
export function readQuery(search) {
  const q = new URLSearchParams(search);
  return { name: q.get('project') || '', format: q.get('format') || '9x16', mode: q.get('mode') || 'preview',
    variant: q.get('variant') || 'main', cutdown: q.get('cutdown') || 'full', alpha: q.get('alpha') === '1',
    w: q.get('w') ? Number(q.get('w')) : null, h: q.get('h') ? Number(q.get('h')) : null };
}

/** resolveProject() for the page, with brand presets fetched. Throws on any validation error. */
export async function resolveForPage(project, template, format, { variant, cutdown }) {
  const brands = await fetchBrands(project, template);
  const r = resolveProject(project, template, format, { variant, cutdown, brands });
  if (r.errors.length) throw new Error(r.errors.join('\n'));
  return r;
}

/**
 * Load project.fonts (font files inside the project) into document.fonts before the first frame, so brand.fonts can
 * name them like a bundled family. A file that does not load is an error: a film in the wrong typeface is a wrong film.
 */
export async function loadProjectFonts(name, fonts) {
  if (!Array.isArray(fonts)) return [];
  return Promise.all(fonts.map(async (f, i) => {
    const url = `/projects/${name}/${f.file.split('/').map(encodeURIComponent).join('/')}`;
    const face = new FontFace(f.family, `url("${url}")`, { weight: String(f.weight ?? 400), style: f.style || 'normal', display: 'block' });
    try { await face.load(); } catch (e) { throw new Error(`project.fonts[${i}]: ${f.file} did not load as "${f.family}" (${e && e.message ? e.message : e})`); }
    document.fonts.add(face);
    return face;
  }));
}
