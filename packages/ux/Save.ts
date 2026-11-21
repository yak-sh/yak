/** Controlled pending changes; persistence and writes belong to the host. */
import { type ComponentChildren, h, type JSX } from 'preact'
import { Button, type Props, Save as Paint } from '@yaks/ui/parts'

export type SaveProps = {
  count: number
  busy?: boolean
  /** why the last save did not work; it stays until the next */
  message?: string
  /** what the last save said, such as "Saved", shown while it fades */
  done?: string
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
  )

/** The one place to save or discard all the host's pending changes, saying
 * "Saving…" while it saves, then what the save said until it fades. */
export let Save: ((props: SaveProps) => JSX.Element | null) & {
  Field: typeof Field
} = Object.assign(
  ({ count, busy, message, done, mod, onSave, onDiscard }: SaveProps) =>
    count || message || done
      ? h(
        Paint,
        {
          mod: [...[mod].flat(), !count && !message && 'done'],
          'aria-label': count ? 'Unsaved changes' : 'Saved',
          'aria-busy': busy || undefined,
        },
        h(
          Paint.Count,
          { role: 'status', 'aria-live': 'polite' },
          busy
            ? 'Saving…'
            : count
            ? `${count} ${count == 1 ? 'change' : 'changes'}`
            : message
            ? ''
            : done,
        ),
        count
          ? h(
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
              disabled: busy,
              onClick: onSave,
            }, 'Save'),
          )
          : null,
        message && h(Paint.Notice, { role: 'alert' }, message),
      )
      : null,
  { Field },
)
