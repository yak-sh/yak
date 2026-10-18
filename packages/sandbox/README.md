# Sandboxes

Containers and jails recorded separately from computers, with provisioning
intentions and confirmed disposal in the graph.

A **sandbox** is an actual or requested container or jail. Its
`sandbox{provider, address, from, image}` records the backend and resource
locator. Its `workspace{machine, root}` records placement and the default
absolute directory. A sandbox is not a computer; computers and workspace verbs
belong to [machine](../machine).

## Read lifecycle status

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { sandboxDoc } from '@yaks/sandbox'
import { kernelDoc } from '@yaks/kernel'

let vocab = loadVocab([kernelDoc, sandboxDoc])
equal(
  vocab.comp('sandbox')?.ladder?.rungs.find((r) => r.comp == 'pending')?.status,
  'requested',
)
equal(
  vocab.comp('sandbox')?.ladder?.rungs.find((r) => r.comp == 'released')
    ?.status,
  'released',
)
```

`pending{}` means provisioning is requested, `failed{reason}` records a failure,
and `released{at, by, via}` confirms external disposal. Without these marks,
`sandbox.status` is `ready`; readiness does not promise the resource is awake.
Providers must check availability on connection. Missing computer placement is
unknown, never an implicit local computer. Changing a session's home does not
release a sandbox.

## Exports

| Export    | Offers                              |
| --------- | ----------------------------------- |
| `.`       | `sandboxDoc`                        |
| `./vocab` | `sandboxDoc`, `docs`, `description` |

These declarations do not provision, wake or dispose external resources.
