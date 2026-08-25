// Self-healing, phase 1 (D-17077): the moment an `exception` facet lands on
// any entity — our code/process hit something UNEXPECTED (a bug) — file ONE
// bug ticket about it, and only one. `exception` is the trigger, not `error`:
// `error` is a known/expected failure state, `exception` is a break (a thrown
// exception, exit 127, a died process, a violated invariant). Dedup by a
// stable KEY (the broken entity's kind + a normalized message + the stack
// head) is what makes it storm-proof: a flapping runner breaking every 300ms
// annotates one open ticket instead of minting thousands. No agent spawn here
// — that is phase 2; this half only has to prove it can't storm.
//
// SERVER-ONLY (imports db). The created() handler fires live off every break
// stamp (deliver.ts excepted() dispatches it), and the boot sweep re-drives
// every exception that has no bug filed yet — so an effect lost to a crash
// between the stamp and here heals at the next boot. Both paths run the SAME
// handler, and the handler re-reads the graph, so it is idempotent: dedup and
// the tri-state recovery check hold whoever calls it.
import { apply, db, human, readComp } from './db.ts'
import { type Change, kindOf, sessionActive } from './types.ts'
import { spawnChanges } from './client.ts'
import { rowsFor } from './graph_query.ts'
import { dispatch, trace } from './effects.ts'
import { record as telemetry } from './telemetry.ts'

type Cast = (changes: Change[]) => void
let now = () => new Date().toISOString()

// The eid→id storage seam (D-18866): component tables key by the owner int id
// and store refs as int ids; this module speaks EIDs. OWNED matches a row by
// owner eid, idOf resolves a ref filter's eid operand, refEid projects a stored
// ref id back to its eid on read. Sibling joins move to the int owner key.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// The volatile tokens a storm varies while the fault stays the same: uuids,
// human ids (T-3, S-45), iso timestamps, absolute paths, :line:col, hex blobs,
// and bare numbers all collapse to one placeholder. What is left is the shape
// of the fault.
export let normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      '#',
    )
    .replace(/\b[a-z]-\d+\b/g, '#') // T-3, S-45 (already lowercased)
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '#') // iso timestamps
    .replace(/\/[^\s:]+/g, '#') // absolute paths
    .replace(/:\d+(:\d+)?/g, '#') // :line:col
    .replace(/\b[0-9a-f]{6,}\b/g, '#') // hex blobs / short hashes
    .replace(/\b\d+\b/g, '#') // bare numbers
    .replace(/#+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()

// The head of a stack — the first frame that actually names our code, so two
// breaks at the same site key together even when their messages differ, and
// the same fault raised from two ids does not split. Empty when absent (a
// died process carries no stack); then the key rests on kind + message alone.
let stackHead = (stack?: string | null) => {
  if (!stack) return ''
  let line = stack.split('\n').map((l) => l.trim())
    .find((l) => l.startsWith('at ')) ?? stack.split('\n')[0] ?? ''
  return normalize(line)
}

// The dedup key: kind + normalized message + normalized stack head. Exported
// for phase 2's spawn, which keys its concurrency cap and per-key cooldown off
// the same string.
export let faultKey = (kind: string, message: string, stack?: string | null) =>
  `${kind}:${normalize(message)}${
    stackHead(stack) ? `@${stackHead(stack)}` : ''
  }`

// A CLI grammar refusal's fault message: the STABLE identity of the fault —
// the error and the command HEAD alone, never the whole invocation. The full
// command line (a `--body` payload, a design brief, any prose) varies per call,
// so folding it into the message gives every occurrence a distinct faultKey and
// defeats the dedup below — one bug ticket per comment instead of one per
// grammar fault, which is exactly the storm this system exists to prevent
// (T-18396). Subject-first syntax needs its second word too: `task T-3 edge`
// truncated to `task T-3` makes a valid show command look broken (T-20966).
// Human ids normalize away in faultKey, so different subjects still dedup.
let commandHead = (args: string[]) =>
  /^[A-Za-z]+-\d+$/.test(args[0] ?? '') ? args.slice(0, 2) : args.slice(0, 1)

export let cliFault = (error: string, args: string[]) =>
  `CLI usage failure: ${error}\nCommand: task ${commandHead(args).join(' ')}`
    .trimEnd()

// The actionability predicate — ONE tunable function, kept tiny on purpose
// (M-17062: a heavy allowlist is how a gate becomes a straitjacket). Known
// transient classes clear on their own, so filing a ticket is noise. Add a
// matcher to teach it a new transient; nothing here is load-bearing shape.
let transient = [
  /timed? ?out|timeout/i,
  /temporarily unavailable|try again|rate limit/i,
  /econnreset|econnrefused|socket hang up|network/i,
]
export let actionable = (_kind: string, message: string) =>
  !transient.some((re) => re.test(message))

// Read one entity's components as a name→row map, so kindOf and the project
// derivation see the whole entity the way every renderer does.
let has = (eid: string): Record<string, Record<string, unknown>> => {
  let out: Record<string, Record<string, unknown>> = {}
  for (
    let name of [
      'doc',
      'task',
      'project',
      'session',
      'role',
      'mail',
      'knock',
      'wake',
      'web',
      'entry',
      'comment',
    ]
  ) {
    let row = readComp(db, eid, name) as Record<string, unknown> | undefined
    if (row) out[name] = row
  }
  return out
}

// The home project (P-19) as a fallback owner, resolved by its number so the
// filer does not carry a baked eid — and only if num 19 is really a PROJECT
// (the join), never whatever else happens to wear that number. Undefined in a
// graph with no such project (a bare test db); then the bug files with no
// project, which is legal.
let home = (): string | undefined =>
  (db.prepare(
    `select e.eid as eid from project p
     join entity e on e.id = p.entity where e.num = 19`,
  ).get() as { eid: string } | undefined)?.eid

// Where the bug belongs: the broken entity's own project, else the project of
// the session's requested task, else the home project. "venture/actor" reduces
// to a project reference — an owner the ticket lands in front of.
let projectFor = (comps: Record<string, Record<string, unknown>>) => {
  let p = comps.task?.project as string | undefined
  if (p) return p
  let req = comps.session?.requested_task as string | undefined
  if (req) {
    let t = db.prepare(
      `select ${refEid('project')} as project from task where ${OWNED}`,
    ).get(req) as
      | { project?: string }
      | undefined
    if (t?.project) return t.project
  }
  return home()
}

// Severity → priority: a fault that reads fatal (a missing binary, a non-zero
// exit, "cannot"/"failed to") jumps the queue; the rest file at the ordinary
// bug priority. Lower sorts first, so severe is the smaller number.
let severity = (message: string) =>
  /exit (?!0\b)\d|not found|127|cannot |failed to |unable to /i.test(message)
    ? 1
    : 2

// The recurrence footer, refreshed in place: one line, never N. On each
// recurrence the count and last-seen advance; stripping the old footer before
// re-appending keeps the body bounded through a storm.
let MARK = '\n\n— ↻ '
let footer = (body: string, count: number, at: string) => {
  let i = body.indexOf(MARK)
  let base = i < 0 ? body : body.slice(0, i)
  return `${base}${MARK}recurred ${count}× · last seen ${at}`
}

// The open bug already carrying this key, if any — the query the stored key
// buys, so dedup is a lookup and never a scan.
let openBug = (key: string) =>
  db.prepare(
    `select o.eid as eid, b.hits as hits, d.body as body
     from bug b
     join entity o on o.id = b.entity
     join task t on t.entity = b.entity
     join doc d on d.entity = b.entity
     where b.fault = ? and t.status in ('open', 'wip') limit 1`,
  ).get(key) as { eid: string; hits: number; body: string } | undefined

// --- Phase 2: the fixer spawn, behind guardrails (D-17077) -----------------
// A NEW bug ticket also mints ONE managed fixer session aimed at it; the
// existing created(session) effect launches it and it boots into the ticket
// through the injection loop. This is the RISKY half, so every spawn passes
// three graph-checkable gates first — a mute lever, a hard concurrency cap,
// and a per-fault cooldown — and the ticket ALWAYS files whether or not the
// spawn is allowed. A gate that says no is not an error: the break is on the
// board, and the boot sweep (ensureFixer over open, un-spawned bugs) re-drives
// the spawn once the gate clears. There is no in-graph budget/pace signal to
// read here (`operate tokens` is a holdco CLI, not a graph entity), and an
// effect must not shell out — so the hard cap is the cost bound, and budget-
// gating is a follow-up (D-17077 acceptance leaves it to the cap otherwise).

// The fixer's provider/model — a capable coding model, ONE obvious constant.
// Env-overridable so an operator can retune it (or a probe can point it at the
// in-repo `fake` provider) without a code edit, the TASKS_CODEX_RUNNER way.
export let FIXER = {
  provider: Deno.env.get('TASKS_FIXER_PROVIDER') || 'codex',
  model: Deno.env.get('TASKS_FIXER_MODEL') || 'gpt-5.6-sol',
}

// The hard concurrency cap: never more than this many fixers running at once,
// so an error STORM across distinct faults cannot become an agent storm. At
// the cap the ticket files and the boot sweep re-drives when a slot frees.
export let FIXER_CAP = Number(Deno.env.get('TASKS_FIXER_CAP')) || 2

// Per-fault cooldown: once a fixer is spawned for a fault key, that key is
// suppressed for this window — a fixer that closes its bug prematurely while
// the fault keeps firing re-opens a ticket, but does not re-spawn a fixer each
// cycle. 30 minutes: long enough for a fixer to land, short enough to retry.
export let FIXER_COOLDOWN_MS = 30 * 60 * 1000

// Auto-spawn muted for this scope? `nofix` on the bug's project mutes that
// venture; `nofix` on the self-healing home (P-19) is the global switch.
let hasNofix = (eid: string) =>
  !!db.prepare(`select 1 from nofix where ${OWNED}`).get(eid)
let muted = (project?: string): boolean => {
  let h = home()
  if (h && hasNofix(h)) return true // global
  return !!(project && hasNofix(project)) // per-venture
}

// How many fixers are running right now (starting/running/stopping). A failed
// or finished fixer has freed its slot, so it does not count against the cap.
let activeFixers = (): number =>
  (db.prepare(
    `select count(*) as n from fixer f join session s on s.entity = f.entity
     where s.status in (${sessionActive.map(() => '?').join(',')})`,
  ).get(...sessionActive) as { n: number }).n

// Was a fixer already spawned for this fault key within the cooldown window?
// The fault is reached through the fixer's requested_task → bug.fault, so it
// lives in exactly one place (M-14942) and the marker stays presence-only.
let coolingDown = (key: string): boolean =>
  !!db.prepare(
    `select 1 from fixer f
       join session s on s.entity = f.entity
       join bug b on b.entity = s.requested_task
       join created c on c.entity = f.entity
     where b.fault = ? and c.at >= ? limit 1`,
  ).get(key, new Date(Date.now() - FIXER_COOLDOWN_MS).toISOString())

// The one gate: why a fixer won't spawn for this bug, or null to spawn. Pure
// over graph state, so the guardrails are unit-testable without launching an
// agent. Cheapest check first; the reason is telemetry, never an exception.
export let fixerBlocked = (
  project: string | undefined,
  key: string,
): string | null =>
  muted(project)
    ? 'muted'
    : activeFixers() >= FIXER_CAP
    ? `at cap (${FIXER_CAP})`
    : coolingDown(key)
    ? 'cooling down'
    : null

// Has a fixer EVER been spawned for this bug? Idempotency for the boot sweep
// and the live path alike — a bug that already summoned a fixer never summons
// a second, whatever became of the first.
let hasFixer = (bug: string): boolean =>
  !!db.prepare(
    `select 1 from fixer f join session s on s.entity = f.entity
     where s.requested_task = ${idOf} limit 1`,
  ).get(bug)

// Mint one managed fixer session aimed at a bug ticket, if the guardrails
// allow — the boot sweep's created(bug) handler AND fileBug's inline call,
// one door. Idempotent (skips a bug that already has a fixer); re-reads the
// graph so the cap/cooldown/mute hold whoever calls it. A launch failure is
// telemetry, never a thrown effect (effects.ts contract): the bug is already
// on the board. cast() alone would never launch the session (it does not
// dispatch), so this fires created(session) = spawned() itself.
export let ensureFixer =
  (cast: Cast) => (bug: string, _comp?: Record<string, unknown>) => {
    let task = db.prepare(
      `select ${refEid('t.project')} as project, t.status as status,
              b.fault as fault
       from task t join bug b on b.entity = t.entity where t.${OWNED}`,
    ).get(bug) as
      | { project: string | null; status: string; fault: string | null }
      | undefined
    if (!task) return // no bug row (deleted in its own batch)
    if (task.status != 'open' && task.status != 'wip') return // closed ticket
    if (hasFixer(bug)) return // already summoned one
    let why = fixerBlocked(task.project ?? undefined, String(task.fault ?? ''))
    if (why) return // ticket stands; the boot sweep re-drives when it clears
    try {
      // spawnChanges resolves just the bug task (find + its project for the
      // actor); read that one entity, never the whole graph (M-21143).
      let { eid, changes } = spawnChanges(rowsFor(db, [bug]), {
        task: bug,
        provider: FIXER.provider,
        model: FIXER.model,
      })
      let t = trace()
      // The `fixer` mark rides the same batch: what the cap counts, the
      // cooldown reaches, and how the sweep tells spawned from un-spawned.
      let out = apply(db, [...changes, { eid, name: 'fixer', comp: {} }], t)
      cast(out)
      dispatch(out, t, (comp, e) =>
        telemetry(db, {
          source: 'srv',
          name: `effect:${comp}`,
          ok: false,
          error: String(e),
        }))
    } catch (e) {
      telemetry(db, {
        source: 'srv',
        name: 'fixer spawn',
        ok: false,
        error: String(e),
      })
    }
  }

// The boot sweep predicate over the `bug` table: an OPEN bug ticket no fixer
// has been spawned for yet. Idempotent to re-drive — ensureFixer re-checks and
// the guardrails hold — so a restart re-drives only the un-spawned and never
// doubles one that launched. This is the reconcile that eventually spawns a
// bug the cap or a mute suppressed live, once the pressure clears.
export let FIXER_PENDING = `exists (select 1 from task t
     where t.entity = bug.entity and t.status in ('open', 'wip'))
   and not exists (select 1 from session s join fixer f on f.entity = s.entity
     where s.requested_task = bug.entity)`

// The created() handler, curried over cast like every effect. Re-reads the
// graph each call: if the exception was already cleared (healed) or the
// deliverable recovered (delivered stamped), the tri-state says resolved and
// nothing files; if a transient, nothing files; if an open bug already wears
// the key, the recurrence is annotated, not multiplied; else one ticket.
export let fileBug =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    // Recovery wins over the stamp: a break cleared before this ran, or a
    // deliverable that also succeeded, is resolved — do not file it.
    let live = db.prepare(
      `select message, stack from exception where ${OWNED}`,
    )
      .get(eid) as { message: string | null; stack: string | null } | undefined
    if (!live) return
    if (db.prepare(`select 1 from delivered where ${OWNED}`).get(eid)) return

    let message = String(live.message ?? comp.message ?? '').trim()
    if (!message) return
    let stack = (live.stack ?? comp.stack ?? null) as string | null
    let comps = has(eid)
    let kind = kindOf(comps)
    if (!actionable(kind, message)) return

    let key = faultKey(kind, message, stack)
    let at = now()
    let open = openBug(key)
    if (open) {
      let count = (open.hits ?? 1) + 1
      cast(apply(db, [
        { eid: open.eid, name: 'bug', comp: { hits: count, last: at } },
        {
          eid: open.eid,
          name: 'doc',
          comp: { body: footer(open.body, count, at) },
        },
        // Every affected entity links to the one ticket, so the sweep can tell
        // a filed break from an unfiled one purely by the about edge.
        {
          eid: open.eid,
          name: 'dependency',
          comp: { type: 'about', child: eid },
        },
      ]))
      return
    }

    let bug = crypto.randomUUID()
    let title = `${kind} exception: ${message.split('\n')[0]}`.slice(0, 100)
    let project = projectFor(comps)
    let body = `Auto-filed by self-healing (D-17077).\n\n` +
      `**${human(db, eid)}** (${kind}) raised:\n\n> ${message}\n` +
      (stack ? `\n\`\`\`\n${stack}\n\`\`\`\n` : '') +
      `\nBroken entity: ${human(db, eid)} · stamped ${comp.at ?? at}`
    cast(apply(db, [
      { eid: bug, name: 'doc', comp: { title, body } },
      {
        eid: bug,
        name: 'task',
        comp: {
          status: 'open',
          priority: severity(message),
          project: project ?? null,
        },
      },
      { eid: bug, name: 'bug', comp: { fault: key, hits: 1, last: at } },
      { eid: bug, name: 'dependency', comp: { type: 'about', child: eid } },
    ]))
    // Phase 2: a NEW ticket also summons a fixer, behind the guardrails. The
    // cast above does not dispatch, so the spawn is minted here — the same
    // door the boot sweep uses (created(bug)), idempotent and gated alike.
    ensureFixer(cast)(bug)
  }

// The boot sweep predicate over the `exception` table: a break that no bug
// task yet points at (via the about edge every filing lands). Idempotent to
// re-drive — the handler dedups by key regardless — so this only spares the
// already-ticketed from a needless re-check.
export let HEAL_PENDING =
  `not exists (select 1 from dependency d join bug b on b.entity = d.parent
     where d.type = 'about' and d.child = exception.entity)`
