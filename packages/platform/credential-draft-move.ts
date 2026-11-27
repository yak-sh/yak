import { retainedWrites, rewriteWrite } from '@yaks/api/log'
import { after } from '@yaks/fp'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { line, sub } from '@yaks/query'
import type { Vault } from '@yaks/secrets'
import type { Driver } from '@yaks/sql'
import { retainedBodies, rewriteRetained } from '@yaks/sqlite/trash'
import { unit } from '@yaks/sqlite/unit'
import {
  credentialDraft,
  draftReference,
  mergeDraft,
  openDraft,
  sealDraft,
} from './credential-drafts.ts'

export let CREDENTIAL_DRAFT_MOVE = 'yak/store/credential-drafts/1' as const
let SIZE = 15

type VaultDoor = Pick<Vault, 'read' | 'seal'>
export type CredentialDraftMove = {
  live?: string
  trash?: number
  writes?: number
  done?: true
  moved?: number
}

let plaintext = (text: unknown): text is string =>
  typeof text == 'string' && !!text && !draftReference(text)

let protect = async (vault: VaultDoor, row: Bundle): Promise<Bundle> => {
  let draft = credentialDraft(row)
  if (!draft || typeof row.entity?.eid != 'string') return row
  let { eid } = row.entity
  let typed = row.typed as Comp | undefined
  let text = draft.text, over = typed?.over
  if (!plaintext(text) && !plaintext(over)) return row
  return {
    ...row,
    draft: {
      ...draft,
      text: plaintext(text) ? await sealDraft(vault, eid, text) : text,
    },
    ...typed && {
      typed: {
        ...typed,
        over: plaintext(over) ? await sealDraft(vault, eid, over) : over,
      },
    },
  }
}

/** Prepare a pre-cutover write from the recovery log, whether or not its
 * payload has been migrated yet. Only its sealed result reaches the graph. */
export let prepareCredentialWrites = (
  graph: Pick<Graph, 'get'>,
  vault: VaultDoor,
  rows: Bundle[],
): Bundle[] | Promise<Bundle[]> => {
  let legacy = rows.filter((row) =>
    typeof credentialDraft(row)?.text == 'string' &&
    typeof (row.typed as Comp | undefined)?.over == 'string'
  )
  if (!legacy.length) return rows
  return Promise.all(rows.map(async (row) => {
    if (!legacy.includes(row)) return row
    let { eid } = row.entity
    let [held] = await graph.get([eid], ['draft'])
    let draft = row.draft as Comp
    let [text, over] = await Promise.all([
      openDraft(vault, eid, String(draft.text)),
      openDraft(vault, eid, String((row.typed as Comp).over)),
    ])
    return (await mergeDraft(
      vault,
      row,
      draft,
      held?.draft as Comp | undefined,
      text,
      over,
    )).row
  }))
}

let live = async (graph: Graph, vault: VaultDoor, cursor?: string) => {
  let rows = await graph.read(
    line`.draft.place>=${'settings:'}&.draft.place<${'settings;'}${
      sub(cursor ? line`&.entity.eid>${cursor}` : line``)
    }&.order=entity.eid&.limit=${SIZE}`,
  )
  let clean = await Promise.all(rows.map((row) => protect(vault, row)))
  let moved = 0
  await graph.storage.tx((tx) =>
    after(tx.get(rows.map((row) => row.entity.eid), ['draft']), (held) => {
      let contents = new Map(
        held.map((row) => [row.entity.eid, row.draft as Comp]),
      )
      let patches = clean.flatMap((row, i) => {
        let before = rows[i].draft as Comp
        let current = contents.get(row.entity.eid)
        if (
          row === rows[i] || !current || current.text !== before.text ||
          current.place !== before.place
        ) return []
        return [{
          entity: row.entity,
          draft: { text: (row.draft as Comp).text },
        }]
      })
      moved = patches.length
      if (moved) return tx.patch(patches)
    })
  )
  return {
    live: rows.at(-1)?.entity.eid ?? cursor,
    ...rows.length < SIZE && { trash: 0 },
    moved,
  }
}

let trash = async (db: Driver, vault: VaultDoor, cursor: number) => {
  let rows = retainedBodies(db, cursor, SIZE)
  let moved = 0
  for (let row of rows) {
    let before = JSON.parse(row.body) as Bundle
    let sealed = await protect(vault, before)
    if (sealed === before) continue
    rewriteRetained(db, row, JSON.stringify(sealed))
    moved++
  }
  return {
    trash: rows.at(-1)?.id ?? cursor,
    ...rows.length < SIZE && { writes: 0 },
    moved,
  }
}

let bundled = async (vault: VaultDoor, body: string): Promise<string> => {
  if (!body.includes('settings:')) return body
  let rows: Bundle[]
  try {
    rows = JSON.parse(body)
  } catch {
    return body
  }
  if (!Array.isArray(rows)) return body
  let sealed = await Promise.all(rows.map((row) => protect(vault, row)))
  return sealed.some((row, i) => row !== rows[i])
    ? JSON.stringify(sealed)
    : body
}

let writes = async (
  db: Driver,
  vault: VaultDoor,
  cursor: number,
) => {
  let rows = retainedWrites(db, cursor, SIZE)
  let moved = 0
  for (let row of rows) {
    let [body, answer] = await Promise.all([
      row.binary ? row.body : bundled(vault, row.body),
      row.answer == null ? null : bundled(vault, row.answer),
    ])
    if (body !== row.body || answer !== row.answer) {
      if (!unit(db, () => rewriteWrite(db, row, body, answer))) {
        return { writes: cursor, moved }
      }
      moved++
    }
    cursor = row.seq
  }
  return {
    writes: cursor,
    ...rows.length < SIZE && { done: true as const },
    moved,
  }
}

/** Take one bounded pass over live drafts, trash, or kept write receipts.
 * The vault write lands first, so a failed pass can retry from its receipt
 * without risking any person's draft. */
export let moveCredentialDrafts = async (
  graph: Graph,
  db: Driver,
  vault: VaultDoor,
  was: CredentialDraftMove,
): Promise<CredentialDraftMove> => {
  if (was.done) return was
  let next = was.writes != null
    ? await writes(db, vault, was.writes)
    : was.trash != null
    ? await trash(db, vault, was.trash)
    : await live(graph, vault, was.live)
  return { ...was, ...next, moved: (was.moved ?? 0) + next.moved }
}
