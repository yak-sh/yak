/** The platform draft desk keeps every keystroke before a paced source save.
 * The worker vouches identity and exposes only that caller's draft receipts.
 * The desk's module is the platform's, served beside the page
 * (`api/_draft.js`) and never among the app's files, so it is loaded where
 * the page runs. */
import type { browserDrafts } from '@yaks/draft/browser'
import type { Bundle } from '@yaks/graph'

/** One of the studio's doors, asked by name; given a value it is a write. */
// deno-lint-ignore no-explicit-any
export type Ask = (name: string, value?: unknown) => Promise<any>

/** A field a person types or picks in. */
export type Typed = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/** The fields a draw has bound to their drafts, and how to let them go. */
export type Recovering = {
  /** keep what is typed in one field under `place` */
  field: (input: Typed, place: string) => void
  /** keep every named field of a form, each under `place:name` */
  bind: (form: Element, place: string) => void
  /** let go of every field bound so far, before the next draw */
  unbind: () => void
  close: () => void
}

type Row = Bundle & {
  draft: { place: string; text: string }
  typed?: { over?: string }
}

let platform = async (base: string): Promise<typeof browserDrafts> =>
  (await import(new URL('api/_draft.js', base).href)).browserDrafts

/** The draft desk of the page at `base`, its drafts read and written through
 * the worker's `drafts` door. */
export let recovery = async (
  request: Ask,
  report: (error: unknown) => void,
  base: string = document.baseURI,
  drafts: () => Promise<typeof browserDrafts> = () => platform(base),
): Promise<Recovering> => {
  let [initial, make] = await Promise.all([request('drafts'), drafts()])
  let rows: Row[] = initial.drafts ?? [],
    listeners = new Set<(rows: Bundle[]) => void>(),
    bound: (() => void)[] = []
  let known = new Set(rows.map((row) => row.draft.place)),
    baseline = new Map<string, string>()
  let client = {
    me: () => Promise.resolve({ person: initial.principal }),
    subscribe: (_query: string, hear: (rows: Bundle[]) => void) => {
      listeners.add(hear)
      hear(rows)
      return () => listeners.delete(hear)
    },
    apply: async (bundles: Bundle[]) => {
      let applied: Row[] = []
      for (let row of bundles as Row[]) {
        let answer = await request('drafts', {
          principal: initial.principal,
          place: row.draft.place,
          text: row.draft.text,
          over: row.typed?.over ?? '',
        })
        applied.push(...answer.bundles)
      }
      let next = new Map(rows.map((row) => [row.entity.eid, row]))
      for (let row of applied) next.set(row.entity.eid, row)
      rows = [...next.values()]
      for (let hear of listeners) hear(rows)
      return { bundles: applied }
    },
  }
  let desk = make(client, new URL('./api/', base).href, {
    by: initial.principal,
    recover: initial.recover ?? [],
    report,
  })
  let field = (input: Typed, place: string) => {
    let previous = baseline.get(place)
    if (previous !== undefined && previous !== input.value) {
      desk.restore(place, input.value, previous)
    } else if (!known.has(place) && !desk.has(place)) {
      desk.restore(place, input.value)
    }
    baseline.set(place, input.value)
    known.add(place)
    bound.push(desk.bind(input as HTMLInputElement, place))
  }
  return {
    field,
    bind: (form, place) => {
      for (
        let input of form.querySelectorAll<Typed>(
          'input[name]:not([type=hidden]),textarea[name],select[name]',
        )
      ) field(input, place + ':' + input.name)
    },
    unbind: () => {
      for (let stop of bound.splice(0)) stop()
    },
    close: () => desk.close(),
  }
}
