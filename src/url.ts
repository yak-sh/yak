// Human-facing graph addresses. Transport stays local through TASKS_HOST;
// anything handed to a person uses the board's stable public door.

let origin = 'https://tasks.yak.sh'

export let entityUrl = (id: string) => `${origin}/${id}`

// entityUrl's inverse: the id token a graph entity link names — undefined for
// any other address. Only id-shaped path segments count (prefix-num, short
// eid, uuid): every other path is a door (/search, /telemetry), and handing
// one to the id resolver would let a slug or alias match something.
export let entityId = (raw: string): string | undefined => {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (u.origin != origin) return undefined
  return u.pathname.match(
    /^\/([A-Za-z]+-\d+|[0-9a-f]{6,8}|[0-9a-f][0-9a-f-]{34}[0-9a-f])$/,
  )?.[1]
}

// ONE canonical spelling for a page address. A page filed from a browser
// and the same page asked about later must produce the same string, or a
// "what references this?" badge lies by omission — so this is the only
// place that decides, and it runs from the TYPE (props.ts `url`), which
// means every door normalizes: writes through parseProp, filters through
// query.ts atom(). Nothing else may spell it.
//
// What carries no identity goes: a fragment names a spot INSIDE a page,
// campaign params name the trip rather than the destination, credentials
// are never part of a page's name, and a trailing slash is a server's
// habit. What might: query params stay (and keep their order — sorting
// re-encodes, and no site sends them shuffled between visits).
//
// Anything that isn't an http(s) URL is left exactly as it came: the same
// type carries `repo.url`, where a git remote (git@host:owner/repo.git)
// is the value and mangling it would be the bug.
let JUNK =
  /^(?:utm_|ga_|mc_|pk_|piwik_|hsa_|_hs|vero_)|^(?:gclid|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|mkt_tok|igshid|ref_src|ref_url|s_cid|si|scid|spm|cmpid)$/i

export let normalize = (raw: string) => {
  let text = raw.trim()
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return text
  }
  if (u.protocol != 'http:' && u.protocol != 'https:') return text
  u.hash = ''
  u.username = u.password = ''
  for (let k of [...u.searchParams.keys()]) {
    if (JUNK.test(k)) u.searchParams.delete(k)
  }
  // The root keeps its slash (that IS the canonical root); every deeper
  // path drops one, since /a and /a/ are one page everywhere it matters
  // and a refetch follows the redirect either way.
  if (u.pathname != '/') u.pathname = u.pathname.replace(/\/+$/, '')
  return u.href.replace(/\?$/, '')
}
