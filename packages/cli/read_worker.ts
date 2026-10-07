/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
// The read side of one file-backed web host. It composes the same graph over
// another SQLite WAL connection so a long query cannot hold the HTTP thread.
import { read } from './config.ts'
import { record } from '@yaks/trace'
import { compose, facet, type Served } from './host.ts'
import type { Heard, Said } from './read_thread.ts'

let host: Promise<Served> | undefined
let tell = (heard: Heard) => self.postMessage(heard)
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
    host = Promise.resolve().then(() =>
      compose(read(data.start), ['graph'], facet, {
        process: false,
        readOnly: true,
      })
    )
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
    try {
      if (!host) throw new Error('the reader was not started')
      let graph = (await host).graph
      let query = () =>
        data.op == 'get'
          ? graph.get(data.eids, data.comps)
          : data.op == 'read'
          ? graph.read(data.query, data.opts)
          : graph.rows(data.query, data.opts)
      if (!data.observed) {
        tell({ id: data.id, value: await query() })
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
      tell({
        id: data.id,
        ...captured.result,
        spans: captured.spans,
        origin: performance.timeOrigin,
      })
    } catch (error) {
      tell({ id: data.id, error: errorOf(error) })
    }
  })()
}
