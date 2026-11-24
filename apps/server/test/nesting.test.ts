import { reset } from "cloudflare:test";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  a4Portrait,
  itemPageId,
  newId,
  pageMargin,
  spacePageId,
  stickerGap,
  taskStickerSize,
} from "@foyer/shared";
import { ItemKind } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { PageKind } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { SpaceKind } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { StickerKind } from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import { type ChangeResult, type Row, RowKind } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { afterEach, describe, expect, it } from "vitest";
import { fakeGoogle } from "../src/fake-google";
import { connectGoogle, work } from "./calendar-helpers";
import {
  type ChangeInit,
  Device,
  idOf,
  itemCreate,
  itemDelete,
  itemMove,
  itemSetParent,
  madeAt,
  pageCreate,
  signIn,
  spaceCreate,
  stickerPlace,
  stickerRemove,
  taskTick,
  textBlockCreate,
  textGroupCreate,
  together,
} from "./sync-device";

const alex = "member@example.com";
const sam = "housemate@example.com";

const devices: Device[] = [];

async function connect(email: string): Promise<Device> {
  const device = await Device.connect((await signIn(email)).token);
  devices.push(device);
  await device.welcome();
  return device;
}

afterEach(async () => {
  for (const device of devices.splice(0)) device.close();
  fakeGoogle.reset();
  await reset();
});

function itemsIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "item"
      ? [{ id: row.value.id, spaceId: row.value.spaceId, parentId: row.value.parentId }]
      : [],
  );
}

function pagesIn(rows: Row[]) {
  return rows.flatMap(({ row }) =>
    row.case === "page"
      ? [{ id: row.value.id, kind: row.value.kind, itemId: row.value.itemId }]
      : [],
  );
}

function stickersIn(rows: Row[]) {
  return rows.flatMap(({ row }) => {
    if (row.case !== "sticker") return [];
    const { pageId, itemId, x, y, kind, placedBy } = row.value;
    return [{ pageId, itemId, x, y, kind, placedBy }];
  });
}

function spot(index: number) {
  return pageMargin + index * (taskStickerSize.height + stickerGap);
}

function deletedIn(rows: Row[], kind: RowKind) {
  return rows.flatMap(({ row }) =>
    row.case === "deleted" && row.value.kind === kind ? [row.value.id] : [],
  );
}

async function rowsCaughtUpBy(device: Device, cursor = 0) {
  return (await device.catchUp(cursor)).flatMap(({ rows }) => rows);
}

async function cursorOf(device: Device) {
  return Number((await device.catchUp()).at(-1)?.cursor);
}

async function itemAsCaughtUpBy(device: Device, itemId: string) {
  return itemsIn(await rowsCaughtUpBy(device)).find(({ id }) => id === itemId);
}

function resultOf(result: ChangeResult | undefined) {
  if (result?.result.case === "refused") return { refused: result.result.value.reason };
  return { committed: result?.result.case === "seq" };
}

function secondsAgo(seconds: number) {
  return { at: madeAt(Date.now() - seconds * 1000) };
}

async function spaceOwnedBy(device: Device, kind: SpaceKind): Promise<string> {
  const rows = await rowsCaughtUpBy(device);
  const spaces = rows.flatMap(({ row }) => (row.case === "space" ? [row.value] : []));
  return spaces.find((space) => space.kind === kind)?.id ?? "";
}

async function newSharedSpace(device: Device): Promise<string> {
  const create = spaceCreate({ name: "Home", kind: SpaceKind.SHARED });
  await device.push(create);
  await device.updates();
  return idOf(create);
}

function bodyPage(itemId: string) {
  return pageCreate({ pageId: itemPageId(itemId), kind: PageKind.ITEM, itemId, ...a4Portrait });
}

async function bodyPageOf(device: Device, itemId: string) {
  await device.push(bodyPage(itemId));
  return itemPageId(itemId);
}

async function newTask(device: Device, spaceId: string, under?: string) {
  const create = itemCreate({ spaceId }, secondsAgo(60));
  await device.push(create);
  if (under) await device.push(itemSetParent(idOf(create), under, secondsAgo(50)));
  await device.updates();
  return idOf(create);
}

describe("putting an item under another", () => {
  it("sends its parent to every device that sees it, and takes it out again", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const party = await newTask(alexDevice, home);
    const cake = await newTask(alexDevice, home);
    await samDevice.updates();

    const committed = await samDevice.push(itemSetParent(cake, party, secondsAgo(20)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    const under = { id: cake, spaceId: home, parentId: party };
    for (const device of [alexDevice, samDevice]) {
      expect(itemsIn(await device.updates())).toEqual([under]);
    }

    await alexDevice.push(itemSetParent(cake, "", secondsAgo(10)));

    expect(itemsIn(await samDevice.updates())).toEqual([{ ...under, parentId: "" }]);
  });

  it("leaves the item where it was, with its sticker, when moving its sticker is refused", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const party = await newTask(alexDevice, home);
    const cake = await newTask(alexDevice, home);
    const spacePage = spacePageId(home, 1);
    const onSpacePage = stickerPlace({ pageId: spacePage, itemId: cake });
    const page = { pageId: spacePage, kind: PageKind.SPACE, spaceId: home, number: 1 };
    await alexDevice.push(pageCreate({ ...page, ...a4Portrait }), onSpacePage);
    const bodyPage = await bodyPageOf(alexDevice, party);
    await Promise.all([alexDevice.updates(), samDevice.updates()]);

    const committed = await alexDevice.push(
      ...together([
        itemSetParent(cake, party),
        stickerRemove(newId()),
        stickerPlace({ pageId: bodyPage, itemId: cake }),
      ]),
    );

    const refused = { refused: "There's no such sticker." };
    expect(committed.results.map(resultOf)).toEqual([refused, refused, refused]);
    for (const device of [alexDevice, samDevice]) {
      expect(await device.updates()).toEqual([]);
      const rows = await rowsCaughtUpBy(device);
      expect(itemsIn(rows).find(({ id }) => id === cake)).toEqual({
        id: cake,
        spaceId: home,
        parentId: "",
      });
      expect(stickersIn(rows).filter(({ itemId }) => itemId === cake)).toEqual([
        expect.objectContaining({ pageId: spacePage }),
      ]);
    }
  });

  it("nests as deep as people like", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const food = await newTask(device, inbox, party);
    const cake = await newTask(device, inbox, food);

    expect(await itemAsCaughtUpBy(device, cake)).toEqual({
      id: cake,
      spaceId: inbox,
      parentId: food,
    });
  });

  it("keeps the parent set last, by the device's clock, whichever arrives first", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const [party, shopping, cake] = [
      await newTask(device, inbox),
      await newTask(device, inbox),
      await newTask(device, inbox),
    ];
    await device.push(itemSetParent(cake, party, secondsAgo(10)));

    const committed = await device.push(itemSetParent(cake, shopping, secondsAgo(20)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect((await itemAsCaughtUpBy(device, cake))?.parentId).toBe(party);
  });

  it("refuses putting an item under itself, or under an item that's under it", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const food = await newTask(device, inbox, party);
    const cake = await newTask(device, inbox, food);

    const committed = await device.push(
      itemSetParent(party, party),
      itemSetParent(party, food),
      itemSetParent(party, cake),
    );

    const loop = { refused: "An item can't go under itself, or under an item that's under it." };
    expect(committed.results.map(resultOf)).toEqual([loop, loop, loop]);
    expect(await device.updates()).toEqual([]);
  });

  it("refuses the loop two devices make offline, each putting one item under the other", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const party = await newTask(alexDevice, home);
    const cake = await newTask(alexDevice, home);
    await alexDevice.push(itemSetParent(cake, party, secondsAgo(20)));
    await samDevice.updates();

    const committed = await samDevice.push(itemSetParent(party, cake, secondsAgo(10)));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "An item can't go under itself, or under an item that's under it.",
    });
    expect((await itemAsCaughtUpBy(samDevice, party))?.parentId).toBe("");
  });

  it("refuses a parent that doesn't exist, or that the member doesn't see", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const alexInbox = await spaceOwnedBy(alexDevice, SpaceKind.INBOX);
    const samInbox = await spaceOwnedBy(samDevice, SpaceKind.INBOX);
    const private_ = await newTask(alexDevice, alexInbox);
    const cake = await newTask(samDevice, samInbox);

    const committed = await samDevice.push(
      itemSetParent(cake, private_),
      itemSetParent(cake, newId()),
    );

    const missing = { refused: "There's no such item to go under." };
    expect(committed.results.map(resultOf)).toEqual([missing, missing]);
  });

  it("moves an item put under a parent in another space there, with everything under it", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const party = await newTask(alexDevice, home);
    const food = await newTask(alexDevice, personal);
    const cake = await newTask(alexDevice, personal, food);
    await samDevice.updates();

    await alexDevice.push(itemSetParent(food, party));

    expect(itemsIn(await samDevice.updates())).toEqual([
      { id: food, spaceId: home, parentId: party },
      { id: cake, spaceId: home, parentId: food },
    ]);
  });

  it("has no effect on a parent in another space when the item moved later", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const personal = await spaceOwnedBy(device, SpaceKind.PERSONAL);
    const party = await newTask(device, personal);
    const cake = await newTask(device, inbox);
    await device.push(
      itemMove(cake, personal, secondsAgo(10)),
      itemMove(cake, inbox, secondsAgo(5)),
    );

    const committed = await device.push(itemSetParent(cake, party, secondsAgo(20)));

    expect(resultOf(committed.results[0])).toEqual({ committed: true });
    expect(await itemAsCaughtUpBy(device, cake)).toEqual({
      id: cake,
      spaceId: inbox,
      parentId: "",
    });
  });
});

describe("moving an item with items under it", () => {
  it("moves everything under it, which members who can't see the new space drop", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const party = await newTask(alexDevice, home);
    const food = await newTask(alexDevice, home, party);
    const cake = await newTask(alexDevice, home, food);
    await samDevice.updates();

    await alexDevice.push(itemMove(party, personal));

    expect(deletedIn(await samDevice.updates(), RowKind.ITEM).sort()).toEqual(
      [party, food, cake].sort(),
    );
    expect(itemsIn(await rowsCaughtUpBy(samDevice))).toEqual([]);
    const rows = itemsIn(await rowsCaughtUpBy(alexDevice));
    expect(rows.filter(({ id }) => [party, food, cake].includes(id))).toEqual([
      { id: party, spaceId: personal, parentId: "" },
      { id: food, spaceId: personal, parentId: party },
      { id: cake, spaceId: personal, parentId: food },
    ]);
  });

  it("refuses moving an item that's under another, which moves with its parent", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const personal = await spaceOwnedBy(device, SpaceKind.PERSONAL);
    const party = await newTask(device, inbox);
    const cake = await newTask(device, inbox, party);

    const committed = await device.push(itemMove(cake, personal));
    const takenOut = await device.push(itemSetParent(cake, ""), itemMove(cake, personal));

    expect(resultOf(committed.results[0])).toEqual({
      refused: "An item under another moves with it. Take it out first.",
    });
    expect(takenOut.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
  });

  it("moves many items under it with what's theirs, out of other members' sight and back", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const garden = await newSharedSpace(alexDevice);
    const personal = await spaceOwnedBy(alexDevice, SpaceKind.PERSONAL);
    const party = await newTask(alexDevice, home);
    const carried = await putManyUnder(alexDevice, home, party);
    await samDevice.updates();
    const beforeGarden = await cursorOf(samDevice);

    await alexDevice.push(itemMove(party, garden, secondsAgo(20)));

    for (const device of [alexDevice, samDevice]) {
      const moved = itemsIn(await device.updates());
      expect(moved.map(({ id }) => id).sort()).toEqual(carried.get(RowKind.ITEM));
      expect(moved.every(({ spaceId }) => spaceId === garden)).toBe(true);
    }
    expect(carriedIn(await rowsCaughtUpBy(samDevice, beforeGarden))).toEqual(carried);
    const beforePersonal = await cursorOf(samDevice);

    await alexDevice.push(itemMove(party, personal, secondsAgo(10)));

    const kept = itemsIn(await alexDevice.updates());
    expect(kept.every(({ spaceId }) => spaceId === personal)).toBe(true);
    for (const rows of [
      await samDevice.updates(),
      await rowsCaughtUpBy(samDevice, beforePersonal),
    ]) {
      expect(carriedIn(rows)).toEqual(new Map());
      for (const [kind, ids] of carried) expect(deletedIn(rows, kind).sort()).toEqual(ids);
    }
    const beforeHome = await cursorOf(samDevice);

    await alexDevice.push(itemMove(party, home));

    expect(carriedIn(await samDevice.updates())).toEqual(carried);
    const caughtUp = await rowsCaughtUpBy(samDevice, beforeHome);
    expect(carriedIn(caughtUp)).toEqual(carried);
    expect(caughtUp.some(({ row }) => row.case === "deleted")).toBe(false);
  });
});

async function putManyUnder(device: Device, spaceId: string, parent: string) {
  const carried = new Map<RowKind, string[]>([[RowKind.ITEM, [parent]]]);
  const carry = (kind: RowKind, change: ChangeInit) => {
    carried.set(kind, [...(carried.get(kind) ?? []), idOf(change)].sort());
    return change;
  };
  await device.push(carry(RowKind.PAGE, bodyPage(parent)));
  let first = parent;
  for (let index = 0; index < 30; index++) {
    const task = carry(RowKind.ITEM, itemCreate({ spaceId }, secondsAgo(60)));
    const itemId = idOf(task);
    const under = index < 20 ? parent : first;
    const sticker = stickerPlace({ pageId: itemPageId(under), itemId }, secondsAgo(50));
    const changes = [
      task,
      itemSetParent(itemId, under, secondsAgo(50)),
      carry(RowKind.STICKER, sticker),
    ];
    if (index === 0) first = itemId;
    if (index % 5 === 0)
      changes.push(carry(RowKind.COMPLETION, taskTick({ itemId }, secondsAgo(50))));
    if (index % 10 === 0) {
      const group = carry(RowKind.TEXT_GROUP, textGroupCreate({ pageId: itemPageId(itemId) }));
      const block = carry(RowKind.TEXT_BLOCK, textBlockCreate({ groupId: idOf(group) }));
      changes.push(carry(RowKind.PAGE, bodyPage(itemId)), group, block);
    }
    const committed = await device.push(...changes);
    expect(committed.results.map(resultOf)).not.toContainEqual(
      expect.objectContaining({ refused: expect.anything() }),
    );
  }
  await device.updates();
  return carried;
}

const carriedKinds = {
  item: RowKind.ITEM,
  page: RowKind.PAGE,
  sticker: RowKind.STICKER,
  completion: RowKind.COMPLETION,
  textGroup: RowKind.TEXT_GROUP,
  textBlock: RowKind.TEXT_BLOCK,
} as const;

function carriedIn(rows: Row[]): Map<RowKind, string[]> {
  const byKind = new Map<RowKind, string[]>();
  for (const { row } of rows) {
    if (!row.case || !(row.case in carriedKinds)) continue;
    const kind = carriedKinds[row.case as keyof typeof carriedKinds];
    const { id } = row.value as { id: string };
    byKind.set(kind, [...(byKind.get(kind) ?? []), id].sort());
  }
  return byKind;
}

describe("deleting an item with items under it", () => {
  it("moves the items still under it up to its own parent", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const home = await newSharedSpace(alexDevice);
    const party = await newTask(alexDevice, home);
    const food = await newTask(alexDevice, home, party);
    const cake = await newTask(alexDevice, home, food);
    await samDevice.updates();

    await alexDevice.push(itemDelete(food));

    const rows = await samDevice.updates();
    expect(deletedIn(rows, RowKind.ITEM)).toEqual([food]);
    expect(itemsIn(rows)).toEqual([{ id: cake, spaceId: home, parentId: party }]);
  });

  it("moves them to the top of its space when it was at the top", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const cake = await newTask(device, inbox, party);

    await device.push(itemDelete(party));

    expect(await itemAsCaughtUpBy(device, cake)).toEqual({
      id: cake,
      spaceId: inbox,
      parentId: "",
    });
  });

  it("gives every device a sticker for each, below the last on its parent's body page", async () => {
    const alexDevice = await connect(alex);
    const samDevice = await connect(sam);
    const { memberId } = await signIn(alex);
    const home = await newSharedSpace(alexDevice);
    const party = await newTask(alexDevice, home);
    const drinks = await newTask(alexDevice, home, party);
    const food = await newTask(alexDevice, home, party);
    const cake = await newTask(alexDevice, home, food);
    const pie = await newTask(alexDevice, home, food);
    const partyPage = await bodyPageOf(alexDevice, party);
    const foodPage = await bodyPageOf(alexDevice, food);
    await alexDevice.push(
      stickerPlace({ pageId: partyPage, itemId: drinks, y: spot(0) }),
      stickerPlace({ pageId: partyPage, itemId: food, y: spot(1) }),
      stickerPlace({ pageId: foodPage, itemId: pie, y: spot(0) }),
      stickerPlace({ pageId: foodPage, itemId: cake, y: spot(1) }),
    );
    await alexDevice.updates();
    await samDevice.updates();

    await alexDevice.push(itemDelete(food));

    const placed = { pageId: partyPage, x: pageMargin, kind: StickerKind.TASK, placedBy: memberId };
    for (const device of [alexDevice, samDevice]) {
      expect(stickersIn(await device.updates())).toEqual([
        { ...placed, itemId: pie, y: spot(1) },
        { ...placed, itemId: cake, y: spot(2) },
      ]);
    }
  });

  it("makes the parent's body page for them when nobody has put anything on it yet", async () => {
    const device = await connect(alex);
    const { memberId } = await signIn(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const food = await newTask(device, inbox, party);
    const cake = await newTask(device, inbox, food);

    await device.push(itemDelete(food));

    const rows = await device.updates();
    const partyPage = itemPageId(party);
    expect(pagesIn(rows)).toEqual([{ id: partyPage, kind: PageKind.ITEM, itemId: party }]);
    expect(stickersIn(rows)).toEqual([
      {
        pageId: partyPage,
        itemId: cake,
        x: pageMargin,
        y: spot(0),
        kind: StickerKind.TASK,
        placedBy: memberId,
      },
    ]);
  });

  it("makes their space's first page for them when the space has none yet", async () => {
    const device = await connect(alex);
    const { memberId } = await signIn(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const cake = await newTask(device, inbox, party);

    await device.push(itemDelete(party));

    const rows = await device.updates();
    const firstPage = spacePageId(inbox, 1);
    expect(pagesIn(rows)).toEqual([{ id: firstPage, kind: PageKind.SPACE, itemId: "" }]);
    expect(stickersIn(rows)).toEqual([
      {
        pageId: firstPage,
        itemId: cake,
        x: pageMargin,
        y: spot(0),
        kind: StickerKind.TASK,
        placedBy: memberId,
      },
    ]);
  });

  it("gives an event it moves up an event's sticker", async () => {
    const { memberId, token } = await signIn(alex);
    const device = await connect(alex);
    await connectGoogle(token);
    await work();
    const personal = await spaceOwnedBy(device, SpaceKind.PERSONAL);
    const party = await newTask(device, personal);
    const dinner = itemCreate({
      spaceId: personal,
      kind: ItemKind.EVENT,
      startsAt: timestampFromMs(Date.parse("2026-11-20T19:00:00Z")),
      endsAt: timestampFromMs(Date.parse("2026-11-20T21:00:00Z")),
    });
    await device.push(dinner, itemSetParent(idOf(dinner), party));
    await device.updates();

    await device.push(itemDelete(party));

    const firstPage = spacePageId(personal, 1);
    const onSpacePage = stickersIn(await device.updates()).filter(
      ({ pageId }) => pageId === firstPage,
    );
    expect(onSpacePage).toEqual([
      {
        pageId: firstPage,
        itemId: idOf(dinner),
        x: pageMargin,
        y: spot(0),
        kind: StickerKind.EVENT,
        placedBy: memberId,
      },
    ]);
  });

  it("gives them stickers in the next free spot of their space's newest page", async () => {
    const device = await connect(alex);
    const { memberId } = await signIn(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const shopping = await newTask(device, inbox);
    const party = await newTask(device, inbox);
    const cake = await newTask(device, inbox, party);
    const firstPage = spacePageId(inbox, 1);
    await device.push(
      pageCreate({
        pageId: firstPage,
        kind: PageKind.SPACE,
        spaceId: inbox,
        number: 1,
        ...a4Portrait,
      }),
      stickerPlace({ pageId: firstPage, itemId: shopping, y: spot(0) }),
      stickerPlace({ pageId: firstPage, itemId: party, y: spot(1) }),
    );
    await device.updates();

    await device.push(itemDelete(party));

    expect(stickersIn(await device.updates())).toEqual([
      {
        pageId: firstPage,
        itemId: cake,
        x: pageMargin,
        y: spot(1),
        kind: StickerKind.TASK,
        placedBy: memberId,
      },
    ]);
  });
});

describe("stickers of items under another", () => {
  it("go on their parent's body page, and not on another's or a space's page", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const shopping = await newTask(device, inbox);
    const cake = await newTask(device, inbox, party);
    const spacePage = spacePageId(inbox, 1);
    await device.push(
      pageCreate({
        pageId: spacePage,
        kind: PageKind.SPACE,
        spaceId: inbox,
        number: 1,
        ...a4Portrait,
      }),
    );

    const committed = await device.push(
      stickerPlace({ pageId: await bodyPageOf(device, party), itemId: cake }),
      stickerPlace({ pageId: await bodyPageOf(device, shopping), itemId: cake }),
      stickerPlace({ pageId: spacePage, itemId: cake }),
    );

    expect(committed.results.map(resultOf)).toEqual([
      { committed: true },
      { refused: "An item's body page only holds the items under it." },
      { refused: "An item under another goes on its parent's body page." },
    ]);
  });

  it("leave a page once the item no longer belongs there, and stay while it does", async () => {
    const device = await connect(alex);
    const inbox = await spaceOwnedBy(device, SpaceKind.INBOX);
    const party = await newTask(device, inbox);
    const cake = await newTask(device, inbox);
    const spacePage = spacePageId(inbox, 1);
    const onSpacePage = stickerPlace({ pageId: spacePage, itemId: cake });
    await device.push(
      pageCreate({
        pageId: spacePage,
        kind: PageKind.SPACE,
        spaceId: inbox,
        number: 1,
        ...a4Portrait,
      }),
      onSpacePage,
    );
    const onBody = stickerPlace({ pageId: await bodyPageOf(device, party), itemId: cake });

    const putUnder = await device.push(
      itemSetParent(cake, party),
      stickerRemove(idOf(onSpacePage)),
      onBody,
      stickerRemove(idOf(onBody)),
    );
    const takenOut = await device.push(itemSetParent(cake, ""), stickerRemove(idOf(onBody)));

    expect(putUnder.results.map(resultOf)).toEqual([
      { committed: true },
      { committed: true },
      { committed: true },
      {
        refused:
          "A task's sticker stays on its space's page, or its parent's body page, until the task is deleted or moved.",
      },
    ]);
    expect(takenOut.results.map(resultOf)).toEqual([{ committed: true }, { committed: true }]);
  });
});
