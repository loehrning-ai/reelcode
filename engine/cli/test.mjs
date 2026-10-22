// test.mjs: run the test suites. Node tests: node --test engine/test/ (they drive the real CLIs, a real Chromium and
// a real ffmpeg); Python tests: engine/audio/test_audio.py through the venv. The generated fixtures the tests read
// (procedural photos, UI captures) are prepared once up front.
//
// npx reelcode test [--node | --py] [--concurrency N] [file ...]
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { parseArgs, runCli } from './lib/args.mjs';
import { STUDIO_ROOT } from './lib/server.mjs';
import { pythonPath } from './lib/pipeline.mjs';
import { loadProject } from './lib/project.mjs';
import { runPrepare } from './lib/prepare.mjs';
import { shLive } from './lib/sys.mjs';

const USAGE = 'npx reelcode test [--node | --py] [--concurrency N] [file ...]';
const SPEC = { node: { type: 'boolean', default: false }, py: { type: 'boolean', default: false }, concurrency: { type: 'number' } };
// checked-in projects whose generated files the node tests read
const FIXTURE_PROJECTS = ['_media', '_smoke-ui', 'example-launch'];

async function prepareFixtures() {
  for (const name of FIXTURE_PROJECTS) {
    const done = await runPrepare(loadProject(`projects/${name}`), { log: (m) => console.log(`  ${m}`) });
    if (done.some((d) => d.ran)) console.log(`  prepared projects/${name}`);
  }
}

runCli(USAGE, async () => {
  const a = parseArgs(process.argv.slice(2), SPEC, { positionals: [0, 99] });
  if (a.node && a.py) throw new Error('pass --node or --py, not both');
  let failed = 0;
  if (!a.py) {
    console.log('preparing test fixtures');
    await prepareFixtures();
    const dir = join(STUDIO_ROOT, 'engine', 'test');
    const files = a._.length ? a._ : readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join('engine', 'test', f));
    // render tests are CPU heavy (Chromium + ffmpeg each); half the cores keeps them from starving one another
    const conc = a.concurrency || Math.max(1, Math.floor(cpus().length / 2));
    console.log(`\nnode --test (${files.length} files, concurrency ${conc})`);
    if (shLive(process.execPath, ['--test', `--test-concurrency=${conc}`, '--test-timeout=900000', ...files]) !== 0) failed++;
  }
  if (!a.node && !a._.length) {
    console.log('\npython audio tests');
    if (shLive(pythonPath(), ['-I', join(STUDIO_ROOT, 'engine', 'audio', 'test_audio.py')]) !== 0) failed++;
  }
  console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
  return failed ? 1 : 0;
});
