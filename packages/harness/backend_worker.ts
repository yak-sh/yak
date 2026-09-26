import type { SourceRequest } from './detail.ts'
import {
  transcriptPlan,
  transcriptSegments,
  type TranscriptWindow,
} from '@yaks/session'
import type { ImageOptions } from './images.ts'
/** Worker owns the authoritative database and all agent execution: the graph
 * the config it is handed names, composed as any `yak` process composes it.
 *
 * It serves a backend on each MessagePort it is sent (remote.ts): the one a
 * frontend that started this Worker for itself sends, or one after another
 * for a test process, which starts the Worker's module graph once and hosts
 * every test's backend in it (testing.ts `worker`). A backend's state is its
 * own; what the Worker holds is the modules, and the observer that reports
 * what escapes all of them. */
import { portLink } from '@yaks/sync'
import { subscriptions } from '@yaks/api'
import { compose, type Config, type Served } from '@yaks/cli/host'
import { type Local, local } from './local.ts'
import { hosted } from './store.ts'
import { diagnostics, uncaught } from './diagnostics.ts'
import type { Bundle } from '@yaks/graph'
uncaught(diagnostics(), self)

/** One backend, on `port`: the graph its `init` names, and every command
 * after it, until its `close`. */
let serve = (port: MessagePort) => {
  let closing = false
  let host: Served | undefined
  let a: Local | undefined
  let subs: ReturnType<typeof subscriptions> | undefined
  let active = new Set<Promise<unknown>>()
  let fake = false
  let started = Promise.withResolvers<void>()
  let released = Promise.withResolvers<void>()
  let link = portLink(port, {
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
    // Ended where it stands, while a close may still be draining: the
    // frontend is about to let this Worker go, and its pid goes on, so it
    // writes its own ending first (@yaks/cli `Host.end`) — its leases
    // released, its `exit` stamped — and what it held is had at once.
    if (method == 'end') {
      await host?.end(
        host.me,
        'interrupted: its backend was ended where it stood',
      )
      return true
    }
    if (closing) throw new Error('Worker is shutting down')
    let args = (value ?? []) as unknown[]
    if (method == 'init') {
      if (a) throw new Error('Already initialized')
      let options = args[0] as {
        provider?: string
        name?: string
        config: Config
        cwd?: string
        web?: boolean
        images?: ImageOptions | false
        streaming?: boolean
        migrationPollMs?: number
        hold?: number
        instructions?: string
        fake?: boolean | 'stuck' | 'held' | { delayMs: number; deltas?: number }
      }
      fake = Boolean(options.fake)
      // The graph role alone: this worker handles the one effect it lends code
      // (the session runner, below), and leaves every other run the graph owes
      // to a process serving the effects role.
      let served = host = await compose(
        { ...options.config, ...options.hold ? { lease: options.hold } : {} },
        ['graph'],
      )
      a = local({
        h: hosted(served, () => served.close()),
        hold: options.hold,
        cwd: options.cwd,
        streaming: options.streaming,
        instructions: options.instructions,
        provider: options.provider,
        name: options.name,
        migrationPollMs: options.migrationPollMs,
        images: options.images,
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
          query.startsWith('.session') &&
          applied.some((b) =>
            b.entry != null || 'task' in b || 'claim' in b ||
            'completed' in b || 'cancelled' in b || '$delete' in b
          ),
      })
      // What other processes and threads commit to the same store reaches the
      // terminal too: the pool working a transcript's turn elsewhere, a `yak`
      // command run beside it. The feed stops when the host closes.
      let fed = subs
      served.feed((applied) => fed.commit(applied))
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
      await Promise.allSettled([...active])
      // Closing drains the step in flight before SQLite is let go, and the
      // subscribers stay attached through the final writes it makes.
      await a.close()
      subs.drop(link.frame)
      a = undefined
      return true
    }
    // Narrow command/projection API: never evaluate caller-provided code.
    switch (method) {
      case 'exception':
        // The frontend owns the terminal: a defect it catches is written
        // into the graph here rather than over the pane it is painting.
        return await a.h.g.apply(args[0] as Bundle[], { trusted: true })
      case 'runtime':
        return a.runtime(String(args[0]))
      case 'control':
        return a.control(
          String(args[0]),
          args[1] as import('./runtime.ts').RuntimeAction,
        )
      case 'authorizeMCP':
        return a.authorizeMCP(
          args[0] as import('./mcp_auth.ts').MCPAuthAction,
          String(args[1] ?? ''),
          String(args[2] ?? ''),
        )
      case 'image':
        return await a.image(String(args[0]))
      case 'models':
        return a.models(args[0] == null ? undefined : String(args[0]))
      case 'selectModel':
        return a.selectModel(String(args[0]), String(args[1]))
      case 'start':
        return a.start(
          String(args[0]),
          args[1] as { effort?: string; model?: string } | undefined,
        )
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
              (limit == null ? '' : '&.entry.seq<=' + limit) + '&*',
          )
          let [row] = await a.h.g.get([id])
          let from = (row?.fork as { from?: string })?.from
          if (!from) break
          let [anchor] = await a.h.g.get([from])
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
}

self.addEventListener('message', (event) => {
  let port = (event as MessageEvent).data?.backend
  if (port instanceof MessagePort) serve(port)
})
