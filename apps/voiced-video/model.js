// Where one video stands, from the rows the workflow's steps wrote: each a
// current take of a step's output (`built.current=true`).

/** A reference as a read speaks it: the eid, or `{eid, name}`. */
export let idOf = (v) => typeof v == 'string' ? v : v?.eid ?? null

let of = (rows, comp, prop, eid) =>
  rows.filter((r) => r[comp] && idOf(r[comp][prop]) == eid)
let byN = (comp) => (a, b) => a[comp].n - b[comp].n

/** The video's characters, each with its auditions and the decision asking
 * for its voice; its lines, each with its voicing once said; its cut; and the
 * builds of its steps that failed (`.build&.failed`). */
export let progress = (video, rows, failures = []) => {
  let roles = of(rows, 'role', 'video', video).map((r) => {
    let ask = of(rows, 'cast', 'role', r.entity.eid).find((d) => d.decision)
    return {
      eid: r.entity.eid,
      name: r.doc?.title ?? '',
      about: r.role.about ?? '',
      auditions: of(rows, 'audition', 'role', r.entity.eid),
      ask: ask?.entity.eid ?? null,
      chosen: ask?.decided?.choice ?? null,
    }
  })
  let named = new Map(roles.map((r) => [r.eid, r.name]))
  let lines = of(rows, 'line', 'video', video).toSorted(byN('line')).map((
    l,
  ) => ({
    eid: l.entity.eid,
    n: l.line.n,
    who: named.get(idOf(l.line.role)) ?? '',
    text: l.doc?.body ?? '',
    audio: of(rows, 'voicing', 'line', l.entity.eid)[0]?.voicing.audio ?? null,
  }))
  let cut = of(rows, 'cut', 'video', video)[0]?.cut ?? null
  let ours = new Set([video, ...roles, ...lines].map((r) => r.eid ?? r))
  let failed = failures.filter((b) => ours.has(idOf(b.build.for)))
  return { roles, lines, cut, failed }
}

/** What the person is shown as the video's state, in one line. */
export let stage = ({ roles, lines, cut }) => {
  if (cut) return 'Ready to play.'
  if (!lines.length) return 'Writing the script…'
  let waiting = roles.filter((r) => !r.chosen)
  if (waiting.some((r) => !r.ask)) return 'Auditioning voices…'
  if (waiting.length) {
    return `Choose a voice for ${waiting.map((r) => r.name).join(', ')}.`
  }
  let said = lines.filter((l) => l.audio).length
  return `Voicing lines: ${said} of ${lines.length}.`
}
