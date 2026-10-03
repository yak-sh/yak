/** A decision's question, choices and answer, shared by browser and terminal. */
import { h, type JSX } from 'preact'
import type { Bundle, Comp } from '@yaks/graph'
import type { Drafts } from '@yaks/draft'
import { Button, Field, Notes, Say, Section } from '@yaks/ui'
import { answer, type Decision } from './decision.ts'

/** Where a custom answer waits, across every interface. */
export let answerPlace = (eid: string): string => `${eid}.decision.answer`

/** Domain controls; the host owns writes, drafts and reference names. */
export let DecisionForm = (
  { e, drafts, apply, name, blocking, caret }: {
    e: Bundle
    drafts: Drafts
    apply: (bundles: Bundle[]) => unknown
    name: (eid: string) => string
    blocking?: boolean
    caret?: number
  },
): JSX.Element | null => {
  let d = e.decision as Decision | undefined
  if (!d) return null
  let eid = e.entity.eid
  let decided = e.decided as Comp | undefined
  let open = !decided && !e.cancelled
  let place = answerPlace(eid)
  let text = drafts.text(place)
  let send = () => {
    if (text.trim()) drafts.spend(place, answer(eid, text))
  }
  return h(
    Section,
    { 'data-decision': eid },
    h(
      Section.Title,
      {},
      'Decision',
      h(
        Section.Note,
        {},
        open
          ? (blocking == null ? '…' : blocking ? 'blocking' : 'eventual')
          : e.cancelled
          ? 'cancelled'
          : 'answered',
      ),
    ),
    h('p', {}, d.question),
    h(
      Notes,
      {},
      d.choices.map((c, i) =>
        h(
          Notes.Item,
          { key: c.label },
          open
            ? h(Button, {
              type: 'button',
              onClick: () => apply(answer(eid, c.label)),
            }, `${i + 1}. ${c.label}`)
            : h(Notes.Text, {}, `${i + 1}. ${c.label}`),
          c.label == d.recommended && h(Section.Note, {}, 'recommended'),
          h('p', {}, c.description),
        )
      ),
    ),
    decided &&
      h(
        'p',
        {},
        'Answered: ',
        String(decided.choice ?? ''),
        decided.by ? ` · by ${name(String(decided.by))}` : '',
        decided.at ? ` · ${decided.at}` : '',
      ),
    open && h(
      Say,
      {
        onSubmit: (event: Event) => {
          event.preventDefault()
          send()
        },
      },
      h(Field, {
        value: text,
        caret,
        placeholder: 'Your own answer…',
        'aria-label': 'Your own answer',
        onInput: (event: Event) =>
          drafts.type(place, (event.currentTarget as HTMLInputElement).value),
      }),
      h(Button, {
        type: 'submit',
        disabled: !text.trim(),
        onClick: (event: Event) => {
          event.preventDefault()
          send()
        },
      }, 'Answer'),
    ),
  )
}
