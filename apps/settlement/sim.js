/**
 * Settlement market simulation.
 *
 * The core is a plain-data minute clock. Buildings post local orders, citizens
 * only act on what they have seen or heard, and the town grows from repeated
 * shortages instead of direct placement.
 */

export let goods = [
  'seeds',
  'crops',
  'food',
  'logs',
  'lumber',
  'charcoal',
  'ore',
  'stone',
  'ingots',
  'tools',
  'hardware',
]

export let skills = [
  'farm',
  'cook',
  'fell',
  'saw',
  'burn',
  'mine',
  'smelt',
  'forge',
  'build',
  'haul',
  'message',
  'trade',
  'forage',
]

export let basePrices = {
  seeds: 3,
  crops: 4,
  food: 9,
  logs: 5,
  lumber: 11,
  charcoal: 8,
  ore: 8,
  stone: 4,
  ingots: 18,
  tools: 38,
  hardware: 28,
}

export let recipes = {
  farm: {
    skill: 'farm',
    inputs: {},
    outputs: { crops: 4, seeds: 2 },
    wage: 5,
  },
  kitchen: {
    skill: 'cook',
    inputs: { crops: 2 },
    outputs: { food: 3 },
    wage: 6,
  },
  woodcutter: {
    skill: 'fell',
    inputs: {},
    outputs: { logs: 2 },
    wage: 5,
  },
  sawmill: {
    skill: 'saw',
    inputs: { logs: 2 },
    outputs: { lumber: 2 },
    wage: 7,
  },
  kiln: {
    skill: 'burn',
    inputs: { logs: 2 },
    outputs: { charcoal: 2 },
    wage: 6,
  },
  mine: {
    skill: 'mine',
    inputs: {},
    outputs: { ore: 1, stone: 2 },
    wage: 7,
  },
  smelter: {
    skill: 'smelt',
    inputs: { ore: 2, charcoal: 1 },
    outputs: { ingots: 1 },
    wage: 9,
  },
  blacksmith: {
    skill: 'forge',
    inputs: { ingots: 1, charcoal: 1 },
    outputs: { tools: 1, hardware: 1 },
    wage: 10,
  },
  builderYard: {
    skill: 'build',
    inputs: { logs: 2, stone: 2 },
    outputs: { lumber: 1 },
    wage: 9,
  },
}

export let kindNames = {
  home: 'Home',
  townHall: 'Town Hall',
  market: 'Market',
  farm: 'Farm',
  kitchen: 'Kitchen',
  woodcutter: 'Woodcutter',
  sawmill: 'Sawmill',
  kiln: 'Kiln',
  mine: 'Mine',
  smelter: 'Smelter',
  blacksmith: 'Blacksmith',
  builderYard: 'Builder Yard',
  construction: 'Construction Site',
}

let growthFor = {
  food: 'kitchen',
  crops: 'farm',
  lumber: 'sawmill',
  logs: 'woodcutter',
  charcoal: 'kiln',
  ore: 'mine',
  stone: 'mine',
  ingots: 'smelter',
  tools: 'blacksmith',
  hardware: 'blacksmith',
}

let constructionNeeds = { logs: 4, stone: 3 }
let constructionWork = 8
let forageKinds = ['woods', 'fields', 'meadow']

let civicDemand = {
  townHall: { food: 24, crops: 18, tools: 3 },
  market: { food: 18, crops: 12, lumber: 8, hardware: 3 },
}

let targets = {
  seeds: 8,
  crops: 18,
  food: 24,
  logs: 16,
  lumber: 16,
  charcoal: 10,
  ore: 12,
  stone: 20,
  ingots: 8,
  tools: 5,
  hardware: 5,
}

let reserve = {
  seeds: 3,
  crops: 4,
  food: 8,
  logs: 5,
  lumber: 5,
  charcoal: 3,
  ore: 4,
  stone: 8,
  ingots: 2,
  tools: 1,
  hardware: 1,
}

let clamp = (n, min, max) => Math.max(min, Math.min(max, n))

let sum = (xs, fn = (x) => x) => xs.reduce((total, x) => total + fn(x), 0)

let entries = (obj) => Object.entries(obj ?? {})

let goodsIn = (store) =>
  Object.fromEntries(entries(store).filter(([good]) => good != 'coins'))

let stocked = (store, good) => store?.[good] ?? 0

let resourceQty = (world, kind) =>
  sum(
    world.map.resources?.filter((r) => r.kind == kind) ?? [],
    (r) => r.qty ?? 0,
  )

let addStock = (good, qty, store = {}) => ({
  ...store,
  [good]: Math.max(0, (store[good] ?? 0) + qty),
})

let addStocks = (patch, store = {}) =>
  entries(patch).reduce((out, [good, qty]) => addStock(good, qty, out), store)

let canSpend = (store, coins) => (stocked(store, 'coins') >= coins)

let canMake = (recipe, store) =>
  entries(recipe.inputs).every(([good, qty]) => stocked(store, good) >= qty)

let dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

let samePos = (a, b) => a.x == b.x && a.y == b.y

let posKey = (pos) => `${pos.x},${pos.y}`

let parsePos = (key) => {
  let [x, y] = key.split(',').map(Number)
  return { x, y }
}

let pathWear = (world, pos) => world.map.paths?.[posKey(pos)] ?? 0

let isPath = (world, pos) => pathWear(world, pos) >= 8

let inBounds = (world, pos) =>
  pos.x >= 1 && pos.y >= 1 &&
  pos.x < world.map.width - 1 && pos.y < world.map.height - 1

let neighbors = (pos) => [
  { x: pos.x + 1, y: pos.y },
  { x: pos.x - 1, y: pos.y },
  { x: pos.x, y: pos.y + 1 },
  { x: pos.x, y: pos.y - 1 },
]

let pathScore = (world, pos) => Math.min(2.2, pathWear(world, pos) / 12)

let pathIndex = (world, pos) => pos.y * world.map.width + pos.x

let fieldDistance = (world, field, pos) =>
  field?.[pathIndex(world, pos)] ?? Infinity

let buildPathField = (map) => {
  let far = map.width + map.height
  let field = Array(map.width * map.height).fill(far)

  for (let [key, wear] of Object.entries(map.paths ?? {})) {
    if (wear < 10) continue
    let pos = parsePos(key)
    field[pos.y * map.width + pos.x] = 0
  }

  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      let i = y * map.width + x
      field[i] = Math.min(field[i], field[i - 1] + 1, field[i - map.width] + 1)
    }
  }
  for (let y = map.height - 2; y > 0; y--) {
    for (let x = map.width - 2; x > 0; x--) {
      let i = y * map.width + x
      field[i] = Math.min(field[i], field[i + 1] + 1, field[i + map.width] + 1)
    }
  }
  return field.map((n) => n >= far ? Infinity : n)
}

let stepBy = (world, from, score) => {
  let best = null
  let bestScore = Infinity
  for (let pos of neighbors(from)) {
    if (!inBounds(world, pos)) continue
    let next = score(pos)
    if (next < bestScore) {
      best = pos
      bestScore = next
    }
  }
  return best
}

let greedyStep = (world, from, to) => {
  let here = dist(from, to)
  return stepBy(
    world,
    from,
    (pos) =>
      dist(pos, to) <= here ? dist(pos, to) - pathScore(world, pos) : Infinity,
  ) ?? from
}

let roadStep = (world, field, from, to) => {
  let direct = dist(from, to)
  if (direct < 4) return null

  let fromPath = fieldDistance(world, field, from)
  let toPath = fieldDistance(world, field, to)
  if (!Number.isFinite(fromPath) || !Number.isFinite(toPath)) return null
  if (fromPath + toPath + direct * 0.25 >= direct * 0.6) return null

  let here = fieldDistance(world, field, from)
  let step = stepBy(
    world,
    from,
    (pos) =>
      fieldDistance(world, field, pos) < here
        ? fieldDistance(world, field, pos) + dist(pos, to) * 0.05
        : Infinity,
  )
  return step
}

let routeStep = (world, from, to) => {
  if (isPath(world, from)) return null
  return roadStep(
    world,
    world.map.pathField ?? buildPathField(world.map),
    from,
    to,
  )
}

let stepToward = (world, from, to) => {
  let routed = routeStep(world, from, to)
  return routed ?? greedyStep(world, from, to)
}

let travelSteps = (world, pos) => pathWear(world, pos) >= 22 ? 2 : 1

let id = (prefix, n) => `${prefix}${n.toString(36)}`

/// hashSeed('town') -> 864577349
/** Folds any seed into the unsigned state used by the RNG. */
export let hashSeed = (seed) => {
  let text = String(seed ?? 1)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0 || 1
}

/// nextRng(1).rng -> 270369
/** Returns a deterministic random draw and the next RNG state. */
export let nextRng = (rng) => {
  rng >>>= 0
  rng ^= rng << 13
  rng ^= rng >>> 17
  rng ^= rng << 5
  rng >>>= 0
  return { value: rng / 4294967296, rng: rng || 1 }
}

let randomInt = (rng, min, max) => {
  let draw = nextRng(rng)
  return {
    value: min + Math.floor(draw.value * (max - min + 1)),
    rng: draw.rng,
  }
}

let pickPos = (rng, rect, pad = 0) => {
  let x = randomInt(rng, rect.x + pad, rect.x + rect.w - 1 - pad)
  let y = randomInt(x.rng, rect.y + pad, rect.y + rect.h - 1 - pad)
  return { pos: { x: x.value, y: y.value }, rng: y.rng }
}

let emptySkills = () => Object.fromEntries(skills.map((skill) => [skill, 0]))

let emptyNeeds = () => ({
  hunger: 0,
  rest: 0,
})

let citizen = (n, pos, rng, homeId) => ({
  id: id('c', n),
  pos,
  homeId,
  coins: 42 + n % 7,
  inventory: {},
  needs: emptyNeeds(),
  skills: emptySkills(),
  tastes: { thrift: (rng % 7) / 10, bustle: ((rng >>> 3) % 7) / 10 },
  knownOrders: {},
  knownGoals: {},
  knownPlaces: {},
  intent: { kind: 'idle' },
})

let building = (n, kind, pos, storage = {}) => ({
  id: id('b', n),
  kind,
  pos,
  storage: { coins: 420, ...storage },
  board: [],
  recipe: recipes[kind],
  owner: null,
  status: { kind: 'open' },
})

let construction = (n, kind, pos) => ({
  ...building(n, 'construction', pos, { coins: 700 }),
  status: {
    kind: 'building',
    target: kind,
    progress: 0,
    needs: constructionNeeds,
  },
})

let putBuilding = (b) => (world) => ({
  ...world,
  buildings: [...world.buildings, b],
})

let replaceBuilding = (next) => (world) => ({
  ...world,
  buildings: world.buildings.map((b) => b.id == next.id ? next : b),
})

let replaceCitizen = (next) => (world) => ({
  ...world,
  citizens: world.citizens.map((c) => c.id == next.id ? next : c),
})

let removeOrder = (orderId) => (b) => ({
  ...b,
  board: b.board.filter((o) => o.id != orderId),
})

let orderId = (b, side, good) => `${b.id}:${side}:${good}`

let pressure = (have, want) =>
  want <= 0 ? 0 : clamp((want - have) / want, -1, 2)

/// price('food', 0, 10) > price('food', 20, 10) -> true
/** Prices rise when local storage is thin and fall when shelves are full. */
export let price = (good, have = 0, want = targets[good] ?? 10) => {
  let base = basePrices[good] ?? 10
  return Math.max(1, Math.round(base * (1 + pressure(have, want) * 0.45)))
}

let order = (b, side, good, qty, opts = {}) => ({
  id: opts.id ?? orderId(b, side, good),
  placeId: b.id,
  actorId: opts.actorId ?? null,
  side,
  good,
  qty,
  price: opts.price ?? price(good, stocked(b.storage, good), targets[good]),
  age: opts.age ?? 0,
  kind: opts.kind ?? 'trade',
})

let wantedInputs = (b) =>
  b.status.kind == 'building'
    ? b.status.needs
    : (b.recipe ? b.recipe.inputs : civicDemand[b.kind]) ?? {}

let boardFor = (world, b) => {
  let board = []

  for (let [good, qty] of entries(wantedInputs(b))) {
    let want = b.status.kind == 'building'
      ? qty
      : Math.max(qty * 4, targets[good] ?? qty)
    let have = stocked(b.storage, good)
    let bid = price(good, have, want)
    if (b.status.kind == 'building') bid *= 2.6
    if (have < want) {
      board.push(order(b, 'buy', good, want - have, {
        price: Math.ceil(bid * policyRate(b, world)),
      }))
    }
  }

  for (let [good, qty] of entries(goodsIn(b.storage))) {
    if (!basePrices[good] || qty <= (reserve[good] ?? 2)) continue
    board.push(order(b, 'sell', good, qty - (reserve[good] ?? 2), {
      price: Math.max(1, Math.floor(price(good, qty, targets[good]) * 0.95)),
    }))
  }

  let buy = board.filter((o) => o.side == 'buy')
  for (let o of buy) {
    let canAdvertise = b.status.kind != 'building' &&
      stocked(b.storage, 'coins') > o.price + 180
    if (o.qty >= 4 && canAdvertise) {
      board.push(order(b, 'notice', o.good, 1, {
        id: `${o.id}:notice`,
        price: world.policies.messengerBounty + Math.ceil(o.price / 4),
        kind: 'notice',
      }))
    }
  }

  return board
}

let policyRate = (b, world) =>
  1 + ((world.policies.subsidies?.[b.kind] ?? 0) / 100)

let postOrders = (world) => ({
  ...world,
  buildings: world.buildings.map((b) => ({
    ...b,
    board: boardFor(world, b).map((o) => {
      let old = b.board.find((prev) => prev.id == o.id)
      return old ? { ...o, age: old.age + 1 } : o
    }),
  })),
})

let orders = (world) => world.buildings.flatMap((b) => b.board)

let orderPlace = (order, world) => placeById(order.placeId, world)

let visibleOrders = (c, world, pred = () => true) =>
  Object.values(c.knownOrders)
    .filter((o) => world.tick - o.seenAt < 240)
    .map((o) => o.order)
    .filter(pred)
    .filter((o) => orderPlace(o, world))

/// let N = __private.nearest
/// N({x: 0, y: 0}, [{x: 5, y: 0}, {x: 1, y: 1}], x => x).x -> 1
/** Finds the closest item without sorting the whole candidate list. */
let nearest = (pos, xs, at) => {
  let best = null
  let bestDist = Infinity
  for (let x of xs) {
    let d = dist(pos, at(x))
    if (d < bestDist) {
      best = x
      bestDist = d
    }
  }
  return best
}

let center = (rect) => ({
  x: Math.round(rect.x + rect.w / 2),
  y: Math.round(rect.y + rect.h / 2),
})

let citizenNumber = (c) => parseInt(c.id.slice(1), 36)

/// let B = __private.buildingIndex
/// B([{id: 'b1'}]).b1.id -> 'b1'
/** Indexes places for the read-heavy parts of a minute tick. */
let buildingIndex = (buildings) =>
  Object.fromEntries(buildings.map((b) => [b.id, b]))

let indexPlaces = (world) => ({
  ...world,
  places: buildingIndex(world.buildings),
})

let stripIndexes = (world) => {
  let { crowds: _crowds, places: _places, ...plain } = world
  return plain
}

let placeById = (placeId, world) =>
  world.places?.[placeId] ?? world.buildings.find((b) => b.id == placeId)

/// let C = __private.positionCounts
/// C([{pos: {x: 1, y: 2}}, {pos: {x: 1, y: 2}}])['1,2'] -> 2
/** Counts moving bodies by tile so scoring can ask about crowds cheaply. */
let positionCounts = (xs) =>
  xs.reduce((out, x) => {
    let key = posKey(x.pos)
    out[key] = (out[key] ?? 0) + 1
    return out
  }, {})

let crowdAt = (pos, world) =>
  world.crowds?.[posKey(pos)] ??
    world.citizens.filter((c) => samePos(c.pos, pos)).length

let goalKey = (intent) => {
  if (!intent || intent.kind == 'idle') return null
  if (intent.kind == 'work') return `work:${intent.placeId}`
  if (intent.kind == 'haul') {
    return `haul:${
      intent.step ?? 'buy'
    }:${intent.buy.placeId}:${intent.buy.good}`
  }
  if (intent.kind == 'message') {
    return `message:${intent.order.id}:${intent.placeId}`
  }
  if (intent.kind == 'forage') return `forage:${posKey(intent.pos)}`
  return null
}

let ownGoal = (c, world) => {
  let key = goalKey(c.intent)
  return key
    ? { key, citizenId: c.id, intent: c.intent, seenAt: world.tick }
    : null
}

let knownGoalClaims = (c, world) =>
  Object.values(c.knownGoals ?? {})
    .filter((g) => g.citizenId != c.id && world.tick - g.seenAt < 30)

let goalClaimed = (c, world, intent) => {
  let key = goalKey(intent)
  return key && knownGoalClaims(c, world).some((g) => g.key == key)
}

let home = (c, world) => c.homeId ? placeById(c.homeId, world) : null

let nextVisit = (c, world) => {
  if (c.intent.kind == 'visit') {
    let place = placeById(c.intent.placeId, world)
    if (place && dist(c.pos, place.pos) > 1) return c.intent
  }

  let known = Object.values(c.knownPlaces)
  let useful = known.filter((p) => p.kind != 'home')
  let places = (useful.length ? useful : known)
    .map((p) => p.id)
    .filter((id) => placeById(id, world))

  if (c.homeId && (world.tick + citizenNumber(c)) % 5 == 0) {
    places = [c.homeId, ...places]
  }

  if (!places.length) return { kind: 'idle' }

  let i = (Math.floor(world.tick / 45) + citizenNumber(c)) % places.length
  return { kind: 'visit', placeId: places[i] }
}

let travelCost = (c, b) => dist(c.pos, b.pos) * 0.18

let homeScore = (c, world) => {
  let b = home(c, world)
  if (!b) return { score: -Infinity, intent: null }
  let recentWork = world.tick - (c.lastWorkedAt ?? -Infinity) < 90
  let recentErrand = world.tick - (c.lastErrandAt ?? -Infinity) < 90
  let urgency = c.needs.rest + (recentWork ? 18 : 0) + (recentErrand ? 8 : 0)
  if (urgency < 10) return { score: -Infinity, intent: null }
  return {
    score: urgency - travelCost(c, b),
    intent: { kind: 'home', placeId: b.id },
  }
}

let foodBuyOpen = (c, world) =>
  visibleOrders(c, world, (o) => o.side == 'sell' && o.good == 'food')
    .some((o) => c.coins >= o.price)

let forageSite = (c, world) =>
  nearest(
    c.pos,
    world.map.resources.filter((r) => r.kind == 'berries' && r.qty > 0),
    (r) => r.pos,
  ) ??
    nearest(
      c.pos,
      world.map.terrain.filter((patch) => forageKinds.includes(patch.kind)),
      center,
    )

let forageScore = (c, world) => {
  if (stocked(c.inventory, 'food') > 0 || c.needs.hunger < 24) {
    return { score: -Infinity, intent: null }
  }
  let site = forageSite(c, world)
  if (!site) return { score: -Infinity, intent: null }
  let pos = site.pos ?? center(site)
  let hunger = c.needs.hunger
  let noMarketFood = foodBuyOpen(c, world) ? 0 : 28
  return {
    score: hunger * 1.15 + noMarketFood + (c.skills.forage ?? 0) * 0.3 -
      dist(c.pos, pos) * 0.12,
    intent: { kind: 'forage', site: site.kind, pos },
  }
}

let workWage = (b, world) =>
  b.status.kind == 'building'
    ? Math.min(stocked(b.storage, 'coins'), 12)
    : Math.min(
      stocked(b.storage, 'coins'),
      Math.round(b.recipe.wage * policyRate(b, world)),
    )

let workOpen = (b, world) => {
  if (b.status.kind == 'building') {
    let ready = entries(b.status.needs)
      .every(([good, qty]) => stocked(b.storage, good) >= qty)
    return ready && workWage(b, world) > 0
  }
  if (b.kind == 'woodcutter' && resourceQty(world, 'tree') <= 0) return false
  if (b.kind == 'mine' && resourceQty(world, 'stone') <= 0) return false
  return b.recipe && canMake(b.recipe, b.storage) && workWage(b, world) > 0
}

let workScore = (c, b, world) => {
  if (!workOpen(b, world)) return -Infinity
  if (b.status.kind == 'building') {
    let left = Math.max(0, constructionWork - b.status.progress)
    return workWage(b, world) +
      left * 2 +
      (c.skills.build ?? 0) * 0.35 -
      travelCost(c, b)
  }
  let outputs = b.status.kind == 'building'
    ? { [b.status.target]: 1 }
    : b.recipe.outputs
  let need = Object.keys(outputs)
    .reduce(
      (n, good) => n + pressure(stocked(b.storage, good), targets[good]),
      0,
    )
  let wage = workWage(b, world)
  let crowd = Math.max(0, crowdAt(b.pos, world) - 2)
  return wage +
    need * 8 +
    (c.skills[b.recipe?.skill ?? 'build'] ?? 0) * 0.25 -
    travelCost(c, b) -
    crowd * 1.4
}

let tradeScore = (c, o, world) => {
  let b = orderPlace(o, world)
  if (!b) return -Infinity
  if (o.side == 'sell' && c.coins < o.price) return -Infinity
  if (o.side == 'buy' && stocked(c.inventory, o.good) <= 0) return -Infinity
  if (o.side == 'buy' && !canSpend(b.storage, o.price)) return -Infinity
  let hunger = o.good == 'food' ? c.needs.hunger * 0.9 : 0
  let crowd = Math.max(0, crowdAt(b.pos, world) - 3)
  return o.side == 'sell'
    ? (hunger + basePrices[o.good] - o.price - travelCost(c, b) - crowd)
    : (o.price + hunger - travelCost(c, b) - crowd)
}

let haulScore = (c, world) => {
  let sells = visibleOrders(c, world, (o) => o.side == 'sell')
  let buys = visibleOrders(c, world, (o) => o.side == 'buy')
  let best = null

  for (let sell of sells) {
    for (let buy of buys) {
      if (sell.good != buy.good || sell.placeId == buy.placeId) continue
      let spread = buy.price - sell.price
      if (spread <= 0 || c.coins < sell.price) continue
      let a = orderPlace(sell, world)
      let b = orderPlace(buy, world)
      let crowd = Math.max(0, crowdAt(b.pos, world) - 2)
      let pickupCrowd = Math.max(0, crowdAt(a.pos, world) - 1)
      let intent = { kind: 'haul', buy: sell, sell: buy, step: 'buy' }
      if (goalClaimed(c, world, intent)) continue
      let score = spread - dist(c.pos, a.pos) * 0.15 -
        dist(a.pos, b.pos) * 0.15 -
        crowd * 1.4 - pickupCrowd * 2.2
      if (!best || score > best.score) {
        best = { score, intent }
      }
    }
  }

  return best ?? { score: -Infinity, intent: null }
}

let messageScore = (c, world) => {
  let notice = nearest(
    c.pos,
    visibleOrders(c, world, (o) => o.side == 'notice'),
    (o) => orderPlace(o, world).pos,
  )
  if (!notice) return { score: -Infinity, intent: null }

  let placeId = messageTarget(c, notice, world)
  let b = placeById(placeId, world)
  if (!b) return { score: -Infinity, intent: null }

  return {
    score: notice.price +
      c.skills.message * 0.2 -
      travelCost(c, b) -
      Math.max(0, crowdAt(b.pos, world) - 1) * 2,
    intent: { kind: 'message', order: notice, placeId },
  }
}

let messageTarget = (c, notice, world) => {
  let sells = visibleOrders(c, world, (o) =>
    o.side == 'sell' &&
    o.good == notice.good &&
    o.placeId != notice.placeId)
  let places = sells
    .map((o) => orderPlace(o, world))
    .filter((b) => b && !samePos(c.pos, b.pos))

  if (!places.length) {
    places = Object.values(c.knownPlaces)
      .map((p) => placeById(p.id, world))
      .filter((b) => b && b.id != notice.placeId && !samePos(c.pos, b.pos))
  }

  return nearest(c.pos, places, (b) => b.pos)?.id
}

let currentOrder = (order, world) =>
  orderPlace(order, world)?.board.find((o) => o.id == order.id)

let keepIntent = (c, world) => {
  let { intent } = c
  if (!intent || intent.kind == 'idle') return null

  if (intent.kind == 'home') {
    let b = home(c, world)
    if (!b) return null
    return samePos(c.pos, b.pos) && c.needs.rest <= 1
      ? null
      : { ...intent, placeId: b.id }
  }
  if (intent.kind == 'forage') {
    return samePos(c.pos, intent.pos) ? null : intent
  }

  let target = targetPos(intent, world)
  if (!target || samePos(c.pos, target)) return null

  if (intent.kind == 'visit') return intent
  if (intent.kind == 'work') {
    let b = placeById(intent.placeId, world)
    return b && workOpen(b, world) ? intent : null
  }
  if (intent.kind == 'buy') {
    let order = currentOrder(intent.order, world)
    return order && c.coins >= order.price ? { ...intent, order } : null
  }
  if (intent.kind == 'sell') {
    let order = currentOrder(intent.order, world)
    let b = order && orderPlace(order, world)
    return order && stocked(c.inventory, order.good) > 0 &&
        b && canSpend(b.storage, order.price)
      ? { ...intent, order }
      : null
  }
  if (intent.kind == 'message') {
    let order = currentOrder(intent.order, world)
    let target = placeById(intent.placeId, world)
    let source = order && orderPlace(order, world)
    return order && target && canSpend(source.storage, order.price)
      ? { ...intent, order }
      : null
  }
  if (intent.kind == 'haul') {
    let buy = currentOrder(intent.buy, world)
    let sell = currentOrder(intent.sell, world)
    if (!buy || !sell) return null
    if (intent.step == 'buy' && c.coins < buy.price) return null
    if (intent.step == 'sell' && stocked(c.inventory, sell.good) <= 0) {
      return null
    }
    return { ...intent, buy, sell }
  }

  return null
}

let chooseIntent = (c, world) => {
  let forage = forageScore(c, world)
  if (
    forage.intent && forage.score >= 72 &&
    !(c.intent.kind == 'buy' && c.intent.order?.good == 'food')
  ) {
    return forage.intent
  }

  let kept = keepIntent(c, world)
  if (kept) return kept

  let candidates = [
    { score: 0.05, intent: nextVisit(c, world) },
    homeScore(c, world),
    forage,
  ]

  let carry = entries(c.inventory).find(([, qty]) => qty > 0)
  if (carry) {
    for (
      let o of visibleOrders(
        c,
        world,
        (o) => o.side == 'buy' && o.good == carry[0],
      )
    ) {
      candidates.push({
        score: tradeScore(c, o, world) + 8,
        intent: { kind: 'sell', order: o },
      })
    }
  }

  for (let o of visibleOrders(c, world, (o) => o.side == 'sell')) {
    candidates.push({
      score: tradeScore(c, o, world),
      intent: { kind: 'buy', order: o },
    })
  }

  for (let b of world.buildings) {
    candidates.push({
      score: goalClaimed(c, world, { kind: 'work', placeId: b.id })
        ? -Infinity
        : workScore(c, b, world),
      intent: { kind: 'work', placeId: b.id },
    })
  }

  candidates.push(haulScore(c, world))
  candidates.push(messageScore(c, world))

  return candidates
    .filter((x) => x.intent)
    .toSorted((a, b) => b.score - a.score)[0].intent
}

let learnBoard = (c, b, world) => ({
  ...c,
  knownPlaces: {
    ...c.knownPlaces,
    [b.id]: { id: b.id, kind: b.kind, pos: b.pos },
  },
  knownOrders: {
    ...c.knownOrders,
    ...Object.fromEntries(b.board.map((order) => [
      order.id,
      { order, seenAt: world.tick, confidence: 1, sourceId: b.id },
    ])),
  },
})

let ageNeeds = (c) => ({
  ...c,
  needs: {
    hunger: clamp(
      c.needs.hunger + 0.035 - stocked(c.inventory, 'food') * 0.002,
      0,
      100,
    ),
    rest: clamp(c.needs.rest + 0.01, 0, 100),
  },
})

let eat = (c) =>
  c.needs.hunger > 18 && stocked(c.inventory, 'food') > 0
    ? {
      ...c,
      inventory: addStock('food', -1, c.inventory),
      needs: { ...c.needs, hunger: Math.max(0, c.needs.hunger - 16) },
    }
    : c

let restAtHome = (c, world) => {
  let b = home(c, world)
  return b && samePos(c.pos, b.pos)
    ? {
      ...c,
      needs: { ...c.needs, rest: Math.max(0, c.needs.rest - 0.8) },
    }
    : c
}

let wearPath = (pos, qty, paths = {}) => ({
  ...paths,
  [posKey(pos)]: clamp((paths[posKey(pos)] ?? 0) + qty, 0, 80),
})

let recordTravel = (from, to, world) => ({
  ...world,
  map: {
    ...world.map,
    paths: wearPath(to, 1.2, wearPath(from, 0.35, world.map.paths)),
  },
})

let decayPaths = (world) => ({
  ...world,
  map: {
    ...world.map,
    paths: Object.fromEntries(
      Object.entries(world.map.paths ?? {})
        .map(([key, wear]) => [key, wear * 0.9985 - 0.002])
        .filter(([, wear]) => wear >= 0.35),
    ),
  },
})

let refreshPathField = (world) => ({
  ...world,
  map: { ...world.map, pathField: buildPathField(world.map) },
})

let visit = (c, world) =>
  world.buildings.reduce(
    (out, b) => dist(out.pos, b.pos) <= 1 ? learnBoard(out, b, world) : out,
    c,
  )

let moveCitizen = (c) => (world) => {
  let target = targetPos(c.intent, world)
  let next = c
  let steps = travelSteps(world, next.pos)
  if (target) {
    for (let i = 0; i < steps && !samePos(next.pos, target); i++) {
      let pos = stepToward(world, next.pos, target)
      if (samePos(pos, next.pos)) break
      world = recordTravel(next.pos, pos, world)
      next = { ...next, pos }
    }
  }
  return replaceCitizen(restAtHome(visit(eat(ageNeeds(next)), world), world))(
    world,
  )
}

let targetPos = (intent, world) => {
  if (intent.kind == 'forage') {
    return intent.pos
  }
  if (intent.kind == 'home') {
    return placeById(intent.placeId, world)?.pos
  }
  if (intent.kind == 'work') {
    return placeById(intent.placeId, world)?.pos
  }
  if (intent.kind == 'visit') {
    return placeById(intent.placeId, world)?.pos
  }
  if (intent.kind == 'message' && intent.placeId) {
    return placeById(intent.placeId, world)?.pos
  }
  if (intent.order) {
    return orderPlace(intent.order, world)?.pos
  }
  if (intent.kind == 'haul') {
    let order = intent.step == 'sell' ? intent.sell : intent.buy
    return orderPlace(order, world)?.pos
  }
}

let transfer = (citizenId, order, world) => {
  let c = world.citizens.find((c) => c.id == citizenId)
  let b = orderPlace(order, world)
  if (!c || !b) return world

  let qty = Math.min(1, order.qty)
  if (order.side == 'sell') {
    if (stocked(b.storage, order.good) < qty || c.coins < order.price) {
      return world
    }
    c = {
      ...c,
      coins: c.coins - order.price,
      inventory: addStock(order.good, qty, c.inventory),
      lastErrandAt: world.tick,
      needs: { ...c.needs, rest: clamp(c.needs.rest + 4, 0, 100) },
      skills: addStock('trade', 0.08, c.skills),
    }
    b = {
      ...b,
      storage: addStock(
        'coins',
        order.price,
        addStock(order.good, -qty, b.storage),
      ),
    }
  } else if (order.side == 'buy') {
    if (
      stocked(c.inventory, order.good) < qty ||
      !canSpend(b.storage, order.price)
    ) return world
    c = {
      ...c,
      coins: c.coins + order.price,
      inventory: addStock(order.good, -qty, c.inventory),
      lastErrandAt: world.tick,
      needs: { ...c.needs, rest: clamp(c.needs.rest + 4, 0, 100) },
      skills: addStock('trade', 0.08, c.skills),
    }
    b = {
      ...b,
      storage: addStock(
        'coins',
        -order.price,
        addStock(order.good, qty, b.storage),
      ),
    }
  }

  world = replaceCitizen(c)(world)
  world = replaceBuilding(removeOrder(order.id)(b))(world)
  return world
}

let takeResource = (kind, qty, world) => {
  let need = qty
  let resources = world.map.resources.map((r) => {
    if (r.kind != kind || need <= 0 || r.qty <= 0) return r
    let take = Math.min(need, r.qty)
    need -= take
    return { ...r, qty: r.qty - take }
  }).filter((r) => r.qty > 0)
  return { ...world, map: { ...world.map, resources } }
}

let doWork = (citizenId, placeId, world) => {
  let c = world.citizens.find((c) => c.id == citizenId)
  let b = world.buildings.find((b) => b.id == placeId)
  if (!c || !b || !samePos(c.pos, b.pos)) return world

  if (b.status.kind == 'building') return build(c, b, world)
  if (!b.recipe || !canMake(b.recipe, b.storage)) return world
  if (b.kind == 'woodcutter') {
    if (resourceQty(world, 'tree') <= 0) return world
    world = takeResource('tree', 1, world)
  }
  if (b.kind == 'mine') {
    if (resourceQty(world, 'stone') <= 0) return world
    world = takeResource('stone', 1, world)
  }

  let wage = workWage(b, world)
  if (wage <= 0) return world
  b = {
    ...b,
    storage: addStocks(
      b.recipe.outputs,
      addStock('coins', -wage, addStocks(negate(b.recipe.inputs), b.storage)),
    ),
  }
  c = {
    ...c,
    coins: c.coins + wage,
    lastWorkedAt: world.tick,
    needs: { ...c.needs, rest: clamp(c.needs.rest + 12, 0, 100) },
    skills: addStock(b.recipe.skill, 0.14, c.skills),
  }
  world = replaceBuilding(b)(replaceCitizen(c)(world))
  return world
}

let build = (c, b, world) => {
  let ready = entries(b.status.needs)
    .every(([good, qty]) => stocked(b.storage, good) >= qty)
  if (!ready) return world

  let wage = Math.min(stocked(b.storage, 'coins'), 12)
  if (wage <= 0) return world
  let progress = b.status.progress + 1 + (c.skills.build ?? 0) * 0.05
  let storage = addStock('coins', -wage, b.storage)
  let next = {
    ...b,
    storage,
    status: { ...b.status, progress },
  }
  c = {
    ...c,
    coins: c.coins + wage,
    lastWorkedAt: world.tick,
    needs: { ...c.needs, rest: clamp(c.needs.rest + 12, 0, 100) },
    skills: addStock('build', 0.2, c.skills),
  }

  if (progress >= constructionWork) {
    next = {
      ...building(Number(b.id.slice(1)), b.status.target, b.pos, {
        coins: Math.max(220, stocked(storage, 'coins')),
      }),
      id: b.id,
    }
  }

  return replaceBuilding(next)(replaceCitizen(c)(world))
}

let negate = (obj) =>
  Object.fromEntries(entries(obj).map(([key, val]) => [key, -val]))

let deliverMessage = (citizenId, intent, world) => {
  let c = world.citizens.find((c) => c.id == citizenId)
  let b = orderPlace(intent.order, world)
  let target = placeById(intent.placeId, world)
  if (
    !c || !b || !target || !samePos(c.pos, target.pos) ||
    !canSpend(b.storage, intent.order.price)
  ) {
    return world
  }

  c = {
    ...c,
    coins: c.coins + intent.order.price,
    lastErrandAt: world.tick,
    needs: { ...c.needs, rest: clamp(c.needs.rest + 4, 0, 100) },
    skills: addStock('message', 0.2, c.skills),
  }
  b = {
    ...b,
    storage: addStock('coins', -intent.order.price, b.storage),
  }
  return replaceBuilding(removeOrder(intent.order.id)(b))(
    replaceCitizen(c)(world),
  )
}

let forage = (citizenId, intent, world) => {
  let c = world.citizens.find((c) => c.id == citizenId)
  if (!c || !samePos(c.pos, intent.pos)) return world
  let patch = nearest(
    intent.pos,
    world.map.resources.filter((r) => r.kind == 'berries' && r.qty > 0),
    (r) => r.pos,
  )
  if (patch && dist(patch.pos, intent.pos) <= 2) {
    world = takeResource('berries', 1, world)
  }
  let qty = 1 + Math.min(1, Math.floor((c.skills.forage ?? 0) / 3))
  c = {
    ...c,
    inventory: addStock('food', qty, c.inventory),
    needs: {
      ...c.needs,
      hunger: Math.max(0, c.needs.hunger - 10),
      rest: clamp(c.needs.rest + 6, 0, 100),
    },
    skills: addStock('forage', 0.16, c.skills),
    intent: { kind: 'home', placeId: c.homeId },
  }
  return replaceCitizen(c)(world)
}

let act = (c, world) => {
  let { intent } = c
  if (intent.kind == 'buy') return transfer(c.id, intent.order, world)
  if (intent.kind == 'sell') return transfer(c.id, intent.order, world)
  if (intent.kind == 'work') return doWork(c.id, intent.placeId, world)
  if (intent.kind == 'message') return deliverMessage(c.id, intent, world)
  if (intent.kind == 'forage') return forage(c.id, intent, world)
  if (intent.kind == 'haul') {
    let next = transfer(
      c.id,
      intent.step == 'sell' ? intent.sell : intent.buy,
      world,
    )
    let now = next.citizens.find((x) => x.id == c.id)
    if (intent.step == 'buy' && stocked(now.inventory, intent.buy.good) > 0) {
      return replaceCitizen({ ...now, intent: { ...intent, step: 'sell' } })(
        next,
      )
    }
    return next
  }
  return world
}

let chooseIntents = (world) => {
  let planWorld = {
    ...indexPlaces(world),
    crowds: positionCounts(world.citizens),
  }
  return {
    ...world,
    citizens: world.citizens.map((c) => ({
      ...c,
      intent: chooseIntent(c, planWorld),
    })),
  }
}

let moveCitizens = (world) =>
  stripIndexes(
    world.citizens.reduce((w, c) => moveCitizen(c)(w), indexPlaces(world)),
  )

let actCitizens = (world) => world.citizens.reduce((w, c) => act(c, w), world)

let shareKnowledge = (world) => ({
  ...world,
  citizens: world.citizens.map((c) => {
    let mates = world.citizens.filter((o) =>
      o.id != c.id && dist(o.pos, c.pos) <= 1
    )
    let knownOrders = { ...c.knownOrders }
    let knownGoals = { ...c.knownGoals }
    let rumors = [...world.rumors]

    for (let m of mates) {
      let goal = ownGoal(m, world)
      if (goal) knownGoals[goal.key] = goal
    }

    for (let m of mates) {
      for (let [id, item] of Object.entries(m.knownOrders)) {
        let old = knownOrders[id]
        let confidence = item.confidence * 0.72
        if (!old || old.confidence < confidence) {
          knownOrders[id] = {
            ...item,
            confidence,
            seenAt: Math.max(item.seenAt, world.tick - 1),
          }
          rumors.push({
            id: `r${world.tick}:${m.id}:${c.id}:${id}`,
            orderId: id,
            sourceId: m.id,
            holderId: c.id,
            seenAt: world.tick,
            confidence,
            hops: (item.hops ?? 0) + 1,
          })
        }
      }
    }

    world = { ...world, rumors }
    return {
      ...c,
      knownOrders,
      knownGoals: Object.fromEntries(
        Object.entries(knownGoals)
          .filter(([, goal]) => world.tick - goal.seenAt < 30),
      ),
    }
  }),
  rumors: world.rumors.slice(-500),
})

let shortages = (world) => {
  let demand = {}
  for (let o of orders(world)) {
    if (o.side == 'buy') {
      demand[o.good] ??= 0
      demand[o.good] += o.qty
    }
  }
  return demand
}

let countKinds = (world) =>
  world.buildings.reduce((out, b) => ({
    ...out,
    [b.status.target ?? b.kind]: (out[b.status.target ?? b.kind] ?? 0) + 1,
  }), {})

let goodsMadeBy = (kind) => Object.keys(recipes[kind]?.outputs ?? {})

let goodsUsedBy = (kind) => Object.keys(recipes[kind]?.inputs ?? {})

let terrainAnchor = (kind, world) => {
  let terrain = kind == 'woodcutter'
    ? 'woods'
    : kind == 'mine'
    ? 'hills'
    : kind == 'farm'
    ? 'fields'
    : null
  let patch = world.map.terrain.find((p) => p.kind == terrain)
  return patch ? center(patch) : null
}

let placesForGoods = (goods, world) =>
  world.buildings.filter((b) =>
    goods.some((good) =>
      stocked(b.storage, good) > reserve[good] ||
      goodsMadeBy(b.status.target ?? b.kind).includes(good)
    )
  )

let sourcePlaces = (kind, world) => {
  let inputs = goodsUsedBy(kind)
  return placesForGoods(inputs, world)
}

let sinkPlaces = (kind, world) => {
  let outputs = goodsMadeBy(kind)
  return world.buildings.filter((b) =>
    b.board.some((o) => o.side == 'buy' && outputs.includes(o.good)) ||
    outputs.some((good) => civicDemand[b.kind]?.[good])
  )
}

let pathPoints = (world) =>
  Object.entries(world.map.paths ?? {})
    .filter(([, wear]) => wear >= 8)
    .map(([key]) => parsePos(key))

let pathAccess = (paths, pos) => {
  if (!paths.length) return 8
  return Math.min(8, dist(pos, nearest(pos, paths, (p) => p)))
}

let around = (pos, world) => {
  let out = []
  for (let r = 2; r <= 14; r += 2) {
    for (let d = -r; d <= r; d += 2) {
      out.push({
        x: clamp(pos.x + d, 3, world.map.width - 4),
        y: clamp(pos.y - r, 3, world.map.height - 4),
      })
      out.push({
        x: clamp(pos.x + d, 3, world.map.width - 4),
        y: clamp(pos.y + r, 3, world.map.height - 4),
      })
      out.push({
        x: clamp(pos.x - r, 3, world.map.width - 4),
        y: clamp(pos.y + d, 3, world.map.height - 4),
      })
      out.push({
        x: clamp(pos.x + r, 3, world.map.width - 4),
        y: clamp(pos.y + d, 3, world.map.height - 4),
      })
    }
  }
  return out
}

let midpoint = (a, b) => ({
  x: Math.round((a.x + b.x) / 2),
  y: Math.round((a.y + b.y) / 2),
})

let placementContext = (kind, world) => {
  let hall = world.buildings.find((b) => b.kind == 'townHall') ??
    world.buildings[0]
  let market = world.buildings.find((b) => b.kind == 'market') ?? hall
  return {
    kind,
    hall,
    market,
    sources: sourcePlaces(kind, world),
    builders: placesForGoods(Object.keys(constructionNeeds), world),
    sinks: sinkPlaces(kind, world),
    natural: terrainAnchor(kind, world),
    paths: pathPoints(world),
  }
}

let siteAnchors = (ctx) => {
  let { hall, market, sources, builders, sinks, natural } = ctx
  let anchors = [
    hall.pos,
    market.pos,
    natural,
    ...sources.map((b) => b.pos),
    ...builders.map((b) => b.pos),
    ...sinks.map((b) => b.pos),
  ]

  for (let a of sources) {
    for (let b of sinks) anchors.push(midpoint(a.pos, b.pos))
  }
  for (let a of builders) {
    for (let b of sinks) anchors.push(midpoint(a.pos, b.pos))
  }
  if (natural) { for (let b of sinks) anchors.push(midpoint(natural, b.pos)) }
  if (natural) {
    for (let b of builders) {
      anchors.push(midpoint(natural, b.pos))
    }
  }

  return anchors.filter(Boolean)
}

let siteCandidates = (world, ctx) => {
  let seen = {}
  return siteAnchors(ctx)
    .flatMap((pos) => [pos, ...around(pos, world)])
    .filter((pos) => {
      let key = posKey(pos)
      if (seen[key]) return false
      seen[key] = true
      return true
    })
    .filter((pos) => !isPath(world, pos))
    .filter((pos) => world.buildings.every((b) => dist(pos, b.pos) > 3))
}

let siteScore = (world, ctx, pos) => {
  let { sources, builders, sinks, natural, paths } = ctx
  let inputCost = sum(sources, (b) => dist(pos, b.pos)) /
    Math.max(1, sources.length)
  let buildCost = sum(builders, (b) => dist(pos, b.pos)) /
    Math.max(1, builders.length)
  let outputCost = sum(sinks, (b) => dist(pos, b.pos)) /
    Math.max(1, sinks.length)
  let pathCost = pathAccess(paths, pos)
  let town =
    world.buildings.find((b) => b.kind == 'market' || b.kind == 'townHall')
      ?.pos ?? pos
  let crowd =
    Math.max(0, 8 - Math.min(...world.buildings.map((b) => dist(pos, b.pos)))) *
    6
  let remote = Math.max(0, dist(pos, town) - 34) * 0.35
  let rawCost = natural ? dist(pos, natural) : 0

  return inputCost * 1.3 + buildCost * 1.2 + outputCost * 0.9 + rawCost * 2.4 +
    pathCost * 3 + crowd + remote
}

let sitePos = (n, kind, world) => {
  let ctx = placementContext(kind, world)
  return siteCandidates(world, ctx)
    .toSorted((a, b) =>
      siteScore(world, ctx, a) - siteScore(world, ctx, b) ||
      dist(a, { x: n % world.map.width, y: n % world.map.height }) -
        dist(b, { x: n % world.map.width, y: n % world.map.height })
    )[0]
}

let settleConstruction = (world) => {
  let active = world.buildings.filter((b) => b.kind == 'construction')
  if (active.length >= 3) return world

  let hungry = world.stats.shortageStreaks ?? {}
  let kinds = countKinds(world)
  let nextKind = Object.entries(hungry)
    .filter(([good, age]) => age > 80 && growthFor[good])
    .toSorted((a, b) => b[1] - a[1])
    .map(([good]) => growthFor[good])
    .find((kind) => (kinds[kind] ?? 0) < 3)

  if (!nextKind) return world

  let n = world.buildings.length + 1
  let pos = sitePos(n, nextKind, world)
  if (!pos) return world
  world = teachTown(
    postOrders(putBuilding(construction(n, nextKind, pos))(world)),
  )
  return {
    ...world,
    stats: {
      ...world.stats,
      shortageStreaks: {},
      constructionsStarted: (world.stats.constructionsStarted ?? 0) + 1,
    },
  }
}

let recomputeStats = (world) => {
  let demand = shortages(world)
  let streaks = { ...(world.stats.shortageStreaks ?? {}) }
  for (let good of goods) {
    let short = demand[good] ?? 0
    streaks[good] = short > 2 ? (streaks[good] ?? 0) + 1 : 0
  }

  return {
    ...world,
    stats: {
      ...world.stats,
      population: world.citizens.length,
      orderCount: orders(world).length,
      shortages: demand,
      shortageStreaks: streaks,
      avgHunger: sum(world.citizens, (c) => c.needs.hunger) /
        world.citizens.length,
      totalCoins: world.treasury +
        sum(world.citizens, (c) => c.coins) +
        sum(world.buildings, (b) => stocked(b.storage, 'coins')),
    },
  }
}

let scatter = (kind, qty, rect, rng) => {
  let resources = []
  for (let i = 0; i < qty; i++) {
    let pick = pickPos(rng + i, rect, 1)
    rng = pick.rng
    resources.push({ kind, pos: pick.pos, qty: 1 })
  }
  return { resources, rng }
}

let seededMap = (rng) => {
  let woods = {
    kind: 'woods',
    x: randomInt(rng, 4, 10).value,
    y: randomInt(rng + 1, 5, 12).value,
    w: randomInt(rng + 2, 22, 31).value,
    h: randomInt(rng + 3, 18, 25).value,
  }
  let fields = {
    kind: 'fields',
    x: randomInt(rng + 4, 31, 40).value,
    y: randomInt(rng + 5, 5, 13).value,
    w: randomInt(rng + 6, 24, 32).value,
    h: randomInt(rng + 7, 17, 24).value,
  }
  let hills = {
    kind: 'hills',
    x: randomInt(rng + 8, 58, 66).value,
    y: randomInt(rng + 9, 31, 39).value,
    w: randomInt(rng + 10, 18, 25).value,
    h: randomInt(rng + 11, 22, 30).value,
  }
  let meadow = {
    kind: 'meadow',
    x: randomInt(rng + 12, 18, 28).value,
    y: randomInt(rng + 13, 34, 42).value,
    w: randomInt(rng + 14, 30, 40).value,
    h: randomInt(rng + 15, 22, 30).value,
  }
  let trees = scatter('tree', 42, woods, rng + 20)
  let berries = scatter('berries', 18, meadow, trees.rng)
  let stones = scatter('stone', 26, hills, berries.rng)
  return {
    width: 88,
    height: 76,
    paths: {},
    terrain: [woods, fields, hills, meadow],
    resources: [...trees.resources, ...berries.resources, ...stones.resources],
  }
}

let seedBuildings = (map) => {
  let woods = map.terrain.find((p) => p.kind == 'woods')
  let hills = map.terrain.find((p) => p.kind == 'hills')
  let meadow = map.terrain.find((p) => p.kind == 'meadow')
  let town = center(meadow)
  let homes = Array.from({ length: 8 }, (_, i) =>
    building(5 + i, 'home', {
      x: clamp(town.x - 9 + (i % 4) * 5, 3, map.width - 4),
      y: clamp(town.y + 11 + Math.floor(i / 4) * 5, 3, map.height - 4),
    }, { coins: 70 }))

  return [
    building(0, 'townHall', town, { coins: 1600 }),
    building(1, 'market', { x: town.x + 4, y: town.y + 1 }, { coins: 900 }),
    building(2, 'woodcutter', center(woods), { coins: 500 }),
    building(3, 'mine', center(hills), { coins: 520 }),
    building(4, 'builderYard', { x: town.x, y: town.y + 8 }, { coins: 650 }),
    ...homes,
  ]
}

let seedCitizens = (count, rng, buildings) => {
  let homes = buildings.filter((b) => b.kind == 'home')
  let town = buildings.find((b) => b.kind == 'townHall')
  let citizens = []
  for (let i = 0; i < count; i++) {
    rng = nextRng(rng + i).rng
    let home = homes[i % homes.length]
    citizens.push(
      citizen(
        i,
        { x: town.pos.x - 4 + (i % 8), y: town.pos.y + 4 + Math.floor(i / 8) },
        rng,
        home.id,
      ),
    )
  }
  return citizens
}

let teachTown = (world) => ({
  ...world,
  citizens: world.citizens.map((c) =>
    world.buildings
      .filter((b) =>
        dist(c.pos, b.pos) < 20 ||
        b.kind == 'construction' ||
        ['townHall', 'market'].includes(b.kind)
      )
      .reduce((out, b) => learnBoard(out, b, world), c)
  ),
})

/// createWorld('same').rng == createWorld('same').rng -> true
/** Creates a deterministic hamlet with no ambient randomness. */
export let createWorld = (seed = 'settlement', opts = {}) => {
  let rng = hashSeed(seed)
  let pop = opts.population ?? 48
  let map = seededMap(rng)
  let buildings = seedBuildings(map)
  let world = {
    tick: 0,
    rng,
    map,
    citizens: seedCitizens(pop, rng, buildings),
    buildings,
    orders: [],
    rumors: [],
    treasury: 1200,
    policies: {
      speed: 1,
      messengerBounty: 6,
      taxes: {},
      subsidies: {},
      ...(opts.policies ?? {}),
    },
    stats: {
      population: pop,
      shortages: {},
      shortageStreaks: {},
      constructionsStarted: 0,
    },
  }

  world = postOrders(world)
  world = teachTown(world)
  world = recomputeStats(world)
  return world
}

/// runTicks(0)(createWorld('x')).tick -> 0
/** Runs the fixed minute clock repeatedly. */
export let runTicks = (n) => (world) => {
  for (let i = 0; i < n; i++) world = tick(world)
  return world
}

/// setPolicy({messengerBounty: 9})({policies: {messengerBounty: 1}}).policies.messengerBounty -> 9
/** Patches player policy without mutating the previous world. */
export let setPolicy = (patch) => (world) => ({
  ...world,
  policies: {
    ...world.policies,
    ...patch,
    taxes: { ...(world.policies?.taxes ?? {}), ...(patch.taxes ?? {}) },
    subsidies: {
      ...(world.policies?.subsidies ?? {}),
      ...(patch.subsidies ?? {}),
    },
  },
})

/** Advances the world by one deterministic minute. */
export let tick = (world) => {
  world = { ...world, tick: world.tick + 1 }
  world = decayPaths(world)
  world = refreshPathField(world)
  world = postOrders(world)
  world = chooseIntents(world)
  world = moveCitizens(world)
  world = actCitizens(world)
  world = shareKnowledge(world)
  world = postOrders(world)
  world = recomputeStats(world)
  world = settleConstruction(world)
  world = recomputeStats(world)
  world = { ...world, orders: orders(world) }
  return world
}

let orderSummary = (world) =>
  goods.map((good) => {
    let buy = orders(world).filter((o) => o.good == good && o.side == 'buy')
    let sell = orders(world).filter((o) => o.good == good && o.side == 'sell')
    return {
      good,
      buyQty: sum(buy, (o) => o.qty),
      sellQty: sum(sell, (o) => o.qty),
      buyPrice: buy.length
        ? Math.round(sum(buy, (o) => o.price) / buy.length)
        : null,
      sellPrice: sell.length
        ? Math.round(sum(sell, (o) => o.price) / sell.length)
        : null,
    }
  })

let placeName = (placeId, world) => {
  let b = placeById(placeId, world)
  return b ? `${kindNames[b.kind] ?? b.kind} ${b.id}` : 'somewhere'
}

let orderPlaceName = (order, world) => placeName(order.placeId, world)

let thought = (c, world) => {
  let { intent } = c
  if (!intent || intent.kind == 'idle') return 'waiting for a useful lead'
  if (intent.kind == 'forage') {
    return `foraging for berries in the ${intent.site}`
  }
  if (intent.kind == 'home') {
    return `heading home to rest at ${placeName(intent.placeId, world)}`
  }
  if (intent.kind == 'visit') {
    return `visiting ${placeName(intent.placeId, world)} to refresh prices`
  }
  if (intent.kind == 'work') {
    let b = placeById(intent.placeId, world)
    if (!b) return 'looking for work'
    if (b.status.kind == 'building') {
      return `building ${
        kindNames[b.status.target] ?? b.status.target
      } at ${b.id}`
    }
    return `working at ${placeName(intent.placeId, world)} for ${
      workWage(b, world)
    } coins`
  }
  if (intent.kind == 'buy') {
    return `buying ${intent.order.good} from ${
      orderPlaceName(intent.order, world)
    } for ${intent.order.price}`
  }
  if (intent.kind == 'sell') {
    return `selling ${intent.order.good} to ${
      orderPlaceName(intent.order, world)
    } for ${intent.order.price}`
  }
  if (intent.kind == 'message') {
    return `carrying ${intent.order.good} shortage news to ${
      placeName(intent.placeId, world)
    }`
  }
  if (intent.kind == 'haul') {
    return intent.step == 'buy'
      ? `hauling ${intent.buy.good}: buying at ${
        orderPlaceName(intent.buy, world)
      }`
      : `hauling ${intent.sell.good}: selling at ${
        orderPlaceName(intent.sell, world)
      }`
  }
  return `doing ${intent.kind}`
}

let citizenView = (c, world) => ({
  id: c.id,
  pos: c.pos,
  homeId: c.homeId,
  coins: Math.round(c.coins),
  inventory: goodsIn(c.inventory),
  needs: c.needs,
  skills: c.skills,
  intent: c.intent,
  thought: thought(c, world),
  knownOrders: Object.keys(c.knownOrders).length,
})

let buildingView = (b) => ({
  id: b.id,
  kind: b.kind,
  name: kindNames[b.kind] ?? b.kind,
  pos: b.pos,
  storage: goodsIn(b.storage),
  coins: Math.round(stocked(b.storage, 'coins')),
  board: b.board,
  status: b.status,
  recipe: b.recipe,
})

/// project(createWorld('p')).buildings.length > 0 -> true
/** Narrows world state to the read-only data the UI should draw. */
export let project = (world) => ({
  tick: world.tick,
  map: world.map,
  citizens: world.citizens.map((c) => citizenView(c, world)),
  buildings: world.buildings.map(buildingView),
  orders: orderSummary(world),
  rumors: world.rumors.slice(-80),
  policies: world.policies,
  stats: world.stats,
})

export let __private = {
  boardFor,
  buildingIndex,
  buildPathField,
  chooseIntent,
  decayPaths,
  learnBoard,
  nearest,
  orders,
  positionCounts,
  settleConstruction,
  shareKnowledge,
  stepToward,
}
