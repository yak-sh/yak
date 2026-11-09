/** Controlled pending changes; persistence and writes belong to the host. */
import { type ComponentChildren, h, type JSX } from 'preact'
import { Button, type Props, Save as Paint } from '@yaks/ui/parts'

export type SaveProps = {
  count: number
  busy?: boolean
  message?: string
  mod?: Props['mod']
  onSave: () => unknown
  onDiscard: () => unknown
}

export type SaveFieldProps = Props & {
  changed: boolean
  children?: ComponentChildren
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
    changed && h(Paint.Mark, {}, 'Changed'),
  )

/** The one place to save or discard all the host's pending changes. */
export let Save: ((props: SaveProps) => JSX.Element | null) & {
  Field: typeof Field
} = Object.assign(
  ({ count, busy, message, mod, onSave, onDiscard }: SaveProps) =>
    count || message
      ? h(
        Paint,
        {
          mod,
          'aria-label': 'Unsaved changes',
          'aria-busy': busy || undefined,
        },
        h(
          Paint.Count,
          { role: 'status', 'aria-live': 'polite' },
          `${count} ${count == 1 ? 'change' : 'changes'}`,
        ),
        h(
          Paint.Actions,
          {},
          h(Button, {
            type: 'button',
            mod: 'quiet',
            disabled: busy,
            onClick: onDiscard,
          }, 'Discard'),
          h(Button, {
            type: 'button',
            mod: 'go',
            disabled: busy || !count,
            onClick: onSave,
          }, busy ? 'Saving…' : 'Save'),
        ),
        message && h(Paint.Notice, { role: 'alert' }, message),
      )
      : null,
  { Field },
)
