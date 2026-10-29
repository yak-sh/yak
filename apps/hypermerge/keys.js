// An actor is an Ed25519 key pair, as in hypermerge: its public key in base58
// is the actor's id, its Automerge actor id and its feed's key, and only the
// holder of the secret key can sign what it appends. Secret keys stay in this
// browser; the store only ever sees public keys and signatures.
import bs58 from 'bs58'
import { hex, unhex } from './pack.js'

let ED = { name: 'Ed25519' }
let b64 = (s) =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )

/** An actor from its secret key as a JWK: {id, secret, jwk}. */
export let held = async (jwk) => ({
  id: bs58.encode(b64(jwk.x)),
  secret: await crypto.subtle.importKey('jwk', jwk, ED, true, ['sign']),
  jwk,
})

/** A new actor with a fresh key pair. */
export let mint = async () => {
  let pair = await crypto.subtle.generateKey(ED, true, ['sign', 'verify'])
  return held(await crypto.subtle.exportKey('jwk', pair.privateKey))
}

/** The actor's signature of some bytes, in hex. */
export let sign = async (actor, bytes) =>
  hex(new Uint8Array(await crypto.subtle.sign(ED, actor.secret, bytes)))

let publics = new Map()
/** Whether `sig` is the signature of `bytes` by the actor whose id is `id`. */
export let verify = async (id, sig, bytes) => {
  try {
    if (!publics.has(id)) {
      publics.set(
        id,
        crypto.subtle.importKey('raw', bs58.decode(id), ED, false, ['verify']),
      )
    }
    return await crypto.subtle.verify(
      ED,
      await publics.get(id),
      unhex(sig),
      bytes,
    )
  } catch {
    return false
  }
}

// This browser's actors for one doc, kept as their secret keys.
let slot = (doc) => `hypermerge:${doc}`

/** The actors this browser holds for a doc. */
export let kept = (doc) => {
  try {
    return Promise.all(
      JSON.parse(localStorage.getItem(slot(doc)) ?? '[]').map(held),
    )
  } catch {
    return Promise.resolve([])
  }
}

/** Keep an actor's secret key in this browser. */
export let keep = (doc, actor) => {
  let all = JSON.parse(localStorage.getItem(slot(doc)) ?? '[]')
  if (!all.some((j) => j.x == actor.jwk.x)) all.push(actor.jwk)
  localStorage.setItem(slot(doc), JSON.stringify(all))
}
