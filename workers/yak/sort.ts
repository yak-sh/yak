// Server-rendered tables keep their sort choices in this page's graph.
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { uxDoc } from '@yaks/ux/vocab'
import { bindSort } from '@yaks/ux/sort'

let front = client(loadVocab([uxDoc]), [], { vault: false, wireVault: false })
bindSort(document, {
  read: (eid) => front.ent(eid),
  write: (b) => front.mutate([b]),
})
