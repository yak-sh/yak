import { type Bundle, type Comp, mint } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { merge } from '@yaks/draft'
import type { Vault } from '@yaks/secrets'
import { credentialDraftPlace } from './credential-draft-place.ts'

let PREFIX = 'yak_draft_'
export let draftReference = (text: string): boolean =>
  /^yak_draft_[0-9a-f-]{36}$/.test(text)

export let credentialDraft = (row: Bundle): Comp | undefined => {
  let draft = row?.draft as Comp | undefined
  return credentialDraftPlace(draft?.place) ? draft : undefined
}

/** A draft revision gets its own record, so a delayed write, failed graph
 * commit, or restored snapshot cannot change what an existing reference opens. */
export let sealDraft = async (
  vault: Pick<Vault, 'seal'>,
  owner: string,
  text: string,
  id = mint(),
): Promise<string> => {
  if (!text) return ''
  let handle = PREFIX + id
  await vault.seal(id, { name: owner, handle, value: text })
  return handle
}

/** Open only a reference belonging to this draft's identity. */
export let openDraft = async (
  vault: Pick<Vault, 'read'>,
  owner: string,
  text: string,
): Promise<string> => {
  if (!draftReference(text)) return text
  let record = await vault.read(text.slice(PREFIX.length))
  if (
    record?.name !== owner || record.handle !== text || record.value == null
  ) {
    throw new Error(
      'The credential draft could not be recovered from the vault',
    )
  }
  return record.value
}

export let openDraftRow = async (
  vault: Pick<Vault, 'read'>,
  row: Bundle,
): Promise<Bundle> => {
  let draft = credentialDraft(row)
  return typeof draft?.text == 'string'
    ? {
      ...row,
      draft: {
        ...draft,
        text: await openDraft(vault, row.entity.eid, draft.text),
      },
    }
    : row
}

/** Merge at the private door, before the write or its recovery receipt
 * reaches the graph. The revision guards competing writes. */
export let mergeDraft = async (
  vault: Pick<Vault, 'read' | 'seal'>,
  row: Bundle,
  draft: Comp,
  held: Comp | undefined,
  text: string,
  over: string,
): Promise<{ text: string; row: Bundle }> => {
  let { eid } = row.entity
  let before = String(held?.text ?? '')
  let current = await openDraft(vault, eid, before)
  let merged = merge(over, text, current)
  let saved = merged == current && (!current || draftReference(before))
    ? before
    : await sealDraft(vault, eid, merged)
  let { typed: _, ...rest } = row
  return {
    text: merged,
    row: {
      ...rest,
      draft: { ...draft, text: saved },
      $was: {
        ...row.$was,
        draft: { ...row.$was?.draft, rev: token(held?.rev) },
      },
    },
  }
}
