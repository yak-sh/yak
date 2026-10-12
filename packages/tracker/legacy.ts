// Exception migration separates a session's history from standalone defect
// reports. The pure plan keeps source guards and durable destination identities.
import { type Bundle, type Comp, token } from '@yaks/graph'
import { capture } from './report.ts'
import { comp, str } from './model.ts'

export type ExceptionMove = {
  history: boolean
  records: Bundle[]
  patch: Bundle
}

/** A retry can resend these records without creating a second occurrence.
 * History keeps its entity; only standalone reports leave their source store. */
export let legacyException = (row: Bundle): ExceptionMove => {
  let x = comp(row, 'exception')
  let created = comp(row, 'created')
  let body = str(comp(row, 'content').body)
  let diagnostic: Comp = {}
  if (!row.entry && !row.output && !row.result && body.startsWith('{')) {
    try {
      let parsed = JSON.parse(body)
      if (typeof parsed?.body == 'string') diagnostic = parsed
    } catch { /* ordinary content remains ordinary content */ }
  }
  let raw = str(x.value ?? x.message ?? diagnostic.body ?? body)
  let named = /^([\w.]*Error):\s*([^\n]*)/.exec(raw)
  let stacked = /^([\w.]*Error):/.exec(str(x.stack))
  let type = str(x.type) || stacked?.[1] || named?.[1] || 'Error'
  let value = x.value != null || !named ? raw : raw.slice(named[1].length + 2)
  if (diagnostic.body) value = value.split('\n')[0]
  let stack = str(x.stack) || (diagnostic.body ? raw : '')
  let history = !!(row.entry || row.output || row.result)
  // The build catcher stored its retry receipt on the raw commit sha, even
  // before the directory declared commit metadata for that entity.
  let commit = !!row.commit ||
    /^[a-f0-9]{40}$/.test(row.entity.eid) &&
      str(x.request).startsWith(`BUILD yak ${row.entity.eid.slice(0, 8)}`)
  let was = {
    exception: Object.fromEntries(
      Object.entries(x).map(([prop, value]) => [prop, token(value)]),
    ),
  }
  let patch: Bundle = {
    entity: { eid: row.entity.eid },
    exception: history
      ? {
        ...Object.fromEntries(Object.keys(x).map((prop) => [prop, null])),
        type,
        value,
      }
      : null,
    $was: was,
  }
  if (history && stack && !body.includes(stack)) {
    patch.content = { body: body ? `${body}\n\n${stack}` : stack }
    patch.$was = { ...was, content: { body: token(body || null) } }
  }
  if (!history && (commit || row.session || row.secret)) {
    patch.failed = {
      at: x.at ?? created.at,
      reason: value,
    }
  }
  let error = Object.assign(new Error(value), {
    name: type,
    stack: stack || '',
  })
  let records = history ? [] : capture(error, {
    sink: () => {},
    eid: row.entity.eid,
    at: str(x.at ?? diagnostic.at ?? created.at),
    actor: {
      ...created.by ? { by: str(created.by) } : {},
      ...created.via ? { via: str(created.via) } : {},
    },
    version: typeof x.version == 'number' ? x.version : undefined,
    commit: commit ? row.entity.eid : undefined,
    during: {
      entity: row.entity.eid,
      kind: row.session ? 'session' : commit ? 'commit' : 'exception',
      ...row.session ? { session: row.entity.eid } : {},
    },
    tags: {
      migration: 'exception/1',
      ...x.request ? { request: x.request } : {},
      ...x.request_id ? { request_id: x.request_id } : {},
      ...diagnostic.phase ? { phase: diagnostic.phase } : {},
      ...diagnostic.pid ? { pid: diagnostic.pid } : {},
      ...diagnostic.session ? { session: diagnostic.session } : {},
    },
  })
  if (records.length) {
    for (let name of ['archived', 'notified', 'resolved']) {
      if (row[name]) records[0][name] = row[name]
    }
  }
  return { history, records, patch }
}
