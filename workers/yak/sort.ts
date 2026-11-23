// Server-rendered tables keep their sort choices in this page's graph.
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { uxDoc } from '@yaks/ux/vocab'
import { bindSort } from '@yaks/ux/sort'
import { leaving, PAGE } from '@yaks/ui/navigate'

let front = client(loadVocab([uxDoc]), [], { vault: false, wireVault: false })
// Each page's tables, those a page brought in place (@yaks/ui/navigate)
// included, let go when it leaves.
let sorting = () => {
  let stop = bindSort(document, {
    read: (eid) => front.ent(eid),
    write: (b) => front.mutate([b]),
  })
  leaving(document).addEventListener('abort', stop)
}
sorting()
document.addEventListener(PAGE, sorting)
