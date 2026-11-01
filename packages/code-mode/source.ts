import { transform } from 'sucrase'
import type { Entry } from './types.ts'

/** User code lives in its own module. The trusted entrypoint loads it inside
 * its catch, with no bindings and no lexical access to the bridge. */
export let source = (
  script: string,
  entries: Entry[],
  most: number,
  wallMs = 30_000,
): Record<string, string> => ({
  'user.js':
    transform(`export default async function execute(tools) {\n${script}\n}`, {
      transforms: ['typescript'],
    }).code,
  'script.js': `import { WorkerEntrypoint } from 'cloudflare:workers';
const wait = scheduler.wait.bind(scheduler);
const race = Promise.race.bind(Promise);
const stringify = JSON.stringify.bind(JSON);
const encode = new TextEncoder().encode.bind(new TextEncoder());
const Controller = AbortController;
export default class extends WorkerEntrypoint {
  async run(bridge) {
    let timer = new Controller();
    let cancel = timer.abort.bind(timer);
    let deadline = wait(${wallMs}, {signal:timer.signal}).then(() => ({error:'execution exceeded 30 seconds'}));
    try {
      let tools = Object.create(null);
      for (let [set, name] of ${JSON.stringify(entries.map((e) => e.path))}) {
        tools[set] ??= Object.create(null);
        tools[set][name] = (args) => {
          let text = JSON.stringify(args);
          if (new TextEncoder().encode(text).length > 65536) throw new Error('tool arguments exceed 64 KiB');
          return bridge.call(set, name, text);
        };
      }
      let work = async () => {
        let {default: execute} = await import('./user.js');
        let value = await execute(tools);
        return {value: value === undefined ? null : value};
      };
      let text = stringify(await race([work(), deadline]));
      if (encode(text).length > ${most}) throw new Error('script return exceeds output limit');
      return text;
    } catch (error) {
      return stringify({error: String(error?.message ?? error).slice(0,1024)});
    } finally { cancel(); }
  }
}`,
})
