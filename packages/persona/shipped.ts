// A persona a package ships as files, read into the rows a store keeps: the
// other way round from ./files.ts, which writes a graph's personas out into a
// checkout. The files own what they say. A store is given each row they say
// something new in, and a document the persona no longer contains leaves it,
// so a change to the files reaches the store the next time they are kept.
//
// Each file is a content file (@yaks/yaml `front`): its frontmatter is the
// bundle, and the document under it is the `doc` body. One of them carries
// `persona`, and lists under `contains` the names of the others, in the order
// it is said in; each other file is a document it contains. A name is a
// file's name without `.md`, and the caller derives each row's eid from it,
// so the files name no entity. Reading takes texts, not a directory: a host
// without a filesystem (a Worker) is handed them at build time.

import { and, eq, present } from '@yaks/query'
import { type Bundle, type Comp, type Eid, unheld } from '@yaks/graph'
import { EDGE, link } from '@yaks/edge'
import { DOC } from '@yaks/doc'
import { front } from '@yaks/yaml'
import { PERSONA } from './comp.ts'
import { CONTAINS, type Reads } from './worn.ts'

/**
 * The rows a persona's files say, by file name: the persona, each document it
 * contains, and the `contains` edge to each in its order. `eid` gives the row
 * a name stands for. A set with no persona, or two, a document the persona
 * does not contain, or a name it contains that no file holds is refused.
 *
 * ```ts
 * import { derivedEid } from '@yaks/graph/identity'
 * import { shipped } from '@yaks/persona'
 *
 * let rows = shipped({
 *   'base.md': '---\npersona: {}\ndoc:\n  title: Helper\ncontains: [tone]\n---\n\nHelp.\n',
 *   'tone.md': '---\ndoc:\n  title: Tone\n---\n\nBe brief.\n',
 * }, (name) => derivedEid('helper|' + name))
 * // the persona, the document `tone`, and the edge between them
 * ```
 */
export let shipped = (
  files: Record<string, string>,
  eid: (name: string) => Eid,
): Bundle[] => {
  let read = Object.entries(files).map(([file, text]) => {
    let { meta, body } = front(text, file)
    if (meta.entity) throw new Error(`${file} names an entity: its name does`)
    let { contains, ...row } = meta as Bundle & { contains?: unknown }
    return {
      name: file.replace(/\.md$/, ''),
      contains,
      row: {
        ...row,
        entity: { eid: eid(file.replace(/\.md$/, '')) },
        [DOC]: {
          ...row[DOC] as Comp,
          body: body.replace(/^\n+/, '').replace(/\n+$/, ''),
        },
      } as Bundle,
    }
  })
  let personas = read.filter((f) => f.row[PERSONA])
  if (personas.length != 1) {
    throw new Error(
      `a persona's files hold one persona, not ${personas.length}`,
    )
  }
  let [persona] = personas
  let names = Array.isArray(persona.contains)
    ? persona.contains.map(String)
    : []
  let docs = read.filter((f) => f != persona)
  let by = new Map(docs.map((f) => [f.name, f.row]))
  let missing = names.filter((n) => !by.has(n))
  if (missing.length) {
    throw new Error(`${persona.name} contains ${missing.join(', ')}: no file`)
  }
  let loose = docs.filter((f) => !names.includes(f.name)).map((f) => f.name)
  if (loose.length) {
    throw new Error(`${persona.name} does not contain ${loose.join(', ')}`)
  }
  let from = persona.row.entity.eid
  return [
    persona.row,
    ...names.flatMap((n, i) => [
      by.get(n)!,
      link(from, CONTAINS, by.get(n)!.entity.eid, i + 1),
    ]),
  ]
}

/**
 * What a store whose entities `storage` reads still needs written to keep a
 * persona as `rows` ({@link shipped}) say: each row it does not already hold
 * as they say it, and the removal of each `contains` edge the persona has
 * there that `rows` does not. Nothing, where the store already keeps it.
 */
export let kept = async (storage: Reads, rows: Bundle[]): Promise<Bundle[]> => {
  let persona = rows.find((b) => b[PERSONA])
  if (!persona) return []
  let [held, links] = await Promise.all([
    storage.get(rows.map((b) => b.entity.eid)),
    storage.read(
      and(eq(`${EDGE}.from`, persona.entity.eid), present(CONTAINS)),
    ),
  ])
  let said = new Set(rows.map((b) => b.entity.eid))
  return [
    ...links.filter((b) => !said.has(b.entity.eid))
      .map((b) => ({ entity: b.entity, $delete: true })),
    ...unheld(held, rows),
  ]
}
