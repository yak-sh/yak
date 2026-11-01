// A document replacement removes its old extracted text in the same write.
// Late extraction completions are discarded against the source in that write.
import { after } from '@yaks/fp'
import { type Bundle, type Comp, dead, hook, type Plugin } from '@yaks/graph'
import { supported } from './documents.ts'

export let documentPages = (): Plugin => ({
  name: 'yak/document-pages',
  admission: () => true,
  hooks: {
    rules: hook([
      'attachment',
      'document_page',
      'document_text',
      '$delete',
      'tombstone',
    ], (bundles, tx) => {
      let ids = [
        ...new Set(bundles.flatMap((b) => [
          ...('attachment' in b || dead(b) || b.document_text
            ? [b.entity.eid]
            : []),
          ...(b.document_page
            ? [String((b.document_page as Comp).document)]
            : []),
        ])),
      ]
      if (!ids.length) return bundles
      return after(tx.get(ids, ['attachment', 'document_text']), (sources) => {
        let files = new Map(
          sources.filter((b) => b.attachment && !dead(b)).map((
            b,
          ) => [b.entity.eid, b.attachment as Comp]),
        )
        for (let b of bundles) {
          if (dead(b) || b.attachment === null) files.delete(b.entity.eid)
          else if (b.attachment) {
            files.set(b.entity.eid, {
              ...files.get(b.entity.eid),
              ...b.attachment as Comp,
            })
          }
        }
        let current = (document: string, blob: unknown) => {
          let file = files.get(document)
          return file?.blob == blob &&
            supported(String(file.name ?? ''), String(file.mime ?? ''))
        }
        return after(
          tx.read(`.document_page.document=${ids.join(',')}&*`),
          (pages) => {
            let stale = new Map(
              pages.filter((b) => {
                let p = b.document_page as Comp
                return !current(String(p.document), p.blob)
              }).map((
                b,
              ) => [
                b.entity.eid,
                { entity: b.entity, $delete: true } as Bundle,
              ]),
            )
            let out = bundles.flatMap((b) => {
              if (b.document_page) {
                let page = b.document_page as Comp
                if (!current(String(page.document), page.blob)) return []
              }
              if (
                b.document_text &&
                !current(b.entity.eid, (b.document_text as Comp).blob)
              ) return []
              stale.delete(b.entity.eid)
              return [b]
            })
            let invalid = sources.filter((b) =>
              b.document_text &&
              !current(b.entity.eid, (b.document_text as Comp).blob)
            )
            return [
              ...out,
              ...stale.values(),
              ...invalid.map((b) => ({
                entity: b.entity,
                document_text: null,
              })),
            ]
          },
        )
      })
    }),
  },
})
