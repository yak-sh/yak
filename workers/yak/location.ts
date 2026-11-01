// Only the front sees the maker's geography before the kernel's fixed
// placement. Carry a coarse region, never the person's coordinates.
export type Location =
  | 'wnam'
  | 'enam'
  | 'sam'
  | 'weur'
  | 'eeur'
  | 'apac'
  | 'oc'
  | 'afr'
  | 'me'

export let LOCATION = 'x-yak-location'
type Geography = { continent?: string; longitude?: string; country?: string }
type Arrived = Request & { cf?: Geography }

let regions: Record<string, Location> = {
  AF: 'afr',
  AS: 'apac',
  OC: 'oc',
  SA: 'sam',
}
let middleEast = new Set(
  'AE BH CY EG IL IQ IR JO KW LB OM PS QA SA SY TR YE'.split(' '),
)

export let regionOf = (cf?: Geography): Location | undefined => {
  if (!cf) return undefined
  if (middleEast.has(cf.country ?? '')) return 'me'
  let longitude = Number(cf.longitude)
  if (cf.continent == 'NA') return longitude < -100 ? 'wnam' : 'enam'
  if (cf.continent == 'EU') return longitude >= 30 ? 'eeur' : 'weur'
  return regions[cf.continent ?? '']
}

/** Replace any caller-supplied hint with what the front observed. */
export let located = (req: Arrived): Request => {
  let out = new Request(req)
  out.headers.delete(LOCATION)
  let region = regionOf(req.cf)
  if (region) out.headers.set(LOCATION, region)
  return out
}

/** The kernel accepts only supported hints; an unlocated request stays so. */
export let locationOf = (req: Request): Location | undefined => {
  let value = req.headers.get(LOCATION)
  return value && /^(wnam|enam|sam|weur|eeur|apac|oc|afr|me)$/.test(value)
    ? value as Location
    : undefined
}
