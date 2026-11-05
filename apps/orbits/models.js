// Classic scripts sharing one global scope with lib.js, as yak.sh served them.
// deno-lint-ignore-file no-unused-vars
class Base {
  static of(...props) {
    return new this(...props)
  }

  static get defaults() {
    return {
      pos: [0, 0],
      vel: [0, 0],
    }
  }

  constructor(...props) {
    this.self.all ??= []
    this.self.all.push(this)
    Object.assign(this, this.self.defaults, ...props)
    this.setup()
  }

  get self() {
    return this.constructor
  }

  get x() {
    return this.pos.x
  }

  get y() {
    return this.pos.y
  }

  setup() {}

  step() {}

  draw(ctx) {}
}

class System extends Base {
  static get defaults() {
    return {
      ...Base.defaults,
      debug: false,
      bodies: [],
      massives: [],
    }
  }

  addBody(body) {
    this.bodies.push(body)
    if (body.mass > 1) this.massives.push(body)
  }

  gravityAt(pt) {
    return this.massives.reduce(
      (force, body) => {
        const r = body.pos.distTo(pt)
        const g = body.mu / r.sq
        return pt.sub(body.pos).unit.scale(g).add(force)
      },
      [0, 0],
    )
  }
}

class Camera extends Base {
  static get defaults() {
    return {
      ...Base.defaults,
      focus: null,
      scale: 1,
      shift: [0, 0],
      size: [canvas.width, canvas.height],
    }
  }

  focusOn(body) {
    this.focus = body
  }
}

class Body extends Base {
  static create(...params) {
    const body = this.of(...params)
    system.addBody(body)
    return body
  }

  get mu() {
    return this.mass * G
  }

  get acceleration() {
    return this.force.scale(1 / this.mass)
  }

  distTo(b) {
    return this.pos.distTo(b.pos)
  }

  gravityFrom(b) {
    const r = this.distTo(b)
    const g = (b.mu * this.mass) / r.sq

    return b.pos.sub(this.pos).unit.scale(g)
  }

  orbit(b, r = this.x, n = 1) {
    this.pos = b.pos.add([r, 0])

    const g = (b.mu / r).sqrt
    const vel = [0, 1].scale(g * (n * 0.85 + 0.15))
    this.vel = b.vel.add(vel)
    return this
  }
}
