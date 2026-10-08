// The structural vocabulary shared by linear collections. Views supply the
// membership and ordering; List supplies rows and trailing actions.
import { block } from '@yaks/ui'

export let ListFrame = block('div', 'List', {
  Row: 'div',
  Action: 'button',
})
