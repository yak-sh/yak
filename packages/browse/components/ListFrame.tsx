// The structural vocabulary shared by linear collections. Views supply the
// membership and ordering; List supplies rows, summaries, empty states, labels,
// and trailing actions.
import { block } from '@yaks/ui'

export let ListFrame = block('div', 'List', {
  Row: 'div',
  Summary: 'div',
  Empty: 'div',
  Label: 'span',
  Action: 'button',
})
