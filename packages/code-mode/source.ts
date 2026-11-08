import type { Strip } from './mod.ts'
import type { Entry } from './types.ts'

/** What each limit says, with what to do instead. */
export let TOO = {
  script: 'script exceeds 64 KiB; read large data with a tool inside the ' +
    'script, or split the work across code_mode calls',
  args: 'tool arguments exceed 64 KiB; split the rows across several calls',
  calls: 'execution allows 16 tool calls; write many rows in one call ' +
    '(graph_apply takes many bundles), or continue in another code_mode call',
  system: 'result exceeds the 32 MiB system safety limit; this is likely an ' +
    'accidental result, so narrow the query or calculation',
}

/** User code lives in its own module, its TypeScript read as JavaScript by
 * the host's `strip`. The trusted entrypoint loads it inside its catch, with
 * no bindings and no lexical access to the bridge. */
export let source = async (
  script: string,
  entries: Entry[],
  most: number,
  strip: Strip,
  wallMs = 30_000,
): Promise<Record<string, string>> => ({
  'user.js': await strip(
    'user.ts',
    `export default async function execute(tools, results) {\n${script}\n}`,
  ),
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
          if (new TextEncoder().encode(text).length > 65536) throw new Error(${
    JSON.stringify(TOO.args)
  });
          return bridge.call(set, name, text);
        };
      }
      let work = async () => {
        let {default: execute} = await import('./user.js');
        let value = await execute(tools, {read: (id) => bridge.read(id)});
        return {value: value === undefined ? null : value};
      };
      let text = stringify(await race([work(), deadline]));
      if (encode(text).length > ${most}) throw new Error(${
    JSON.stringify(TOO.system)
  });
      return text;
    } catch (error) {
      return stringify({error: String(error?.message ?? error).slice(0,1024)});
    } finally { cancel(); }
  }
}`,
})
