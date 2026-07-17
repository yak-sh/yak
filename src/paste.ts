// Pasted content → the right entity. Matchers in specificity order: a bare
// eid or T-123 id lands a card on the EXISTING entity; a URL mints a web
// entity (rendered as the framed page); JSON minting comps, or carrying a
// known eid, or shaped like a task, does the obvious; anything else becomes
// a task — first line title, rest body.
import { cache, config, uuid } from './live.ts'
import { type Change } from './types.ts'

// What a paste resolves to: comps to mint (none for existing entities),
// the entity a card should target, and optionally how to show it.
export type Pasted = {
  changes: Change[]
  target: string
  view?: string
  w?: number
}

let byNum = (num: number) =>
  Object.entries(cache.value).find(([, r]) => r.entity?.num == num)?.[0]

let task = (title: string, body = '', status = 'open'): Pasted => {
  let eid = uuid()
  return {
    changes: [
      // kind is stated, not inherited from whichever comp lands first
      { eid, name: 'entity', comp: { kind: 'task' } },
      { eid, name: 'doc', comp: { eid, title, body } },
      { eid, name: 'task', comp: { eid, status } },
    ],
    target: eid,
  }
}

let json = (text: string): Pasted | null => {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o != 'object' || Array.isArray(o)) return null
  if (typeof o.eid == 'string' && cache.value[o.eid]) {
    return { changes: [], target: o.eid }
  }
  let names = ['doc', 'task', 'project', 'web'].filter(
    (n) => o[n] && typeof o[n] == 'object',
  )
  if (names.length) {
    let eid = uuid()
    let kind = names.includes('task') ? 'task' : names[0]
    return {
      changes: [
        { eid, name: 'entity', comp: { kind } },
        ...names.map((n) => ({
          eid,
          name: n,
          comp: { ...(o[n] as object), eid },
        })),
      ],
      target: eid,
    }
  }
  if (typeof o.title == 'string') {
    return task(o.title, String(o.body ?? ''), String(o.status ?? 'open'))
  }
  return null
}

export let pasted = (raw: string): Pasted | null => {
  let text = raw.trim()
  if (!text) return null
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(text)) {
    return cache.value[text] ? { changes: [], target: text } : null
  }
  let m = text.match(/^[A-Za-z]+-(\d+)$/)
  if (m) {
    let eid = byNum(+m[1])
    return eid ? { changes: [], target: eid } : null
  }
  if (/^https?:\/\/\S+$/.test(text)) {
    let eid = uuid()
    // Ask the server to freeze the page (fire-and-forget: the answer comes
    // back over the ws as web.frozen_at + a doc with the page title).
    // Delayed a beat so the mint reaches the server first.
    setTimeout(() => {
      fetch(`http://${config.host}/freeze?eid=${eid}`).catch(() => {})
    }, 300)
    return {
      changes: [{ eid, name: 'web', comp: { eid, url: text } }],
      target: eid,
      view: 'Web',
      w: 480,
    }
  }
  if (/^[{[]/.test(text)) {
    let hit = json(text)
    if (hit) return hit
  }
  let [head, ...rest] = text.split('\n')
  return task(head.slice(0, 80), rest.join('\n').trim())
}
