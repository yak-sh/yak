import type { SourceRequest } from './detail.ts'
import type { Server as MCPServer } from '@yaks/mcp-client'
import {
  transcriptPlan,
  transcriptSegments,
  type TranscriptWindow,
} from '@yaks/session'
import type { ImageOptions } from './images.ts'
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
let fake = false
let started = Promise.withResolvers<void>()
let released = Promise.withResolvers<void>()
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
  // Releasing the test provider must also work while close drains its turn.
  if (method == 'fakeRelease' && fake) {
    released.resolve()
    return true
  }
  if (closing) throw new Error('Worker is shutting down')
  let args = (value ?? []) as unknown[]
  if (method == 'init') {
    if (a) throw new Error('Already initialized')
    let options = args[0] as {
      db?: string
      cwd?: string
      web?: boolean
      mcp?: MCPServer[]
      images?: ImageOptions | false
      streaming?: boolean
      migrationPollMs?: number
      instructions?: string
      fake?: boolean | 'stuck' | 'held' | { delayMs: number; deltas?: number }
    }
    fake = Boolean(options.fake)
    a = agent({
      h: open(options.db),
      cwd: options.cwd,
      streaming: options.streaming,
      instructions: options.instructions,
      migrationPollMs: options.migrationPollMs,
      images: options.images,
      mcp: options.mcp,
      web: options.web,
      ...(options.fake
        ? {
          name: 'fake',
          model: async (req: import('@yaks/model').Request) => {
            started.resolve()
            if (typeof options.fake == 'object' && options.fake.deltas) {
              for (let i = 0; i < options.fake.deltas; i++) {
                req.onText?.({ index: 0, text: 'x' })
              }
            }
            if (options.fake == 'stuck') {
              return new Promise(() => {})
            }
            if (options.fake == 'held') await released.promise
            if (typeof options.fake == 'object') {
              let delay = options.fake.delayMs
              await new Promise((resolve) => setTimeout(resolve, delay))
            }
            return {
              id: 'test',
              model: 'fake',
              items: [{
                kind: 'assistant' as const,
                text: typeof options.fake == 'object' && options.fake.deltas
                  ? 'x'.repeat(options.fake.deltas)
                  : 'ok',
              }],
            }
          },
        }
        : {}),
    })
    subs = subscriptions(a.h.g, {
      invalidate: (query, applied) =>
        query == '.session' &&
        applied.some((b) =>
          b.entry != null || 'task' in b || 'claim' in b ||
          'completed' in b || 'cancelled' in b || '$delete' in b
        ),
    })
    return { names: a.names }
  }
  if (!a || !subs) throw new Error('Worker not initialized')
  if (method == 'fakeStarted' && fake) return await started.promise
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
    let drained = a.d.stop()
    await Promise.allSettled([...active])
    // Do not finalize native SQLite statements while a model turn still owns them.
    await drained
    // Keep subscribers attached through final writes from admitted work.
    subs.drop(link.frame)
    await a.close()
    a = undefined
    removeErrors()
    return true
  }
  // Narrow command/projection API: never evaluate caller-provided code.
  switch (method) {
    case 'runtime':
      return a.runtime(String(args[0]))
    case 'control':
      return a.control(
        String(args[0]),
        args[1] as import('./runtime.ts').RuntimeAction,
      )
    case 'image':
      return await a.image(String(args[0]))
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
    case 'usage':
      return a.usage(String(args[0]))
    case 'tasks':
      return a.tasks()
    case 'children':
      return a.children(String(args[0]))
    case 'entrySource':
      return a.entrySource(
        String(args[0]),
        String(args[1]),
        args[2] as SourceRequest,
      )
    case 'transcriptWindowPlan': {
      let session = String(args[0])
      let plan = await transcriptPlan(
        a.h.g,
        session,
        args[1] as TranscriptWindow,
      )
      let frontiers = (await transcriptSegments(a.h.g, session)).map((s) =>
        '.entry.session=' + s.session +
        (Number.isFinite(s.through) ? '&.entry.seq<=' + s.through : '') +
        '&.fields=entry.seq&.order=-entry.seq&.limit=1'
      )
      return { ...plan, frontiers }
    }
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
