import type { Preparation } from './document.ts'
import { InputError } from './refusal.ts'

/** A renewed ticket may authorize the same immutable source bytes again.
 * Changing content, page order or typography starts another preparation. */
export let renewed = (
  old: string | undefined,
  next: unknown,
): string | undefined => {
  if (next == null || next === old) return old
  if (typeof old !== 'string' || typeof next !== 'string') {
    throw new InputError('Resume requires the same source files')
  }
  let before: URL, after: URL
  try {
    before = new URL(old)
    after = new URL(next)
  } catch {
    throw new InputError('Resume requires the same source files')
  }
  if (
    before.protocol !== 'https:' || after.protocol !== 'https:' ||
    !before.searchParams.get('ticket') || !after.searchParams.get('ticket')
  ) throw new InputError('Only source artifact tickets may be renewed')
  before.searchParams.delete('ticket')
  after.searchParams.delete('ticket')
  before.searchParams.sort()
  after.searchParams.sort()
  if (before.href !== after.href) {
    throw new InputError('The source document changed; prepare another edition')
  }
  return next
}

export let renewal = (
  state: Preparation,
  args: Record<string, unknown>,
): Preparation => {
  let draft = { ...state.draft }
  for (let field of ['front', 'back', 'interior', 'cover'] as const) {
    draft[field] = renewed(draft[field], args[field])
  }
  if (args.pages != null) {
    if (
      !Array.isArray(args.pages) || args.pages.length !== draft.pages?.length
    ) throw new InputError('Page order changed; prepare another edition')
    draft.pages = draft.pages.map((page, n) => ({
      ...page,
      blob: renewed(
        page.blob,
        (args.pages as Record<string, unknown>[])[n]?.blob,
      ),
    }))
  }
  return { ...state, draft }
}
