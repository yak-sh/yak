/** EventSource owns reconnect, not a polling clock. Closing releases the lease. */
import type { Activity } from './activity.ts'

export type Connection = 'connecting' | 'live' | 'reconnecting' |
  'paused' | 'offline'
export type Source = Pick<EventSource,
  'addEventListener' | 'close' | 'onopen' | 'onerror' | 'readyState'>
export type StreamOptions = {
  connect: (url: string) => Source
  url: string
  tail?: boolean
  epoch: (epoch: string) => void
  activity: (event: Activity) => void
  gap: () => void
  status: (status: Connection) => void
  error: () => void
}

/** Frame data is an observation contract, never arbitrary graph bundles. */
export let valid = (input: unknown): input is Activity => {
  if (!input || typeof input != 'object') return false
  let e = input as Activity
  return typeof e.id == 'string' && !!e.id &&
    typeof e.name == 'string' && typeof e.epoch == 'string' && !!e.epoch &&
    Number.isSafeInteger(e.seq) && e.seq > 0 && Number.isFinite(e.time) &&
    ['apply', 'phase', 'rule', 'query', 'get', 'effect', 'request', 'fanout']
      .includes(e.kind) && ['start', 'end', 'instant'].includes(e.stage) &&
    (e.start == undefined || Number.isFinite(e.start)) &&
    (e.duration == undefined || Number.isFinite(e.duration) && e.duration >= 0) &&
    (e.parent == undefined || typeof e.parent == 'string') &&
    (e.package == undefined || typeof e.package == 'string') &&
    (e.plugin == undefined || typeof e.plugin == 'string') &&
    (e.outcome == undefined || ['ok', 'check', 'refused', 'error', 'interrupted']
      .includes(e.outcome)) &&
    (e.counts == undefined || !!e.counts && typeof e.counts == 'object' &&
      !Array.isArray(e.counts))
}

export let stream = (opts: StreamOptions): { close: () => void } => {
  let closed = false
  let source = opts.connect(opts.url + (opts.tail ? '?tail=1' : ''))
  let frame = (fn: (value: unknown) => void) => (event: Event) => {
    if (closed) return
    try {
      fn(JSON.parse((event as MessageEvent<string>).data))
    } catch {
      opts.error()
    }
  }
  let hello = frame((value) => {
    let h = value as { epoch?: unknown; omitted?: unknown }
    if (typeof h?.epoch != 'string' || !h.epoch) throw new Error('bad hello')
    opts.epoch(h.epoch)
    if (typeof h.omitted == 'number' && h.omitted > 0) opts.gap()
    opts.status('live')
  })
  let activity = frame((value) => {
    if (!valid(value)) throw new Error('bad observation')
    opts.activity(value)
  })
  let gap = frame((value) => {
    let g = value as { omitted?: unknown }
    if (typeof g?.omitted == 'number' && g.omitted > 0) opts.gap()
  })
  source.addEventListener('hello', hello)
  source.addEventListener('activity', activity)
  source.addEventListener('gap', gap)
  source.onopen = () => { if (!closed) opts.status('live') }
  // Disconnection alone does not establish that any records were lost.
  source.onerror = () => {
    if (!closed) opts.status(source.readyState == 2 ? 'offline' : 'reconnecting')
  }
  return {
    close: () => {
      if (closed) return
      closed = true
      source.onopen = null
      source.onerror = null
      source.close()
    },
  }
}
