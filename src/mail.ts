// Outbound mail: the mail intent's effect and the comment relay.
// A mail is a mail asked for as data — created (or re-driven by
// the boot sweep), the effect here resolves the address and delivers
// LOCAL-FIRST: a fleet recipient (a bot.yak.sh address the graph
// address book knows) is stamped delivered in place, never leaving the
// graph; only the boundary — external mailboxes — rides Cloudflare
// Email Sending (mailer.ts), or $TASKS_MAIL_CMD when that's set (the
// override/test seam). Either way the effect stamps
// the outcome server-side: acted_at (the effect ran), error (how it went
// wrong), to_addr (the RESOLVED envelope address — denormalized so later
// address-book edits never rewrite what a delivery actually used),
// sent_id (the Message-ID the native send was assigned). The comment
// relay mints mails for comments on an addressed project's tasks — the
// graph's replacement for holdco's delivery.js. SERVER-ONLY (imports db).
import { apply, db, human } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { canon, type Letter, logOut, native, send } from './mailer.ts'
import { type Change } from './types.ts'
import { entityUrl } from './url.ts'

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

// created(mail): deliver and stamp. $TASKS_MAIL_CMD, when set, is the
// mailer — argv `--to <addr> [--from <addr>] [--in-reply-to <mid>]
// <subject>`, body on stdin, exit 0 = sent (the retired bin/email's
// contract) — the override/test seam. Otherwise the native sender
// (mailer.ts) speaks Cloudflare Email Sending directly and sent_id
// stamps the Message-ID it was assigned.
// acted_at stamps on EVERY outcome, success or not: the sweep key means
// "the effect ran", error says how it went, and a human retries by
// minting a fresh request — an automatic retry storm helps no one.
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
    let addr: string
    try {
      addr = addressOf(String(row.to))
    } catch (e) {
      return done({ acted_at: now(), error: (e as Error).message })
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
      return done({
        acted_at: now(),
        error: 'no sender: the authoring actor has no address on file',
      })
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
      return done({
        acted_at: now(),
        to_addr: to,
        message_id: `local:${Date.now()}:${eid}`,
        received_at: now(),
        verified: 1,
        ...(row.target_eid ? {} : { target_eid: home }),
        ...(row.from || !from ? {} : { from }),
      })
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
      return
    }
    if (!native()) {
      return done({
        acted_at: now(),
        to_addr: to,
        error: 'no mailer configured (set TASKS_MAIL_CMD, or ' +
          'CLOUDFLARE_EMAIL_TOKEN + HOLDCO_CF_ACCOUNT_ID for the native ' +
          'sender)',
      })
    }
    if (!from) {
      return done({
        acted_at: now(),
        to_addr: to,
        error: 'no from address (set mail.from or TASKS_MAIL_FROM)',
      })
    }
    let letter: Letter = {
      from,
      to,
      subject: String(doc?.title ?? ''),
      body: String(doc?.body ?? ''),
      mid,
    }
    let id: string | undefined
    try {
      id = await send(letter)
    } catch (e) {
      return done({
        acted_at: now(),
        to_addr: to,
        error: String((e as Error).message).slice(0, 240),
      })
    }
    done({ acted_at: now(), to_addr: to, ...(id ? { sent_id: id } : {}) })
    // Sent is sent — the store log is provenance for external readers,
    // and its failure is telemetry, never a failed send.
    await logOut(letter, id).catch((e) =>
      console.warn('fleet-mail out-log —', e)
    )
  }

// created(comment): a comment on an ADDRESSED project's task fans out as
// a mail — to the project REFERENCE, not a raw address, so the
// resolution path (and its audit trail) is exercised on every relay. The
// about edge from the mail to the comment is the receipt: it makes the
// mint idempotent, and the boot sweep's predicate reads it back. Mail
// written by the project's own operator stays home (the self-echo
// guard delivery.js had).
export let fanout =
  (cast: Cast) => (eid: string, comp: Record<string, unknown>) => {
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
export let FANOUT_PENDING = `
  not exists (
    select 1 from dependency d join mail s on s.eid = d.parent_eid
    where d.type = 'about' and d.child_eid = comment.eid)
  and exists (
    select 1 from created cr where cr.eid = comment.eid
    and cr.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))
`.trim()
