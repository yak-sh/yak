/** Graph-free keyboard mode routing. A mounted controller runs before focused widgets. */
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Key } from './input.ts'

type Handler = (key: Key) => boolean | void
let controllers: Handler[] = []
export let interceptKey = (key: Key): boolean => {
  for (let i = controllers.length - 1; i >= 0; i--) {
    if (controllers[i](key)) return true
  }
  return false
}
export let useKeymap = (handler: Handler): void => {
  let latest = useRef(handler)
  latest.current = handler
  useLayoutEffect(() => {
    let dispatch: Handler = (key) => latest.current(key)
    controllers.push(dispatch)
    return () => {
      controllers.splice(controllers.indexOf(dispatch), 1)
    }
  }, [])
}
