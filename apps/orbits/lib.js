extend(Object, {
  tap(f) {
    f(this)
    return this
  },
})

extend(Array, {
  get x() {
    return this[0]
  },

  get y() {
    return this[1]
  },

  get neg() {
    return this.map((x) => -x)
  },

  get len() {
    return (this.x.sq + this.y.sq).sqrt
  },

  get unit() {
    return this.scale(1 / this.len)
  },

  scale(n) {
    return this.map((x) => x * n)
  },

  add(b) {
    return this.map((x, i) => x + b[i])
  },

  distTo(b) {
    return this.sub(b).len
  },

  sub(b) {
    return this.add(b.neg)
  },

  get canvas() {
    return this.add(system.focus.pos)
  },
})

extend(Number, {
  get sq() {
    return Math.pow(this, 2)
  },

  get sqrt() {
    return Math.sqrt(this)
  },

  get draw() {
    const max = Math.min(canvas.height, canvas.width) / 2
    const f = max / system.camera.scale
    return this * f
  },
})

function extend(Class, defs) {
  const descs = Object.getOwnPropertyDescriptors(defs)
  Object.defineProperties(Class.prototype, descs)
  return Class
}
