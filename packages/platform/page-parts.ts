/**
 * The parts yaks.app's signed-in pages are made of, said once (the style
 * guide's One design language): a card's head, a field under its label, a
 * form's button, an empty list, and a settings form that joins the page's
 * Save bar. The server draws pages with them, and the browser draws the views
 * that moved onto the page graph (D-475) with the same.
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Empty } from '@yaks/ui/Empty'
import { Form } from '@yaks/ui/Form'

/** A card's head: its mark, its title, how it stands, and what acts on the
 * whole card, at the right. */
export let heading = (
  title: Kids,
  at: { mark?: Kids; status?: Kids; actions?: Kids; id?: string } = {},
) =>
  h(
    Card.Head,
    null,
    at.mark,
    h(Card.Title, { id: at.id }, title),
    at.status,
    at.actions ? h(Card.Actions, null, at.actions) : null,
  )

/** A field: its label, its control, and what explains it under both. */
export let labeled = (
  id: string,
  label: Kids,
  control: Kids,
  hint: Kids = '',
) =>
  h(
    Form.Field,
    null,
    h(Form.Label, { for: id }, label),
    control,
    hint ? h(Form.Hint, null, hint) : null,
  )

/** One button that sends the form it is in. */
export let send = (label: Kids) =>
  h(Button, { mod: 'go', type: 'submit' }, label)

/** Nothing in a list yet: what will be there, and how it gets there. */
export let empty = (title: string, ...says: Kids[]) =>
  h(Empty, null, h(Empty.Title, null, title), says)

/** Where a form says what came of a write, under its button
 * (./account-browser.ts `tell`). */
export let said = () =>
  h(Form.Hint, { as: 'p', role: 'status', 'data-said': '', hidden: true })

/** One choice of a select. */
export let option = (value: string, label: string, chosen: boolean) =>
  h('option', { value, selected: chosen }, label)

/** The fields a card holds, one under the other. */
export let fieldsOf = (...kids: Kids[]) =>
  h(Form, { class: 'Page_Form', as: 'div' }, kids)

/** Settings that join the page's Save bar; creation keeps its own action. */
export let saving = (action: string, card: Kids, label = 'Save') =>
  h(
    Form,
    {
      class: 'Page_Form',
      method: 'post',
      action,
      ...label == 'Save' ? { 'data-save': action } : {},
    },
    card,
    label == 'Save' ? null : h(Form.Actions, null, send(label)),
  )

/** What a settings form saves through in place of posting, set on the form by
 * the script that draws its page from the page graph (./account-browser.ts)
 * and called by the page's Save bar (yaks.app's settings.ts) with what the
 * form holds. What it resolves to is what the bar says. */
export let SAVE_THROUGH = Symbol.for('@yaks/platform/save-through')

/** A form that may say what it saves through. */
export type SavingForm = HTMLFormElement & {
  [SAVE_THROUGH]?: (body: FormData) => Promise<string | undefined>
}
