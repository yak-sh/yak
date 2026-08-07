// Outbound mail: the mail intent's effect and the comment relay.
// A mail is a mail asked for as data — created (or re-driven by
// the boot sweep), the effect here resolves the address and delivers
// LOCAL-FIRST: a fleet recipient (a bot.yak.sh address the graph
// address book knows) is stamped delivered in place, never leaving the
// graph; only the boundary — external mailboxes — rides Cloudflare
// Email Sending (mailer.ts), or $TASKS_MAIL_CMD when that's set (the
// override/test seam). Either way the effect settles the outcome as the
// shared delivered/error facet (deliver.ts) and denormalizes the resolved
// envelope onto the row as DATA: to_addr (the address the delivery used, so
// later address-book edits never rewrite it) and sent_id (the Message-ID the
// native send was assigned). The comment relay mints mails for comments on
// an addressed project's tasks — the graph's replacement for holdco's
// delivery.js. SERVER-ONLY (imports db).
import { apply, db, human } from './db.ts'
import { delivered, errored, settled, toOf } from './deliver.ts'
import { dispatch, trace } from './effects.ts'
import { canon, type Letter, logOut, native, send } from './mailer.ts'
import { type Change } from './types.ts'
import { entityUrl } from './url.ts'

type Cast = (changes: Change[]) => void
type Row = Record<string, string | number | null>

let now = () => new Date().toISOString()

// Settle a delivery: write the resolved envelope DATA to the mail row and
// record the OUTCOME as the shared component (D-14945) — error {at, message}
// on failure, else delivered {at, via}, where via names how it went out (the
// native Message-ID, a `local` hand-off, or the address). The mail row's DATA
// broadcast and the outcome broadcast are separate frames; both are the one
// writer's, since delivery never crosses apply() (client caches would else
// hold a mail that never settles). Releases the in-flight lock.
let settle = (
  eid: string,
  data: Row,
  outcome: { via?: string; error?: string },
  cast: Cast,
) => {
  flying.delete(eid)
  let cols = Object.keys(data)
  if (cols.length) {
    db.prepare(
      `update mail set ${cols.map((c) => `"${c}" = ?`).join(', ')}
       where eid = ?`,
    ).run(...cols.map((c) => data[c]), eid)
    let row = db.prepare('select * from mail where eid = ?').get(eid)
    if (row) cast([{ eid, name: 'mail', comp: row as Record<string, unknown> }])
  }
  if (outcome.error) errored(eid, outcome.error, cast)
  else delivered(eid, outcome.via ?? '', cast)
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
  if (e) return e.address
  // No address-book entry: a SESSION is still reachable at its derived
  // id-address (named() resolves it back for local delivery) — the fallback
  // for entities too short-lived to carry an `email` comp. Anything else
  // genuinely has no address, and guessing one would misdeliver.
  if (db.prepare('select 1 from session where eid = ?').get(eid)) {
    return `${human(db, eid)}@bot.yak.sh`
  }
  throw new Error(`no address on file for ${to} — give it an email comp`)
}

// The id grammar IS the address grammar: `S-31@bot.yak.sh` names S-31.
// DERIVED, never stored — sessions mint and die constantly, so a book row
// per session is bookkeeping nobody would keep true, and addressing one
// should not require minting anything. `human()` is the single place that
// decides an entity's id, so round-tripping through it is what makes the
// PREFIX binding rather than decorative: T-31@ resolves to nothing when
// 31 is a session, even though the two share a num.
export let named = (to: string): string | null => {
  let local = /^([A-Za-z]+-(\d+))@bot\.yak\.sh$/i.exec(to.trim())
  if (!local) return null
  let row = db.prepare('select eid from entity where num = ?')
    .get(Number(local[2])) as { eid: string } | undefined
  if (!row) return null
  return human(db, row.eid).toLowerCase() == local[1].toLowerCase()
    ? row.eid
    : null
}

// The address book, reversed and strict — which fleet entity wears this
// address? Only bot.yak.sh addresses count as fleet: an external
// mailbox in the book (the owner's own, a customer's) must still ride
// Cloudflare to reach its inbox. Both spellings are checked, resolved
// and canon'd, so a book entry Cloudflare would bounce (underscores)
// still delivers at home. No triage fallback (that's routeTo's, an
// inbound concern) — absence means "not fleet".
// The BOOK WINS over the derivation: an `email` comp is somebody's
// decision, and an id-shaped address is only the fallback for the
// entities too short-lived to carry one.
let homeOf = (addr: string, to: string): string | null => {
  if (!/@bot\.yak\.sh$/i.test(to)) return null
  let hit = (a: string) =>
    (db.prepare('select eid from email where address = ? collate nocase')
      .get(a) as { eid: string } | undefined)?.eid
  return hit(to) ?? hit(addr) ?? named(to) ?? named(addr)
}

// A stored message id to the RFC Message-ID a mail client threads on:
// the fleet store wraps ids (`msg:<ts>:<rfc-id>`, `out:` for outbound) —
// unwrap those, pass a raw id through, and shed the angle brackets the
// mailer re-adds in the header.
export let rfcId = (stored: string) =>
  (stored.match(/^(?:msg|out):\d+:(.+)$/)?.[1] ?? stored)
    .replace(/[<>]/g, '').trim()

// Threading resolves at delivery (reference at authoring — the row's
// reply_to_eid names the mail being answered; what the WORLD needs is
// that mail's Message-ID): inbound rows carry it in message_id (store-
// wrapped), our own sent rows in sent_id. Nothing resolvable = deliver
// unthreaded — the reply_to_eid edge still records the intent in the
// graph, and a lost thread is not a lost letter.
let threadId = (eid: string) => {
  let r = db.prepare('select message_id, sent_id from mail where eid = ?')
    .get(eid) as
      | { message_id: string | null; sent_id: string | null }
      | undefined
  let mid = r?.message_id ? rfcId(String(r.message_id)) : r?.sent_id
  return mid ? String(mid) : undefined
}

let repoUrl = (target: string | null) =>
  target
    ? (db.prepare(
      `select repo.url from task join repo on repo.eid = task.project_eid
       where task.eid = ?`,
    ).get(target) as { url: string | null } | undefined)?.url ?? undefined
    : undefined

// created(mail): deliver and settle. $TASKS_MAIL_CMD, when set, is the
// mailer — argv `--to <addr> [--from <addr>] [--in-reply-to <mid>]
// <subject>`, body on stdin, exit 0 = sent (the retired bin/email's
// contract) — the override/test seam. Otherwise the native sender
// (mailer.ts) speaks Cloudflare Email Sending directly and sent_id
// stamps the Message-ID it was assigned.
// EVERY outcome settles into delivered or error (D-14945): the presence of
// either means "the effect ran", and a human retries by minting a fresh
// request — an automatic retry storm helps no one.
// In-flight guard: the boot sweep can catch a mail the comment
// sweep JUST minted (dispatched, not yet settled — delivery is async) and
// fire it twice. The delivered/error component is the crash-gap key
// (settled()), so the dedup for the in-process race lives here, not in a row.
let flying = new Set<string>()

export let mailed =
  (cast: Cast) => async (eid: string, _comp: Record<string, unknown>) => {
    let row = db.prepare('select * from mail where eid = ?').get(
      eid,
    ) as Row | undefined
    if (!row || settled(eid)) return // gone, or a sweep replaying a done one
    // Inbound mail is a RECORD of arrival, never an ask to send — the
    // message_id mark (inbound.ts stamps it) is what keeps what arrived
    // from echoing back out. The boot sweep's predicate screens it too.
    if (row.message_id) return
    if (flying.has(eid)) return // a concurrent fire is already delivering
    flying.add(eid)
    let doc = db.prepare('select title, body from doc where eid = ?').get(
      eid,
    ) as { title: string; body: string } | undefined
    // WHERE it goes rides the shared `deliver {to}` facet now, resolved to an
    // address by the same book rule (an eid → its email, a raw address →
    // itself for the legacy rows migration carried over verbatim).
    let addr: string
    try {
      addr = addressOf(toOf(eid))
    } catch (e) {
      return settle(eid, {}, { error: (e as Error).message }, cast)
    }
    let to = canon(addr)
    // The concrete sender: the row's own from, stamped by apply() from the
    // actor that wrote it. There is deliberately NO fallback — the fleet
    // default used to fill this gap, so mail authored by two ventures went
    // out signed by the portfolio, and every reply in those threads then
    // aimed at the wrong inbox (T-9489). An unsigned letter is a defect to
    // report, not one to sign on the author's behalf.
    let from = String(row.from ?? '')
    if (!from) {
      return settle(eid, {}, {
        error: 'no sender: the authoring actor has no address on file',
      }, cast)
    }
    // Local-first: a fleet recipient never leaves the graph — the sent
    // entity IS the delivery, gaining its inbound half right here.
    // message_id doubles as the never-send mark (inbound.ts), so a
    // locally-delivered letter can never also ride Cloudflare; verified
    // because apply() authenticated the author; acted_at still records
    // when delivery happened. The full-row broadcast rings the
    // recipient's channel exactly like the sweep's arrival stamp
    // (channel.ts injects on received_at). And the
    // arrive() precedent holds: a relay mail keeps aiming at its task —
    // only a bare letter aims at the recipient's inbox entity.
    let home = homeOf(addr, to)
    if (home) {
      return settle(
        eid,
        {
          to_addr: to,
          message_id: `local:${Date.now()}:${eid}`,
          received_at: now(),
          verified: 1,
          ...(row.target_eid ? {} : { target_eid: home }),
          ...(row.from || !from ? {} : { from }),
        },
        { via: 'local' },
        cast,
      )
    }
    let mid = row.reply_to_eid ? threadId(String(row.reply_to_eid)) : undefined
    let cmd = Deno.env.get('TASKS_MAIL_CMD')
    if (cmd) {
      let [bin, ...pre] = cmd.split(/\s+/)
      let args = [
        ...pre,
        '--to',
        to,
        ...(row.from ? ['--from', String(row.from)] : []),
        ...(mid ? ['--in-reply-to', mid] : []),
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
        settle(
          eid,
          { to_addr: to },
          out.success
            ? { via: to }
            : { error: `exit ${out.code}: ${err || '?'}` },
          cast,
        )
      } catch (e) {
        settle(eid, { to_addr: to }, {
          error: String((e as Error).message).slice(0, 240),
        }, cast)
      }
      return
    }
    if (!native()) {
      return settle(eid, { to_addr: to }, {
        error: 'no mailer configured (set TASKS_MAIL_CMD, or ' +
          'CLOUDFLARE_EMAIL_TOKEN + HOLDCO_CF_ACCOUNT_ID for the native ' +
          'sender)',
      }, cast)
    }
    if (!from) {
      return settle(eid, { to_addr: to }, {
        error: 'no from address (set mail.from or TASKS_MAIL_FROM)',
      }, cast)
    }
    let letter: Letter = {
      from,
      to,
      subject: String(doc?.title ?? ''),
      body: String(doc?.body ?? ''),
      mid,
      repo: repoUrl(row.target_eid == null ? null : String(row.target_eid)),
    }
    let id: string | undefined
    try {
      id = await send(letter)
    } catch (e) {
      return settle(eid, { to_addr: to }, {
        error: String((e as Error).message).slice(0, 240),
      }, cast)
    }
    settle(eid, { to_addr: to, ...(id ? { sent_id: id } : {}) }, {
      via: id ?? to,
    }, cast)
    // Sent is sent — the store log is provenance for external readers,
    // and its failure is telemetry, never a failed send.
    await logOut(letter, id).catch((e) =>
      console.warn('fleet-mail out-log —', e)
    )
  }

// Commentary born beside its target is part of filing it, not new
// correspondence. The two births are the whole question, and a shared batch
// is the wrong way to ask it: the doors mint the target in one apply() and
// the comment in the next, milliseconds later, so batch identity holds for 3
// of the 122 pairs actually born together.
//
// One second is where the data splits — 122 pairs land inside it and the
// next is two seconds out, so the window sits in an empty band rather than
// on a gradient. The target's kind does not enter into it: a comment born
// beside a memory, a design or a session is the same event.
//
// A missing birth on either side reads as NOT born together, so the comment
// still fans out. A letter delivered is recoverable; correspondence silently
// swallowed is not.
let BORN_WITH_TARGET = `
  exists (
    select 1 from created c, created t
    where c.eid = comment.eid
      and t.eid = comment.target_eid
      and c.at >= t.at
      and c.at <= strftime('%Y-%m-%dT%H:%M:%fZ', t.at, '+1 second'))
`.trim()

let bornWithTarget = (eid: string) =>
  !!db.prepare(`select 1 from comment where eid = ? and ${BORN_WITH_TARGET}`)
    .get(eid)

// created(comment): a comment on an ADDRESSED project's task fans out as
// a mail — to the project REFERENCE, not a raw address, so the
// resolution path (and its audit trail) is exercised on every relay. The
// about edge from the mail to the comment is the receipt: it makes the
// mint idempotent, and the boot sweep's predicate reads it back. Mail
// written by the project's own operator stays home (the self-echo
// guard delivery.js had).
export let fanout =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
    if (bornWithTarget(eid)) return
    let target = String(comp.target_eid ?? '')
    let t = db.prepare('select project_eid from task where eid = ?').get(
      target,
    ) as { project_eid: string | null } | undefined
    if (!t?.project_eid) return
    if (
      !db.prepare('select 1 from email where eid = ?').get(t.project_eid)
    ) return
    let actor = db.prepare('select "by" from created where eid = ?').get(
      eid,
    ) as { by: string | null } | undefined
    if (String(actor?.by ?? '') == t.project_eid) return
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
      let out = apply(
        db,
        [
          {
            eid: sid,
            name: 'doc',
            comp: {
              title: `[T-${num}] ${title}`,
              body: `${said}\n\n${entityUrl(`T-${num}`)}`,
            },
          },
          { eid: sid, name: 'mail', comp: { target_eid: target } },
          // WHERE it goes rides the shared deliver.to — the project reference,
          // resolved to its address at delivery like any other.
          { eid: sid, name: 'deliver', comp: { to: t.project_eid } },
          {
            eid: sid,
            name: 'dependency',
            comp: { type: 'about', child_eid: eid },
          },
          // The relay carries someone's WORDS, so it is signed by whoever
          // wrote them. Without a writer named here the sender would resolve
          // by fallback, and a comment relayed from any venture would leave
          // signed by the box owner (T-9571).
        ],
        t2,
        actor?.by ?? null,
      )
      cast(out)
      dispatch(out, t2, (c, e) => console.warn(`relay effect ${c} —`, e))
    } catch (e) {
      console.warn('comment relay dropped —', e)
    }
  }

// The fanout sweep's pending predicate: recent PROSE comments with no
// mail receipt. Over-approximates on purpose — the handler re-checks
// project/address/self-echo. The one-HOUR horizon bounds the
// backfill when a project FIRST gains an address: older comments are
// history, not undelivered mail, and a day of it arriving at once is a
// mail bomb, not a catch-up.
//
// The horizon is an uncorrelated `in` so the sweep stays proportional to the
// window rather than to the comment table: SQLite materializes it once and
// SEARCHes comment by eid. Tying it back to `comment` makes the window
// advisory and hands the row count to the planner.
export let FANOUT_PENDING = `
  comment.eid in (
    select cr.eid from created cr
    where cr.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))
  and
  not exists (
    select 1 from dependency d join mail s on s.eid = d.parent_eid
    where d.type = 'about' and d.child_eid = comment.eid)
  and
  not ${BORN_WITH_TARGET}
`.trim()
