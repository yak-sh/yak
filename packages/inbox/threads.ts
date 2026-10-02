import { aboutOf, addressed, type Reader, type Row } from './reader.ts'

export const lanes = ['Needs you', 'Replies', 'Updates', 'Recent'] as const
export type Lane = typeof lanes[number]
export type Direction = 'said' | 'received'
export type Search = {
  text?: string
  direction?: Direction
  all?: boolean
  lane?: Lane
}
export type Thread<R extends Row = Row> = {
  eid: string
  row: R
  latest: R
  messages: R[]
  lane: Lane
  reason: string
  blocking: boolean
  at: string
  unread: boolean
}

let str = (v: unknown): string => String(v ?? '')
let newest = (...times: unknown[]) => times.map(str).sort().at(-1) ?? ''
let closed = (r: Row) => !!(r.comps.completed || r.comps.cancelled)
let states = [
  'completed',
  'cancelled',
  'failed',
  'blocked',
  'broken',
  'resolved',
  'regressed',
  'decided',
  'exit',
]
export let stateAt = (r: Row): string =>
  newest(r.comps.blocked?.since, ...states.map((s) => r.comps[s]?.at))
export let messageAt = (r: Row): string =>
  newest(r.comps.created?.at, r.comps.mail?.at, r.comps.commit?.at)
/** Reading, archiving, delivery and arbitrary edits are not new activity. */
export let activityAt = (r: Row): string =>
  newest(messageAt(r), stateAt(r), r.comps.bug?.last, r.comps.bug?.first)
export let threadOf = (
  r: Row,
  who?: Reader,
  byId?: Map<string, Row>,
  seen = new Set<string>(),
): string => {
  let reply = str(r.comps.mail?.reply_to)
  if (reply && byId?.has(reply) && !seen.has(r.eid)) {
    seen.add(r.eid)
    return threadOf(byId.get(reply)!, who, byId, seen)
  }
  let target = r.comps.mail && who &&
      [who.actor, who.session, who.scope].includes(str(r.comps.mail.target))
    ? ''
    : aboutOf(r)
  return target || str(r.comps.entry?.session ?? r.comps.commit?.target) ||
    r.eid
}

export let saidBy = (who: Reader, r: Row, byId?: Map<string, Row>): boolean => {
  if (r.comps.mail) return !!who.addrs?.has(str(r.comps.mail.from))
  if (r.comps.entry) {
    return !!who.actor &&
      (r.comps.created?.by == who.actor ||
        byId?.get(str(r.comps.entry.session))?.comps.session?.actor ==
          who.actor) &&
      !!r.comps.content &&
      ![
        'output',
        'prompt',
        'notice',
        'reasoning',
        'result',
        'exception',
        'refusal',
        'ask',
        'call',
      ].some((c) => !!r.comps[c])
  }
  return !!who.actor && r.comps.created?.by == who.actor
}

let words = (r: Row) =>
  [
    r.comps.doc?.title,
    r.comps.doc?.body,
    r.comps.content?.body,
    r.comps.bug?.title,
    r.comps.decision?.question,
  ].map(str).join('\n').toLocaleLowerCase()
/** Follow reply ancestry, not every branch on an entity the person spoke on. */
let answers = (who: Reader, r: Row, byId: Map<string, Row>): boolean => {
  let seen = new Set<string>([r.eid])
  let ref = str(r.comps.comment?.reply_to ?? r.comps.mail?.reply_to)
  while (ref && !seen.has(ref)) {
    seen.add(ref)
    let parent = byId.get(ref)
    if (!parent || threadOf(parent, who, byId) != threadOf(r, who, byId)) {
      return false
    }
    if (saidBy(who, parent, byId)) return true
    ref = str(parent.comps.comment?.reply_to ?? parent.comps.mail?.reply_to)
  }
  return false
}

/** One row per thread, with lane precedence and blocking work first. */
export let threads = <R extends Row>(
  all: R[],
  who: Reader,
  search: Search = {},
): Thread<R>[] => {
  let records = new Map(all.map((r) => [r.eid, r]))
  let byId = new Map(records)
  for (let r of records.values()) {
    for (let id of [r.comps.mail?.message_id, r.comps.notified?.message_id]) {
      if (id) byId.set(str(id), r)
    }
  }
  let groups = new Map<string, R[]>()
  for (let r of records.values()) {
    if (r.comps.edge || r.comps.subscription) continue
    let eid = threadOf(r, who, byId)
    let group = groups.get(eid) ?? []
    group.push(r)
    groups.set(eid, group)
  }
  let to = addressed(who)
  let out: Thread<R>[] = []
  for (let [eid, group] of groups) {
    if (who.muting?.has(eid)) continue
    let root = byId.get(eid) ?? group[0]
    let messages = group.filter((r) =>
      r.comps.comment || r.comps.mail ||
      (r.comps.entry &&
        (saidBy(who, r, byId) || (r.comps.output && !r.comps.reasoning)))
    )
      .sort((a, b) =>
        messageAt(a).localeCompare(messageAt(b)) || a.eid.localeCompare(b.eid)
      )
    let own = messages.filter((r) => saidBy(who, r, byId))
    let started = saidBy(who, root) ||
      (!!who.actor && root.comps.session?.actor == who.actor)
    let watched = !!who.watching?.has(eid) || !!who.claims?.has(eid)
    let received = messages.filter((r) => !saidBy(who, r, byId))
    let reply = received.filter((r) =>
      answers(who, r, byId) || to(r) ||
      (!!r.comps.entry?.session && started && !!r.comps.output)
    )
    let direct = group.some(to) ||
      (root.comps.mail && root.comps.deliver?.to == who.actor)
    let assigned = !!who.actor && root.comps.filed?.assignee == who.actor
    let alert = !!root.comps.bug && !root.comps.resolved &&
      (who.operator == true) &&
      (!who.scope || !root.comps.bug.app || root.comps.bug.app == who.scope ||
        watched || assigned)
    let decision = !!root.comps.decision && !!who.actor &&
      who.operator == true &&
      (assigned ||
        (!root.comps.filed?.assignee &&
          (!who.scope || root.comps.filed?.project == who.scope || watched)))
    let need = !!(!closed(root) && !root.comps.decided &&
      ((assigned && !!root.comps.task) || decision || alert ||
        (direct && group.some((r) => !!r.comps.knock))))
    let changes = group.filter((r) =>
      r.comps.commit ||
      (r.comps.entry && (r.comps.exception || r.comps.refusal || r.comps.stop))
    )
    let update = (started || watched) && (!!stateAt(root) || !!changes.length)
    let visible = [
      'doc',
      'task',
      'session',
      'design',
      'bug',
      'project',
      'mail',
      'decision',
    ].some((name) => !!root.comps[name])
    let recent = (started && visible) || !!own.length ||
      (!!who.actor &&
        [root.comps.opened?.by, root.comps.decided?.by].includes(who.actor))
    if (!need && !reply.length && !update && !recent && !direct) continue
    let activity = need
      ? group
      : [root, ...own, ...reply, ...(started || watched ? changes : [])]
    let at = newest(...activity.map(activityAt))
    let archived = root.comps.archived
    if (!search.all && archived && (!archived.at || at <= str(archived.at))) {
      continue
    }
    let text = (search.text ?? '').trim().toLocaleLowerCase()
    // A decision's question and answer can have different authors. Treat the
    // answer as its own words rather than attributing the whole root to them.
    let searchable = group.flatMap((r) => {
      let mine = r == root ? started : saidBy(who, r, byId)
      let includes = (said: boolean) =>
        !search.direction || said == (search.direction == 'said')
      return [
        ...(includes(mine) ? [words(r)] : []),
        ...(r.comps.decided && includes(r.comps.decided.by == who.actor)
          ? [str(r.comps.decided.choice).toLocaleLowerCase()]
          : []),
      ]
    })
    if (
      (search.direction || text) &&
      !searchable.some((words) => !text || words.includes(text))
    ) continue
    let blocking = need &&
      all.some((edge) =>
        edge.comps.requires && edge.comps.edge?.to == eid &&
        !!byId.get(str(edge.comps.edge.from))?.comps.task &&
        !closed(byId.get(str(edge.comps.edge.from))!)
      )
    let lane: Lane = need
      ? 'Needs you'
      : reply.length || direct
      ? 'Replies'
      : update
      ? 'Updates'
      : 'Recent'
    let latest = changes.concat(messages).sort((a, b) =>
      activityAt(a).localeCompare(activityAt(b))
    ).at(-1) ?? root
    let attention = newest(
      root.comps.opened?.at,
      root.comps.decided?.at,
      started ? messageAt(root) : '',
      ...own.map(messageAt),
    )
    if (search.lane && lane != search.lane) {
      continue
    }
    out.push({
      eid,
      row: root,
      latest,
      messages,
      lane,
      reason: need
        ? alert ? 'alert' : root.comps.decision ? 'decision' : 'assigned to you'
        : lane == 'Replies'
        ? 'reply to your words'
        : lane == 'Updates'
        ? 'work changed state'
        : 'had your attention',
      blocking,
      at,
      unread: at > attention,
    })
  }
  return out.sort((a, b) =>
    Number(b.blocking) - Number(a.blocking) || b.at.localeCompare(a.at) ||
    a.eid.localeCompare(b.eid)
  )
}

/** Atomic replacement gives repeated attention marks a fresh server timestamp. */
export let attention = (eid: string, mark: 'archived' | 'opened') => [
  { entity: { eid }, [mark]: null },
  { entity: { eid }, [mark]: {} },
]
