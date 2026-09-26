// What a listing carries, in one place, because a filter line has one answer:
// the same query asked by the person's agent (tools.ts graph_query), by their
// page (apps.ts `/api/query`) and by the socket that keeps answering it
// (graph.ts `/ws`) is the same question, and the doors answered it differently
// — the tools hid the platform's stamps, the page's door returned them
// (C-32574 item 5), and the live door sent raw changes, so a page's rows
// changed shape the moment they moved (C-32624 item 2). The rule lives here
// and every door reads it.
//
// The rule itself is T-32506's (C-32498 item 10): a listing answers the rows
// a person saved, without the bookkeeping the store keeps about saving them,
// and without a row that is nothing but bookkeeping. Naming a stamp in the
// filter (`.created`, `.created.by=…`) asks for it back — a door never hides
// what was asked for. Anything that is not a row listing (an aggregate, a
// count) passes through as it came.

// The platform's bookkeeping about a row — who wrote it and when, whether it
// has been served. `archived` is not here: an app's agent reads and writes it
// (it is how an error is marked fixed), so it is the person's business too.
export let STAMPS = ['created', 'updated', 'notified', 'opened', 'quarantined']

// The kernel's own rows about the app, which nobody saved: a break the
// platform wrote down (unseen.ts `noted`) and a failure it expected. They are
// read through `app_errors`, not through a listing, so a listing leaves them
// out unless the filter names one — the deliberate opt-in src/query.ts
// `selected()` asks for the store's blob rows. Asking for the stamps is not
// asking for these: `.created` alone dragged every exception into a person's
// list of their own rows (C-32607 item 4).
export let KERNEL = ['exception', 'error']

// A person is the platform's row too — a store mints one for whoever writes to
// it, so `created.by` has a name to resolve (graph.ts `#vouching`) — but only in an
// app's store: the directory's own graph is made of people, and the agent tier
// reads that through the same listing. So a person is screened out of the
// question, which only a page's doors ask, and never out of an answer.
//
// And the models a store may ask (models.ts `catalogued`): planted in every
// app's store by the platform, and saved by nobody.
export let PLATFORM = [...KERNEL, 'person', 'provider', 'model', 'serves']

export type Row = Record<string, unknown>

/** Whether a filter line names a component, in any of the three ways a clause
 * can: present (`.created`), absent (`!created`) or wanted (`?created`). */
export let names = (line: string, word: string) =>
  ['.', '!', '?'].some((mark) => line.includes(mark + word))

// The same rule, asked instead of answered: the platform's own rows left out
// of the question. A listing can only screen an answer's rows, so a `.count`
// over one filter still counted what the list beside it did not show — a
// person row wears a `doc` title now, so it matches `.doc` (T-32627).
// Screening the ask is what makes an aggregate, a search and a list agree, and
// every door that serves a page asks this way. Naming one asks for it back,
// and an address asks for its row whatever kind of row it is.
// `words` names which of them to screen for, because a store refuses a filter
// naming a component it never planted — screening for a word this store has no
// table for would refuse the whole read rather than narrow it. A caller that
// knows the store's vocabulary passes the ones it declares; the default is
// every platform word.
export let asking = (line: string, words: string[] = PLATFORM) => {
  if (!line.replace(/^[?&]+/, '') || line.includes('id=')) return line
  let screen = words.filter((k) => !names(line, k)).map((k) => `!${k}`)
  return screen.length ? `${line}&${screen.join('&')}` : line
}

// The rule itself, over rows: what this filter line's answer carries.
export let listed = (rows: Row[], asked: string): Row[] => {
  let hidden = STAMPS.filter((s) => !names(asked, s))
  let out: Row[] = []
  for (let row of rows) {
    let kernel = KERNEL.filter((k) => k in row)
    if (kernel.length && !kernel.some((k) => names(asked, k))) continue
    let kept = Object.fromEntries(
      Object.entries(row).filter(([k]) => !hidden.includes(k)),
    )
    // `entity` and `kind` name a row; one with nothing else left was a stamp.
    if (Object.keys(kept).some((k) => k != 'entity' && k != 'kind')) {
      out.push(kept)
    }
  }
  return out
}

// Outputs speak human (db.ts `human()`) at an app's store too: a property that
// references a person answers `{eid, name}` when this store knows the person,
// and the bare eid when it does not. A view gets one query, and a byline it
// would need a second question for is no byline: the inline leaderboard drew
// "someone" on every row while `created.by` was a uuid (C-32730 item 5). Writes
// are unmoved — the value is the eid, and a read shape handed back is lowered
// to it (db.ts `admitted`).
//
// The query door answers rows painted this way. A socket answers the rows as
// the store keeps them, with `Names` beside them, because a page that keeps a
// copy of its store (@yaks/client) lands each row in the store's own words,
// where `created.by` is an eid; the served client paints the frame's rows with
// the same rule (public/client.js `named`), so its `subscribe()` still answers
// what `query()` does.
//
// Which properties reference is the caller's word (the vocabulary), and so is
// who among the eids is a person (the store's rows): only the caller holds a
// store to ask with (graph.ts).
export type Ref = (comp: string, prop: string) => boolean

/** Who a list of rows points at, as the store says it beside them: the
 * referencing properties the rows hold an eid in (`created.by`), and what the
 * store calls each person among those eids. */
export type Names = { refs: string[]; names: Record<string, string> }

let props = (comp: unknown): comp is Row =>
  !!comp && typeof comp == 'object' && !Array.isArray(comp)

// Every place the rows hold an eid in a referencing property.
let places = function* (rows: Row[], ref: Ref) {
  for (let row of rows) {
    for (let [comp, held] of Object.entries(row)) {
      if (!props(held)) continue
      for (let [prop, v] of Object.entries(held)) {
        if (typeof v == 'string' && ref(comp, prop)) yield { comp, prop, v }
      }
    }
  }
}

/** The eids the rows point at, and the properties that hold them. */
export let mentions = (rows: Row[], ref: Ref) => {
  let eids = new Set<string>()
  let refs = new Set<string>()
  for (let { comp, prop, v } of places(rows, ref)) {
    eids.add(v)
    refs.add(`${comp}.${prop}`)
  }
  return { eids: [...eids], refs: [...refs] }
}

/** The rows, each reference to someone the store named painted `{eid,
 * name}`. Nobody to name is the rows themselves. */
export let named = (rows: Row[], { refs, names }: Names): Row[] => {
  if (!Object.keys(names).length) return rows
  let at = new Set(refs)
  let name = (held: Row, comp: string) =>
    Object.fromEntries(
      Object.entries(held).map(([prop, v]) =>
        typeof v == 'string' && Object.hasOwn(names, v) &&
          at.has(`${comp}.${prop}`)
          ? [prop, { eid: v, name: names[v] }]
          : [prop, v]
      ),
    )
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .map(([comp, held]) => [comp, props(held) ? name(held, comp) : held]),
    )
  )
}

// The same rule over a door's JSON body — what the kernel hands a page back
// from the store's own answer.
export let listing = (body: string, asked: string) => {
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    return body
  }
  if (!Array.isArray(rows)) return body
  return JSON.stringify(listed(rows as Row[], asked))
}
