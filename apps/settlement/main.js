import { createWorld, project, runTicks, setPolicy } from './sim.js'

let canvas = document.querySelector('#map')
let ctx = canvas.getContext('2d')
let play = document.querySelector('#play')
let speed = document.querySelector('#speed')
let bounty = document.querySelector('#bounty')
let industry = document.querySelector('#industry')
let subsidy = document.querySelector('#subsidy')
let seedButton = document.querySelector('#seed')
let clock = document.querySelector('#clock')
let stats = document.querySelector('#stats')
let shortages = document.querySelector('#shortages')
let orderList = document.querySelector('#orders')
let citizenList = document.querySelector('#citizens')
let selection = document.querySelector('#selection')

let speeds = [0, 2, 4, 8, 16, 32]
let world = createWorld(location.hash.slice(1) || 'market')
let view = project(world)
let paused = false
let selected = null
let seedCount = 0
let scale = 1
let origin = { x: 0, y: 0 }
let lastHudAt = 0
let lastFrameAt = performance.now()
let simBudget = 0

let spriteSheet = new Image()
spriteSheet.src = 'assets/spritesheet.png'
spriteSheet.addEventListener('load', () => draw())

let spriteOrder = [
  'townHall',
  'market',
  'home',
  'farm',
  'kitchen',
  'woodcutter',
  'sawmill',
  'kiln',
  'mine',
  'smelter',
  'blacksmith',
  'builderYard',
  'construction',
  'citizen',
  'citizenCarry',
  'forage',
  'stonePath',
  'grass',
  'wornPath',
  'dirtPath',
]

let spriteGrid = {
  x: [4, 316, 629, 941],
  y: [4, 290, 572, 829, 1027],
  w: [309, 309, 309, 309],
  h: [284, 279, 254, 195, 222],
}

let spriteCells = Object.fromEntries(spriteOrder.map((name, i) => {
  let col = i % 4
  let row = Math.floor(i / 4)
  return [name, {
    x: spriteGrid.x[col],
    y: spriteGrid.y[row],
    w: spriteGrid.w[col],
    h: spriteGrid.h[row],
  }]
}))

let spriteReady = (img) => img?.complete && img.naturalWidth > 0

let goodColors = {
  food: '#d26c3f',
  crops: '#d0b34f',
  logs: '#795333',
  lumber: '#a27345',
  charcoal: '#2f3132',
  ore: '#7a6771',
  stone: '#9a9284',
  ingots: '#c08647',
  tools: '#44545a',
  hardware: '#566264',
}

let fmt = (n) => Math.round(n).toLocaleString()

let top = (obj, limit = 5) =>
  Object.entries(obj ?? {})
    .filter(([, n]) => n > 0)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)

let storeText = (store) =>
  top(store, 8).map(([good, qty]) =>
    `<span class=pill>${good} ${fmt(qty)}</span>`
  ).join('') || '<span class=dim>empty</span>'

let resize = () => {
  let dpr = devicePixelRatio || 1
  let box = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.floor(box.width * dpr))
  canvas.height = Math.max(1, Math.floor(box.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw()
}

let setWorld = (next, opts = {}) => {
  world = next
  view = project(world)
  if (opts.forceHud || performance.now() - lastHudAt > 250) {
    lastHudAt = performance.now()
    renderHud()
  } else {
    renderSelection()
  }
  draw()
}

let tick = (now = performance.now()) => {
  if (!paused) {
    let dt = Math.min(0.25, Math.max(0, (now - lastFrameAt) / 1000))
    simBudget += speeds[Number(speed.value)] * dt
    let n = Math.min(12, Math.floor(simBudget))
    simBudget -= n
    if (n) setWorld(runTicks(n)(world))
  }
  lastFrameAt = now
  requestAnimationFrame(tick)
}

let updatePolicy = () => {
  let subsidies = { [industry.value]: Number(subsidy.value) }
  setWorld(
    setPolicy({
      messengerBounty: Number(bounty.value),
      subsidies,
    })(world),
    { forceHud: true },
  )
}

play.addEventListener('click', () => {
  paused = !paused
  play.textContent = paused ? 'Run' : 'Pause'
  play.setAttribute(
    'aria-label',
    paused ? 'Run simulation' : 'Pause simulation',
  )
})

bounty.addEventListener('input', updatePolicy)
industry.addEventListener('change', () => {
  subsidy.value = world.policies.subsidies[industry.value] ?? 0
})
subsidy.addEventListener('input', updatePolicy)

seedButton.addEventListener('click', () => {
  let seed = `market-${++seedCount}`
  history.replaceState(null, '', `#${seed}`)
  selected = null
  simBudget = 0
  setWorld(createWorld(seed), { forceHud: true })
})

addEventListener('resize', resize)

canvas.addEventListener('click', (event) => {
  let rect = canvas.getBoundingClientRect()
  let point = {
    x: (event.clientX - rect.left - origin.x) / scale,
    y: (event.clientY - rect.top - origin.y) / scale,
  }
  let items = [
    ...view.buildings.map((item) => ({
      type: 'building',
      item,
      d: dist(point, item.pos),
    })),
    ...view.citizens.map((item) => ({
      type: 'citizen',
      item,
      d: dist(point, item.pos),
    })),
  ]
  let nearest = items.toSorted((a, b) => a.d - b.d)[0]
  selected = { type: nearest.type, id: nearest.item.id }
  renderSelection()
  draw()
})

citizenList.addEventListener('click', (event) => {
  let row = event.target.closest('[data-citizen]')
  if (!row) return
  selected = { type: 'citizen', id: row.dataset.citizen }
  renderSelection()
  draw()
})

let dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

let terrainColor = (kind) => ({
  woods: '#77935c',
  fields: '#cbd783',
  hills: '#9b9079',
  meadow: '#b7c98a',
}[kind] ?? '#b7c98a')

let buildingSpriteSize = (b) => ({
  townHall: [6.6, 5.6],
  market: [5.8, 4.1],
  home: [4.1, 3.2],
  farm: [6.8, 4.4],
  kitchen: [5.8, 5.4],
  woodcutter: [5.4, 4.9],
  sawmill: [6.1, 5.0],
  kiln: [4.7, 5.0],
  mine: [5.5, 4.8],
  smelter: [4.9, 5.2],
  blacksmith: [6.0, 5.0],
  builderYard: [5.5, 4.8],
  construction: [5.6, 4.9],
}[b.kind] ?? [5.2, 4.6])

let setupCamera = () => {
  let box = canvas.getBoundingClientRect()
  scale = Math.min(box.width / view.map.width, box.height / view.map.height) *
    0.94
  origin = {
    x: (box.width - view.map.width * scale) / 2,
    y: (box.height - view.map.height * scale) / 2,
  }
}

let worldRect = (x, y, w, h) => {
  ctx.fillRect(origin.x + x * scale, origin.y + y * scale, w * scale, h * scale)
}

let worldCircle = (x, y, r) => {
  ctx.beginPath()
  ctx.arc(origin.x + x * scale, origin.y + y * scale, r * scale, 0, Math.PI * 2)
  ctx.fill()
}

let drawSprite = (name, x, y, w, h, anchor = 0.62) => {
  let cell = spriteCells[name]
  if (!cell || !spriteReady(spriteSheet)) return false
  ctx.drawImage(
    spriteSheet,
    cell.x,
    cell.y,
    cell.w,
    cell.h,
    origin.x + (x - w / 2) * scale,
    origin.y + (y - h * anchor) * scale,
    w * scale,
    h * scale,
  )
  return true
}

let drawItemDot = (good, x, y, r = 0.16) => {
  ctx.fillStyle = goodColors[good] ?? '#9b3f2e'
  worldCircle(x, y, r)
  ctx.strokeStyle = 'rgba(24, 33, 28, 0.65)'
  ctx.lineWidth = 1
  ctx.stroke()
}

let draw = () => {
  setupCamera()
  let box = canvas.getBoundingClientRect()
  ctx.clearRect(0, 0, box.width, box.height)
  ctx.fillStyle = '#aabf78'
  ctx.fillRect(0, 0, box.width, box.height)

  for (let patch of view.map.terrain) {
    ctx.fillStyle = terrainColor(patch.kind)
    worldRect(patch.x, patch.y, patch.w, patch.h)
  }

  drawResources()
  drawPaths()
  drawGrid()
  drawHeat()
  for (let b of view.buildings) drawBuilding(b)
  for (let c of view.citizens) drawCitizen(c)
  drawSelectionMark()
}

let drawGrid = () => {
  ctx.strokeStyle = 'rgba(24, 33, 28, 0.055)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= view.map.width; i += 4) {
    ctx.moveTo(origin.x + i * scale, origin.y)
    ctx.lineTo(origin.x + i * scale, origin.y + view.map.height * scale)
  }
  for (let i = 0; i <= view.map.height; i += 4) {
    ctx.moveTo(origin.x, origin.y + i * scale)
    ctx.lineTo(origin.x + view.map.width * scale, origin.y + i * scale)
  }
  ctx.stroke()
}

let drawResources = () => {
  for (let r of view.map.resources ?? []) {
    if (r.kind == 'tree') {
      ctx.fillStyle = '#5f7f43'
      worldCircle(r.pos.x, r.pos.y - 0.1, 0.42)
      ctx.fillStyle = '#60452b'
      worldRect(r.pos.x - 0.08, r.pos.y + 0.22, 0.16, 0.28)
    } else if (r.kind == 'berries') {
      ctx.fillStyle = '#527c3d'
      worldCircle(r.pos.x, r.pos.y, 0.34)
      ctx.fillStyle = '#9b3f5d'
      worldCircle(r.pos.x + 0.12, r.pos.y - 0.08, 0.07)
      worldCircle(r.pos.x - 0.09, r.pos.y + 0.1, 0.06)
    } else if (r.kind == 'stone') {
      ctx.fillStyle = '#8f887b'
      worldCircle(r.pos.x, r.pos.y, 0.28)
      ctx.fillStyle = '#6e6a63'
      worldCircle(r.pos.x + 0.16, r.pos.y + 0.04, 0.18)
    }
  }
}

let drawPaths = () => {
  for (let [key, wear] of Object.entries(view.map.paths ?? {})) {
    if (wear < 2) continue
    let [x, y] = key.split(',').map(Number)
    let alpha = Math.min(0.74, 0.18 + wear / 105)
    ctx.fillStyle = wear >= 32
      ? `rgba(113, 86, 54, ${alpha})`
      : wear >= 12
      ? `rgba(145, 115, 72, ${alpha})`
      : `rgba(181, 157, 94, ${alpha * 0.72})`
    worldRect(x - 0.5, y - 0.5, 1, 1)
  }
}

let drawHeat = () => {
  let hot = new Map(view.orders.map((o) => [o.good, o.buyQty - o.sellQty]))
  for (let b of view.buildings) {
    let pressure = Object.entries(b.storage)
      .reduce(
        (n, [good, qty]) => n + Math.max(0, (hot.get(good) ?? 0) - qty) / 100,
        0,
      )
    if (pressure <= 0) continue
    ctx.fillStyle = `rgba(155, 63, 46, ${Math.min(0.28, pressure)})`
    worldCircle(b.pos.x, b.pos.y, 3.2)
  }
}

let drawBuilding = (b) => {
  let [w, h] = buildingSpriteSize(b)
  ctx.fillStyle = 'rgba(24, 33, 28, 0.16)'
  worldCircle(b.pos.x + 0.12, b.pos.y + 0.28, Math.max(w, h) * 0.32)

  if (!drawSprite(b.kind, b.pos.x, b.pos.y + 0.15, w, h)) {
    ctx.fillStyle = '#8d633f'
    worldRect(b.pos.x - 0.75, b.pos.y - 0.75, 1.5, 1.5)
  }

  if (b.status.kind == 'building') {
    ctx.fillStyle = 'rgba(255, 250, 240, 0.9)'
    worldRect(b.pos.x - 1.1, b.pos.y + 1.35, 2.2, 0.2)
    ctx.fillStyle = '#31697a'
    worldRect(
      b.pos.x - 1.1,
      b.pos.y + 1.35,
      2.2 * Math.min(1, b.status.progress / 12),
      0.2,
    )
  }
}

let drawCitizen = (c) => {
  let carry = top(c.inventory, 1)[0]?.[0]
  let didDraw = drawSprite(
    carry ? 'citizenCarry' : 'citizen',
    c.pos.x,
    c.pos.y + 0.22,
    carry ? 1.7 : 1.32,
    carry ? 1.7 : 1.5,
    0.86,
  )
  if (!didDraw) {
    ctx.fillStyle = '#f8eed2'
    worldCircle(c.pos.x, c.pos.y, 0.34)
    ctx.strokeStyle = '#18211c'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (carry) {
    drawItemDot(carry, c.pos.x + 0.35, c.pos.y - 0.28)
  }
}

let drawSelectionMark = () => {
  if (!selected) return
  let item = selectedItem()
  if (!item) return
  let { pos } = item
  ctx.strokeStyle = '#fffaf0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(
    origin.x + pos.x * scale,
    origin.y + pos.y * scale,
    1.5 * scale,
    0,
    Math.PI * 2,
  )
  ctx.stroke()
  ctx.strokeStyle = '#9b3f2e'
  ctx.lineWidth = 1
  ctx.stroke()
}

let stat = (label, value) =>
  `<div class=stat><b class="stat_Value">${value}</b><span class="stat_Label">${label}</span></div>`

let citizenRow = (c) => `
	<li class=citizen data-citizen="${c.id}">
		<div class=row><b>${c.id}</b><span>${c.intent.kind}</span></div>
		<div class=thought>${c.thought}</div>
	</li>
`

let renderHud = () => {
  clock.textContent = `Day ${Math.floor(view.tick / 1440) + 1}, ${
    String(Math.floor(view.tick / 60) % 24).padStart(2, '0')
  }:${String(view.tick % 60).padStart(2, '0')}`
  stats.innerHTML = [
    stat('people', view.stats.population),
    stat('orders', view.stats.orderCount),
    stat('builds', view.stats.constructionsStarted ?? 0),
    stat('hunger', fmt(view.stats.avgHunger ?? 0)),
  ].join('')

  shortages.innerHTML =
    top(view.stats.shortages, 7).map(([good, qty]) =>
      `<li><div class=row><b>${good}</b><span>${fmt(qty)}</span></div></li>`
    ).join('') || '<li class=dim>balanced for now</li>'

  orderList.innerHTML = view.orders
    .filter((o) => o.buyQty || o.sellQty)
    .toSorted((a, b) => (b.buyQty - b.sellQty) - (a.buyQty - a.sellQty))
    .slice(0, 8)
    .map((o) => `
			<li>
				<div class=row><b>${o.good}</b><span>${fmt(o.buyQty)} / ${
      fmt(o.sellQty)
    }</span></div>
				<div class=dim>buy ${o.buyPrice ?? '-'} sell ${o.sellPrice ?? '-'}</div>
			</li>
		`).join('')

  citizenList.innerHTML = view.citizens
    .toSorted((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map(citizenRow)
    .join('')

  renderSelection()
}

let renderSelection = () => {
  if (!selected) {
    selection.innerHTML = '<span class=dim>Pick a citizen or building.</span>'
    return
  }

  let item = selectedItem()
  if (!item) {
    selected = null
    renderSelection()
    return
  }

  if (selected.type == 'building') {
    selection.innerHTML = `
			<div class=row><b>${item.name}</b><span>${item.id}</span></div>
			<div class=dim>${item.kind} at ${item.pos.x}, ${item.pos.y}</div>
			<p>${storeText(item.storage)}</p>
			<p>${item.board.length} local orders</p>
			${
      item.status.kind == 'building'
        ? `<p>Building ${item.status.target}: ${
          fmt(item.status.progress)
        }/12</p>`
        : ''
    }
		`
  } else {
    let best = top(item.skills, 3)
    selection.innerHTML = `
			<div class=row><b>${item.id}</b><span>${
      fmt(item.coins)
    } coins</span></div>
			<div class=dim>${item.intent.kind} at ${item.pos.x}, ${item.pos.y}</div>
			<p class=thought>${item.thought}</p>
			<p>${storeText(item.inventory)}</p>
			<p>${
      best.map(([skill, val]) =>
        `<span class=pill>${skill} ${val.toFixed(1)}</span>`
      ).join('')
    }</p>
			<p class=dim>${item.knownOrders} known orders</p>
		`
  }
}

let selectedItem = () =>
  selected?.type == 'building'
    ? view.buildings.find((item) => item.id == selected.id)
    : view.citizens.find((item) => item.id == selected.id)

resize()
renderHud()
tick()
