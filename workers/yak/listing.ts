// What a LISTING carries, in one place, because a filter line has one answer:
// the same query asked by the person's agent (tools.ts graph_query) and by
// their page (apps.ts `/api/query`) is the same question, and the two doors
// answered it differently — the tools hid the platform's stamps, the page's
// door returned them (C-32574 item 5). The rule lives here and both doors
// read it.
//
// The rule itself is T-32506's (C-32498 item 10): a listing answers the rows
// a person SAVED, without the bookkeeping the store keeps about saving them,
// and without a row that is nothing but bookkeeping. Naming a stamp in the
// filter (`.created!`, `.created.by=…`) asks for it back — a door never hides
// what was asked for. Anything that is not a row listing (an aggregate, a
// count) passes through as it came.
//
// The live door is not a listing: `/api/ws` streams the wire's own changes,
// stamps included, because a change frame is the write as it landed. A page
// that renders stamps names them in its filter and gets them from both.

// The platform's bookkeeping about a row — who wrote it and when, whether it
// has been served. `archived` is not here: an app's agent reads and writes it
// (it is how an error is marked fixed), so it is the person's business too.
export let STAMPS = ['created', 'updated', 'notified', 'opened', 'quarantined']

export let listing = (body: string, asked: string) => {
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    return body
  }
  if (!Array.isArray(rows)) return body
  let hidden = STAMPS.filter((s) => !asked.includes(`.${s}`))
  let out = []
  for (let row of rows as Record<string, unknown>[]) {
    let kept = Object.fromEntries(
      Object.entries(row).filter(([k]) => !hidden.includes(k)),
    )
    // `entity` and `kind` name a row; one with nothing else left was a stamp.
    if (Object.keys(kept).some((k) => k != 'entity' && k != 'kind')) {
      out.push(kept)
    }
  }
  return JSON.stringify(out)
}
