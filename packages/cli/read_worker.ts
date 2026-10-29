/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The read side of one file-backed web host. It composes the same graph over
// another SQLite WAL connection so a long query cannot hold the HTTP thread.
import { read } from './config.ts'
import { record } from '@yaks/trace'
import { compose, facet, type Served } from './host.ts'
import type { Heard, Said } from './read_thread.ts'
import { thread } from './stall.ts'
import { readActivity, readOperations } from './read_activity.ts'

let host: Promise<Served> | undefined
let activity: ReturnType<typeof readActivity> | undefined
let tell = (heard: Heard) => self.postMessage(heard)
// Where this thread is, so the reader can see how long a read here waited
// for a CPU while it runs.
let place = thread()
if (place) tell({ thread: place })
let errorOf = (cause: unknown) => {
  let error = cause instanceof Error ? cause : new Error(String(cause))
  return {
    name: error.name,
    message: error.message,
    details: Object.fromEntries(
      Object.entries(error).filter(([key]) => key != 'stack'),
    ),
  }
}

self.onmessage = ({ data }: MessageEvent<Said>) => {
  if ('start' in data) {
    activity = readActivity(data.activity)
    activity.say('composing the read-only graph')
    host = Promise.resolve().then(async () => {
      let host = await compose(read(data.start), ['graph'], facet, {
        process: false,
        readOnly: true,
      })
      activity?.say('idle; waiting for a read')
      return host
    })
    host.catch(() => {})
    return
  }
  if ('close' in data) {
    void host?.then((h) => h.close(), () => {}).finally(() => {
      tell({ closed: true })
      self.close()
    })
    return
  }
  void (async () => {
    let stop: (() => void) | undefined
    try {
      if (!host) throw new Error('the reader was not started')
      activity?.say('waiting for the read-only graph to finish composing')
      let graph = (await host).graph
      activity?.say(`entering graph.${data.op}`)
      stop = readOperations(graph, (text) => activity?.say(text))
      let query = () =>
        data.op == 'get'
          ? graph.get(data.eids, data.comps, data.opts)
          : data.op == 'read'
          ? graph.read(data.query, data.opts)
          : graph.rows(data.query, data.opts)
      if (!data.observed) {
        let value = await query()
        activity?.say('posting the read result to the main thread')
        tell({ id: data.id, value })
        return
      }
      // Catch inside the recorder so a refused/failed read returns its tree,
      // too, without turning an error into an independent worker report.
      let captured = await record(graph, () => {
        try {
          return Promise.resolve(query()).then(
            (value) => ({ value }),
            (error) => ({ error: errorOf(error) }),
          )
        } catch (error) {
          return Promise.resolve({ error: errorOf(error) })
        }
      }, { history: false })
      activity?.say('posting the read result and trace to the main thread')
      tell({
        id: data.id,
        ...captured.result,
        spans: captured.spans,
        origin: performance.timeOrigin,
      })
    } catch (error) {
      activity?.say('posting the read failure to the main thread')
      tell({ id: data.id, error: errorOf(error) })
    } finally {
      stop?.()
      activity?.say('idle; the read reply was posted')
    }
  })()
}
