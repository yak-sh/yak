/**
 * The person's account saved through the tab's page graph: the Save bar of a
 * page drawn from their `account` row (./account-rows.ts), Profile's or
 * Friends', writes that row with what its form holds, and the page shows it
 * at once. What the door refuses, or a save that could not reach it, the bar
 * says, keeping what was typed.
 *
 * @module
 */
import { type Client, WriteRefused, WriteUnknown } from '@yaks/client'
import { CallError } from '@yaks/tools/errors'
import {
  type Account,
  accountEid,
  accountOf,
  type AccountWrite,
} from './account-rows.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'

/** What a page says of a write the door refused, or `unreached` of one that
 * could not reach it; anything else is a failure, thrown on. */
export let refusal = (error: unknown, unreached: string): string => {
  if (error instanceof WriteRefused) return error.message
  if (error instanceof WriteUnknown) return unreached
  throw error
}

/** What a settings form holding `body` makes of `account`. */
export let accountFrom = (account: Account, body: FormData): AccountWrite => ({
  ...account,
  ...body.has('name') ? { name: String(body.get('name')) } : {},
  ...body.has('presence') ? { hidden: body.get('presence') == 'hidden' } : {},
  ...body.has('first') ? { first: String(body.get('first')) } : {},
})

/** Save each settings form in `root` through `graph` as `person`'s account,
 * whose row `rows` reads. Called again after each redraw, since a redraw may
 * bring a form. */
export let savesAccount = (
  root: HTMLElement,
  graph: Pick<Client, 'mutate'>,
  person: string,
  rows: () => Parameters<typeof accountOf>[0],
): void => {
  for (let form of root.querySelectorAll<SavingForm>('form[data-save]')) {
    form[SAVE_THROUGH] = async (body) => {
      let account = accountOf(rows())
      if (!account) {
        throw new CallError('arguments', 'Your account is still loading.')
      }
      try {
        await graph.mutate([{
          entity: { eid: accountEid(person) },
          account: accountFrom(account, body),
        }])
      } catch (error) {
        throw new CallError(
          'arguments',
          refusal(
            error,
            'Your changes could not be saved. They are kept here. Try again.',
          ),
        )
      }
      return undefined
    }
  }
}

/** Say `words` of what came of `form`'s write where it says so (./page-parts.ts
 * `said`), as a refusal when `refused`; nothing hides it. */
export let tell = (form: HTMLElement, words: string, refused = false): void => {
  let said = form.querySelector<HTMLElement>('[data-said]')
  if (!said) return
  said.textContent = words
  said.hidden = !words
  said.classList.toggle('Form_Hint-negative', refused)
}
