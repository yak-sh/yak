// Scheduled companion work runs here with the app's scoped store grant. A
// page only reads the state it writes, so closing every page changes nothing.
import { companionTick } from './companion-tick.ts'
import { LODES } from './gather.ts'
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

export let workerOf = (v) => ({
  fetch(req, env) {
    let path = new URL(req.url).pathname
    return req.method == 'POST' && path.endsWith('/companion/tick')
      ? tick(req, env, v)
      : new Response('Not found', { status: 404 })
  },
})

export default workerOf(vale())
