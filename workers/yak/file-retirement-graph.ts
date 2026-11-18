// A referrer cancels its files' previous retirement in the same transaction.
import { after } from '@yaks/fp'
import { type Bundle, dead, type Plugin } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { line } from '@yaks/query'
import { referenced } from './file-retirement.ts'

export let reclaimFiles = (): Plugin => ({
  name: 'yak/file-retirement',
  admission: () => true,
  hooks: {
    rules: hook(
      ['written', 'deploy', 'app', 'switched', '$delete', 'tombstone'],
      (bundles, tx) => {
        let touched = bundles.filter((b) =>
          b.written || b.deploy || b.app || b.switched || dead(b)
        )
        if (!touched.length) return bundles
        return after(
          tx.get(touched.map((b) => b.entity.eid), [
            'written',
            'deploy',
            'app',
            'switched',
          ]),
          (rows) => {
            let keys = new Set([...rows, ...touched].flatMap(referenced))
            let prefixes = new Set<string>()
            for (let row of [...rows, ...touched]) {
              if (row.app) prefixes.add(`/.releases/${row.entity.eid}/`)
              for (let comp of [row.deploy, row.switched]) {
                let app = (comp as { app?: string } | undefined)?.app
                if (typeof app == 'string') prefixes.add(`/.releases/${app}/`)
              }
            }
            if (!keys.size && !prefixes.size) return bundles
            return after(tx.read(line`.file_retirement`), (retirements) => {
              let out = [...bundles]
              for (let row of retirements) {
                let retired = row.file_retirement as { keys: string[] }
                let keep = retired.keys.filter((key) =>
                  !keys.has(key) &&
                  ![...prefixes].some((prefix) => key.includes(prefix))
                )
                if (keep.length == retired.keys.length) continue
                out.push({
                  entity: row.entity,
                  ...keep.length
                    ? { file_retirement: { keys: keep } }
                    : { $delete: true },
                } as Bundle)
              }
              return out
            })
          },
        )
      },
    ),
  },
})
