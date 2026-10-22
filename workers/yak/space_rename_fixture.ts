// A space moved with everything in it (D-131924), run through a whole kernel:
// the deno stand-in (mcp_spaces_test.ts) and workerd, whose bucket, Durable
// Objects and email handler are the runtime's own
// (space_rename_workerd_test.ts). Ada's space, with two apps, a deployed page,
// a row, a letter and a custom domain, moves twice, once from the connector and
// once from the settings card; everything answers at the new name, the old one
// redirects, and once somebody else takes it, it is wholly theirs.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  arrives,
  client,
  connector,
  type Kernel,
  meta,
  rfc822,
  seed,
  unique,
} from './probe.ts'

export let renamed = async (k: Kernel) => {
  let ada46 = unique('ada46')
  let adacooks46 = unique('ada-cooks46')
  let adakitchen46 = unique('ada-kitchen46')
  let ourbookclub106com = unique('ourbookclub106') + '.com'
  let them = await seed(k, [{ slug: ada46, apps: ['cookbook', 'garden'] }])
  let agent = connector(k, them.cookie)
  let box = client(k, `${ada46}.yaks.app`, 'cookbook', them.cookie)
  await box.put('/index.html', '<!doctype html><h1>Our recipe box</h1>')
  await agent.tool('app_deploy', { space: ada46, app: 'cookbook' })
  let cake = crypto.randomUUID()
  await box.applied([{ entity: { eid: cake }, doc: { title: 'Lemon cake' } }])
  // A domain somebody else owns, aimed at the space by its eid.
  await meta(k).apply([{
    hostname: {
      name: ourbookclub106com,
      serves: them.eids[ada46],
      stage: 'active',
    },
  }])
  let handle = async (host: string, app: string) =>
    String((await (await k.at(host, `/${app}/api/graph`)).json()).db)
  let was = await handle(`${ada46}.yaks.app`, 'cookbook')
  // The space's own handle, the root of every key it keeps in the bucket
  // (D-131924): the name it was born at and six hex off its eid.
  let row = async (slug: string) =>
    (await meta(k).query(`.space.slug=${slug}&?former`))[0] as unknown as {
      space: { store: string }
      former?: { slug?: string | null; slugs?: string | null }
    }
  let store = (await row(ada46)).space.store
  assertMatch(store, new RegExp(`^${ada46}\\.[0-9a-f]{6}$`))
  let mail = (to: string, subject: string) =>
    arrives(k, {
      from: 'ana@books.example',
      to,
      raw: rfc822({ Subject: subject }, 'Bring a dish.'),
    })
  let titles = async (host: string, cookie: string) =>
    ((await client(k, host, 'cookbook', cookie).get(
      '.mail&?doc',
    )) as unknown as {
      doc: { title: string }
    }[]).map((r) => r.doc.title).sort()

  let said = await agent.tool('space_set', {
    space: ada46,
    slug: adacooks46,
  })
  assertStringIncludes(said, `https://${adacooks46}.yaks.app/`)
  assertStringIncludes(said, `until another space takes the name ${ada46}`)
  // One directory write: the handle stays, so nothing in the bucket moved.
  assertEquals((await row(adacooks46)).space.store, store)

  // Served at the new address, files and rows and all.
  let now = await k.at(`${adacooks46}.yaks.app`, '/cookbook/')
  assertEquals(now.status, 200)
  assertStringIncludes(await now.text(), '<h1>Our recipe box</h1>')
  let [kept] = await client(
    k,
    `${adacooks46}.yaks.app`,
    'cookbook',
    them.cookie,
  )
    .get(`id=${cake}`) as unknown as { doc: { title: string } }[]
  assertEquals(kept.doc.title, 'Lemon cake')
  // The store handle did not move: it is the app's own, not the address's.
  assertEquals(await handle(`${adacooks46}.yaks.app`, 'cookbook'), was)

  // The subdomain it left keeps answering, as the permanent move it was,
  // with the path and the query kept.
  let gone = await k.at(`${ada46}.yaks.app`, '/cookbook/?page=2', {
    redirect: 'manual',
  })
  assertEquals(gone.status, 301)
  assertEquals(
    gone.headers.get('location'),
    `https://${adacooks46}.yaks.app/cookbook/?page=2`,
  )
  // A write keeps its method, the way a renamed app's does.
  let write = await k.at(`${ada46}.yaks.app`, '/cookbook/api/apply', {
    method: 'POST',
    body: '[]',
    redirect: 'manual',
  })
  assertEquals(write.status, 308)
  assertEquals(
    write.headers.get('location'),
    `https://${adacooks46}.yaks.app/cookbook/api/apply`,
  )
  // A dashboard link naming the space by the old name follows it.
  let desk = await k.at(
    'yaks.app',
    `/manage/settings?space=${ada46}&saved=1`,
    {
      redirect: 'manual',
      headers: { cookie: them.cookie },
    },
  )
  assertEquals(desk.status, 301)
  assertEquals(
    desk.headers.get('location'),
    `https://yaks.app/manage/settings?space=${adacooks46}&saved=1`,
  )
  // An assistant still naming the space the old way is told where it went.
  await assertRejects(
    () => agent.tool('app_list', { space: ada46 }),
    Error,
    `moved to ${adacooks46}`,
  )
  // A letter to the old address still arrives, in the app's own store, and
  // a clone of the old remote finds the same repository.
  assertEquals(
    (await mail(`${ada46}.cookbook@yaks.app`, 'Still')).status,
    200,
  )
  assertEquals(
    await titles(`${adacooks46}.yaks.app`, them.cookie),
    ['Still'],
  )
  let clone = await k.at(
    `${ada46}.yaks.app`,
    '/cookbook.git/info/refs?service=git-upload-pack',
    { headers: { cookie: them.cookie } },
  )
  assert(clone.status != 404, `a clone at the old address: ${clone.status}`)
  await clone.body?.cancel()

  // The domain names an eid, so it opens the space wherever the space
  // lives — nothing about it was touched.
  let their = await k.at(ourbookclub106com, '/cookbook/')
  assertEquals(their.status, 200)
  assertStringIncludes(await their.text(), '<h1>Our recipe box</h1>')
  // And the roster is the space's own: its owner is still its owner, which
  // is what lets them move it again, from the settings card this time.
  let card = await k.at('yaks.app', `/manage/settings?space=${adacooks46}`, {
    method: 'POST',
    body: new URLSearchParams({ space: adakitchen46 }),
    redirect: 'manual',
    headers: { cookie: them.cookie },
  })
  assertEquals(card.status, 303, await card.text())
  assertEquals((await row(adakitchen46)).space.store, store)
  assertEquals(
    (await k.at(`${adakitchen46}.yaks.app`, '/cookbook/')).status,
    200,
  )

  // Forgotten (T-34659): the subdomain stops redirecting at once, and the
  // answer names what it costs.
  assertStringIncludes(
    await agent.tool('space_set', {
      space: adakitchen46,
      forget: adacooks46,
    }),
    `${adacooks46}.yaks.app stops redirecting and is free for anyone to take`,
  )
  assertEquals(
    (await k.at(`${adacooks46}.yaks.app`, '/cookbook/', {
      redirect: 'manual',
    }))
      .status,
    404,
  )

  // Somebody else takes the name Ada left, which still redirected to her:
  // it is theirs now, whole. Their space roots at a handle of its own, and
  // their cookbook is a store of its own.
  let rex = await seed(k, [{ slug: ada46, apps: ['cookbook'] }])
  assert((await row(ada46)).space.store != store)
  assertEquals(
    await client(k, `${ada46}.yaks.app`, 'cookbook', rex.cookie)
      .get(`id=${cake}`),
    [],
  )
  assert(await handle(`${ada46}.yaks.app`, 'cookbook') != was)
  let claimed = await k.at(`${ada46}.yaks.app`, '/cookbook/', {
    redirect: 'manual',
  })
  assert(claimed.status != 301, 'the name no longer redirects to Ada')
  await claimed.body?.cancel()
  // A letter to it now lands in their cookbook, not hers.
  assertEquals((await mail(`${ada46}.cookbook@yaks.app`, 'New')).status, 200)
  assertEquals(await titles(`${ada46}.yaks.app`, rex.cookie), ['New'])
  assertEquals(
    await titles(`${adakitchen46}.yaks.app`, them.cookie),
    ['Still'],
  )
  // Her history no longer holds the name, so no later move hands it back.
  assertEquals((await row(adakitchen46)).former?.slug ?? null, null)
  await assertRejects(
    () => agent.tool('space_set', { space: adakitchen46, forget: ada46 }),
    Error,
    'does not answer at',
  )
  assertEquals(
    (await k.at(`${adakitchen46}.yaks.app`, '/cookbook/')).status,
    200,
  )
}
