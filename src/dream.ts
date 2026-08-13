// The dream: the fleet's consolidation half of self-healing (T-12800, D-17362).
// Where heal.ts reacts to a break in real time, the dream is sleep — it combs
// a venture's completed sessions while idle and FLAGS the meta a heads-down
// doer can't notice about its own work: a warm path found missing, duplicate
// tickets, a reflex firing across sessions, complexity outgrowing size, an
// owner decision taken. Flag, never fix: the drift becomes a 'consider' task
// or a memory, never an edit in the same pass.
//
// It is a post-commit EFFECT (a species of recallEntry/heal.ts), not a spawned
// desk: a self-armed cadence wake mints a knock to a per-venture `dream`
// entity, dreamComb hooks it, combs each session since the floor cursor with
// ONE complete() call apiece (the cheap batch-fit model, never interactive),
// lands the findings, advances the floor, and re-arms the next wake. No
// session of its own — its run-record is telemetry, its output the graph
// edits. SERVER-ONLY (imports db). The model call is injectable so tests never
// spawn a provider (like recall.ts's recallFn).
import { apply, db, human, snapshot, touch } from './db.ts'
import { type Change, uuid } from './types.ts'
import { dispatch, trace } from './effects.ts'
import { record as telemetry } from './telemetry.ts'
import { delivered, PENDING, toOf } from './deliver.ts'
import { readEntries } from './entries.ts'
import { graphLog } from './entry_log.ts'
import { transcribe } from './log_text.ts'
import { complete } from './complete.ts'
import { memoryChanges, rows } from './client.ts'
import { normalize } from './heal.ts'
import { embed, FLOOR, similar, textOf } from './embed.ts'

type Cast = (changes: Change[]) => void

let DAY = 86_400_000
let iso = (ms: number) => new Date(ms).toISOString()

// The cadence between dreams and the model it wakes on — env-tunable so an
// operator can retune a venture's clock or point tests at the `fake` provider
// without a code edit (the complete.ts / heal.ts FIXER way).
export let CADENCE = Number(Deno.env.get('TASKS_DREAM_CADENCE_MS')) || DAY // 24h
export let DREAM_MODEL = Deno.env.get('TASKS_DREAM_MODEL') || 'gpt-5.6-luna'

// A transcript is bounded by the model's context — a marathon session's whole
// log won't fit, and the tail is where the meta lives (what the doer reached
// for last, what it wrapped with). Take the tail past the cap.
let TAIL = Number(Deno.env.get('TASKS_DREAM_TAIL')) || 48_000

// How many session combs run at once (T-17407 gate 4). A 7-day window is
// dozens of sessions and one complete() apiece run in series is minutes of
// wall clock; bounded so a wide window never fires dozens of provider
// processes at once. Env-tunable, the CADENCE/TAIL way.
export let CONCURRENCY = Number(Deno.env.get('TASKS_DREAM_CONCURRENCY')) || 8

// The charge (T-12800), asked for as JSON Lines so parsing stays tolerant: one
// object per line, unparseable lines skipped. The five kinds are the doctrine's
// four drifts plus the decision capture.
export let DREAM_SYSTEM =
  `You are the dream: the consolidation pass over ONE finished work session's
transcript. Comb it the way a human reviewer would and FLAG the meta the doer,
heads-down, could not notice about its own run. Flag, never fix.

Emit JSON Lines — ONE compact JSON object per line, nothing else (no prose, no
code fences). If nothing rises to a flag, emit NOTHING (empty output). Be
sparing: a handful of high-signal flags, never a summary of the session.

Each object:
  {"kind":"gap|entropy|reflex|complexity|decision","title":"...","body":"...",
   "priority":2|3,"decided":"YYYY-MM-DD"?}

kind:
- gap        a warm path the doer reached for and found MISSING (a tool/verb
             that should exist). title = the missing capability.
- entropy    duplicate tickets, loose tasks that should collapse into a
             milestone, correction-comment clutter, stale/redundant memories.
- reflex     the SAME miss likely to recur — a systems bug, not a one-off
             (escalating a decidable question, verifying via a lossy proxy).
- complexity the system growing super-linearly — flag the shape.
- decision   an OWNER decision TAKEN in this session. Set "decided" to the date
             it was taken (else omit). body = the decision, in the owner's terms.

priority: 2 for something worth doing soon, 3 otherwise. Default 3.
title is a short imperative; body is a few lines with the pointer (file:line, an
id) to ground truth, never a restatement of it.`

// The dream cursor, read from its own table.
let dreamOf = (eid: string) =>
  db.prepare('select scope, floor from dream where eid = ?').get(eid) as
    | { scope: string | null; floor: string | null }
    | undefined

// The venture's checkout, so the model runs where its code lives. Absent is
// fine — complete() falls back to the server's cwd.
let pathOf = (project: string): string | undefined =>
  (db.prepare('select path from repo where eid = ?').get(project) as
    | { path?: string }
    | undefined)?.path ?? undefined

// A venture's sessions are the ones acting FOR it (session.actor = project) —
// the same link `belongs`/`previously` use — NOT a cwd match: a managed spawn
// runs in a worktree, never the repo root, so cwd scoping would miss most of
// them. Finished in (floor, ceil], oldest first.
let sessionsSince = (project: string, floor: string, ceil: string) =>
  db.prepare(
    `select s.eid, s.id from session s
     where s.actor = ? and s.finished_at is not null
       and s.finished_at > ? and s.finished_at <= ?
     order by s.finished_at`,
  ).all(project, floor, ceil) as { eid: string; id: string | null }[]

// The created.at of the 20th-most-recent entry across the venture's sessions,
// or undefined below 20 — the entries half of the max(20 entries, 7 days)
// clamp below.
let twentiethAt = (project: string): string | undefined =>
  (db.prepare(
    `select c.at as at from entry e
       join session s on s.eid = e.session
       join created c on c.eid = e.eid
      where s.actor = ? order by c.at desc limit 1 offset 19`,
  ).get(project) as { at?: string } | undefined)?.at ?? undefined

// One calendar day forward, held back so the re-read window is never smaller
// than max(20 entries, 7 days): a burst or a too-frequent dream cannot starve
// the window a recurring reflex needs to be noticed across sessions. Both
// clamps only pull the floor BACK (earlier), toward more re-read.
export let advance = (
  project: string,
  floor: string,
  now: number,
  twenty = twentiethAt(project),
): string => {
  let next = iso(Date.parse(floor) + DAY)
  let seven = iso(now - 7 * DAY)
  if (seven < next) next = seven
  if (twenty && twenty < next) next = twenty
  return next
}

// A session's transcript as the reviewer text — provider-neutral entry rows
// rendered to lines, tail-capped. The #-tagged /meta memos ride as ordinary
// entries, no special query.
let transcriptOf = (session: string): string => {
  let text = transcribe(graphLog(readEntries(db, session)).entries).join('\n')
  return text.length > TAIL ? text.slice(-TAIL) : text
}

let KINDS = new Set(['gap', 'entropy', 'reflex', 'complexity', 'decision'])
export type Finding = {
  kind: string
  title: string
  body: string
  priority: number
  decided?: string
}

// Parse the model's reply as JSON Lines, tolerantly: a line that isn't a JSON
// object, names no known kind, or carries no title is skipped — never an error.
export let parseFindings = (reply: string): Finding[] => {
  let out: Finding[] = []
  for (let line of reply.split('\n')) {
    let s = line.trim()
    if (s[0] != '{') continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(s)
    } catch {
      continue
    }
    let kind = String(o.kind ?? '')
    let title = String(o.title ?? '').trim()
    if (!KINDS.has(kind) || !title) continue
    out.push({
      kind,
      title,
      body: String(o.body ?? '').trim(),
      priority: Number(o.priority) == 2 ? 2 : 3,
      ...(o.decided ? { decided: String(o.decided) } : {}),
    })
  }
  return out
}

// A drift finding as a 'consider' task, built like heal.ts fileBug: doc + task
// + an `about` edge to the source session (provenance — the run it was dreamed
// from). NEVER edits the drift away.
export let considerChanges = (
  f: Finding,
  project: string | null,
  source: string,
): Change[] => {
  let eid = uuid()
  return [
    {
      eid,
      name: 'doc',
      comp: { title: `consider: ${f.title}`.slice(0, 100), body: f.body },
    },
    {
      eid,
      name: 'task',
      comp: { status: 'open', priority: f.priority, project },
    },
    { eid, name: 'dependency', comp: { type: 'about', child: source } },
  ]
}

let oops = (comp: string, e: unknown) =>
  telemetry(db, {
    source: 'srv',
    name: `effect:${comp}`,
    ok: false,
    error: String(e),
  })

// Land a batch the heal.ts way: apply, cast so caches update, dispatch so
// downstream effects fire and a throwing one is telemetry, never a break.
let land = (changes: Change[], cast: Cast, writer?: string | null) => {
  let t = trace()
  let out = apply(db, changes, t, writer)
  cast(out)
  dispatch(out, t, oops)
}

// The dedup key of a finding (T-17407 gate 1): its kind + normalized title,
// the heal.ts faultKey pattern. The 7-day re-comb window guarantees a recurring
// drift is re-surfaced daily, so two runs' findings of the same shape must
// collapse. Title is a finding's stable identity (a short imperative); body
// varies more, so it stays out of the key. normalize() is heal.ts's — uuids,
// ids, dates, paths, numbers all fold to one placeholder.
export let findingKey = (f: Finding) => `${f.kind}:${normalize(f.title)}`

// An artifact this dream already filed for a key, and the status of the task it
// became (null for a memory). The stored key makes dedup a lookup, never a scan
// (heal.ts openBug). One row per key.
let filed = (key: string) =>
  db.prepare(
    `select fd.eid as eid, fd.hits as hits, t.status as status
       from finding fd left join task t on t.eid = fd.eid
      where fd.key = ? limit 1`,
  ).get(key) as
    | { eid: string; hits: number | null; status: string | null }
    | undefined

// Does a finding point at work already CLOSED (T-17407 gate 2)? A finding whose
// title/body names a done or cancelled task is restating resolved drift — the
// thing it asks for is handled — so it must not become a new task. Ids are
// human (T-17354); num→status. Checks graph state, never the session narrative
// (the miss was T-17402 self-declaring "tracked as T-17354" — done — yet filed).
let CLOSED = new Set(['done', 'cancelled'])
export let namesResolved = (f: Finding): boolean => {
  let ids = (f.title + ' ' + f.body).match(/\bT-\d+\b/g)
  if (!ids) return false
  for (let id of new Set(ids)) {
    let row = db.prepare(
      `select t.status as status from task t join entity e on e.eid = t.eid
        where e.num = ?`,
    ).get(Number(id.slice(2))) as { status: string } | undefined
    if (row && CLOSED.has(row.status)) return true
  }
  return false
}

// The semantic gate (T-17422): a finding whose MEANING already lives in a
// memory — reworded, so the key-dedup (kind + normalized TITLE) slid past it —
// is a re-notice, not news. Rank the finding's vector against stored vectors at
// the dupe-hint floor (embed.ts FLOOR: near-identical, the same bar the
// creation-time dupe hint uses) and keep the nearest hit that is a MEMORY.
// Pure over a query vector like recall.ts's recallFrom, so a test drives it with
// precomputed vectors and never loads the embedder. NET is wide because
// memories are sparse among all doc-bearing entities (recall.ts's reasoning) — a
// few near tasks must not crowd out the memory the finding restates.
let NET = 60
export let nearestMemory = (
  q: Float32Array,
  floor = FLOOR,
): string | undefined => {
  for (let h of similar(db, q, NET, floor)) {
    if (db.prepare('select 1 from memory where eid = ?').get(h.eid)) {
      return h.eid
    }
  }
  return undefined
}

// Route by kind (T-17407 gate 3): a decision or a reflex/lesson becomes a
// MEMORY (a decision dated when taken; a reflex a venture-scoped lesson), not a
// vague open "consider" task. Only actionable, unaddressed drift — a missing
// warm path, ticket entropy, super-linear complexity — becomes a task.
let MEMORY_KINDS = new Set(['decision', 'reflex'])

type Fate = 'filed' | 'recur' | 'reinforce' | 'skip'

// File ONE finding, or don't — the four gates in one place. Dedup against what
// this dream already filed (an OPEN artifact recurs and is hit-counted, a
// resolved or already-captured one is skipped), skip a finding that points at
// closed work, reinforce (never re-file) a finding whose MEANING already lives
// in a memory, then route by kind and mark the artifact with its key. Returns
// what happened, for the run tally. Called in session order so two sessions'
// same-shape findings in one run also collapse (each land re-reads). Async for
// the one embed the semantic gate needs; embedFn is injected so tests drive it.
let fileFinding = async (
  f: Finding,
  project: string | null,
  s: { eid: string; id: string | null },
  ceil: string,
  cast: Cast,
  embedFn: typeof embed,
): Promise<Fate> => {
  let key = findingKey(f)
  let seen = filed(key)
  if (seen) {
    // Already filed this shape. An OPEN/wip task recurs — count it, a stronger
    // signal it is worth doing. Anything else (a resolved task, a captured
    // memory) is handled — skip without re-filing.
    if (seen.status == 'open' || seen.status == 'wip') {
      land([{
        eid: seen.eid,
        name: 'finding',
        comp: { hits: (seen.hits ?? 1) + 1, last: iso(Date.now()) },
      }], cast)
      return 'recur'
    }
    return 'skip'
  }
  if (namesResolved(f)) return 'skip'
  // Semantic gate: a finding near an existing memory restates a documented
  // lesson in fresh words — reinforce that memory (a re-notice IS a re-
  // confirmation) and don't file a redundant twin. A box with no embedder
  // returns null and the gate degrades to silence, like every similar door.
  // touch() is the one writer of recall stats and returns cast-able changes —
  // the apply() wire refuses them, so cast, never land.
  let vec = await embedFn(textOf(f.title, f.body))
  if (vec) {
    let mem = nearestMemory(vec)
    if (mem) {
      cast(touch(db, [mem], true))
      return 'reinforce'
    }
  }
  let mark = (eid: string): Change => ({
    eid,
    name: 'finding',
    comp: { key, hits: 1, last: iso(Date.now()) },
  })
  if (MEMORY_KINDS.has(f.kind)) {
    // A decision/reflex is a memory, attributed to the session it rose from —
    // its `id` (not eid: sessionFor keys on session.id, so an eid would mint a
    // spurious session). No id, no attribution to make — skip.
    if (!s.id) return 'skip'
    let made = memoryChanges(rows(snapshot(db)), {
      title: f.title,
      body: f.body,
      session: s.id,
      ...(f.kind == 'decision'
        ? { decided: f.decided ?? ceil.slice(0, 10) }
        : { scope: project ?? undefined }),
    })
    land([...made.changes, mark(made.eid)], cast, s.id)
  } else {
    let cs = considerChanges(f, project, s.eid) // all three share one eid
    land([...cs, mark(cs[0].eid)], cast)
  }
  return 'filed'
}

// Run `fn` over items with at most `n` in flight (T-17407 gate 4). Results
// match input order; a wide window batches instead of firing one provider
// process at a time in series.
let pool = async <T, R>(
  items: T[],
  n: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> => {
  let out: R[] = new Array(items.length)
  let i = 0
  let worker = async () => {
    while (i < items.length) {
      let j = i++
      out[j] = await fn(items[j])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

// Comb the window: complete() each session in a bounded batch, then file its
// findings in session order (dedup, gate, route), and advance the floor.
// Returns the run tally for telemetry.
let comb = async (
  to: string,
  d: { scope: string | null; floor: string | null },
  cast: Cast,
  completeFn: typeof complete,
  embedFn: typeof embed,
) => {
  let project = d.scope
  let base = { combed: 0, filed: 0, recurred: 0, reinforced: 0, skipped: 0 }
  if (!project) return { ...base, floor: d.floor ?? '' }
  let repo = pathOf(project)
  let now = Date.now()
  let ceil = iso(now)
  let floor = d.floor ?? iso(now - 7 * DAY)
  let sessions = sessionsSince(project, floor, ceil)
  // Gate 4: the model calls run concurrently (bounded), the graph writes stay
  // sequential below so same-shape findings across sessions dedup in one run.
  let replies = await pool(sessions, CONCURRENCY, async (s) => {
    let text = transcriptOf(s.eid)
    if (!text.trim()) return { s, combed: false, reply: null as string | null }
    let reply = await completeFn(DREAM_MODEL, DREAM_SYSTEM, text, {
      effort: 'low',
      deadline: 120_000,
      ...(repo ? { cwd: repo } : {}),
    })
    return { s, combed: true, reply }
  })
  let tally = { ...base }
  for (let { s, combed, reply } of replies) {
    if (combed) tally.combed++
    if (!reply) continue // nothing found, or no model — never an error
    for (let f of parseFindings(reply)) {
      let fate = await fileFinding(f, project, s, ceil, cast, embedFn)
      if (fate == 'filed') tally.filed++
      else if (fate == 'recur') tally.recurred++
      else if (fate == 'reinforce') tally.reinforced++
      else tally.skipped++
    }
  }
  let next = advance(project, floor, now)
  land([{ eid: to, name: 'dream', comp: { floor: next } }], cast)
  return { ...tally, floor: next }
}

// Re-arm the next dream: an UNTARGETED cadence wake with deliver.to = the
// dream entity. Untargeted so replaceWakes collapses a duplicate to the same
// recipient (one cadence clock per dream, db.ts); the dispatch fires waking()
// so the server's one timer picks it up now, not only at next boot.
let rearm = (to: string, cast: Cast) => {
  let w = uuid()
  let t = trace()
  let out = apply(db, [
    { eid: w, name: 'wake', comp: { at: iso(Date.now() + CADENCE) } },
    { eid: w, name: 'deliver', comp: { to } },
  ], t)
  cast(out)
  dispatch(out, t, oops)
}

// The created(knock) handler. EVERY knock reaches it, so it abstains unless the
// recipient is a dream — the same shape as the knock ladder's dream guard. It
// stamps delivered up front (the wake did its job; a crash mid-comb re-combs
// the window next cadence rather than storming the boot sweep), combs, and
// ALWAYS re-arms.
export let dreamComb =
  (cast: Cast, completeFn = complete, embedFn = embed) =>
  async (
    eid: string,
  ) => {
    let to = toOf(eid)
    let d = dreamOf(to)
    if (!d) return // not a dream knock — abstain
    delivered(eid, 'dream comb', cast)
    let at = Date.now()
    try {
      let r = await comb(to, d, cast, completeFn, embedFn)
      telemetry(db, {
        source: 'srv',
        name: 'dream',
        ok: true,
        ms: Date.now() - at,
        detail: `${human(db, to)}: combed ${r.combed}, filed ${r.filed}, ` +
          `recurred ${r.recurred}, reinforced ${r.reinforced}, ` +
          `skipped ${r.skipped}, floor→${r.floor.slice(0, 10)}`,
      })
    } catch (e) {
      telemetry(db, {
        source: 'srv',
        name: 'dream',
        ok: false,
        ms: Date.now() - at,
        error: String(e),
      })
    } finally {
      rearm(to, cast)
    }
  }

// The boot sweep predicate: a pending knock aimed at a dream — one whose comb
// never ran (a crash in the post-commit gap). Re-driven through dreamComb like
// any effect's outbox, so a dream that missed its beat while the server was
// down combs on startup.
export let DREAM_PENDING =
  `exists (select 1 from deliver dv join dream dr on dr.eid = dv."to"
     where dv.eid = knock.eid)
   and ${PENDING('knock')}`

// Seed a dream that has no pending cadence wake — the boot reconcile (a fresh
// dream, or one whose wake was consumed while the server was down) and the
// `task dream` verb's first arm. One near-term wake; replaceWakes keeps it from
// stacking. Returns the changes so the caller lands them on its own clock.
export let seedWake = (to: string, at = iso(Date.now() + 1000)): Change[] => {
  // wake is UNaliased on purpose: PENDING('wake') names `wake.eid`, which an
  // alias would not resolve (the boot-crash that shipped once).
  let has = db.prepare(
    `select 1 from wake join deliver dv on dv.eid = wake.eid
     where dv."to" = ? and ${PENDING('wake')}`,
  ).get(to)
  if (has) return []
  let w = uuid()
  return [
    { eid: w, name: 'wake', comp: { at } },
    { eid: w, name: 'deliver', comp: { to } },
  ]
}

// The dreams with no pending wake — the boot seed's fetch (server.ts). A dream
// self-arms by re-minting at each run's end, so this only catches the gaps: a
// brand-new dream, or one whose wake fired-and-consumed during downtime.
export let unwoken = (): string[] =>
  (db.prepare(
    `select dr.eid from dream dr
     where not exists (select 1 from wake join deliver dv on dv.eid = wake.eid
       where dv."to" = dr.eid and ${PENDING('wake')})`,
  ).all() as { eid: string }[]).map((r) => r.eid)
