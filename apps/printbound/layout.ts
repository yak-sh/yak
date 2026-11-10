export type Product = {
  id: string
  sku: string
  width: number
  height: number
  bleed: number
  binding: 'perfect' | 'saddle' | 'casewrap'
  minimum: number
  multiple: number
  maximum: number
  ppi: number
  dpi: number
  coloring: boolean
  round?: boolean
}

let product = (
  id: string,
  sku: string,
  width: number,
  height: number,
  extra: Partial<Product> = {},
): Product => ({
  id,
  sku,
  width: width * 72,
  height: height * 72,
  bleed: 9,
  binding: 'perfect',
  minimum: 32,
  multiple: 2,
  maximum: 800,
  ppi: 444,
  dpi: 300,
  coloring: false,
  ...extra,
})

export let products: Record<string, Product> = {
  text: product('text', '0600X0900.BW.STD.PB.060UC444.MXX', 6, 9),
  picture: product('picture', '0900X0700.FC.PRE.PB.080CW444.GXX', 9, 7, {
    multiple: 4,
  }),
  hardcover: product('hardcover', '0900X0700.FC.PRE.CW.080CW444.GXX', 9, 7, {
    multiple: 4,
    binding: 'casewrap',
  }),
  coloring: product('coloring', '0850X1100BWSTDPB060UW444MXX', 8.5, 11, {
    coloring: true,
    round: true,
  }),
  booklet: product('booklet', '0850X1100BWSTDSS060UW444MXX', 8.5, 11, {
    coloring: true,
    round: true,
    binding: 'saddle',
    minimum: 8,
    multiple: 4,
    maximum: 48,
  }),
}

export let count = (spec: Product, pages: number) => {
  let n = Math.ceil(Math.max(pages, spec.minimum) / spec.multiple) *
    spec.multiple
  if (!Number.isInteger(pages) || pages < 1 || n > spec.maximum) {
    throw new Error('Document page count is outside the product binding')
  }
  return n
}

// Bindery's measured casewrap board bands; a hinge is a fold inside a panel,
// so it does not add width. Units here and throughout the PDF modules are pt.
let bands = [
  [84, .25],
  [140, .5],
  [168, .625],
  [194, .6875],
  [222, .75],
  [250, .8125],
  [278, .875],
  [306, .9375],
  [334, 1],
  [360, 1.0625],
  [388, 1.125],
  [416, 1.1875],
  [444, 1.25],
  [472, 1.3125],
  [500, 1.375],
  [528, 1.4375],
  [556, 1.5],
  [582, 1.5625],
  [610, 1.625],
  [638, 1.6875],
  [666, 1.75],
  [694, 1.8125],
  [722, 1.875],
  [750, 1.9375],
  [778, 2],
  [798, 2.0625],
  [800, 2.125],
]

export let geometry = (spec: Product, pages: number) => {
  if (count(spec, pages) != pages) {
    throw new Error('Unpadded interior page count')
  }
  let edge = spec.binding == 'casewrap' ? 63 : spec.bleed
  let raw = spec.binding == 'saddle'
    ? 0
    : spec.binding == 'casewrap'
    ? (bands.find(([last]) => pages <= last)?.[1] ?? NaN) * 72
    : (pages / spec.ppi + .06) * 72
  let width = 2 * (spec.width + edge) + raw
  if (spec.round) width = Math.round(width)
  let spine = width - 2 * (spec.width + edge)
  return {
    width,
    height: spec.height + 2 * edge,
    spine,
    edge,
    back: edge,
    front: edge + spec.width + spine,
    text: spine >= 18,
    safe: spec.binding == 'casewrap' ? 54 : 36,
  }
}

export let fit = (width: number, height: number, box: {
  x: number
  y: number
  width: number
  height: number
}, cover = false) => {
  let scale = (cover ? Math.max : Math.min)(
    box.width / width,
    box.height / height,
  )
  return {
    x: box.x + (box.width - width * scale) / 2,
    y: box.y + (box.height - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  }
}
