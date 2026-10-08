'use strict';
const { AbortSignal } = globalThis;
fetch('http://127.0.0.1:' + (process.env.PORT || 3030) + '/health', { signal: AbortSignal.timeout(4000) })
  .then(async response => {
    if (!response.ok || (await response.json()).database !== 'UP') process.exitCode = 1;
  }).catch(() => { process.exitCode = 1; });
