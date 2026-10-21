// args.mjs: tiny flag parser. spec = {flag: {type:'string'|'number'|'boolean'|'list', default}}; positionals in out._
export class UsageError extends Error {}
/** Thrown for --help / -h anywhere in argv: runCli prints the usage to stdout and exits 0. */
export class HelpRequest extends Error {}

export function parseArgs(argv, spec, { positionals = [0, 1] } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) throw new HelpRequest('help');
  const out = { _: [] };
  for (const [k, s] of Object.entries(spec)) if (s.default !== undefined) out[k] = s.default;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let [key, inline] = a.slice(2).split(/=(.*)/s);
    let neg = false;
    if (!spec[key] && key.startsWith('no-') && spec[key.slice(3)] && spec[key.slice(3)].type === 'boolean') { key = key.slice(3); neg = true; }
    const s = spec[key];
    if (!s) throw new UsageError(`unknown flag --${key}`);
    if (s.type === 'boolean') { out[key] = !neg; continue; }
    const v = inline !== undefined ? inline : argv[++i];
    if (v === undefined || (inline === undefined && v.startsWith('--'))) throw new UsageError(`--${key} needs a value`);
    if (s.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new UsageError(`--${key} must be a number (got ${v})`);
      out[key] = n;
    } else if (s.type === 'list') out[key] = v.split(',').map((x) => x.trim()).filter(Boolean);
    else out[key] = v;
    if (s.enum && ![].concat(out[key]).every((x) => s.enum.includes(x))) throw new UsageError(`--${key} must be one of ${s.enum.join('|')} (got ${v})`);
  }
  const [min, max] = positionals;
  if (out._.length < min || out._.length > max) throw new UsageError(`expected ${min === max ? min : `${min}-${max}`} positional argument(s), got ${out._.length}`);
  return out;
}

/** Run main(); print usage on UsageError; exit 1 on any error. */
export async function runCli(usage, main) {
  try {
    const code = await main();
    process.exit(code || 0);
  } catch (e) {
    if (e instanceof HelpRequest) {
      console.log(`usage: ${usage}\nAll flags, with examples: docs/CLI.md`);
      process.exit(0);
    }
    if (e instanceof UsageError) console.error(`error: ${e.message}\nusage: ${usage}`);
    else console.error(`error: ${e && e.message ? e.message : e}`);
    if (process.env.REELCODE_DEBUG && e && e.stack) console.error(e.stack);
    process.exit(1);
  }
}
