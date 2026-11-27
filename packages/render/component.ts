import type { Action, Bundle, Context, Patch } from './mod.ts'

/** The application applies a successful edit and may display rejected input. */
export type Events = {
  onPatch?: (patch: Patch, bundle: Bundle) => void
  onError?: (error: unknown, bundle: Bundle) => void
}

/** A synchronous read; absence is allowed so a subscription can announce arrival. */
export type Store = (eid: string) => Bundle | undefined

/** Watch one entity and return the cleanup for that listener. */
export type Subscribe = (eid: string, notify: () => void) => () => void

/** An entity address and view; all remaining props are renderer context. */
export type EntityProps = Context & Events & { eid: string; view?: string }

/** Whether a portable handler contains an action to run. */
export let action = (value: unknown): value is Action =>
  value != null && typeof value == 'object' && 'run' in value &&
  typeof value.run == 'function'

type Control = {
  type?: string
  checked?: boolean
  value?: string
  validity?: { badInput: boolean }
  validationMessage?: string
  setCustomValidity?: (message: string) => void
  reportValidity?: () => boolean
}

/** Adapt a portable edit action to a control event and report its outcome. */
export let change =
  (act: Action, bundle: Bundle, ctx: Events): (event: Event) => void =>
  (event) => {
    let control = event.currentTarget as Control | null
    let input = control?.type == 'checkbox' ? control.checked : control?.value
    let patch: Patch
    try {
      if (control?.validity?.badInput) {
        throw new Error(control.validationMessage || 'Enter a valid value')
      }
      patch = act.run(bundle, input)
    } catch (error) {
      control?.setCustomValidity?.(
        error instanceof Error ? error.message : String(error),
      )
      control?.reportValidity?.()
      ctx.onError?.(error, bundle)
      return
    }
    control?.setCustomValidity?.('')
    ctx.onPatch?.(patch, bundle)
  }

/** Preserve native change events for handlers in portable renders. */
export let committed = (
  props: Record<string, unknown> | null,
  bundle: Bundle,
  ctx: Events,
): Record<string, unknown> | null => {
  if (!props) return props
  let { onChange, ref, ...rest } = props
  let changed = action(onChange)
    ? change(onChange, bundle, ctx)
    : typeof onChange == 'function'
    ? onChange as (event: Event) => void
    : undefined
  if (!changed) return props
  let before: Element | null = null
  return {
    ...rest,
    ref: (el: Element | null) => {
      before?.removeEventListener('change', changed)
      el?.addEventListener('change', changed)
      before = el
      if (typeof ref == 'function') ref(el)
      else if (ref && typeof ref == 'object' && 'current' in ref) {
        ref.current = el
      }
    },
  }
}
