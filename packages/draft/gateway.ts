import { type Bundle, token } from '@yaks/graph'
import { draftEid } from './desk.ts'
import { merge } from './merge.ts'

export type DraftDoor = {
  query(q: string): Promise<Bundle[]>
  apply(rows: Bundle[]): Promise<{ bundles: Bundle[] }>
}
export type DraftIdentity = { person?: string | null; via?: string | null }
export class DraftRefused extends Error {}
type DraftRow = Bundle & {
  draft: {
    by?: string
    via?: string
    place: string
    text: string
    rev?: number
  }
  created?: { by?: string; via?: string }
}
export type DraftSnapshot = {
  principal: string
  via?: string | null
  drafts: DraftRow[]
  recover: string[]
}
export type DraftGateway = {
  snapshot(): Promise<DraftSnapshot>
  write(value: Record<string, unknown>): Promise<{ bundles: Bundle[] }>
}
let identity = (who: DraftIdentity) => {
  let by = who.person || who.via
  if (!by || !/^[a-f0-9-]{36}$/i.test(by)) {
    throw new DraftRefused('Open this page again to recover your saved draft.')
  }
  return by
}
/** A private application's vouched draft door, using the same desk and merge
 * protocol as a page whose graph is directly accessible. */
export let draftGateway = (db: DraftDoor, who: DraftIdentity): DraftGateway => {
  let by = identity(who)
  let read = (by: string) => db.query(`.draft.by=${by}`) as Promise<DraftRow[]>
  let guestRows = (via: string) =>
    db.query(`.draft.via=${identity({ via })} !draft.by`) as Promise<
      DraftRow[]
    >
  return {
    async snapshot() {
      let rows = await (who.person ? read(by) : guestRows(by)),
        recover: string[] = []
      if (who.person) {
        // Directory sign-in receipts fill guest authorship independently of
        // an app-store failure. Their original via still identifies the input.
        let attributed = await db.query(
          `.draft !draft.by .created.by=${by}`,
        ) as DraftRow[]
        let earlier = attributed.filter((row) =>
          row.draft.via && row.draft.via === row.created?.via
        )
        let current = who.via && who.via !== by ? await guestRows(who.via) : []
        let guest = [
          ...new Map([
            ...earlier,
            ...current.filter((row) =>
              !row.created?.by || row.created.by === by
            ),
          ].map((row) => [row.entity.eid, row])).values(),
        ]
        recover = [
          ...new Set([
            ...earlier.map((row) => row.draft.via!),
            ...who.via &&
                !current.some((row) => row.created?.by && row.created.by !== by)
              ? [who.via]
              : [],
          ]),
        ]
        if (guest.length) {
          let changes: Bundle[] = []
          for (let row of guest) {
            let existing = rows.find((r) => r.draft.place === row.draft.place)
            let text = row.draft.text === ''
              ? ''
              : merge('', row.draft.text, existing?.draft.text ?? '')
            changes.push({
              entity: { eid: draftEid(by, row.draft.place) },
              draft: { by, place: row.draft.place, text },
              typed: { over: existing?.draft.text ?? '' },
            }, {
              entity: row.entity,
              $delete: true,
              $was: { draft: { text: token(row.draft.text) } },
            })
          }
          await db.apply(changes)
          rows = await read(by)
        }
      }
      return { principal: by, via: who.via, drafts: rows, recover }
    },
    async write(value: Record<string, unknown>) {
      if (value.principal !== by) {
        throw new DraftRefused(
          'Your sign-in changed. This text is kept with the person who typed it.',
        )
      }
      if (
        typeof value.place !== 'string' || typeof value.text !== 'string' ||
        typeof value.over !== 'string'
      ) throw new DraftRefused('Send the saved draft again.')
      return await db.apply([{
        entity: { eid: draftEid(by, value.place) },
        draft: {
          ...(who.person ? { by } : { via: by }),
          place: value.place,
          text: value.text,
        },
        typed: { over: value.over },
      }])
    },
  }
}
