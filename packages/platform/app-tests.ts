// App test selection and the program loaded into a fresh Dynamic Worker.
// The host supplies a store scoped to the app's temporary branch.
export type TestResult = { path: string; name: string; error?: string }

export let testPaths = (paths: string[], asked?: string[]): string[] => {
  let tests = paths.filter((p) => /_test\.[jt]s$/.test(p)).sort()
  return asked?.length
    ? [...new Set(asked)].filter((p) => tests.includes(p))
    : tests
}

export let testProgram = (path: string, main: string): string => `
import { WorkerEntrypoint } from 'cloudflare:workers';
let path = ${JSON.stringify(path)};
export default class extends WorkerEntrypoint {
  async run(bridge) {
    let tests = [];
    let results = [];
    function test(name, run) {
      if (typeof name !== 'string' || typeof run !== 'function') {
        throw new TypeError('test takes a name and a callback');
      }
      if (tests.length >= 256) throw new Error('This file registers more than 256 tests');
      tests.push({ name: name.slice(0, 256), run });
    }
    async function call(name, args) {
      let response = await bridge.call('store', name, JSON.stringify(args));
      if (response.isError) throw new Error(response.content.map(c => c.text).join(' '));
      return response.structuredContent;
    }
    let store = {
      query: (q) => call('query', { q }),
      apply: (entities) => call('apply', { entities }),
    };
    globalThis.test = test;
    globalThis.Deno = { test };
    globalThis.store = store;
    let explain = (error) => String(error?.stack ?? error).slice(0, 2048);
    try {
      await import(${JSON.stringify('./' + main)});
    } catch (error) {
      return JSON.stringify([{ path, name: path, error: explain(error) }]);
    }
    if (!tests.length) return JSON.stringify([{ path, name: path, error: 'No tests registered' }]);
    for (let { name, run } of tests) {
      try {
        await run({ store });
        results.push({ path, name });
      } catch (error) {
        results.push({ path, name, error: explain(error) });
      }
    }
    return JSON.stringify(results);
  }
}
`
