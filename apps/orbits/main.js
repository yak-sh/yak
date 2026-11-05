// Classic scripts sharing one global scope with lib.js, as yak.sh served them.
// deno-lint-ignore-file no-var no-window no-unused-vars
canvas.width = window.innerWidth * 2
canvas.height = window.innerHeight * 2
canvas.style.width = `100vw`
canvas.style.height = `100vh`

let G = 3.674e-12 // 6.674e-11 // Gravitational constant
let M = 1e6 // Solar Mass
let Me = M / 332_946 // Earth mass
let AU = 1 // Astronomical unit

var camera = Camera.of({
  scale: 9 * AU,
})

var system = System.of({ camera })

var hole = Body.create({
  color: 'black',
  mass: 4.154e5 * M,
  radius: 50,
  vel: [0, 0],
  pos: [0, 0],
  grav: [0, 0],
})

var sun = Body.create({
  color: '#E9C86D',
  mass: M,
  radius: 40, // 6.957e8
}).orbit(hole, 900 * AU)

var mercury = Body.create({
  color: '#A4583A',
  mass: 0.0553 * Me,
  radius: 4, // 6.371e6
}).orbit(sun, 0.387 * AU, Math.random())

var venus = Body.create({
  color: '#E7AF68',
  mass: 0.815 * Me,
  radius: 7, // 6.371e6
}).orbit(sun, 0.72 * AU, Math.random())

var earth = Body.create({
  color: '#6C99C6',
  mass: Me,
  radius: 10, // 6.371e6
}).orbit(sun, 1 * AU)

var moon = Body.create({
  color: 'gray',
  mass: 0.0123 * Me,
  radius: 4, // 6.371e6
}).orbit(earth, 0.0026 * AU)

var mars = Body.create({
  color: '#A4583A',
  mass: 0.107 * Me,
  radius: 8, // 6.371e6
}).orbit(sun, 1.52 * AU, Math.random())

var jupiter = Body.create({
  color: '#BD8847',
  mass: 317.8 * Me,
  radius: 11, // 6.371e6
}).orbit(sun, 5.2 * AU, Math.random())

var saturn = Body.create({
  color: '#E0C284',
  mass: 95.2 * Me,
  radius: 11, // 6.371e6
}).orbit(sun, 9.5 * AU, Math.random())

var uranus = Body.create({
  color: '#D7F5F7',
  mass: 14.5 * Me,
  radius: 11, // 6.371e6
}).orbit(sun, 19.2 * AU, Math.random())

var kuiperBelt = Body.create({
  color: '#A4583A',
  mass: 14.5 * Me,
  radius: 11, // 6.371e6
}).orbit(sun, 30 * AU, Math.random())

var neptune = Body.create({
  color: '#7A95BA',
  mass: 17.1 * Me,
  radius: 11, // 6.371e6
}).orbit(sun, 30.1 * AU, Math.random())

var eris = Body.create({
  color: '#A4583A',
  mass: 0.0027 * Me,
  radius: 5, // 6.371e6
}).orbit(sun, 67.8 * AU, Math.random())

var asteroids = []

var asteroid = (body, d = 4, n = Math.random(), m = Math.random()) =>
  Body.create({
    asteroid: true,
    color: 'gray',
    mass: moon.mass * m,
    radius: 1, // 6.371e6
  })
    .orbit(body, n * d * AU + 0.01, Math.random())
    .tap((a) => {
      asteroids.push(a)
    })

for (let i = 0; i < 30; i++) {
  asteroid(sun, 2)
  asteroid(sun, 20)
  asteroid(hole, 700)
}

let rotation = 0

go(earth)
drawInitial(system)
loop()

function loop() {
  for (const obj of system.bodies) step(obj, system)
  system.camera.tap((cam) => {
    cam.pos = cam.focus.pos
    cam.vel = cam.focus.vel
  })
  draw(system)
  for (const obj of system.bodies) move(obj, system)
  requestAnimationFrame(loop)
}

function step(obj, sys) {
  obj.force = [0, 0]

  for (const oth of sys.massives) {
    if (obj === oth) continue

    obj.force = obj.force.add(obj.gravityFrom(oth))
  }

  obj.vel = obj.vel.add(obj.acceleration)
}

function move(obj, sys) {
  obj.pos = obj.pos.add(obj.vel)
}

function drawInitial(sys) {
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'rgb(0, 0, 0)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function draw(sys) {
  const ctx = canvas.getContext('2d')
  const { shift } = sys
  const cam = sys.camera

  ctx.globalCompositeOperation = 'overlay'
  // ctx.globalCompositeOperation = "screen"
  ctx.fillStyle = 'rgba(0, 0, 0, 0.009)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'

  if (sys.wipe || sys.wipeOnce) {
    drawInitial(sys)
    sys.wipeOnce = false
  }

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  // ctx.rotate((rotation += 0.02))
  ctx.translate(-cam.x.draw, cam.y.draw)

  // ctx.translate(shift.x.draw / 10, shift.y)

  for (const obj of sys.bodies) {
    ctx.fillStyle = obj.color
    ctx.strokeStyle = '#eee'
    ctx.beginPath()
    ctx.arc(obj.pos.x.draw, -obj.pos.y.draw, obj.radius, 0, 2 * Math.PI)
    ctx.fill()
    // ctx.stroke()

    if (sys.debug) {
      drawVec('red', obj.pos, obj.acceleration.scale(cam.scale))
      drawVec(
        'blue',
        obj.pos,
        obj.vel
          .add(sys.debugAbsolute ? [0, 0] : cam.vel.neg)
          .scale(cam.scale / 2),
      )
    }
  }
  ctx.restore()

  // for (let x = 0; x < canvas.width; x += 50) {
  //   for (let y = 0; y < canvas.height; y += 50) {
  //     ctx.strokeStyle = "white"
  //     ctx.beginPath()
  //     ctx.moveTo(x, y)
  //     const g = sys.gravityAt([x, y]).scale(100_000)
  //     console.log(g)
  //     ctx.lineTo(x + g.x, y + g.y)
  //     ctx.stroke()
  //   }
  // }

  function drawVec(color, pos, v) {
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(pos.x.draw, -pos.y.draw)
    const g = pos.add(v)
    ctx.lineTo(g.x.draw, -g.y.draw)
    ctx.stroke()
  }
}

/**
 * Change the "speed" of the animation: speed(1.5) moves 50% faster.
 */
function speed(n) {
  G *= n

  for (const obj of system.bodies) {
    obj.vel = obj.vel.scale(n.sqrt)
  }

  return G
}

function toggleDebug(p = !system.debug) {
  system.debug = p
}

function debug(absolute = false) {
  system.debugAbsolute = absolute
  system.debug = true
}

function wipe(p = true) {
  system.wipeOnce = p
}

function wipeAll(p = true) {
  system.wipe = p
}

function focus(body) {
  system.camera.focusOn(body)
  wipe()
}

function zoom(n) {
  system.camera.scale /= n
  wipe()
}

function scale(n) {
  system.camera.scale = n * AU
  wipe()
}

console.log(`
go(sun) // focus and zoom to another body
speed(2) // change the speed (kinda)
focus(hole) // focus on another body
zoom(0.001) // zoom in or out
`)

function go(body) {
  focus(body)

  switch (body) {
    case sun:
      scale(3)
      break

    case mercury:
    case earth:
      scale(1.5) // 0.1
      break

    case mars:
      scale(2)
      break

    case jupiter:
      scale(5)
      break

    case saturn:
      scale(8)
      break

    case neptune:
    case uranus:
      scale(30)
      break

    case eris:
      scale(70)
      break

    case hole:
      scale(900)
      break
  }
}

window.onhashchange = processHash
processHash()
function processHash() {
  const hash = location.hash.slice(1)
  if (hash) {
    eval(decodeURIComponent(hash))
  }
}
