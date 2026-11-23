// The person step before printing: once PrintBound has composed a book's print
// document, the workflow's "Approve the print document" builder (seed.json)
// asks the book's owner, as a decision in their Updates and on the studio's
// print card, whether to print it as it looks. Only an approved document is
// quoted; a new document (pages changed, prepared again) is asked anew.
import type { Bundle } from '@yaks/graph'
import { identifier, Refusal, type Store } from './db.ts'
import type { Book } from './model.ts'
import { APPROVE, CHANGE } from './approve.ts'

type Binding = {
  entities: string[]
  vars: { title: string; owner: string; revision: string }
}

/** The builder's step: one decision for the book's reviewed document. */
export let ask = ({ entities: [book], vars }: Binding) => ({
  outputs: [{
    slot: 'approval',
    inputs: [book],
    components: {
      task: {},
      filed: { assignee: vars.owner },
      decision: {
        question:
          `Print “${vars.title}” as its preview shows it? Every page, the cover and the blank leaves are in the preview on the book's print card.`,
        choices: [
          {
            label: APPROVE,
            description:
              'Print these files. You choose where copies go and see the price before paying.',
          },
          {
            label: CHANGE,
            description:
              'Edit, redraw or reorder pages first; the book is prepared and asked again.',
          },
        ],
        recommended: APPROVE,
      },
      print_approval: { book, revision: vars.revision },
      doc: { title: `Approve “${vars.title}” for print` },
    },
  }],
})

export type Approval = { decision: string; choice?: string }

/** The question asked of a book's reviewed document, and its answer. */
export let approval = async (
  db: Store,
  book: Book,
): Promise<Approval | null> => {
  let revision = book.print_review?.revision
  if (!revision) return null
  let [asked] = await db.query(
    `.print_approval.book=${book.entity.eid}&.print_approval.revision=${
      identifier(revision)
    }&.built.current=true&?decided`,
  ) as Bundle[]
  if (!asked) return null
  let choice = (asked.decided as { choice?: string } | undefined)?.choice
  return { decision: asked.entity.eid, ...choice ? { choice } : {} }
}

/** The owner's answer, from the studio. */
export let answer = async (db: Store, book: Book, choice: unknown) => {
  if (choice !== APPROVE && choice !== CHANGE) {
    throw new Refusal('Choose to approve the document or change pages.')
  }
  let asked = await approval(db, book)
  if (!asked) {
    throw new Refusal('This book’s print document is still being prepared.')
  }
  await db.apply([{
    entity: { eid: identifier(asked.decision) },
    decided: { choice },
  }])
  return { ...asked, choice }
}

/** Whether the document a quote is for was approved by its owner. */
export let approved = async (db: Store, book: Book) =>
  (await approval(db, book))?.choice === APPROVE
