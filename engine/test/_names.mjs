// _names.mjs: per-process fixture names for the CLI tests. Two `node --test` runs at once (two agents, two
// terminals) must never share a projects/<name>, templates/<name> or brands/<id> folder: each run deletes its own
// fixtures before and after, which would delete the other run's mid-test. Not a test file (no .test. in the name).
const TAG = process.pid.toString(36);

/** uniq('_rxt-splice') -> '_rxt-splice-<pid in base 36>' (still a valid project / template / preset name). */
export const uniq = (base) => `${base}-${TAG}`;

/** A RegExp source matching a name literally (for asserting CLI output that contains it). */
export const reName = (name) => name.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
