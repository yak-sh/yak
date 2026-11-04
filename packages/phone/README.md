# @yaks/phone

Phone numbers in the graph. A person's mobile number is a component on the
person, beside the `email{address}` they wear, and the words they agreed to
before anyone texts them are kept on an entity of their own.

## Stored data and exports

- `phone{number}` is a number in E.164 form (`+12695550142`) on the entity it
  reaches. On a person it is their mobile.
- `sms_consent{person, consent, at}` records that `person` agreed to be texted
  at their `phone{number}`, in the words `consent` exactly as they were shown,
  at `at`. Its eid is derived from `person` (`consentEid`), so a person has one
  consent; stopping texts removes it and leaves the number.
- `mobile(typed)` puts a typed US mobile number in E.164 form, or answers null
  for anything else.

The root import exports `phoneDoc`, `mobile` and `consentEid`.
`@yaks/phone/vocab` also exports `docs: [phoneDoc]` for plugin loaders. The
package sends no texts.

## Example

```ts
import { consentEid, mobile, phoneDoc } from '@yaks/phone'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab([phoneDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'ana' }, phone: { number: mobile('269-555-0142')! } },
  {
    entity: { eid: consentEid('ana') },
    sms_consent: {
      person: 'ana',
      consent: 'Text me.',
      at: '2026-11-04T00:00:00Z',
    },
  },
])
equal((await g.get(['ana']))[0]?.phone, { number: '+12695550142' })
equal((await g.read('.sms_consent.person=ana')).length, 1)
```
