// Outbound mail: the mail intent's effect and the comment relay.
// A mail is a mail asked for as data — created (or re-driven by
// the boot sweep), the effect here resolves the address, delivers through
// $TASKS_MAIL_CMD, and stamps the outcome server-side: acted_at (the
// effect ran), error (how it went wrong), to_addr (the RESOLVED envelope
// address — denormalized so later address-book edits never rewrite what a
// delivery actually used). The comment relay mints mails for
// comments on an addressed project's tasks — the graph's replacement for
// holdco's delivery.js. SERVER-ONLY (imports db).
import { apply, db } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { type Change } from './types.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, string | number | null>

let now = () => new Date().toISOString()

// The one writer for the stamped trio — delivery outcome never crosses
// apply(), so the stamp broadcasts its own full row (like sessions.ts
// castRow) or client caches would hold a mail that never settles.
let stamp = (eid: string, patch: Row, cast: Cast) => {
  let cols = Object.keys(patch)
  db.prepare(
    `update mail set ${cols.map((c) => `"${c}" = ?`).join(', ')}
     where eid = ?`,
  ).run(...cols.map((c) => patch[c]), eid)
  let row = db.prepare('select * from mail where eid = ?').get(eid)
  if (row) {
    cast([{ eid, name: 'mail', comp: row as Record<string, unknown> }])
  }
}

let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A reference the address book can hold: an eid, a human id (U-1, P-26),
// or an alias slug — the same shapes every *_eid door takes.
let eidOf = (ref: string): string | undefined => {
  let hit = (sql: string, v: string | number) =>
    (db.prepare(sql).get(v) as { eid: string } | undefined)?.eid
  if (UUID.test(ref)) return hit('select eid from entity where eid = ?', ref)
  let m = ref.match(/^[A-Za-z]+-(\d+)$/)
  if (m) return hit('select eid from entity where num = ?', Number(m[1]))
  return hit('select eid from alias where slug = ?', ref)
}

// The address book is one rule: a raw address (it has an @) passes
// through; anything else must resolve to an entity wearing an email
// comp. No address on file is an ERROR the caller stamps — never a guess.
export let addressOf = (to: string): string => {
  if (to.includes('@')) return to
  let eid = eidOf(to)
  if (!eid) throw new Error(`no entity: ${to}`)
  let e = db.prepare('select address from email where eid = ?').get(eid) as
    | { address: string }
    | undefined
  if (!e) {
    throw new Error(`no address on file for ${to} — give it an email comp`)
  }
  return e.address
}

// created(mail): deliver and stamp. $TASKS_MAIL_CMD is the mailer
// — argv `--to <addr> [--from <addr>] <subject>`, body on stdin, exit 0 =
// sent (holdco's bin/email speaks exactly this). acted_at stamps on
// EVERY outcome, success or not: the sweep key means "the effect ran",
// error says how it went, and a human retries by minting a fresh request
// — an automatic retry storm helps no one.
// In-flight guard: the boot sweep can catch a mail the comment
// sweep JUST minted (dispatched, not yet stamped — delivery is async) and
// fire it twice. acted_at must stay the crash-gap key, so the dedup for
// the in-process race lives here, not in the row.
let flying = new Set<string>()

export let mailed =
  (cast: Cast) => async (eid: string, _comp: Record<string, unknown>) => {
    let row = db.prepare('select * from mail where eid = ?').get(
      eid,
    ) as Row | undefined
    if (!row || row.acted_at) return // gone, or a sweep replaying a done one
    // Inbound mail is a RECORD of arrival, never an ask to send — the
    // message_id mark (inbound.ts stamps it) is what keeps what arrived
    // from echoing back out. The boot sweep's predicate screens it too.
    if (row.message_id) return
    if (flying.has(eid)) return // a concurrent fire is already delivering
    flying.add(eid)
    let doc = db.prepare('select title, body from doc where eid = ?').get(
      eid,
    ) as { title: string; body: string } | undefined
    let done = (patch: Row) => {
      flying.delete(eid)
      stamp(eid, patch, cast)
    }
    let to: string
    try {
      to = addressOf(String(row.to))
    } catch (e) {
      return done({ acted_at: now(), error: (e as Error).message })
    }
    let cmd = Deno.env.get('TASKS_MAIL_CMD')
    if (!cmd) {
      return done({
        acted_at: now(),
        to_addr: to,
        error: 'no mailer configured (set TASKS_MAIL_CMD)',
      })
    }
    let [bin, ...pre] = cmd.split(/\s+/)
    let args = [
      ...pre,
      '--to',
      to,
      ...(row.from ? ['--from', String(row.from)] : []),
      String(doc?.title ?? ''),
    ]
    try {
      let child = new Deno.Command(bin, {
        args,
        stdin: 'piped',
        stdout: 'null',
        stderr: 'piped',
      }).spawn()
      let w = child.stdin.getWriter()
      await w.write(new TextEncoder().encode(String(doc?.body ?? '')))
      await w.close()
      let out = await child.output()
      let err = new TextDecoder().decode(out.stderr).trim().slice(-240)
      done({
        acted_at: now(),
        to_addr: to,
        ...(out.success ? {} : { error: `exit ${out.code}: ${err || '?'}` }),
      })
    } catch (e) {
      done({
        acted_at: now(),
        to_addr: to,
        error: String((e as Error).message).slice(0, 240),
      })
    }
  }

// created(comment): a comment on an ADDRESSED project's task fans out as
// a mail — to the project REFERENCE, not a raw address, so the
// resolution path (and its audit trail) is exercised on every relay. The
// about edge from the mail to the comment is the receipt: it makes the
// mint idempotent, and the boot sweep's predicate reads it back. Mail
// authored by the project's own operator stays home (the self-echo
// guard delivery.js had).
//
// PROSE ONLY: email is reserved for words an agent actually wrote.
// Event comments (comment.event — reasons()-minted status trails) never
// mail: claimants hear them on the comms bus, and automated notification
// is its own future concept (T-3690), not an inbox flood. Read from the
// row, not the dispatched comp — the sweep and the live path then agree,
// and the wire's copy of `event` was never trustworthy anyway.
export let fanout =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    if (
      db.prepare('select 1 from comment where eid = ? and event = 1').get(eid)
    ) return
    let target = String(comp.target_eid ?? '')
    let t = db.prepare('select project_eid from task where eid = ?').get(
      target,
    ) as { project_eid: string | null } | undefined
    if (!t?.project_eid) return
    if (
      !db.prepare('select 1 from email where eid = ?').get(t.project_eid)
    ) return
    let author = String(comp.author_eid ?? '')
    if (author) {
      let actor = (db.prepare(
        'select actor_eid from session where eid = ?',
      ).get(author) ??
        db.prepare('select actor_eid from client where eid = ?').get(
          author,
        )) as { actor_eid: string | null } | undefined
      if (String(actor?.actor_eid ?? '') == t.project_eid) return
    }
    if (
      db.prepare(`
      select 1 from dependency d join mail s on s.eid = d.parent_eid
      where d.type = 'about' and d.child_eid = ?
    `).get(eid)
    ) return
    let num = (db.prepare('select num from entity where eid = ?').get(
      target,
    ) as { num: number } | undefined)?.num
    let title = (db.prepare('select title from doc where eid = ?').get(
      target,
    ) as { title: string } | undefined)?.title ?? ''
    let said = (db.prepare('select body from doc where eid = ?').get(eid) as
      | { body: string }
      | undefined)?.body ?? ''
    let sid = crypto.randomUUID()
    let t2 = trace()
    try {
      let out = apply(db, [
        {
          eid: sid,
          name: 'doc',
          comp: {
            title: `[T-${num}] ${title}`,
            body: `${said}\n\nhttp://127.0.0.1:5173/T-${num}`,
          },
        },
        {
          eid: sid,
          name: 'mail',
          comp: { to: t.project_eid, target_eid: target },
        },
        {
          eid: sid,
          name: 'dependency',
          comp: { type: 'about', child_eid: eid },
        },
      ], t2)
      cast(out)
      dispatch(out, t2, (c, e) => console.warn(`relay effect ${c} —`, e))
    } catch (e) {
      console.warn('comment relay dropped —', e)
    }
  }

// The fanout sweep's pending predicate: recent PROSE comments with no
// mail receipt. Over-approximates on purpose — the handler re-checks
// project/address/self-echo — but events are screened here too, so the
// sweep never even enumerates them. The one-HOUR horizon bounds the
// backfill when a project FIRST gains an address: older comments are
// history, not undelivered mail, and a day of it arriving at once is a
// mail bomb, not a catch-up.
export let FANOUT_PENDING = `
  comment.event is null
  and not exists (
    select 1 from dependency d join mail s on s.eid = d.parent_eid
    where d.type = 'about' and d.child_eid = comment.eid)
  and exists (
    select 1 from entity e where e.eid = comment.eid
    and e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))
`.trim()
