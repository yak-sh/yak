/** CLI addresses share Browse's route grammar; Inspect selects its reading. */
import { schemaPath } from './navigation.ts'
import { entityPath, searchPath } from './url.ts'
import { SHORT } from '@yaks/id'
import { EID } from './types.ts'
export let start = (what: string, inspect = false): string => {
  if (!what) return inspect ? schemaPath : '/'
  let id = /^([A-Za-z]+-)?\d+$/.test(what) || SHORT.test(what) || EID.test(what)
    ? what
    : null
  return id ? `${entityPath(id)}${inspect ? '?v=Debug' : ''}` : searchPath(what)
}
