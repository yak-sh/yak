import { h } from 'preact'
import { Button, Check, Field, Form } from '@yaks/ui/parts'
import { CONSENT } from '@yaks/platform/consent'

/** A proposed mobile number stays a proposal until the person submits the
 * same optional checkbox the Operator's settings page uses. */
export let contactCard = (body: string) => {
  let contact: { id?: string; number?: string; action?: string } | undefined
  try {
    contact = JSON.parse(body).contact
  } catch {
    return null
  }
  if (
    !contact?.id || !/^\+1\d{10}$/.test(contact.number ?? '') ||
    !/^\/manage\/[^/?]+\/operator\?texts=1$/.test(contact.action ?? '')
  ) return null
  return h(
    Form,
    { method: 'post', action: contact.action, 'data-contact-form': '' },
    h(Form.Hidden, { name: 'contact', value: contact.id }),
    h(Form.Hidden, { name: 'number', value: contact.number }),
    h('p', null, `Text you at ${contact.number}?`),
    h(
      Check,
      null,
      h(Check.Input, {
        type: 'checkbox',
        name: 'agreed',
        value: 'yes',
        required: true,
      }),
      h('span', null, CONSENT),
    ),
    h(
      Form.Field,
      { hidden: true, 'data-contact-code': '' },
      h(Form.Label, null, 'Verification code'),
      h(Field, {
        name: 'code',
        placeholder: '6 digits from your text',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        pattern: '[0-9]{6}',
        maxlength: 6,
      }),
    ),
    h(Button, { type: 'submit' }, 'Agree to texts'),
    h('p', { role: 'status', 'data-contact-status': '' }),
  )
}
