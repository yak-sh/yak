// Door shapes belong to one world, shared by its chunks and freed with it.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assert, assertEquals } from '@std/assert'
import { doors } from './doors.ts'
import { flat } from './terrain.ts'

Deno.test('door shapes are shared within a world and disposed only with it', () => {
  let v = flat(5, [], [{ kind: 'smithy.plaster', x: 64, z: 64, seed: 0 }])
  let b = v.buildings(64, 64, 0)[0]
  assert(b.doors.length > 0)
  let material = new THREE.MeshBasicMaterial()
  let sceneA = new THREE.Scene(), sceneB = new THREE.Scene()
  let a = doors(sceneA, material), other = doors(sceneB, material)
  let first = a.hang([b]), second = a.hang([b]), third = other.hang([b])
  let ga = (sceneA.children[0] as THREE.Mesh).geometry
  let again = (sceneA.children[b.doors.length] as THREE.Mesh).geometry
  let gb = (sceneB.children[0] as THREE.Mesh).geometry
  assert(ga == again)
  assert(ga != gb)
  let freedA = 0, freedB = 0
  ga.addEventListener('dispose', () => freedA++)
  gb.addEventListener('dispose', () => freedB++)
  first.drop()
  assertEquals(sceneA.children.length, b.doors.length)
  assertEquals(freedA, 0)
  a.dispose()
  assertEquals(sceneA.children.length, 0)
  assertEquals(freedA, 1)
  assertEquals(freedB, 0)
  second.drop()
  third.drop()
  other.dispose()
  assertEquals(freedB, 1)
  material.dispose()
})
