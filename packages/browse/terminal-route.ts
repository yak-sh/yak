/** CLI addresses share Browse's route grammar; Inspect selects its reading. */
import { searchPath } from './url.ts'
import { SHORT } from '@yaks/id'
import { EID } from './types.ts'
export let start = (what: string, inspect = false): string => {
  if (!what) return inspect ? '/?map' : '/'
  let id = /^([A-Za-z]+-)?\d+$/.test(what) || SHORT.test(what) || EID.test(what)
    ? what
    : null
  return id
    ? `/${encodeURIComponent(id)}${inspect ? '?v=Inspect.Full' : ''}`
    : searchPath(what)
}
