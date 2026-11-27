import type { Strip } from './mod.ts'
import type { Entry } from './types.ts'
import { fileModule } from './files.ts'

export let timedOut = (wallMs: number) =>
  `execution exceeded ${wallMs / 1000} seconds`

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

/** What a script is given beside its tools. */
export type Given = {
  wallMs?: number
  /** `fs`, over /tmp and the app mount */
  files?: boolean
  /** puppeteer's module, as `puppeteer.js`, for a script given `browser`: it
   * launches on the evaluator's `env.BROWSER`, and every browser it launched
   * is closed when the run ends */
  browser?: string
  /** a REPL's cell: the Worker exports `Cell`, a Durable Object class whose
   * storage is the REPL's, and keeps the cell's top-level values there
   * (./repl.ts) */
  cell?: boolean
}

/** Where a cell keeps its top-level values, in its storage's kv. */
export let VALUES = '$repl:values'

// The signature user code runs in, and a cell's two more: its storage and
// what it carries from the cells before it.
let signature = (cell?: boolean) =>
  `export default async function execute(tools, results, fs, browser${
    cell ? ', storage, $carried' : ''
  }) {`
/** Where ./repl.ts `carry` declares what a cell carries, before its code. */
export let CARRIED = '/*carried*/'

/** User code lives in its own module, its TypeScript read as JavaScript by
 * the host's `strip`. The trusted entrypoint loads it inside its catch, with
 * no bindings and no lexical access to the bridge. */
export let source = async (
  script: string,
  entries: Entry[],
  most: number,
  strip: Strip,
  { wallMs = 30_000, files = false, browser, cell }: Given = {},
): Promise<Record<string, string>> => ({
  ...files ? { 'files.js': fileModule } : {},
  ...browser ? { 'puppeteer.js': browser } : {},
  'user.js': cell
    ? `${signature(cell)}\n${CARRIED}\n${
      body(await strip('user.ts', `${signature(cell)}\n${script}\n}`))
    }\n}`
    : await strip('user.ts', `${signature()}\n${script}\n}`),
  'script.js': `import { ${
    cell ? 'DurableObject' : 'WorkerEntrypoint'
  } } from 'cloudflare:workers';
${files ? "import { filesystem } from './files.js';" : ''}
${browser ? "import puppeteer from './puppeteer.js';" : ''}
const wait = scheduler.wait.bind(scheduler);
const race = Promise.race.bind(Promise);
const stringify = JSON.stringify.bind(JSON);
const encode = new TextEncoder().encode.bind(new TextEncoder());
const Controller = AbortController;
${cell ? keeping : ''}
${
    cell
      ? 'export class Cell extends DurableObject {'
      : 'export default class extends WorkerEntrypoint {'
  }
  async run(bridge) {
    let timer = new Controller();
    let cancel = timer.abort.bind(timer);
    let deadline = wait(${wallMs}, {signal:timer.signal}).then(() => ({error:${
    JSON.stringify(timedOut(wallMs))
  }}));
    let launched = [];${
    cell
      ? `
    let kv = this.ctx.storage.kv;
    let carried = {values: kv.get(${
        JSON.stringify(VALUES)
      }) ?? {}, capture: null};`
      : ''
  }
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
      // A path outside the catalog says which ones exist, rather than a
      // TypeError reading a property of undefined.
      let named = (of, what, list) => new Proxy(of, {
        get(o, k) {
          if (typeof k != 'string' || k in o || k == 'then') return o[k];
          throw new Error(what(k) + list());
        },
      });
      for (let set in tools) {
        tools[set] = named(tools[set], (k) => \`tools.\${set}.\${k} is not a tool; this set has \`, () => Object.keys(tools[set]).join(', '));
      }
      tools = named(tools, (k) => \`tools.\${k} is not a tool set; the sets are \`, () => Object.keys(tools).map((s) => 'tools.' + s).join(', '));
      let work = async () => {
        let {default: execute} = await import('./user.js');
        let value = await execute(tools, {read: (id) => bridge.read(id)}, ${
    files ? 'filesystem((app, args) => bridge.file(app, args))' : 'undefined'
  }, ${
    browser
      ? `{launch: async (options) => {
          let opened = await puppeteer.launch(this.env.BROWSER, options);
          launched.push(opened);
          return opened;
        }}`
      : 'undefined'
  }${cell ? ', {sql: this.ctx.storage.sql, kv}, carried' : ''});
        return {value: value === undefined ? null : value};
      };
      let answer = await race([work(), deadline]);${
    cell ? '\n      Object.assign(answer, keep(kv, carried));' : ''
  }
      let text = stringify(answer);
      if (encode(text).length > ${most}) throw new Error(${
    JSON.stringify(TOO.system)
  });
      return text;
    } catch (error) {
      return stringify({error: String(error?.message ?? error).slice(0,1024)${
    cell ? ', ...keep(kv, carried)' : ''
  }});
    } finally {
      cancel();
      await Promise.allSettled(launched.map((opened) => opened.close()));
    }
  }
}`,
})

// The body of the function `strip` read, between its signature's line and
// its closing brace.
let body = (stripped: string) =>
  stripped.slice(stripped.indexOf('{\n') + 2, stripped.lastIndexOf('}'))

// What a cell keeps of its top-level values once it ends, however it ended:
// each a structured clone can copy, together in one value so two names for
// one object stay one object. Each other (a function, a promise, a socket)
// is dropped, and the answer names it.
let keeping = `function keep(kv, carried) {
  let values = carried.capture ? carried.capture() : carried.values;
  let kept = {};
  let dropped = [];
  for (let [name, value] of Object.entries(values)) {
    try {
      structuredClone(value);
      kept[name] = value;
    } catch {
      dropped.push(name);
    }
  }
  try {
    kv.put(${JSON.stringify(VALUES)}, kept);
  } catch (error) {
    return {$kept: [], dropped: Object.keys(values), unkept: String(error?.message ?? error).slice(0, 1024)};
  }
  return {$kept: Object.keys(kept), ...dropped.length ? {dropped} : {}};
}`
