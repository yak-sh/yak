// One REPL's object (repl.ts, index.ts `Repl`): each of its cells runs here
// as its facet, the `Cell` Durable Object class the cell's Dynamic Worker
// exports, so every cell's storage is the REPL's one database. Nothing can
// load new code into a running isolate, so a cell aborts the facet and starts
// it again with its own class; the facet's database carries over. What the
// next cell declares again (@yaks/code-mode/repl `Carried`) is kept here, as
// the facet's storage cannot be read from outside it. Its alarm, an hour after
// the last cell, drops the facet and everything it kept.
import { type Carried, cells } from '@yaks/code-mode/repl'
import {
  type Lend,
  type Loader,
  type Running,
  workerCode,
} from './code-runtime.ts'
import { LASTS } from './repl.ts'

type Facet = { run(bridge: unknown): Promise<string> }
export type ReplState = {
  storage: {
    kv: {
      get(key: string): unknown
      put(key: string, value: unknown): void
    }
    setAlarm(at: number): Promise<void>
    deleteAll(): Promise<void>
  }
  facets: {
    get(name: string, start: () => { class: unknown }): Facet
    abort(name: string, reason: unknown): void
    delete(name: string): void
  }
}

let CELL = 'cell'
let CARRIED = 'carried'

export class Repl {
  #queue: Promise<unknown> = Promise.resolve()
  #ctx: ReplState
  #loader: Loader
  #lend: Lend
  #now: () => number

  constructor(
    ctx: ReplState,
    loader: Loader,
    lend: Lend,
    now: () => number = Date.now,
  ) {
    this.#ctx = ctx
    this.#loader = loader
    this.#lend = lend
    this.#now = now
  }

  /** Run a cell once the cells asked before it have ended. */
  run(
    modules: Record<string, string>,
    bridge: unknown,
    running: Omit<Running, 'repl'>,
  ): Promise<string> {
    let turn = this.#queue.then(() => this.#cell(modules, bridge, running))
    this.#queue = turn.catch(() => {})
    return turn
  }

  #cell(
    modules: Record<string, string>,
    bridge: unknown,
    running: Omit<Running, 'repl'>,
  ) {
    let { storage, facets } = this.#ctx
    return cells({
      read: () => storage.kv.get(CARRIED) as Carried | undefined,
      write: (carried) => storage.kv.put(CARRIED, carried),
    }, async (loaded) => {
      let worker = this.#loader.load(workerCode(loaded, this.#lend, running))
      facets.abort(CELL, new Error('the next cell starts'))
      let facet = facets.get(CELL, () => ({
        class: worker.getDurableObjectClass('Cell'),
      }))
      try {
        return await facet.run(bridge)
      } finally {
        await storage.setAlarm(this.#now() + LASTS)
      }
    })(modules)
  }

  /** The REPL has ended: its facet's database and what it carried go. */
  async alarm() {
    this.#ctx.facets.delete(CELL)
    await this.#ctx.storage.deleteAll()
  }
}
