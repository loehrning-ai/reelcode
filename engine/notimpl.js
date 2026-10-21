// notimpl.js: the marker error thrown by v2 interface stubs (Node and page). Callers that wire a feature
// (make.mjs, runtime.js) catch it and skip the feature with a warning instead of failing the run.

export class NotImplemented extends Error {
  constructor(what) {
    super(`not implemented: ${what}`);
    this.name = 'NotImplemented';
    this.notImplemented = true;
  }
}

/** True for a NotImplemented error (also across module copies / page realms, by marker). */
export const isNotImplemented = (e) => !!(e && (e.notImplemented === true || e.name === 'NotImplemented'));
