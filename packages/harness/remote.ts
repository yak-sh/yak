/** Opt-in worker frontend. UI state remains in the frontend's private graph. */
import { client } from '@yaks/client'
import { type Frame, land, portLink, strip } from '@yaks/sync'
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
    instructions?: string
    fake?: boolean
  } = {},
) => {
  let worker = new Worker(
    new URL('./backend_worker.ts', import.meta.url).href,
    { type: 'module' },
  )
  let replica = client(vocab, [], { vault: false })
  let listeners = new Set<() => void>()
  let members = new Map<string, string[]>()
  let failure: Error | undefined
  let queued = Promise.resolve()
  let link = portLink(worker, {
    frame: (frame: Frame) => {
      queued = queued.then(async () => {
        if (frame.refused) throw new Error(frame.refused.message)
        await land(replica.graph, frame)
        let ids = new Set(members.get(frame.id) ?? [])
        for (let b of frame.bundles ?? []) ids.add(b.entity.eid)
        for (let id of frame.gone ?? []) ids.delete(id)
        members.set(frame.id, [...ids])
        for (let notify of listeners) notify()
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
  let request = async (method: string, args: unknown[] = []) => {
    if (failure) throw failure
    return await link.request(method, args)
  }
  let init: { names: Record<string, string> }
  try {
    init = await request('init', [options]) as typeof init
  } catch (e) {
    link.close()
    worker.terminate()
    replica.close()
    throw e
  }
  let rows = (id: string) =>
    (members.get(id) ?? []).flatMap((id) => {
      let b = replica.ent(id)
      return b ? [b] : []
    })
  let listen = async (id: string, query: string) => {
    await request('subscribe', [id, query])
    await queued
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
    serial = Promise.resolve()
  let select = (session: string) => {
    serial = serial.catch(() => {}).then(async () => {
      if (selected == session) return
      for (let id of plans) {
        await request('unsubscribe', [id])
        await queued
        let old = members.get(id) ?? []
        members.delete(id)
        await strip(
          replica.graph,
          old.filter((eid) =>
            ![...members.values()].some((ids) => ids.includes(eid))
          ),
        )
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
    })
    return serial
  }
  // Summaries still use the existing authoritative projection because session
  // status and local titles are derived. This is a measured pilot limitation.
  let agent: UIAgent = {
    start: async (text) => await request('start', [text]) as string,
    send: async (id, text) => await request('send', [id, text]) as string,
    taskEntry: async (id, text) =>
      await request('taskEntry', [id, text]) as { task: string; child: string },
    archive: async (id, value) => {
      await request('archive', [id, value])
    },
    sessions: async () => await request('sessions') as Bundle[],
    tasks: async () => await request('tasks') as Bundle[],
    children: async (id) => await request('children', [id]) as Bundle[],
    transcript: async (id) => {
      await select(id)
      await queued
      return plans.flatMap((key) =>
        rows(key).sort((a, b) =>
          Number((a.entry as Comp).seq) - Number((b.entry as Comp).seq)
        )
      )
    },
    entry: (b) =>
      tree(transcriptViews, b, 'Transcript', vocab, { names: init.names }),
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
    close: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          request('close'),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Worker shutdown timeout')),
              2000,
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
        link.close()
        worker.terminate()
        replica.close()
        listeners.clear()
      }
    },
  }
}
