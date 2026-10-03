// Rehearse the hosted mover over captured player data in a disposable SQLite file.
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { lensRule } from '../workers/yak/lenses.ts'
import { wakeMove } from '../apps/vale/position-move.ts'
import { unpacked } from '../apps/vale/ability-update.ts'
import words from '../apps/vale/vocab.json' with { type: 'json' }
import core from '../packages/kernel/vocab.json' with { type: 'json' }
import wake from '../packages/wake/vocab.json' with { type: 'json' }

let [dir] = Deno.args
if (!dir) throw new Error('usage: vale-position-move.ts capture-directory')
let read = async (name: string) =>
  unpacked(JSON.parse(await Deno.readTextFile(`${dir}/${name}.json`)))
let heroes = await read('seen'),
  requests = await read('requests'),
  villagers = await read('villagers')
let declaration = words.$defs.saved_position.ops[0].view.declaration
let doc = { ...words, $defs: { ...words.$defs, seen: declaration } }
let vocab = loadVocab([doc, core, wake])
let driver = open(`${dir}/rehearsal.db`)
try {
  let g = graph({ vocab, storage: storage(driver, vocab) })
  g.install()
  let clean = (row: Bundle): Bundle => ({
    entity: { eid: row.entity.eid },
    ...Object.fromEntries(
      Object.entries(row).filter(([k]) =>
        k != 'entity' && k != 'kind' && !k.startsWith('$')
      ).map((
        [name, component],
      ) => [
        name,
        component && typeof component == 'object'
          ? Object.fromEntries(
            Object.entries(component).map(([prop, value]) => [
              prop,
              vocab.def(name)?.properties?.[prop]?.ref && value &&
                typeof value == 'object' && 'eid' in value
                ? value.eid
                : value,
            ]),
          )
          : component,
      ]),
    ),
  })
  await g.apply([...heroes, ...requests, ...villagers].map(clean), {
    trusted: true,
    stamp: false,
  })
  let rule = lensRule('yourname/vale', words)!
  let source = await g.read(rule.find)
  let patches = source.flatMap((row) =>
    rule.move(row, (q) => g.read(q) as Bundle[])
  )
  await g.apply(patches, { trusted: true })
  for (let hero of heroes.map(clean)) {
    let before = hero.seen as Record<string, unknown>
    let held = (await g.get([hero.entity.eid]))[0]
    let position = held.position as Record<string, unknown>
    for (let prop of ['level', 'x', 'z']) {
      if (position[prop] !== before[prop]) {
        throw new Error(`lost ${hero.entity.eid}.${prop}`)
      }
    }
    if (position.at !== Date.parse(String(before.at))) {
      throw new Error('lost location time')
    }
    if (typeof before.teleport == 'string') {
      let mark = (await g.get([before.teleport]))[0].completed as Record<
        string,
        unknown
      >
      let historical = (hero.updated ?? hero.created) as Record<string, unknown>
      if (
        mark.at !== before.at || mark.by !== historical.by ||
        mark.via !== historical.via
      ) {
        throw new Error(
          `lost acknowledgement attribution: ${JSON.stringify(mark)}`,
        )
      }
    }
  }
  let schedules = wakeMove(await g.read('.villager ?wake'))
  await g.apply(schedules, { trusted: true })
  let after = {
    seen: (await g.read('.seen')).length,
    positions: (await g.read('.player .position')).length,
    completed: (await g.read('.teleport_request .completed')).length,
    wakes: schedules.length,
  }
  if (
    after.seen || after.positions != heroes.length ||
    after.completed !=
      heroes.filter((h) => (h.seen as Record<string, unknown>).teleport).length
  ) {
    throw new Error(`migration counts disagree: ${JSON.stringify(after)}`)
  }
  let again = (await g.read(rule.find)).flatMap((row) =>
    rule.move(row, (q) => g.read(q) as Bundle[])
  )
  let wakeAgain = wakeMove(await g.read('.villager ?wake'))
  if (again.length || wakeAgain.length) {
    throw new Error('migration is not idempotent')
  }
  console.log(
    JSON.stringify({
      before: {
        seen: heroes.length,
        requests: requests.length,
        villagers: villagers.length,
      },
      after,
      second: { positions: again.length, wakes: wakeAgain.length },
    }),
  )
  await Deno.writeTextFile(
    `${dir}/wake-patches.json`,
    JSON.stringify(wakeMove(villagers), null, 2) + '\n',
  )
} finally {
  driver.close()
}
