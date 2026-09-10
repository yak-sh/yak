/** Worker owns the authoritative database and all agent execution. */
import { portLink } from '@yaks/sync'
import { subscriptions } from '@yaks/api'
import { type Agent, agent } from './run.ts'
import { open } from './store.ts'
import { diagnostics, uncaught } from './diagnostics.ts'
const removeErrors = uncaught(diagnostics(), self)
let closing = false
let a: Agent | undefined
let subs: ReturnType<typeof subscriptions> | undefined
let active = new Set<Promise<unknown>>()
let link = portLink({
  postMessage: (value) => postMessage(value),
  addEventListener: self.addEventListener.bind(self),
  removeEventListener: self.removeEventListener.bind(self),
}, {
  report: (error) => diagnostics().report(error, { phase: 'worker-command' }),
  receive: (method, value) => {
    let pending = handle(method, value)
    active.add(pending)
    pending.then(() => active.delete(pending), () => active.delete(pending))
    return pending
  },
})
async function handle(method: string, value: unknown): Promise<unknown> {
  if (closing) throw new Error('Worker is shutting down')
  let args = (value ?? []) as unknown[]
  if (method == 'init') {
    if (a) throw new Error('Already initialized')
    let options = args[0] as {
      db?: string
      cwd?: string
      instructions?: string
      fake?: boolean
    }
    a = agent({
      h: open(options.db),
      cwd: options.cwd,
      instructions: options.instructions,
      ...(options.fake
        ? {
          name: 'fake',
          model: () =>
            Promise.resolve({
              id: 'test',
              model: 'fake',
              items: [{ kind: 'assistant' as const, text: 'ok' }],
            }),
        }
        : {}),
    })
    subs = subscriptions(a.h.g, {
      invalidate: (query, applied) =>
        query == '.session' &&
        applied.some((b) => b.entry != null),
    })
    return { names: a.names }
  }
  if (!a || !subs) throw new Error('Worker not initialized')
  if (method == 'subscribe') {
    await subs.open(link.frame, String(args[0]), args[1] as string)
    return true
  }
  if (method == 'unsubscribe') {
    subs.close(link.frame, String(args[0]))
    return true
  }
  if (method == 'close') {
    closing = true
    await Promise.allSettled([...active])
    subs.drop(link.frame)
    // Do not finalize native SQLite statements while a model turn still owns them.
    await Promise.all((await a.sessions()).map((s) => a!.idle(s.entity.eid)))
    await diagnostics().drain()
    a.close()
    a = undefined
    removeErrors()
    return true
  }
  // Narrow command/projection API: never evaluate caller-provided code.
  switch (method) {
    case 'start':
      return a.start(String(args[0]))
    case 'send':
      return a.send(String(args[0]), String(args[1]))
    case 'taskEntry':
      return a.taskEntry(String(args[0]), String(args[1]))
    case 'archive':
      return a.archive(String(args[0]), Boolean(args[1]))
    case 'resume':
      return a.resume()
    case 'idle':
      return a.idle(String(args[0]))
    case 'sessions':
      return a.sessions()
    case 'tasks':
      return a.tasks()
    case 'children':
      return a.children(String(args[0]))
    case 'transcriptPlan': {
      let id = String(args[0]), plans: string[] = []
      let limit: number | undefined
      let seen = new Set<string>()
      while (!seen.has(id)) {
        seen.add(id)
        plans.unshift(
          '.entry.session=' + id +
            (limit == null ? '' : '&.entry.seq<=' + limit),
        )
        let [row] = await a.h.g.storage.tx((tx) => tx.get([id]))
        let from = (row?.fork as { from?: string })?.from
        if (!from) break
        let [anchor] = await a.h.g.storage.tx((tx) => tx.get([from]))
        if (!anchor?.entry) break
        id = String((anchor.entry as { session: string }).session)
        limit = Math.min(
          limit ?? Infinity,
          Number((anchor.entry as { seq: number }).seq),
        )
      }
      return plans
    }
    default:
      throw new Error('Unknown worker operation: ' + method)
  }
}
