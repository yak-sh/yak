// Scheduled companion work runs here with the app's scoped store grant. A
// page only reads the state it writes, so closing every page changes nothing.
import { companionTick } from './companion-tick.ts'
import { LODES } from './gather.ts'
import { destinationOf } from './teleport.ts'
import { installBuildingDesigns, refreshTerrain, vale } from './terrain.ts'
import { placeOf, placeText } from './place.ts'
import { resolveTarget } from './target.ts'
import { GIVERS } from './quests.ts'
import { decided, where as villagerWhere } from './villagers.ts'
import { eidOf } from './villager-id.ts'
import { inspectOf } from './inspect.ts'
import { objectiveOf } from './companion.ts'
import { useThemes } from './levels.ts'

let read = async (door, line, live = false) => {
  let search = live
    ? `live=1&q=${encodeURIComponent(line)}`
    : `q=${encodeURIComponent(line)}`
  let res = await door.fetch(`query?${search}`)
  if (!res.ok) throw new Error(`store query ${res.status}: ${await res.text()}`)
  return await res.json()
}
let query = (env, line) => read(env.APP, line)
let live = (env, line) => read(env.STORE, line, true)

let apply = async (env, rows) => {
  if (!rows.length) return
  let res = await env.APP.fetch('apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entities: rows }),
  })
  if (!res.ok) throw new Error(`store apply ${res.status}: ${await res.text()}`)
  await res.body?.cancel()
}

let choose = async (env, choices) => {
  let criteria = Object.fromEntries(choices.map((t, i) => [
    `tree${i + 1}`,
    `${LODES[t.kind].name}, ${Math.round(t.path.length / 4)} metres away`,
  ]))
  let res = await env.APP.fetch('ai/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'typesafe/jev',
      input: {
        state: [{
          role: 'user',
          content:
            'Gather wood for your companion. Choose one reachable natural tree.',
        }],
        questions: {
          tree: {
            type: 'choice',
            instructions: 'Which tree do you chop next?',
            criteria,
          },
        },
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`Jev answered ${res.status}: ${await res.text()}`)
  }
  let key = (await res.json()).answers?.tree?.choice
  let i = Number(String(key).replace('tree', '')) - 1
  if (!choices[i]) throw new Error(`Jev chose ${String(key)}`)
  return choices[i]
}

let tick = async (req, env, v, themes) => {
  let call = req.headers.get('x-yak-command-call')
  let directive = req.headers.get('x-yak-command-source')
  let at = Date.parse(req.headers.get('x-yak-command-at') || '')
  if (!call || !directive || !Number.isFinite(at)) {
    return new Response('Scheduled calls only', { status: 403 })
  }
  await themes(env)
  let [row] = await query(
    env,
    `.eid=${JSON.stringify(directive)}&?directive&?created&?companion`,
  )
  if (!row?.directive) return new Response('No directive', { status: 404 })
  let hero = row.directive.player
  let [[player], directives, items, upgraded, gathered] = await Promise.all([
    query(env, `.eid=${JSON.stringify(hero)}&?player&?created&?seen`),
    query(env, `.directive.player=${JSON.stringify(hero)}&?created`),
    query(env, `.item.owner=${JSON.stringify(hero)}&?gathered`),
    query(env, `.upgraded.by=${JSON.stringify(hero)}`),
    query(env, '.gathered&?place'),
  ])
  let rows = await companionTick(
    v,
    {
      hero: player,
      directive: row,
      directives,
      items,
      upgraded,
      gathered,
    },
    call,
    at,
    (choices) => choose(env, choices),
  )
  await apply(env, rows)
  return Response.json({ wrote: rows.length })
}

let where = async (req, env) => {
  let args = await req.json().catch(() => null)
  let player = args?.player
  if (typeof player != 'string' || !player) {
    return new Response('Pass a hero.', { status: 400 })
  }
  let [hero] = await read(
    env.STORE,
    `.eid=${JSON.stringify(player)}&.player&?created&?seen`,
  )
  if (!hero) return new Response('No hero has that id.', { status: 404 })
  let owner = req.headers.get('x-yak-role') == 'owner'
  let person = req.headers.get('x-yak-person')
  if (!owner && (!person || hero.created?.by != person)) {
    return new Response('You can only locate your own hero.', { status: 403 })
  }
  let [current] = await live(
    env,
    `.eid=${JSON.stringify(player)}&.position`,
  )
  let place = placeOf(current, 'position')
  let source = 'live'
  if (!place) {
    place = placeOf(hero, 'seen')
    source = 'saved'
  }
  return new Response(
    place
      ? `Hero ${player}: ${placeText(place, source)}`
      : `Hero ${player} has no known position yet.`,
  )
}

let targetPlace = async (env, v, eid) => {
  let [moving] = await live(env, `.eid=${JSON.stringify(eid)}&.position`)
  let placed = placeOf(moving, 'position')
  if (placed) return placed
  let [stored] = await read(
    env.STORE,
    `.eid=${JSON.stringify(eid)}&?companion`,
  )
  placed = placeOf(stored, 'companion')
  if (placed) return placed
  let giver = GIVERS.find((g) => eidOf(g.id) == eid)
  if (!giver) return null
  let [outputs, choices] = await Promise.all([
    read(
      env.STORE,
      `.entry.session=${
        JSON.stringify(eid)
      }&.output&?content&?answer&?created&.order=-created.at&.limit=60`,
    ),
    read(
      env.STORE,
      `.going.villager=${
        JSON.stringify(eid)
      }&?created&.order=-created.at&.limit=60`,
    ),
  ])
  let plans =
    decided(outputs, choices, (session) => session == eid ? giver.id : null)
      .plans.get(giver.id) ?? []
  let [x, , z] = villagerWhere(giver, v, plans, Date.now())
  return placeOf({ companion: { x, z } }, 'companion')
}

let inspect = async (req, env, v, themes) => {
  if (req.headers.get('x-yak-role') != 'owner') {
    return new Response('Only the app owner can inspect an entity.', {
      status: 403,
    })
  }
  let args = await req.json().catch(() => null)
  if (typeof args?.target != 'string' || !args.target.trim()) {
    return new Response('Pass a land, name, or entity id.', { status: 400 })
  }
  await themes(env)
  let to
  try {
    to = await resolveTarget(args.target, (line) => read(env.STORE, line))
  } catch (e) {
    return new Response(e.message, { status: 400 })
  }
  if (!to) {
    return new Response('No land or entity has that name.', {
      status: 404,
    })
  }
  if ('level' in to) return new Response(inspectOf(to))

  let id = to.eid
  let [stored] = await read(
    env.STORE,
    `.eid=${JSON.stringify(id)}` +
      '&?player&?villager&?directive&?item&?position&?seen&?companion&?doc&?created',
  )
  let at = await targetPlace(env, v, id)
  let giver = GIVERS.find((g) => eidOf(g.id) == id)
  let row = stored ?? (giver
    ? {
      entity: { eid: id },
      doc: { title: giver.name },
      villager: { id: giver.id, level: giver.level, home: giver.place },
    }
    : at
    ? { entity: { eid: id }, position: at }
    : null)
  if (!row) {
    return new Response('No inspectable entity has that id.', {
      status: 404,
    })
  }
  let related = { at }
  if (row.player) {
    let [looks, directives] = await Promise.all([
      read(
        env.STORE,
        `.look.player=${JSON.stringify(id)}&.order=-look.at&.limit=1`,
      ),
      read(
        env.STORE,
        `.directive.player=${
          JSON.stringify(id)
        }&?created&?companion&.order=-created.at&.limit=10`,
      ),
    ])
    related.look = looks[0]
    let objective = objectiveOf(row, directives)
    related.objective = directives.find((d) => d.entity.eid == objective?.eid)
  }
  if (row.villager) {
    let choices = await read(
      env.STORE,
      `.going.villager=${
        JSON.stringify(id)
      }&?created&.order=-created.at&.limit=10`,
    )
    related.going = choices.find((c) => c.created?.via == id)
  }
  let objective = row.directive ? row : related.objective
  if (objective) {
    let gathered = await read(
      env.STORE,
      `.gathered.directive=${JSON.stringify(objective.entity.eid)}`,
    )
    related.progress = gathered.length
  }
  return new Response(inspectOf({ row, related }))
}

let teleport = async (req, env, v, themes) => {
  if (req.headers.get('x-yak-role') != 'owner') {
    return new Response('Only the app owner can teleport a hero.', {
      status: 403,
    })
  }
  let args = await req.json().catch(() => null)
  let player = args?.player
  let named = typeof args?.level == 'string'
  let point = args?.x !== undefined || args?.z !== undefined
  let toward = typeof args?.to == 'string'
  if (
    typeof player != 'string' || !player ||
    Number(named) + Number(point) + Number(toward) != 1
  ) {
    return new Response(
      'Pass a hero and one destination: a land, x and z, or to=entity.',
      { status: 400 },
    )
  }
  await themes(env)
  let at
  try {
    if (point) {
      at = destinationOf(v, { x: args.x, z: args.z })
    } else {
      let to = await resolveTarget(
        named ? args.level : args.to,
        (line) => read(env.STORE, line),
      )
      if (!to) {
        return new Response('No land or entity has that name.', {
          status: 404,
        })
      }
      if ('level' in to) {
        at = destinationOf(v, to)
      } else {
        let place = await targetPlace(env, v, to.eid)
        if (!place) {
          return new Response('That entity has no usable position.', {
            status: 404,
          })
        }
        at = destinationOf(v, { x: place.x, z: place.z })
      }
    }
  } catch (e) {
    return new Response(e.message, { status: 400 })
  }
  let found = await read(
    env.STORE,
    `.eid=${JSON.stringify(player)}&.player`,
  )
  if (!found.length) {
    return new Response('No hero has that id.', { status: 404 })
  }
  let request = crypto.randomUUID()
  let saved = await env.STORE.fetch('apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entities: [{
        entity: { eid: request },
        teleport_request: { player, ...at },
      }],
    }),
  })
  if (!saved.ok) return saved
  let { pending } = await saved.json()
  return Response.json({ request, player, ...at, pending: !!pending })
}

export let workerOf = (v) => {
  // The ground is grown from the store's themes and building plans, as on
  // the page (main.ts): without the plans, nothing near a building stands.
  let seen, built
  let themes = async (env) => {
    let [rows, plans] = await Promise.all([
      read(env.STORE, '.theme_design'),
      read(env.STORE, '.building_design'),
    ])
    let sorted = rows.sort((a, b) => a.entity.eid.localeCompare(b.entity.eid))
    let next = JSON.stringify(sorted)
    let planned = JSON.stringify(plans)
    if (planned != built) installBuildingDesigns(plans)
    built = planned
    if (next == seen) return
    useThemes(sorted)
    refreshTerrain()
    seen = next
  }
  return {
    fetch(req, env) {
      let path = new URL(req.url).pathname
      if (req.method == 'POST' && path.endsWith('/companion/tick')) {
        return tick(req, env, v, themes)
      }
      if (req.method == 'POST' && path.endsWith('/teleport')) {
        return teleport(req, env, v, themes)
      }
      if (req.method == 'POST' && path.endsWith('/where')) {
        return where(req, env)
      }
      if (req.method == 'POST' && path.endsWith('/inspect')) {
        return inspect(req, env, v, themes)
      }
      return new Response('Not found', { status: 404 })
    },
  }
}

export default workerOf(vale())
