// What the page knows, worked out from the store's rows: the directory's
// people, the lists, who agreed to texts and who said STOP, every text sent and
// received, and what each broadcast reached. Nothing here touches the page or
// the store, so it is all tested in model_test.ts.

/** @typedef {Record<string, any>} Bundle */

/** What the page subscribes to: the directory's people and church, and this
 * app's own rows. */
export let FILTERS = {
  people:
    '.individual&.fields=individual.first,individual.middle,individual.last,individual.nickname,individual.suffix,individual.phone,individual.status,individual.deceased',
  church: '.congregation',
  lists:
    '(.group|.membership|.broadcast|.phone|.sms_consent|.help)&?doc&?group&?membership&?broadcast&?phone&?sms_consent&?help&?created',
  texts: '.text&?doc&?deliver&?delivered&?bounced&?copy&?archived&?created',
}

/** A US number in E.164 form (`+12695550142`), or null when it is not one. */
export let e164 = (s) => {
  let main = String(s ?? '').split(/\s*(?:x|ext\.?|extension|#)\s*\d+\s*$/i)[0]
  if (main.trim().startsWith('+') && !main.trim().startsWith('+1')) return null
  let d = main.replace(/\D/g, '')
  if (d.length == 11 && d[0] == '1') d = d.slice(1)
  return d.length == 10 && /^[2-9]/.test(d) ? `+1${d}` : null
}

/** `+12695550142` as a person writes it: `(269) 555-0142`. */
export let shown = (number) => {
  let d = String(number ?? '').replace(/^\+1/, '')
  return /^\d{10}$/.test(d)
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : String(number ?? '')
}

// The keywords carriers require every number to answer, as @yaks/phone's
// `keyword` reads them: the whole text, in any case, punctuation aside.
let KEYWORDS = {
  STOP: 'stop',
  STOPALL: 'stop',
  UNSUBSCRIBE: 'stop',
  CANCEL: 'stop',
  END: 'stop',
  QUIT: 'stop',
  HELP: 'help',
  INFO: 'help',
  START: 'start',
  YES: 'start',
  UNSTOP: 'start',
}
export let keyword = (text) =>
  KEYWORDS[String(text ?? '').trim().replace(/^\W+|\W+$/g, '').toUpperCase()] ??
    null

export let given = (p) => p?.nickname || p?.first || ''
export let nameOf = (p) =>
  p ? [given(p), p.last, p.suffix].filter(Boolean).join(' ') || 'Unnamed' : ''
let sortKey = (p) => `${p.last || ''} ${given(p)}`.toLowerCase()
export let initials = (name) =>
  String(name).split(/\s+/).filter((w) => /\w/.test(w)).map((w) => w[0])
    .slice(0, 2).join('').toUpperCase() || '#'

let ref = (v) => (v && typeof v == 'object' ? v.eid : v) || null
let eidOf = (r) => r.entity.eid
let byTime = (a, b) => a.at.localeCompare(b.at)

/** The words a person is recorded as agreeing to when the church office puts
 * them on a list: what they asked the church for. */
export let consentWords = (church) =>
  `Asked to receive texts from ${church}: prayer requests, news and reminders, a few a week. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`

/** The words of a text as sent. The church texts from its own number, so
 * nothing is added to them. */
export let signed = (_church, body) => String(body ?? '').trim()

/** What the church's texting line (voip.ms) takes: up to `sms` characters go
 * as one SMS, up to `mms` as one picture message (MMS) with no picture, and
 * the API carries `day` texts a day, either kind. */
export let LINE = { sms: 160, mms: 2048, day: 100 }

// GSM-7 holds 160 characters a text and 153 in each part of a longer one;
// anything outside it (an emoji, curly quotes) makes every part 70 or 67.
let GSM =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/
/** How many texts a message is sent as, and how many characters it has. */
export let segments = (text) => {
  let s = String(text ?? '')
  let plain = GSM.test(s)
  let n = [...s].length +
    (plain ? (s.match(/[\^{}\\[~\]|€]/g)?.length ?? 0) : 0)
  let [one, part] = plain ? [160, 153] : [70, 67]
  return { chars: n, texts: n <= one ? 1 : Math.ceil(n / part), plain }
}

/** What the line does with `text`: it counts characters as the line does
 * (UTF-16 units), and sends up to LINE.sms as an SMS, more as an MMS, and
 * more than LINE.mms not at all. Either way it is one text against the day. */
export let size = (text) => {
  let s = String(text ?? '')
  return {
    chars: s.length,
    kind: s.length <= LINE.sms ? 'sms' : s.length <= LINE.mms ? 'mms' : 'long',
    plain: segments(s).plain,
  }
}

const DAY = 86400000
/** How many texts the line has taken in the 24 hours before `now`: those it
 * accepted, those waiting to go, and its automatic answers. A text it refused
 * does not count. The line's other uses (the Operator's) are not seen here. */
export let usedToday = (m, now = new Date()) =>
  m.texts.filter((t) =>
    t.out && t.state != 'bounced' && now - new Date(t.at) < DAY &&
    new Date(t.at) <= now
  ).length

/** What sending `count` texts now does against the day: how many there is room
 * for, and how many would be left over for another day. */
export let room = (m, count, now = new Date()) => {
  let left = Math.max(0, LINE.day - usedToday(m, now))
  return {
    used: usedToday(m, now),
    go: Math.min(count, left),
    over: Math.max(0, count - left),
  }
}

/**
 * The page's picture of the store. `rows` are the answers of the page's
 * subscriptions, together: the directory's `individual` and `congregation`
 * rows, and this app's lists, memberships, numbers, consents, broadcasts and
 * texts.
 */
export let gather = (rows) => {
  let m = {
    church: /** @type {Bundle | null} */ (null),
    people: new Map(),
    byNumber: new Map(),
    numbers: new Map(), // eid -> the phone{number} this store texts them at
    holders: new Map(), // number -> eids in this store wearing it
    consent: new Map(), // person eid -> {eid, consent, at}
    groups: new Map(),
    broadcasts: new Map(),
    help: /** @type {{ eid: string, contact: string } | null} */ (null),
    texts: [],
  }
  let memberships = []
  for (let r of rows) {
    let eid = eidOf(r)
    if (r.individual) {
      let p = { ...r.individual, eid, mobile: e164(r.individual.phone) }
      p.name = nameOf(p)
      m.people.set(eid, p)
    }
    if (r.congregation) m.church = { ...r.congregation, eid }
    if (r.phone?.number) {
      m.numbers.set(eid, r.phone.number)
      m.holders.set(r.phone.number, [
        ...m.holders.get(r.phone.number) ?? [],
        eid,
      ])
    }
    if (r.help) m.help = { eid, contact: r.help.contact || '' }
    if (r.sms_consent) {
      m.consent.set(ref(r.sms_consent.person), { ...r.sms_consent, eid })
    }
    if (r.group) {
      m.groups.set(eid, {
        eid,
        name: r.doc?.title || 'Untitled list',
        about: r.doc?.body || '',
        members: [],
      })
    }
    if (r.membership) memberships.push({ ...r.membership, eid })
    if (r.broadcast) {
      m.broadcasts.set(eid, {
        eid,
        group: ref(r.broadcast.group),
        body: r.doc?.body || '',
        at: r.created?.at || '',
        by: r.created?.by?.name || null,
        copies: [],
      })
    }
    if (r.text) m.texts.push(textOf(r))
  }
  for (let p of m.people.values()) {
    if (p.mobile && !p.deceased && !m.byNumber.has(p.mobile)) {
      m.byNumber.set(p.mobile, p)
    }
  }
  for (let ms of memberships) {
    let g = m.groups.get(ref(ms.group)), p = m.people.get(ref(ms.person))
    if (g && p) g.members.push({ eid: ms.eid, person: p })
  }
  for (let g of m.groups.values()) {
    g.members.sort((a, b) => sortKey(a.person).localeCompare(sortKey(b.person)))
  }
  m.texts.sort(byTime)
  // A broadcast's copy to a person is the last one: a text sent again to
  // someone it did not reach replaces the one that bounced.
  for (let t of m.texts) {
    if (!t.out) continue
    t.number ??= m.numbers.get(t.to) ?? null
    let b = t.broadcast && m.broadcasts.get(t.broadcast)
    if (!b) continue
    let i = b.copies.findIndex((c) => c.to == t.to)
    if (i < 0) b.copies.push(t)
    else b.copies[i] = t
  }
  m.stopped = stopped(m.texts)
  return m
}

// One text, sent or received, as the page reads it.
let textOf = (r) => {
  // The platform's own answers (STOP, HELP) carry no `deliver`, only how
  // they went.
  let out = !!(r.deliver || r.delivered || r.bounced)
  return {
    eid: eidOf(r),
    out,
    body: r.doc?.body || '',
    // A text that arrived says where it came from; one sent says where it
    // went once it left, and until then is the number of `deliver.to`.
    number: out ? r.text.to || null : r.text.from || null,
    to: out ? ref(r.deliver?.to) : null,
    at: (out ? r.delivered?.at : r.text.at) || r.created?.at || '',
    state: !out
      ? 'in'
      : r.delivered
      ? 'delivered'
      : r.bounced
      ? 'bounced'
      : 'sending',
    // Why it was not sent, or why it waits to be tried again.
    reason: r.bounced?.reason || r.deliver?.waiting || '',
    by: out ? r.created?.by?.name || null : null,
    broadcast: ref(r.copy?.broadcast),
    archived: !!r.archived,
  }
}

/** Who said STOP and has not said START since, by number, with when. */
export let stopped = (texts) => {
  let out = new Map()
  for (let t of [...texts].sort(byTime)) {
    if (t.out || !t.number) continue
    let k = keyword(t.body)
    if (k == 'stop') out.set(t.number, t.at)
    if (k == 'start') out.delete(t.number)
  }
  return out
}

/** Why a person on a list will not get a text, or null when they will. */
export let why = (m, p) =>
  p.deceased
    ? 'has passed away'
    : !p.mobile
    ? 'no mobile number in the directory'
    : m.stopped.has(p.mobile)
    ? 'opted out (texted STOP)'
    : !m.consent.has(p.eid)
    ? 'has not agreed to texts'
    : null

/** Who on a list a broadcast reaches, and who it does not and why. */
export let recipients = (m, group) => {
  let to = [], left = []
  for (let { person } of m.groups.get(group)?.members ?? []) {
    let no = why(m, person)
    no ? left.push({ person, why: no }) : to.push(person)
  }
  return { to, left }
}

/**
 * The bundles that send `body` to everyone a list reaches: the broadcast,
 * each person's number as the directory has it now, and one text each.
 */
export let broadcastBundles = (m, group, body, eid = '$broadcast') => {
  let text = signed(m.church?.name, body)
  return [{
    entity: { eid },
    broadcast: { group },
    doc: { body: text },
  }, ...copyBundles(m, recipients(m, group).to, text, eid)]
}

// One text of `text` to each of `people`, each a copy of the broadcast, with
// the number the directory has for them now.
let copyBundles = (m, people, text, broadcast) =>
  people.flatMap((p) => [
    ...m.numbers.get(p.eid) != p.mobile
      ? [{ entity: { eid: p.eid }, phone: { number: p.mobile } }]
      : [],
    {
      entity: { eid: `$text-${p.eid}` },
      text: {},
      doc: { body: text },
      deliver: { to: p.eid },
      copy: { broadcast },
    },
  ])

/** The bundle that gives the platform the office number to put in its answer
 * to HELP, when the church's phone in the directory is not what it has. */
export let helpBundles = (m) => {
  let contact = String(m.church?.phone ?? '').trim()
  return !contact || contact == m.help?.contact ? [] : [
    m.help ? { entity: { eid: m.help.eid }, help: { contact } } : {
      entity: { eid: '$help' },
      alias: { name: 'help' },
      help: { contact },
    },
  ]
}

/** The bundles that send a broadcast again to the people it did not reach
 * and who can be texted now. Nothing is lost when a send stops short (the
 * day's limit, a line that was down): what did not go goes when this is
 * sent. */
export let resendBundles = (m, broadcast) => {
  let b = m.broadcasts.get(broadcast)
  let people = reach(m, broadcast).bounced.flatMap(({ person }) =>
    person && !why(m, person) ? [person] : []
  )
  return b ? copyBundles(m, people, b.body, broadcast) : []
}

/** What a broadcast reached: delivered, not sent (with the reason), and still
 * sending. */
export let reach = (m, broadcast) => {
  let b = m.broadcasts.get(broadcast)
  /** @type {Record<string, Bundle[]>} */
  let out = { delivered: [], bounced: [], sending: [] }
  for (let t of b?.copies ?? []) {
    out[t.state].push({ text: t, person: m.people.get(t.to) ?? null })
  }
  return out
}

/** The bundles that put people on a list: the membership, the number they
 * are texted at, and their agreement in the church's words when they have
 * none on file. Someone who texted STOP is left off. */
export let joinBundles = (m, group, people, at = new Date().toISOString()) => {
  let words = consentWords(m.church?.name || 'the church')
  /** @type {Bundle[]} */
  let out = []
  for (let eid of people) {
    let p = m.people.get(eid)
    if (!p?.mobile || m.stopped.has(p.mobile)) continue
    out.push({
      entity: { eid: `$member-${eid}` },
      membership: { group, person: eid },
    })
    /** @type {Bundle} */
    let b = { entity: { eid } }
    if (m.numbers.get(eid) != p.mobile) b.phone = { number: p.mobile }
    if (b.phone) out.push(b)
    if (!m.consent.has(eid)) {
      out.push({
        entity: { eid: `$consent-${eid}` },
        sms_consent: { person: eid, consent: words, at },
      })
    }
  }
  return out
}

/**
 * Every conversation someone started or answered: one per number that has
 * texted the church, with every text to and from it, the directory person it
 * belongs to, and whether anything they sent still waits for an answer.
 * Newest first.
 */
export let conversations = (m) => {
  let threads = new Map()
  for (let t of m.texts) {
    if (!t.number) continue
    let c = threads.get(t.number) ??
      threads.set(t.number, { number: t.number, texts: [], heard: false })
        .get(t.number)
    c.texts.push(t)
    if (!t.out) c.heard = true
  }
  return [...threads.values()].filter((c) => c.heard).map((c) => {
    let person = m.byNumber.get(c.number) ??
      m.people.get(c.texts.find((t) => t.to)?.to) ?? null
    let last = c.texts.at(-1)
    return {
      ...c,
      person,
      name: person?.name || shown(c.number),
      last,
      waiting: c.texts.filter((t) => !t.out && !t.archived).length,
      stopped: m.stopped.get(c.number) ?? null,
    }
  }).sort((a, b) => b.last.at.localeCompare(a.last.at))
}

/** The bundles that answer a conversation: the reply, sent to the person the
 * number belongs to (or a contact holding just the number), their agreement
 * when none is on file, which is the text they sent first, and every text of
 * theirs marked answered. */
export let replyBundles = (m, c, body, at = new Date().toISOString()) => {
  let to = c.person?.eid ?? m.holders.get(c.number)?.[0] ?? '$contact'
  /** @type {Bundle[]} */
  let out = []
  if (m.numbers.get(to) != c.number) {
    out.push({ entity: { eid: to }, phone: { number: c.number } })
  }
  if (!m.consent.has(to)) {
    let first = c.texts.find((t) => !t.out)
    out.push({
      entity: { eid: '$consent' },
      sms_consent: {
        person: to,
        consent: `Texted ${
          m.church?.name || 'the church'
        } first: ${first.body}`,
        at: first.at || at,
      },
    })
  }
  out.push({
    entity: { eid: '$reply' },
    text: {},
    doc: { body: String(body).trim() },
    deliver: { to },
  })
  return [...out, ...doneBundles(c)]
}

/** The bundles that mark a conversation answered. */
export let doneBundles = (c) =>
  c.texts.filter((t) => !t.out && !t.archived).map((t) => ({
    entity: { eid: t.eid },
    archived: {},
  }))

/** Living directory people with a mobile number, best match first. */
export let findPeople = (m, words = '', not = new Set()) => {
  let q = String(words).toLowerCase().trim().split(/\s+/).filter(Boolean)
  let digits = String(words).replace(/\D/g, '')
  return [...m.people.values()]
    .filter((p) => p.mobile && !p.deceased && !not.has(p.eid))
    .filter((p) => {
      let hay = `${p.first || ''} ${p.nickname || ''} ${p.last || ''} ${
        p.middle || ''
      }`.toLowerCase()
      return q.every((w) => hay.includes(w)) ||
        (digits.length >= 3 && p.mobile.includes(digits))
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

/** "3:05 PM" today, "Tue" this week, "Nov 3" this year, else "Nov 3, 2025". */
export let when = (iso, now = new Date()) => {
  if (!iso) return ''
  let d = new Date(iso)
  let days = (now - d) / 86400000
  if (d.toDateString() == now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (days < 6) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() == now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export let plural = (n, one, many = one + 's') => `${n} ${n == 1 ? one : many}`
