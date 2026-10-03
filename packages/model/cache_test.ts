// The cache reader fails closed; expiry is a request snapshot, not a hit count.
import { equal, test } from '@yaks/testing'
import { cachedPrefixExpires, cacheExpiry, prefixCacheMark } from './mod.ts'

let reply = { id: 'r', model: 'm', items: [] }
let start = Date.parse('2026-10-03T10:00:00Z')

test('explicit prefix expiry wins over retention, including past and invalid expiry', () => {
  let cache = { requestedAt: start, retention: 300 }
  equal(
    prefixCacheMark(
      { ...reply, cacheExpiresAt: '2026-10-03T09:00:00Z' },
      cache,
    ),
    {
      cache_expires_at: '2026-10-03T09:00:00.000Z',
    },
  )
  equal(prefixCacheMark({ ...reply, cacheExpiresAt: null }, cache), {
    cache_expires_at: null,
  })
  equal(prefixCacheMark({ ...reply, cacheExpiresAt: 'invalid' }, cache), {
    cache_expires_at: null,
  })
})

test('fallback is dispatch plus retention; unknown, zero and invalid retention are cold', () => {
  equal(prefixCacheMark(reply, { requestedAt: start, retention: 300 }), {
    cache_expires_at: '2026-10-03T10:05:00.000Z',
  })
  for (let retention of [undefined, 0, -1, Infinity, NaN, 0.5, '300']) {
    equal(prefixCacheMark(reply, { requestedAt: start, retention }), {
      cache_expires_at: null,
    })
  }
  equal(prefixCacheMark(reply), { cache_expires_at: null })
})

test('reader consumes only the recorded unambiguous expiry, never usage or provider retention', () => {
  let expiry = '2026-10-03T10:05:00.000Z'
  for (let provider of ['openai', 'openrouter']) {
    equal(
      cachedPrefixExpires({ [provider]: { cache_expires_at: expiry } }),
      expiry,
    )
    equal(
      cachedPrefixExpires({ [provider]: { cache_expires_at: null } }),
      undefined,
    )
  }
  equal(
    cachedPrefixExpires({
      usage: { cached_tokens: 2000 },
      provider: { cache_retention: 300 },
    }),
    undefined,
  )
  equal(
    cachedPrefixExpires({
      openai: { cache_expires_at: expiry },
      openrouter: { cache_expires_at: expiry },
    }),
    undefined,
  )
  equal(cacheExpiry(start / 1000), '2026-10-03T10:00:00.000Z')
  for (
    let value of [
      Infinity,
      -1,
      '',
      '2026-10-03',
      '2026-10-03T10:00:00',
      {},
      null,
    ]
  ) equal(cacheExpiry(value), undefined)
})
