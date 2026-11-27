/** Drain a renderer's updates while a test drives a view. @module */

import * as React from 'react'
import { flushSync } from 'react-dom'
import { act as compatible } from '@yaks/preact/test-utils'

let settle = (React as { act?: typeof compatible }).act

/** Run one synchronous fixture action and draw before the next assertion. */
export let actNow = <T>(run: () => T): T => {
  if (settle) return flushSync(run)
  let value!: T
  compatible(() => void (value = run()))
  return value
}

/** Run an action and let its scheduled renders finish. */
export let act: typeof compatible = (run) => {
  if (!settle) return compatible(run)
  let flag = 'IS_REACT_ACT_ENVIRONMENT'
  let before = Object.getOwnPropertyDescriptor(globalThis, flag)
  Object.defineProperty(globalThis, flag, { value: true, configurable: true })
  let restore = () => {
    if (before) Object.defineProperty(globalThis, flag, before)
    else Reflect.deleteProperty(globalThis, flag)
  }
  try {
    return settle(() => {
      let pending = run()
      if (typeof pending?.then == 'function') {
        return Promise.resolve(pending).finally(restore)
      }
      restore()
    })
  } catch (error) {
    restore()
    throw error
  }
}

/** Read mutable fixture state through React's subscription interface. */
export let useValue = <T>(source: {
  value: T
  subscribe: (changed: () => void) => () => void
}): T =>
  React.useSyncExternalStore(
    (changed) => source.subscribe(changed),
    () => source.value,
  )
