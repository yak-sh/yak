import { equal, test } from '@yaks/testing'
import { scored } from './score.ts'

let query = new Float32Array([1, 0])
let vectors = [
  { owner: 3, vector: new Float32Array([0, 1]) },
  { owner: 2, vector: new Float32Array([1, 0]) },
  { owner: 4, vector: new Float32Array([0, 0]) },
  { owner: 1, vector: new Float32Array([1, 0]) },
]
let cases: [string, Parameters<typeof scored>[2], number[]][] = [
  ['answers no neighbours at zero limit', { limit: 0 }, []],
  ['orders cosine scores and ties by owner', {}, [1, 2, 3, 4]],
  ['cuts a tie at the limit', { limit: 1 }, [1]],
  ['excludes scores below the floor', { floor: 0.5 }, [1, 2]],
  ['excludes the named owner', { without: 1 }, [2, 3, 4]],
]
for (let [name, opts, want] of cases) {
  test(`scoring ${name}`, () =>
    equal(scored(query, vectors, opts).map((v) => v.owner), want))
}

test('a query with no direction gives each vector zero similarity', () => {
  equal(
    scored(new Float32Array(2), vectors),
    [1, 2, 3, 4].map((owner) => ({ owner, similarity: 0 })),
  )
})
