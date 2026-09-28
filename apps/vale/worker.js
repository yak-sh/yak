// Scheduled companion work runs here with the app's scoped store grant. A
// page only reads the state it writes, so closing every page changes nothing.
import { companionTick } from './companion-tick.ts'
import { LODES } from './gather.ts'
import { destinationOf } from './teleport.ts'
import { vale } from './terrain.ts'

let query = async (env, line) => {
  let search = line.split('&').map(encodeURIComponent).join('&')
  let res = await env.APP.fetch(`query?${search}`)
  if (!res.ok) throw new Error(`store query ${res.status}: ${await res.text()}`)
  return await res.json()
}

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

let tick = async (req, env, v) => {
  let call = req.headers.get('x-yak-command-call')
  let directive = req.headers.get('x-yak-command-source')
  let at = Date.parse(req.headers.get('x-yak-command-at') || '')
  if (!call || !directive || !Number.isFinite(at)) {
    return new Response('Scheduled calls only', { status: 403 })
  }
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

let teleport = async (req, env, v) => {
  if (req.headers.get('x-yak-role') != 'owner') {
    return new Response('Only the app owner can teleport a hero.', {
      status: 403,
    })
  }
  let args = await req.json().catch(() => null)
  let player = args?.player
  let named = typeof args?.level == 'string'
  let point = args?.x !== undefined || args?.z !== undefined
  if (typeof player != 'string' || named == point) {
    return new Response('Pass a hero and either a land or both x and z.', {
      status: 400,
    })
  }
  let target = named ? { level: args.level } : { x: args.x, z: args.z }
  let at
  try {
    at = destinationOf(v, target)
  } catch (e) {
    return new Response(e.message, { status: 400 })
  }
  let found = await env.STORE.fetch(
    `query?${encodeURIComponent(`.eid=${JSON.stringify(player)}`)}&.player`,
  )
  if (!found.ok) return found
  if (!(await found.json()).length) {
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

export let workerOf = (v) => ({
  fetch(req, env) {
    let path = new URL(req.url).pathname
    if (req.method == 'POST' && path.endsWith('/companion/tick')) {
      return tick(req, env, v)
    }
    if (req.method == 'POST' && path.endsWith('/teleport')) {
      return teleport(req, env, v)
    }
    return new Response('Not found', { status: 404 })
  },
})

export default workerOf(vale())
