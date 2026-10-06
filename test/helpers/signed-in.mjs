// Testes que sobem o servidor sem pensar em login: entram pelo RIPPER_TOKEN (herdado via process.env)
// e todo fetch para 127.0.0.1 leva o Bearer.
export const TEST_TOKEN = 'ripper-signed-in-test-token';
process.env.RIPPER_TOKEN ||= TEST_TOKEN;
const orig = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  if (/^http:\/\/127\.0\.0\.1:/.test(String(url?.url ?? url))) {
    const headers = new Headers(opts.headers);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${process.env.RIPPER_TOKEN}`);
    opts = { ...opts, headers };
  }
  return orig(url, opts);
};
