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

export type Row = Record<string, unknown>

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
