// Recent reads the kernel's opened mark. Only a page opened by a known
// person writes one; repeated renders of that page do not churn provenance.
import { currentPerson } from '@yaks/draft/ui'
import { apply, row } from './live.ts'
import { vocab } from './types.ts'
let last: string | undefined
export let opened = (eid: string): void => {
  let by = currentPerson()
  let key = `${by}:${eid}`
  if (!by || !vocab.comp('opened') || last == key || !row(eid).value) return
  last = key
  // The API stamps kernel provenance in the configured person’s name.
  // Sending stamped columns would strip the whole empty mark at admission.
  void apply([{
    entity: { eid },
    opened: {},
  }])
}
