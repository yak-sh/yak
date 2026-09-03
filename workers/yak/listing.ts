// What a LISTING carries, in one place, because a filter line has one answer:
// the same query asked by the person's agent (tools.ts graph_query), by their
// page (apps.ts `/api/query`) and by the socket that keeps answering it
// (store.ts `/ws`) is the same question, and the doors answered it differently
// — the tools hid the platform's stamps, the page's door returned them
// (C-32574 item 5), and the live door sent raw changes, so a page's rows
// changed shape the moment they moved (C-32624 item 2). The rule lives here
// and every door reads it.
//
// The rule itself is T-32506's (C-32498 item 10): a listing answers the rows
// a person SAVED, without the bookkeeping the store keeps about saving them,
// and without a row that is nothing but bookkeeping. Naming a stamp in the
// filter (`.created!`, `.created.by=…`) asks for it back — a door never hides
// what was asked for. Anything that is not a row listing (an aggregate, a
// count) passes through as it came.

// The platform's bookkeeping about a row — who wrote it and when, whether it
// has been served. `archived` is not here: an app's agent reads and writes it
// (it is how an error is marked fixed), so it is the person's business too.
export let STAMPS = ['created', 'updated', 'notified', 'opened', 'quarantined']

// The kernel's own rows ABOUT the app, which nobody saved: a break the
// platform wrote down (unseen.ts `noted`) and a failure it expected. They are
// read through `app_errors`, not through a listing, so a listing leaves them
// out unless the filter names one — the deliberate opt-in src/query.ts
// `selected()` asks for the store's blob rows. Asking for the stamps is not
// asking for these: `.created!` alone dragged every exception into a person's
// list of their own rows (C-32607 item 4).
export let KERNEL = ['exception', 'error']

// A PERSON is the platform's row too — a store mints one for whoever writes to
// it, so `created.by` has a name to resolve (store.ts `knows`) — but only in an
// APP's store: the directory's own graph is made of people, and the agent tier
// reads that through the same listing. So a person is screened out of the
// QUESTION, which only a page's doors ask, and never out of an answer.
export let PLATFORM = [...KERNEL, 'person']

export type Row = Record<string, unknown>

// The same rule, asked instead of answered: the platform's own rows left out
// of the QUESTION. A listing can only screen an answer's rows, so a `.count!`
// over one filter still counted what the list beside it did not show — a
// person row wears a `doc` title now, so it matches `.doc!` (T-32627).
// Screening the ask is what makes an aggregate, a search and a list agree, and
// every door that serves a PAGE asks this way. Naming one asks for it back,
// and an address asks for its row whatever kind of row it is.
export let asking = (line: string) => {
  if (!line.replace(/^[?&]+/, '') || line.includes('id=')) return line
  let screen = PLATFORM.filter((k) => !line.includes(`.${k}`))
    .map((k) => `.${k}=`)
  return screen.length ? `${line}&${screen.join('&')}` : line
}

// The rule itself, over rows: what this filter line's answer carries.
export let listed = (rows: Row[], asked: string): Row[] => {
  let hidden = STAMPS.filter((s) => !asked.includes(`.${s}`))
  let out: Row[] = []
  for (let row of rows) {
    let kernel = KERNEL.filter((k) => k in row)
    if (kernel.length && !kernel.some((k) => asked.includes(`.${k}`))) continue
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

// Outputs speak human (db.ts `human()`) at an app's store too: a column that
// REFERENCES a person answers `{eid, name}` when this store knows the person,
// and the bare eid when it does not. A view gets ONE query, and a byline it
// would need a second question for is no byline: the inline leaderboard drew
// "someone" on every row while `created.by` was a uuid (C-32730 item 5). So
// the name rides on the row that names the eid. Writes are unmoved — the value
// is the eid, and a read shape handed back is lowered to it (db.ts `admitted`).
//
// Which columns REFERENCE, and what the store calls the people among them, are
// the caller's word: the rule is the same over a fetch and over a socket, and
// only the caller holds a db to ask with (query.ts).
export type Ref = (comp: string, col: string) => boolean
export type Names = (eids: string[]) => Map<string, string>

let cols = (comp: unknown): comp is Row =>
  !!comp && typeof comp == 'object' && !Array.isArray(comp)

export let named = (rows: Row[], ref: Ref, names: Names): Row[] => {
  let mentioned = new Set<string>()
  for (let row of rows) {
    for (let [comp, held] of Object.entries(row)) {
      if (!cols(held)) continue
      for (let [col, v] of Object.entries(held)) {
        if (typeof v == 'string' && ref(comp, col)) mentioned.add(v)
      }
    }
  }
  if (!mentioned.size) return rows
  let known = names([...mentioned])
  if (!known.size) return rows
  let name = (held: Row, comp: string) =>
    Object.fromEntries(
      Object.entries(held).map(([col, v]) =>
        typeof v == 'string' && known.has(v) && ref(comp, col)
          ? [col, { eid: v, name: known.get(v) }]
          : [col, v]
      ),
    )
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .map(([comp, held]) => [comp, cols(held) ? name(held, comp) : held]),
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
