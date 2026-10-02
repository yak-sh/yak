// The bag lists wearable pieces before grouped supplies, with item level
// taking priority over rarity and older pieces using their tier's first level.
import { test } from "@yaks/testing";
import { assert, assertEquals } from "@std/assert";
import { parseHTML } from "linkedom";
import type { Frame } from "./play.ts";
import { seedItems } from "./items_fixture.ts";
import { carried, pack } from "./pack.ts";

seedItems();

test("the bag orders gear by item level, then rarity", () => {
  let h = (eid: string, kind: string, lvl?: number, rarity?: "legendary") => ({
    eid,
    kind,
    n: 1,
    lvl,
    rarity,
  });
  let worn = h("worn", "sword2", 18);
  let bag = [
    h("low-fine", "sword1", 1, "legendary"),
    h("same-common", "sword1", 12),
    h("same-fine", "sword1", 12, "legendary"),
    h("legacy", "sword2"),
    worn,
    h("jelly-a", "jelly"),
    { ...h("jelly-b", "jelly"), n: 2 },
    h("tusk", "tusk"),
  ];
  assertEquals(
    carried({ bag, worn: { main: worn } }).map(({ h, n }) => [h.eid, n]),
    [
      ["legacy", 1],
      ["same-fine", 1],
      ["same-common", 1],
      ["low-fine", 1],
      ["tusk", 1],
      ["jelly-a", 3],
    ],
  );
});

test("worn slots stay above the detail outside the scrolling bag list", () => {
  let { document, window } = parseHTML(
    "<html><body><main></main></body></html>",
  );
  let prior = Object.getOwnPropertyDescriptor(globalThis, "Element");
  Object.defineProperty(globalThis, "Element", {
    value: window.Element,
    configurable: true,
  });
  try {
    let body = document.querySelector("main")!;
    let actions: unknown[] = [];
    let view = pack({ body, open: true, show() {}, close() {}, toggle() {} }, {
      wear: (...args) => actions.push(args),
      take() {},
    });
    let sword = { eid: "sword", kind: "sword1", n: 1 };
    let frame = {
      sheet: {
        worn: { main: sword },
        bag: [sword, { eid: "spare", kind: "sword1", n: 1 }],
        lvl: 1,
        learned: [],
        kit: {},
      },
      rack: false,
    } as Frame;
    view.show(frame);
    let list = body.querySelector<HTMLElement>(".Split_List")!;
    let detail = body.querySelector(".Split_Content")!;
    assert(!list.querySelector(".Pack_Worn"));
    assertEquals(detail.firstElementChild?.className, "Pack_Worn");
    let worn = detail.querySelector<HTMLElement>('[data-pick="worn:main"]')!;
    list.scrollTop = 300;
    worn.click();
    view.show(frame);
    assertEquals(list.scrollTop, 300);
    assertEquals(detail.firstElementChild?.className, "Pack_Worn");
    detail.querySelector<HTMLElement>("[data-do=off]")!.click();
    assertEquals(actions, [["main"]]);
  } finally {
    if (prior) Object.defineProperty(globalThis, "Element", prior);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});
