type Point = { x: number; z: number; own?: boolean }
let span = 23

export let board = (canvas: HTMLCanvasElement) => {
  let ctx = canvas.getContext('2d')!
  let dimensions = () => {
    let rect = canvas.getBoundingClientRect()
    let size = Math.min(rect.width, rect.height) * 0.84
    return {
      rect,
      size,
      x: (rect.width - size) / 2,
      z: (rect.height - size) / 2,
    }
  }
  return {
    draw(pawns: Point[], cursors: Point[] = []) {
      let { rect, size, x, z } = dimensions()
      let density = Math.min(devicePixelRatio || 1, 2)
      let w = Math.floor(rect.width * density),
        h = Math.floor(rect.height * density)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.setTransform(density, 0, 0, density, 0, 0)
      ctx.fillStyle = '#263d46'
      ctx.fillRect(0, 0, rect.width, rect.height)
      ctx.fillStyle = '#62836e'
      ctx.fillRect(x, z, size, size)
      let tile = size / span
      ctx.strokeStyle = '#91a98e'
      ctx.beginPath()
      for (let i = 1; i < span; i++) {
        let offset = i * tile
        ctx.moveTo(x + offset, z)
        ctx.lineTo(x + offset, z + size)
        ctx.moveTo(x, z + offset)
        ctx.lineTo(x + size, z + offset)
      }
      ctx.stroke()
      let dot = (p: Point, color: string, ring = false) => {
        ctx.beginPath()
        ctx.arc(
          x + (p.x + span / 2) * tile,
          z + (p.z + span / 2) * tile,
          tile * 0.36,
          0,
          Math.PI * 2,
        )
        if (ring) {
          ctx.strokeStyle = color
          ctx.stroke()
        } else {
          ctx.fillStyle = color
          ctx.fill()
        }
      }
      for (let p of pawns) dot(p, p.own ? '#fee1a2' : '#354e72')
      for (let p of cursors) dot(p, '#fff9eb', true)
    },
    pick(clientX: number, clientY: number) {
      let { rect, size, x, z } = dimensions()
      let tx = (clientX - rect.left - x) / size
      let tz = (clientY - rect.top - z) / size
      if (tx < 0 || tx >= 1 || tz < 0 || tz >= 1 || !size) return null
      return {
        x: Math.floor(tx * span) - (span - 1) / 2,
        z: Math.floor(tz * span) - (span - 1) / 2,
      }
    },
    dispose() {},
  }
}
