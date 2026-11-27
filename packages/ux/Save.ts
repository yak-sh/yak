/** Controlled pending changes; persistence and writes belong to the host. */
import { createElement as h, type JSX, type ReactNode } from 'react'
import { Button, type Props, Save as Paint } from '@yaks/ui/parts'

export type SaveProps = {
  count: number
  busy?: boolean
  /** why the last save did not work; it stays until the next */
  message?: string
  /** what the last save said, such as "Saved", shown while it fades */
  done?: string
  inline?: boolean
  mod?: Props['mod']
  onSave: () => unknown
  onDiscard: () => unknown
}

/** The place beside a field where bindSave draws the form's actions. */
let Slot = (): JSX.Element =>
  h(
    'div',
    { 'data-save-slot': '' },
    h('noscript', null, h(Button, { type: 'submit', mod: 'go' }, 'Save')),
  )

export type SaveFieldProps = Props & {
  changed: boolean
  children?: ReactNode
}

let Field = (
  { changed, children, mod, ...props }: SaveFieldProps,
): JSX.Element =>
  h(
    Paint.Field,
    {
      ...props,
      mod: [...[mod].flat(), changed && 'changed'],
      'data-changed': changed || undefined,
    },
    children,
  )

/** The one place to save or discard all the host's pending changes, saying
 * "Saving…" while it saves, then what the save said until it fades. */
export let Save: ((props: SaveProps) => JSX.Element | null) & {
  Field: typeof Field
  Slot: typeof Slot
} = Object.assign(
  ({ count, busy, message, done, inline, mod, onSave, onDiscard }: SaveProps) =>
    inline || count || busy || message || done
      ? h(
        Paint,
        {
          mod: [
            ...[mod].flat(),
            inline && 'inline',
            !inline && !busy && !count && !message && done && 'done',
          ],
          'aria-label': 'Changes',
        },
        h(
          Paint.Count,
          { role: 'status', 'aria-live': 'polite' },
          busy
            ? 'Saving…'
            : count && !inline
            ? `${count} ${count == 1 ? 'change' : 'changes'}`
            : message
            ? ''
            : done,
        ),
        count ||
          inline
          ? h(
            Paint.Actions,
            {},
            count
              ? h(Button, {
                type: 'button',
                mod: 'quiet',
                disabled: busy,
                onClick: onDiscard,
              }, 'Discard')
              : null,
            h(Button, {
              type: inline ? 'submit' : 'button',
              mod: 'go',
              'aria-busy': busy || undefined,
              disabled: busy,
              onClick: inline ? undefined : onSave,
            }, 'Save'),
          )
          : null,
        message && h(Paint.Notice, { role: 'alert' }, message),
      )
      : null,
  { Field, Slot },
)
