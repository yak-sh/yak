// A person's saved keys (apps.ts `/storage`, public/storage.js): the
// localStorage of a walled page, a sandboxed app's or a draft's preview.
// GET them all, or POST `{set, remove, clear}` to change them. The person is
// the kernel's vouch and nobody else's, so one person never reads another's.
// Held to a megabyte of text each — a page's preferences and its drafts, not
// a second database beside the graph. The host supplies its own memory; this
// door is the same for either graph host.
import { json, readBody } from '@yaks/api'
import { vouchOf } from './app-authority.ts'

type Read = (key: string) => string | null
type Write = (key: string, value: string) => void

// The most one person keeps in one app's storage, in characters of JSON.
// public/storage.js holds a page to the same ceiling.
let STORED = 1024 * 1024

export let storageDoor = async (
  request: Request,
  read: Read,
  write: Write,
): Promise<Response> => {
  let person = vouchOf(request).person
  if (!person) {
    return json({ error: 'Refused', message: 'nobody to keep it for' }, 401)
  }
  let word = `storage:${person}`
  let held = JSON.parse(read(word) ?? '{}') as Record<string, string>
  if (request.method == 'GET') return Response.json(held)
  let sent = await readBody(request).then(JSON.parse).catch(() => null) as {
    set?: Record<string, unknown>
    remove?: unknown[]
    clear?: boolean
  } | null
  if (!sent || typeof sent != 'object') {
    return json(
      { error: 'Refused', message: '/storage takes a JSON object' },
      400,
    )
  }
  let next: Record<string, string> = sent.clear ? {} : { ...held }
  for (let k of sent.remove ?? []) delete next[String(k)]
  for (let [k, v] of Object.entries(sent.set ?? {})) next[k] = String(v)
  let text = JSON.stringify(next)
  if (text.length > STORED) {
    return json({ error: 'Refused', message: 'storage is full' }, 413)
  }
  write(word, text)
  return Response.json({ ok: true, keys: Object.keys(next).length })
}
