import type {
  TranscriptPage,
  TranscriptPlan,
  TranscriptWindow,
} from '@yaks/session'
import { streamingEnabled } from './streaming.ts'
import { transient } from '@yaks/graph'
import type { ImageOptions } from './images.ts'
/** Worker frontend. UI state remains in the frontend's private graph. */
import { client } from '@yaks/client'
import { type Frame, portLink } from '@yaks/sync'
import type { Bundle, Comp } from '@yaks/graph'
import { render as tree } from '@yaks/preact'
import { render } from '@yaks/text'
import { views } from '@yaks/session'
import { vocab } from './vocab.ts'
import { transcriptViews } from './transcript.ts'
import type { UIAgent } from './panels.ts'
import { diagnostics } from './diagnostics.ts'

export let remote = async (
  options: {
    db?: string
    cwd?: string
    web?: boolean
    images?: ImageOptions | false
    streaming?: boolean
    stream?: boolean
    instructions?: string
    fake?: boolean | 'stuck' | 'held' | { delayMs: number; deltas?: number }
  } = {},
) => {
  let worker = new Worker(
    new URL('./backend_worker.ts', import.meta.url).href,
    { type: 'module' },
  )
  let replica = client(vocab, [], { vault: false, retention: 256 })
  let listeners = new Set<() => void>()
  let members = new Map<string, string[]>()
  // Memoize the asynchronous projection until its authoritative subscription
  // changes. Selection changes do not change session titles or task summaries.
  let summaries = new Map<string, Promise<Bundle[]>>()
  // Initial subscription data is returned to its awaiting caller. Publishing it
  // as a new change would invalidate that same read and force a second refresh.
  let initializing = new Set<string>()
  let failure: Error | undefined
  let windowRevision = 0
  let queued = Promise.resolve()
  let link = portLink(worker, {
    frame: (frame: Frame) => {
      queued = queued.then(async () => {
        if (frame.refused) throw new Error(frame.refused.message)
        summaries.delete(frame.id)
        if (frame.id.startsWith('window:') && frame.gone?.length) {
          windowRevision++
        }
        if (frame.id.startsWith('frontier:')) {
          windowRevision++
          if (!initializing.has(frame.id)) {
            for (let notify of listeners) notify()
          }
          return
        }
        await replica.cache.land(frame)
        let ids = new Set(members.get(frame.id) ?? [])
        for (let b of frame.bundles ?? []) ids.add(b.entity.eid)
        for (let id of frame.gone ?? []) ids.delete(id)
        members.set(frame.id, [...ids])
        if (!initializing.has(frame.id)) {
          for (let notify of listeners) notify()
        }
      }).catch((error) => {
        failure = error
        diagnostics().report(error, { phase: 'worker-sync' })
        for (let notify of listeners) notify()
      })
    },
  })
  let fatal = (event: Event) => {
    failure = new Error(
      (event as ErrorEvent).message || 'Worker transport failed',
    )
    link.close(failure)
    diagnostics().report(failure, { phase: 'worker' })
    for (let notify of listeners) notify()
  }
  worker.addEventListener('error', fatal)
  worker.addEventListener('messageerror', fatal)
  let closing = false
  let shutdown: Promise<{ drained: boolean }> | undefined
  let forceExit!: () => void
  let forced = new Promise<{ drained: boolean }>((resolve) => {
    forceExit = () => resolve({ drained: false })
  })
  let request = async (method: string, args: unknown[] = []) => {
    if (closing && method != 'close' && method != 'fakeRelease') {
      throw new Error('Worker is shutting down')
    }
    if (failure) throw failure
    return await link.request(method, args)
  }
  let init: { names: Record<string, string> }
  try {
    init = await request('init', [{
      ...options,
      streaming: streamingEnabled(options),
      web: options.web ?? Deno.env.get('HARNESS_WEB') != '0',
    }]) as typeof init
  } catch (e) {
    link.close()
    worker.terminate()
    replica.close()
    throw e
  }
  let rows = (id: string) =>
    (members.get(id) ?? []).flatMap((id) => {
      let b = replica.ent(id)
      return b ? transient(replica.graph).project([b]) : []
    })
  let listen = async (id: string, query: string) => {
    initializing.add(id)
    if (!id.startsWith('frontier:')) {
      replica.cache.subscribe(id, query, { prime: false })
    }
    try {
      await request('subscribe', [id, query])
      await queued
    } finally {
      initializing.delete(id)
    }
  }
  // Only summaries and tasks are global. Entry subscriptions follow selection.
  try {
    await listen('sessions', '.session')
    await listen('tasks', '.task')
  } catch (error) {
    link.close()
    worker.terminate()
    replica.close()
    throw error
  }
  let selected: string | undefined,
    plans: string[] = [],
    serial: Promise<unknown> = Promise.resolve()
  let snapshot = () =>
    plans.flatMap((key) =>
      rows(key).sort((a, b) =>
        Number((a.entry as Comp).seq) - Number((b.entry as Comp).seq)
      )
    )
  let select = (session: string) => {
    let result = serial.catch(() => {}).then(async () => {
      if (selected == session) {
        await queued
        return snapshot()
      }
      if (windowKeys.length || frontierKeys.length) await clearWindow()
      for (let id of plans) {
        await request('unsubscribe', [id])
        await queued
        members.delete(id)
        replica.cache.unsubscribe(id)
      }
      plans = []
      selected = undefined
      let queries = await request('transcriptPlan', [session]) as string[]
      for (let i = 0; i < queries.length; i++) {
        let id = 'transcript:' + session + ':' + i
        await listen(id, queries[i])
        plans.push(id)
      }
      selected = session
      return snapshot()
    })
    serial = result
    return result
  }
  let windowSession: string | undefined,
    windowQueries: string[] = [],
    frontierKeys: string[] = []
  let windowKeys: string[] = []
  let lastWindow: {
    key: string
    revision: number
    plan: TranscriptPlan & { frontiers: string[] }
  } | undefined
  let clearWindow = async () => {
    for (let id of [...windowKeys, ...frontierKeys]) {
      await request('unsubscribe', [id])
      await queued
      members.delete(id)
      replica.cache.unsubscribe(id)
    }
    windowKeys = []
    frontierKeys = []
    windowQueries = []
    lastWindow = undefined
  }
  let windowed = (
    session: string,
    options: TranscriptWindow = {},
  ): Promise<TranscriptPage> => {
    let result = serial.catch(() => {}).then(async () => {
      for (let id of plans) {
        await request('unsubscribe', [id])
        await queued
        members.delete(id)
        replica.cache.unsubscribe(id)
      }
      plans = []
      selected = undefined
      let key = JSON.stringify([session, options])
      let revision = windowRevision
      let plan = lastWindow?.key == key && lastWindow.revision == revision
        ? lastWindow.plan
        : await request('transcriptWindowPlan', [session, options]) as
          & TranscriptPlan
          & { frontiers: string[] }
      let replaced = windowSession != session ||
        JSON.stringify(plan.queries) != JSON.stringify(windowQueries)
      if (
        windowSession != session ||
        JSON.stringify(plan.queries) != JSON.stringify(windowQueries)
      ) {
        await clearWindow()
        windowSession = session
        windowQueries = plan.queries
        for (let [i, query] of plan.queries.entries()) {
          let id = 'window:' + session + ':' + i
          await listen(id, query)
          windowKeys.push(id)
        }
        for (let [i, query] of plan.frontiers.entries()) {
          let id = 'frontier:' + session + ':' + i
          await listen(id, query)
          frontierKeys.push(id)
        }
      }
      await queued
      // Recheck once after installing frontier subscriptions. A write between
      // planning and the initial frontier snapshot must not disappear.
      lastWindow = { key, revision, plan }
      if (replaced) {
        queueMicrotask(() => {
          for (let notify of listeners) notify()
        })
      }
      return {
        entries: windowKeys.flatMap((key) =>
          rows(key).sort((a, b) =>
            Number((a.entry as Comp).seq) - Number((b.entry as Comp).seq)
          )
        ),
        before: plan.before,
        after: plan.after,
      }
    })
    serial = result
    return result
  }
  // Summaries still use the existing authoritative projection because session
  // status and local titles are derived. This is a measured pilot limitation.
  let summary = (method: string) => {
    let found = summaries.get(method)
    if (found) return found
    let pending = request(method).then((rows) => rows as Bundle[])
    summaries.set(method, pending)
    pending.catch(() => {
      if (summaries.get(method) === pending) summaries.delete(method)
    })
    return pending
  }
  let agent: UIAgent = {
    start: async (text) => await request('start', [text]) as string,
    send: async (id, text) => await request('send', [id, text]) as string,
    taskEntry: async (id, text) =>
      await request('taskEntry', [id, text]) as { task: string; child: string },
    archive: async (id, value) => {
      await request('archive', [id, value])
    },
    runtime: async (id) => await request('runtime', [id]) as Bundle[],
    control: async (id, action) =>
      await request('control', [id, action]) as string,
    sessions: () => summary('sessions'),
    tasks: () => summary('tasks'),
    usage: async (session) => await request('usage', [session]) as Bundle[],
    children: async (id) => await request('children', [id]) as Bundle[],
    transcript: (id) => select(id),
    transcriptWindow: windowed,
    entry: (b) =>
      tree(transcriptViews, b, 'Transcript', vocab, {
        names: init.names,
        inlineImages: Deno.env.get('HARNESS_GRAPHICS') == 'kitty',
        image: (eid: string) => request('image', [eid]),
      }),
    line: (b, view = 'Line', ctx = {}) =>
      render(views, b, view, vocab, { names: init.names, ...ctx }, 'plain'),
  }
  return {
    agent,
    traffic: link.stats,
    replica,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    resume: () => request('resume'),
    idle: (session: string) => request('idle', [session]),
    /** Fake-provider barriers: observe dispatch and explicitly allow replies. */
    testing: options.fake
      ? {
        started: () => request('fakeStarted'),
        release: () => request('fakeRelease'),
      }
      : undefined,
    /** Force is explicit and also releases an outstanding graceful close. */
    force: () => {
      closing = true
      forceExit()
      worker.terminate()
      link.close()
    },
    close: (options: { timeout?: number | null } = {}) =>
      shutdown ??= (async () => {
        closing = true
        listeners.clear()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            request('close').then(() => ({ drained: true })),
            forced,
            new Promise<{ drained: boolean }>((resolve) => {
              if (options.timeout === null) return
              timer = setTimeout(
                () => resolve({ drained: false }),
                options.timeout ?? 2000,
              )
            }),
          ])
        } finally {
          clearTimeout(timer)
          link.close()
          worker.removeEventListener('error', fatal)
          worker.removeEventListener('messageerror', fatal)
          worker.terminate()
          await queued
          replica.close()
          listeners.clear()
        }
      })(),
  }
}
