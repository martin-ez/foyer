import { create, fromBinary, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { timestampFromMs, timestampMs } from "@bufbuild/protobuf/wkt";
import {
  addDays,
  afterPlan,
  type CalendarPageKind,
  calendarPageOf,
  clashingName,
  daysBetween,
  type EventTime,
  eventTimeFields,
  formatRepeat,
  freeSpaceName,
  itemPageId,
  itemTitleProblem,
  minutesOf,
  newId,
  type PageSize,
  type PlacedSticker,
  pageSizeFor,
  planCalendarStickers,
  type RepeatFrom,
  type RepeatRule,
  signedOutCloseCode,
  spaceNameProblem,
  timeOfDay,
} from "@foyer/shared";
import type { GoogleConnection } from "@foyer/shared/gen/foyer/calendar/v1/calendar_pb";
import {
  type Item,
  ItemKind,
  ItemSchema,
  RepeatFrom as RepeatFromKind,
} from "@foyer/shared/gen/foyer/item/v1/item_pb";
import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { type Page, PageKind, PageSchema } from "@foyer/shared/gen/foyer/page/v1/page_pb";
import { type Space, SpaceKind, SpaceSchema } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import {
  type Sticker,
  StickerKind,
  StickerSchema,
} from "@foyer/shared/gen/foyer/sticker/v1/sticker_pb";
import {
  type Change,
  ChangeSchema,
  DeviceMessageSchema,
  HouseholdMessageSchema,
  type Row,
  RowKind,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";
import { type Completion, CompletionSchema } from "@foyer/shared/gen/foyer/task/v1/task_pb";
import { localToday, minutesIntoLocalDay, momentInLocalDay } from "../page/calendar-date";
import type { Point } from "../page/sheet-camera";
import { spotInSpace, spotOnPage } from "../page/sticker-layout";
import { currentOccurrence, firstDateOf, repeatFromKind, tickOf } from "../tasks/repeats";
import { itemsUnder } from "../tasks/task-lists";

/** What happens to the items under a task when it's deleted: they're deleted too, they move up to
 *  its own parent, or to the top of its space. */
export type ItemsUnderDeleted = "delete" | "move-up" | "to-top";

import { LiveLane } from "./live-lane";

/** A spot on a calendar page that someone picked for an item's sticker, such as where they tapped
 *  to add it, or where they dropped it. On a day page, `time` is the time of day it means, in
 *  minutes after midnight: null in the strip of things without a time, and missing on other pages. */
export type SpotOnDay = { pageId: string; at: Point; time?: number | null };

/** Where the device stands with the household. */
export type SyncStatus = "connecting" | "catching-up" | "up-to-date" | "offline" | "signed-out";

/** What the device knows of the household, with its own changes applied before they're saved. */
export type SyncState = {
  status: SyncStatus;
  members: Member[];
  /** The spaces the member sees: their Inbox, their personal spaces, then the shared ones, each
   *  kind in the order they were made. */
  spaces: Space[];
  /** The pages the member sees that have been created, by id. A page is created when something is
   *  first put on it, so a page that isn't here is empty. */
  pages: ReadonlyMap<string, Page>;
  /** The tasks, events and notes the member sees, by id. */
  items: ReadonlyMap<string, Item>;
  /** The stickers on the pages the member sees, by id, including those whose item they can't see,
   *  which are drawn with their contents hidden. */
  stickers: ReadonlyMap<string, Sticker>;
  /** The completions of the tasks the member sees, by id: one each time a task was ticked. */
  completions: ReadonlyMap<string, Completion>;
  /** The member's connection to their Google account, or null when they aren't connected. */
  googleConnection: GoogleConnection | null;
  /** How many changes the household hasn't saved yet. */
  unsaved: number;
  /** A sentence for each change the household refused, which the device undid. */
  problems: string[];
};

/** A connection to the household that a `Connect` opened. */
export type Connection = { send(data: Uint8Array | string): void; close(): void };

/** What a connection reports: that it opened, each message, and that it closed, with its code. */
export type ConnectionEvents = {
  opened(): void;
  received(data: Uint8Array | string): void;
  closed(code: number): void;
};

/** Opens a connection to the household's sync address, carrying the device's session. */
export type Connect = (events: ConnectionEvents) => Connection;

/** How often a connected device says it's still there. */
export const keepAliveInterval = 30_000;

/** How long a connection may stay silent before the device gives up on it and connects again. */
export const silenceLimit = 75_000;

/** The longest wait between attempts to connect again. */
export const longestReconnectDelay = 30_000;

/** At most this many changes go in one push. */
export const pushChangeLimit = 100;

type Pending = { change: Change; describe: string; pushId?: string };

/** Keeps a device in step with the household, in memory: catches up when it connects, applies
 *  what others change, and shows the member's own changes at once until the household commits or
 *  refuses them. Connects again after a drop, waiting longer each time, until signed out. */
export class HouseholdSync {
  /** Which page the device is on and where it's pointing, and who else is there. */
  readonly live = new LiveLane((message) => this.#send(message));

  readonly #memberId: string;
  readonly #connect: Connect;
  readonly #today: () => string;
  readonly #listeners = new Set<() => void>();
  readonly #members = new Map<string, { seq: bigint; member: Member }>();
  readonly #spaces = new Map<string, { seq: bigint; space: Space }>();
  readonly #pages = new Map<string, { seq: bigint; page: Page }>();
  readonly #items = new Map<string, { seq: bigint; item: Item }>();
  readonly #stickers = new Map<string, { seq: bigint; sticker: Sticker }>();
  readonly #completions = new Map<string, { seq: bigint; completion: Completion }>();
  readonly #googleConnections = new Map<string, { seq: bigint; connection: GoogleConnection }>();
  readonly #rowsOfKind = {
    member: this.#members,
    space: this.#spaces,
    page: this.#pages,
    item: this.#items,
    sticker: this.#stickers,
    completion: this.#completions,
    googleConnection: this.#googleConnections,
  };
  readonly #deleted = new Map<string, bigint>();
  #pending: Pending[] = [];
  #problems: string[] = [];
  #cursor = 0n;
  #status: SyncStatus = "offline";
  #state: SyncState;
  #connection: Connection | null = null;
  #stopped = true;
  #attempts = 0;
  #lastHeard = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  /** `today` gives the device's own date, as an ISO 8601 date: by default from its clock and time
   *  zone. */
  constructor(options: { memberId: string; connect: Connect; today?: () => string }) {
    this.#memberId = options.memberId;
    this.#connect = options.connect;
    this.#today = options.today ?? (() => localToday());
    this.#state = this.#currentState();
  }

  /** Connects, and keeps connecting again until stopped or signed out. */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#open();
  }

  /** Closes the connection and stops connecting again. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#drop();
    if (this.#status !== "signed-out") this.#status = "offline";
    this.#changed();
  }

  /** What the device knows now. The same object until something changes. */
  readonly getState = (): SyncState => this.#state;

  /** Calls a listener whenever the state changes, until the returned function is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Creates a personal or shared space, and returns its id. Spaces at the start and end of the
   *  name are dropped. A name another space the member sees has is numbered, as in "Home 2". */
  createSpace(kind: SpaceKind.PERSONAL | SpaceKind.SHARED, name: string): string {
    const spaceId = newId();
    const trimmed = name.trim();
    this.#make(`creating “${trimmed}”`, {
      case: "spaceCreate",
      value: { spaceId, kind, name: trimmed },
    });
    return spaceId;
  }

  /** Renames a personal or shared space. Spaces at the start and end of the name are dropped. */
  renameSpace(spaceId: string, name: string): void {
    const trimmed = name.trim();
    this.#make(`renaming a space to “${trimmed}”`, {
      case: "spaceRename",
      value: { spaceId, name: trimmed },
    });
  }

  /** Why the household would refuse this name for a new space, or for the space `renaming` if
   *  given, as far as the device knows, or null if it wouldn't: a name that's blank or too long
   *  once trimmed, or a rename to the name of another space the member sees, ignoring case. */
  nameProblem(name: string, renaming?: string): string | null {
    const trimmed = name.trim();
    const problem = spaceNameProblem(trimmed);
    if (problem || renaming === undefined) return problem;
    const others = this.#state.spaces.filter(({ id }) => id !== renaming);
    const clash = clashingName(trimmed, namesOf(others));
    return clash === undefined ? null : `Another space you see is called “${clash}”.`;
  }

  /** Adds a task to a space, with its sticker in the next free spot on the space's newest page, and
   *  given a date, on that day of the calendar's pages, at `spot` on its page if given. Spaces at the
   *  title's ends are dropped. Returns the number of the space's page its sticker went on. */
  addTask(
    spaceId: string,
    title: string,
    dated?: { date: string; spot?: SpotOnDay },
  ): { itemId: string; pageNumber: number } {
    const itemId = newId();
    const trimmed = title.trim();
    const date = dated?.date ?? "";
    const create: ChangeInit = {
      case: "itemCreate",
      value: { itemId, kind: ItemKind.TASK, spaceId, title: trimmed, date },
    };
    const { changes, pageNumber } = this.#stickOn(spaceId, itemId);
    const time = dated?.spot?.time ?? null;
    const timed: ChangeInit[] =
      dated && time !== null
        ? [{ case: "itemSetTime", value: { itemId, time: timeOfDay(time) } }]
        : [];
    const calendar = dated
      ? this.#onCalendar(itemId, StickerKind.TASK, date, dated.spot, time)
      : [];
    this.#make(`adding “${trimmed}”`, create, ...timed, ...changes, ...calendar);
    return { itemId, pageNumber };
  }

  /** Why the household would refuse this title for a task, or null if it wouldn't: one that's
   *  blank or too long once trimmed. */
  titleProblem(title: string): string | null {
    return itemTitleProblem(title.trim());
  }

  /** Changes a task's title. Spaces at its start and end are dropped. */
  setTitle(itemId: string, title: string): void {
    const value = { itemId, title: title.trim() };
    this.#make(`renaming a task to “${value.title}”`, { case: "itemSetTitle", value });
  }

  /** Changes a task's description. */
  setDescription(itemId: string, description: string): void {
    const value = { itemId, description };
    this.#make("changing a task's description", { case: "itemSetDescription", value });
  }

  /** Changes a task's date, a plain ISO 8601 date, or clears it when empty, which clears its time,
   *  moving its stickers on the calendar's pages to that day, at `spot` on its page if given, or
   *  taking them off. A spot on a day page's timeline gives the task that time too. */
  setDate(itemId: string, date: string, spot?: SpotOnDay): void {
    const time = date !== "" && typeof spot?.time === "number" ? spot.time : undefined;
    const calendar = this.#onCalendar(itemId, StickerKind.TASK, date || null, spot, time);
    const timed: ChangeInit[] =
      time === undefined ? [] : [{ case: "itemSetTime", value: { itemId, time: timeOfDay(time) } }];
    this.#make(
      "changing a task's date",
      { case: "itemSetDate", value: { itemId, date } },
      ...timed,
      ...calendar,
    );
  }

  /** Changes a dated task's time of day, as "19:00", or clears it when empty, moving its sticker on
   *  its day's page to that time on the timeline, or to the strip, at `spot` if given. */
  setTime(itemId: string, time: string, spot?: SpotOnDay): void {
    const item = this.#state.items.get(itemId);
    const minutes = time === "" ? null : minutesOf(time);
    const calendar = item?.date
      ? this.#onCalendar(itemId, StickerKind.TASK, item.date, spot, minutes)
      : [];
    this.#make(
      time === "" ? "taking a task's time off" : `setting a task's time to ${time}`,
      { case: "itemSetTime", value: { itemId, time } },
      ...calendar,
    );
  }

  /** Sets the rule a task repeats by, and where its next date comes from, or stops it repeating
   *  when `rule` is null. A task without a date gets the rule's first date from today. */
  setRepeat(itemId: string, rule: RepeatRule | null, from: RepeatFrom): void {
    const item = this.#state.items.get(itemId);
    const title = item?.title ?? "a task";
    if (!rule) {
      const value = { itemId, repeat: "", repeatFrom: RepeatFromKind.UNSPECIFIED };
      this.#make(`stopping “${title}” repeating`, { case: "itemSetRepeat", value });
      return;
    }
    const value = { itemId, repeat: formatRepeat(rule), repeatFrom: repeatFromKind(from) };
    const changes: ChangeInit[] = [{ case: "itemSetRepeat", value }];
    if (item?.date === "") {
      const today = this.#today();
      const date = firstDateOf({ rule, from }, "", today) ?? today;
      changes.unshift({ case: "itemSetDate", value: { itemId, date } });
      changes.push(...this.#onCalendar(itemId, StickerKind.TASK, date));
    }
    this.#make(`making “${title}” repeat`, ...changes);
  }

  /** Moves a task, with everything under it, to another space, taking it out of its parent first,
   *  with its sticker going to the new space's newest page. Returns the number of that page, or
   *  null if nothing moved. */
  moveTask(itemId: string, spaceId: string): { pageNumber: number } | null {
    const item = this.#state.items.get(itemId);
    if (!item || item.spaceId === spaceId) return null;
    const takeOut: ChangeInit[] = item.parentId
      ? [{ case: "itemSetParent", value: { itemId, parentId: "" } }]
      : [];
    const removals = this.#placedStickers(item).map(
      ({ id }): ChangeInit => ({ case: "stickerRemove", value: { stickerId: id } }),
    );
    const { changes, pageNumber } = this.#stickOn(spaceId, itemId);
    const move: ChangeInit = { case: "itemMove", value: { itemId, spaceId } };
    this.#make(`moving “${item.title}”`, ...takeOut, move, ...removals, ...changes);
    return { pageNumber };
  }

  /** Puts a task under another task, with its sticker going to that task's body page, or back at
   *  the top of its space when `parentId` is null, with its sticker on the space's newest page.
   *  Under a task in another space, it moves there with everything under it. */
  putUnder(itemId: string, parentId: string | null): void {
    const item = this.#state.items.get(itemId);
    if (!item || item.parentId === (parentId ?? "")) return;
    const parent = parentId === null ? undefined : this.#state.items.get(parentId);
    if (parentId !== null && !parent) return;
    const set: ChangeInit = { case: "itemSetParent", value: { itemId, parentId: parentId ?? "" } };
    const removals = this.#placedStickers(item).map(
      ({ id }): ChangeInit => ({ case: "stickerRemove", value: { stickerId: id } }),
    );
    const placing =
      parentId === null
        ? this.#stickOn(item.spaceId, itemId).changes
        : this.#stickOnBody(parentId, itemId);
    const describe = parent
      ? `putting “${item.title}” under “${parent.title}”`
      : `taking out “${item.title}”`;
    this.#make(describe, set, ...removals, ...placing);
  }

  /** Adds a task under another, in its space, with its sticker in the next free spot on that
   *  task's body page. Spaces at the start and end of the title are dropped. */
  addTaskUnder(parentId: string, title: string): string | null {
    const parent = this.#state.items.get(parentId);
    if (!parent) return null;
    const itemId = newId();
    const trimmed = title.trim();
    const create: ChangeInit = {
      case: "itemCreate",
      value: { itemId, kind: ItemKind.TASK, spaceId: parent.spaceId, title: trimmed },
    };
    const set: ChangeInit = { case: "itemSetParent", value: { itemId, parentId } };
    this.#make(`adding “${trimmed}”`, create, set, ...this.#stickOnBody(parentId, itemId));
    return itemId;
  }

  /** Deletes a task, and its stickers on every page. The items under it are deleted too, or moved
   *  up to its own parent or to the top of its space, each with its sticker on its new page. */
  deleteTask(itemId: string, under: ItemsUnderDeleted = "delete"): void {
    const item = this.#state.items.get(itemId);
    const title = item?.title ?? "a task";
    if (item && under === "delete") {
      const deletions = itemsUnder(itemId, this.#state.items.values())
        .reverse()
        .map((id): ChangeInit => ({ case: "itemDelete", value: { itemId: id } }));
      if (deletions.length > 0) this.#make(`deleting what's under “${title}”`, ...deletions);
    } else if (item) {
      const target = under === "move-up" && item.parentId ? item.parentId : null;
      for (const child of [...this.#state.items.values()].filter((i) => i.parentId === itemId)) {
        this.putUnder(child.id, target);
      }
    }
    this.#make(`deleting “${title}”`, { case: "itemDelete", value: { itemId } });
  }

  /** Ticks a task, which adds a completion unless it's already done. A repeating task's tick is
   *  for its current occurrence, and moves it to its next date from today. */
  tickTask(itemId: string): void {
    this.tickTasks([itemId]);
  }

  /** Ticks several tasks at once, as `tickTask` ticks each. A repeating task's stickers stay on the
   *  calendar's pages on the day ticked, and it gets new ones on its next date. */
  tickTasks(itemIds: readonly string[]): void {
    const today = this.#today();
    const calendar = this.#calendarPlanner();
    const ticks = itemIds.flatMap((itemId): ChangeInit[] => {
      const item = this.#state.items.get(itemId);
      const ticked = item ? tickOf(item, today) : { occurrence: "", nextDate: "" };
      const tick: ChangeInit = {
        case: "taskTick",
        value: { completionId: newId(), itemId, ...ticked },
      };
      if (ticked.nextDate === "") return [tick];
      const kept = new Set([...this.#tickedDays(itemId), ticked.occurrence]);
      return [tick, ...calendar.plan(itemId, StickerKind.TASK, ticked.nextDate, kept)];
    });
    const first = this.#state.items.get(itemIds[0] ?? "")?.title ?? "a task";
    const describe =
      itemIds.length > 1 ? `ticking “${first}” and the tasks under it` : `ticking “${first}”`;
    if (ticks.length > 0) this.#make(describe, ...ticks);
  }

  /** Unticks a task's occurrence, whoever ticked it: by default its current one. If ticking a
   *  repeating task moved it, it goes back to the occurrence unless its date changed since, and so
   *  do its stickers on the calendar's pages. */
  untickTask(itemId: string, occurrence?: string): void {
    const item = this.#state.items.get(itemId);
    const value = { itemId, occurrence: occurrence ?? (item ? currentOccurrence(item) : "") };
    const back = item?.repeat && value.occurrence !== "" ? value.occurrence : null;
    const kept = new Set([...this.#tickedDays(itemId)].filter((day) => day !== back));
    const calendar =
      back === null ? [] : this.#calendarPlanner().plan(itemId, StickerKind.TASK, back, kept);
    this.#make(
      `unticking “${item?.title ?? "a task"}”`,
      { case: "taskUntick", value },
      ...calendar,
    );
  }

  /** Moves a sticker within its page, which brings it to the top, keeping its day on a calendar
   *  page. */
  moveSticker(stickerId: string, x: number, y: number): void {
    this.#make("moving a sticker", { case: "stickerMove", value: { stickerId, x, y } });
  }

  /** Moves a sticker on a day page within its day, to a spot on its timeline or in its strip,
   *  changing when its item happens to the spot's time: a task takes it as its time, or has none in
   *  the strip; an event starts then, keeping its length, or happens all day in the strip, and an
   *  all-day event put on the timeline lasts an hour. */
  moveOnDayPage(stickerId: string, at: Point, time: number | null): void {
    const sticker = this.#state.stickers.get(stickerId);
    const item = sticker && this.#state.items.get(sticker.itemId);
    if (!sticker || !item) return;
    const spot = { pageId: sticker.pageId, at, time };
    if (item.kind === ItemKind.EVENT) {
      const before = eventTimeOf(item);
      const after = before && retimeEvent(before, sticker.occurrence, time);
      if (after) this.setEventTime(item.id, after, spot);
      else this.moveSticker(stickerId, at.x, at.y);
      return;
    }
    const was = item.time === "" ? null : minutesOf(item.time);
    if (was === time) this.moveSticker(stickerId, at.x, at.y);
    else this.setTime(item.id, time === null ? "" : timeOfDay(time), spot);
  }

  /** Moves the item of a sticker on a calendar page to another day, the sticker staying where it
   *  was dropped: a task takes the day as its date, and an event moves by as many days, keeping its
   *  times and length. Its stickers on the other calendar pages go to the new day. */
  moveToDay(stickerId: string, at: Point, date: string): void {
    const sticker = this.#state.stickers.get(stickerId);
    const item = sticker && this.#state.items.get(sticker.itemId);
    if (!sticker || !item || sticker.occurrence === date) return;
    const spot = { pageId: sticker.pageId, at };
    if (item.kind === ItemKind.EVENT) {
      const time = eventTimeOf(item);
      if (time) this.setEventTime(item.id, shiftEvent(time, sticker.occurrence, date), spot);
      return;
    }
    this.setDate(item.id, date, spot);
  }

  /** Adds an event to a space that has a Google calendar, which the household writes it to and dates
   *  it from, and returns its id. Its stickers go on the day it starts on this device, at `spot` on
   *  its page if given. Spaces at the title's ends are dropped. */
  addEvent(
    spaceId: string,
    event: { title: string; description: string; time: EventTime },
    spot?: SpotOnDay,
  ) {
    const itemId = newId();
    const title = event.title.trim();
    const { description } = event;
    const value = { itemId, kind: ItemKind.EVENT, spaceId, title, description };
    const day = this.#dayOf(event.time);
    const time = startOnDay(event.time, day);
    this.#make(
      `adding “${title}”`,
      { case: "itemCreate", value: { ...value, ...timeChange(event.time) } },
      ...this.#onCalendar(itemId, StickerKind.EVENT, day, spot, time),
    );
    return itemId;
  }

  /** Changes when an event happens, moving its stickers on the calendar's pages to the day it now
   *  starts on this device, at `spot` on its page if given. */
  setEventTime(itemId: string, time: EventTime, spot?: SpotOnDay): void {
    const title = this.#state.items.get(itemId)?.title ?? "an event";
    const day = this.#dayOf(time);
    this.#make(
      `changing when “${title}” happens`,
      { case: "eventSetTime", value: { itemId, ...timeChange(time) } },
      ...this.#onCalendar(itemId, StickerKind.EVENT, day, spot, startOnDay(time, day)),
    );
  }

  /** Moves an event to another space that has a Google calendar, and so to that calendar. */
  moveEvent(itemId: string, spaceId: string): void {
    const title = this.#state.items.get(itemId)?.title ?? "an event";
    this.#make(`moving “${title}”`, { case: "itemMove", value: { itemId, spaceId } });
  }

  /** Deletes an event, in Google Calendar too. */
  deleteEvent(itemId: string): void {
    const title = this.#state.items.get(itemId)?.title ?? "an event";
    this.#make(`deleting “${title}”`, { case: "itemDelete", value: { itemId } });
  }

  /** Forgets the refused changes the state reports. */
  dismissProblems(): void {
    this.#problems = [];
    this.#changed();
  }

  #onCalendar(
    itemId: string,
    kind: StickerKind,
    date: string | null,
    spot?: SpotOnDay,
    time?: number | null,
  ) {
    const kept = this.#tickedDays(itemId);
    const at = date === null ? undefined : spot;
    return this.#calendarPlanner().plan(itemId, kind, date, kept, at, time);
  }

  /** An item's time on a day, in minutes after its midnight on this device: a task's time, or when
   *  an event with times starts. */
  #timeOn(itemId: string, date: string | null): number | null {
    const item = this.#state.items.get(itemId);
    if (!item || date === null) return null;
    if (item.time !== "") return minutesOf(item.time);
    const time = eventTimeOf(item);
    return time ? startOnDay(time, date) : null;
  }

  #calendarPlanner() {
    const pages = new Map<string, PageSize>();
    for (const page of this.#state.pages.values()) {
      if (calendarPageOf(page.id)) pages.set(page.id, { width: page.width, height: page.height });
    }
    let stickers: PlacedSticker[] = [...this.#state.stickers.values()]
      .filter(({ occurrence }) => occurrence !== "")
      .map(({ id, pageId, itemId, x, y, occurrence }) => ({
        id,
        pageId,
        itemId,
        x,
        y,
        occurrence,
      }));
    const createPage = (pageId: string, size: PageSize): ChangeInit[] => {
      const calendar = calendarPageOf(pageId);
      if (!calendar || pages.has(pageId)) return [];
      pages.set(pageId, size);
      const value = { pageId, kind: calendarPageKinds[calendar.kind], ...size };
      return [{ case: "pageCreate", value }];
    };
    return {
      plan: (
        itemId: string,
        kind: StickerKind,
        date: string | null,
        kept: ReadonlySet<string>,
        spot?: SpotOnDay,
        time: number | null = this.#timeOn(itemId, date),
      ): ChangeInit[] => {
        const changes: ChangeInit[] = [];
        if (spot && date !== null) {
          const moving = stickers.find(
            (each) =>
              each.itemId === itemId && each.pageId === spot.pageId && !kept.has(each.occurrence),
          );
          const placed = { ...spot.at, occurrence: date };
          if (moving) {
            changes.push({ case: "stickerMove", value: { stickerId: moving.id, ...placed } });
            stickers = stickers.map((each) => (each === moving ? { ...each, ...placed } : each));
          } else {
            const stickerId = newId();
            const size = sizeOfCalendarPage(spot.pageId, pages);
            changes.push(...createPage(spot.pageId, size));
            const value = { stickerId, pageId: spot.pageId, kind, itemId, ...placed };
            changes.push({ case: "stickerPlace", value });
            stickers = [...stickers, { id: stickerId, pageId: spot.pageId, itemId, ...placed }];
          }
        }
        const plan = planCalendarStickers({ itemId, date, time, kept, stickers, pages });
        for (const page of plan.pages) changes.push(...createPage(page.pageId, page.size));
        for (const { stickerId, pageId, x, y, occurrence } of plan.place) {
          const value = { stickerId, pageId, x, y, kind, itemId, occurrence };
          changes.push({ case: "stickerPlace", value });
        }
        for (const value of plan.move) changes.push({ case: "stickerMove", value });
        for (const stickerId of plan.remove) {
          changes.push({ case: "stickerRemove", value: { stickerId } });
        }
        stickers = afterPlan(stickers, itemId, plan);
        return changes;
      },
    };
  }

  #tickedDays(itemId: string): Set<string> {
    const days = new Set<string>();
    if (!this.#state.items.get(itemId)?.repeat) return days;
    for (const { itemId: ticked, occurrence } of this.#state.completions.values()) {
      if (ticked === itemId && occurrence !== "") days.add(occurrence);
    }
    return days;
  }

  #dayOf(time: EventTime): string {
    return time.allDay ? time.startsOn : localToday(new Date(time.startsAt));
  }

  #placedStickers(item: Item): Sticker[] {
    const spacePages = `space:${item.spaceId}:`;
    const parentPage = item.parentId ? itemPageId(item.parentId) : null;
    return [...this.#state.stickers.values()].filter(
      ({ itemId, pageId }) =>
        itemId === item.id && (pageId.startsWith(spacePages) || pageId === parentPage),
    );
  }

  #stickOnBody(parentId: string, itemId: string): ChangeInit[] {
    const { pages, stickers } = this.#state;
    const pageId = itemPageId(parentId);
    const size = pageSizeFor("item");
    const spot = spotOnPage(pageId, StickerKind.TASK, pages, stickers.values(), size);
    const changes: ChangeInit[] = [];
    if (spot.isNewPage) {
      changes.push({
        case: "pageCreate",
        value: { pageId, kind: PageKind.ITEM, itemId: parentId, ...size },
      });
    }
    const sticker = { stickerId: newId(), pageId, ...spot.at, itemId, kind: StickerKind.TASK };
    changes.push({ case: "stickerPlace", value: sticker });
    return changes;
  }

  #stickOn(spaceId: string, itemId: string): { changes: ChangeInit[]; pageNumber: number } {
    const { pages, stickers } = this.#state;
    const newPageSize = pageSizeFor("space");
    const spot = spotInSpace(spaceId, StickerKind.TASK, pages, stickers.values(), newPageSize);
    const changes: ChangeInit[] = [];
    if (spot.isNewPage) {
      const { pageId, number } = spot;
      const value = { pageId, kind: PageKind.SPACE, spaceId, number, ...newPageSize };
      changes.push({ case: "pageCreate", value });
    }
    const sticker = { stickerId: newId(), pageId: spot.pageId, ...spot.at, itemId };
    changes.push({ case: "stickerPlace", value: { ...sticker, kind: StickerKind.TASK } });
    return { changes, pageNumber: spot.number };
  }

  #make(describe: string, ...changes: ChangeInit[]): void {
    const at = timestampFromMs(Date.now());
    for (const change of changes) {
      const made = create(ChangeSchema, { changeId: newId(), at, change });
      this.#pending.push({ change: made, describe });
    }
    this.#pushUnsent();
    this.#changed();
  }

  #open(): void {
    this.#status = "connecting";
    this.#changed();
    const events: ConnectionEvents = {
      opened: () => {
        if (this.#connection === connection) this.#heard();
      },
      received: (data) => {
        if (this.#connection === connection) this.#receive(data);
      },
      closed: (code) => {
        if (this.#connection === connection) this.#closed(code);
      },
    };
    const connection = this.#connect(events);
    this.#connection = connection;
    this.#heard();
    clearInterval(this.#keepAliveTimer);
    this.#keepAliveTimer = setInterval(() => this.#keepAlive(), keepAliveInterval);
  }

  #keepAlive(): void {
    if (Date.now() - this.#lastHeard > silenceLimit) {
      this.#closed(0);
      return;
    }
    this.#connection?.send("ping");
  }

  #heard(): void {
    this.#lastHeard = Date.now();
  }

  #receive(data: Uint8Array | string): void {
    this.#heard();
    if (typeof data === "string") return;
    const { message } = fromBinary(HouseholdMessageSchema, data);
    if (this.live.receive(message)) return;
    switch (message.case) {
      case "welcome":
        this.#attempts = 0;
        this.#status = "catching-up";
        this.#send({ case: "pull", value: { cursor: this.#cursor } });
        this.#pushUnsent();
        this.live.connected();
        break;
      case "pullReply":
        this.#apply(message.value.rows);
        if (message.value.done) {
          this.#cursor = message.value.cursor;
          this.#status = "up-to-date";
        } else {
          this.#send({ case: "pull", value: { cursor: message.value.cursor } });
        }
        break;
      case "updates":
        this.#apply(message.value.rows);
        if (this.#status === "up-to-date") {
          for (const { seq } of message.value.rows) if (seq > this.#cursor) this.#cursor = seq;
        }
        break;
      case "committed":
        for (const { changeId, result } of message.value.results) {
          const pending = this.#pending.find(({ change }) => change.changeId === changeId);
          this.#pending = this.#pending.filter((each) => each !== pending);
          if (pending && result.case === "refused") {
            this.#problems.push(`Couldn't save ${pending.describe}: ${result.value.reason}`);
          }
        }
        break;
    }
    this.#changed();
  }

  #apply(rows: Row[]): void {
    for (const { seq, row } of rows) {
      switch (row.case) {
        case "member":
          if (this.#isNewer("member", row.value.id, seq, this.#members)) {
            this.#members.set(row.value.id, { seq, member: row.value });
          }
          break;
        case "space":
          if (this.#isNewer("space", row.value.id, seq, this.#spaces)) {
            this.#spaces.set(row.value.id, { seq, space: row.value });
          }
          break;
        case "page":
          if (this.#isNewer("page", row.value.id, seq, this.#pages)) {
            this.#pages.set(row.value.id, { seq, page: row.value });
          }
          break;
        case "item":
          if (this.#isNewer("item", row.value.id, seq, this.#items)) {
            this.#items.set(row.value.id, { seq, item: row.value });
          }
          break;
        case "sticker":
          if (this.#isNewer("sticker", row.value.id, seq, this.#stickers)) {
            this.#stickers.set(row.value.id, { seq, sticker: row.value });
          }
          break;
        case "completion":
          if (this.#isNewer("completion", row.value.id, seq, this.#completions)) {
            this.#completions.set(row.value.id, { seq, completion: row.value });
          }
          break;
        case "googleConnection":
          if (this.#isNewer("googleConnection", row.value.memberId, seq, this.#googleConnections)) {
            this.#googleConnections.set(row.value.memberId, { seq, connection: row.value });
          }
          break;
        case "deleted": {
          const kind = rowKindNames[row.value.kind];
          const rows = kind && this.#rowsOfKind[kind];
          if (kind && rows && this.#isNewer(kind, row.value.id, seq, rows)) {
            rows.delete(row.value.id);
            this.#deleted.set(`${kind} ${row.value.id}`, seq);
          }
          break;
        }
      }
    }
  }

  #isNewer(kind: string, id: string, seq: bigint, rows: Map<string, { seq: bigint }>): boolean {
    const known = rows.get(id)?.seq ?? this.#deleted.get(`${kind} ${id}`) ?? -1n;
    return seq >= known;
  }

  #pushUnsent(): void {
    if (this.#status !== "catching-up" && this.#status !== "up-to-date") return;
    for (;;) {
      const unsent = this.#pending.filter(({ pushId }) => !pushId).slice(0, pushChangeLimit);
      if (unsent.length === 0) return;
      const pushId = newId();
      for (const pending of unsent) pending.pushId = pushId;
      const changes = unsent.map(({ change }) => change);
      this.#send({ case: "push", value: { pushId, changes } });
    }
  }

  #send(message: MessageInitShape<typeof DeviceMessageSchema>["message"]): void {
    this.#connection?.send(toBinary(DeviceMessageSchema, create(DeviceMessageSchema, { message })));
  }

  #closed(code: number): void {
    this.#drop();
    for (const pending of this.#pending) pending.pushId = undefined;
    if (code === signedOutCloseCode) {
      this.#stopped = true;
      this.#status = "signed-out";
    } else {
      this.#status = "offline";
      if (!this.#stopped) {
        const delay = Math.min(1000 * 2 ** this.#attempts, longestReconnectDelay);
        this.#attempts += 1;
        this.#reconnectTimer = setTimeout(() => this.#open(), delay);
      }
    }
    this.#changed();
  }

  #drop(): void {
    clearInterval(this.#keepAliveTimer);
    const connection = this.#connection;
    this.#connection = null;
    connection?.close();
    this.live.disconnected();
  }

  #changed(): void {
    this.#state = this.#currentState();
    for (const listener of this.#listeners) listener();
  }

  #currentState(): SyncState {
    const spaces = new Map([...this.#spaces].map(([id, { space }]) => [id, space]));
    const pages = new Map([...this.#pages].map(([id, { page }]) => [id, page]));
    const items = new Map([...this.#items].map(([id, { item }]) => [id, item]));
    const stickers = new Map([...this.#stickers].map(([id, { sticker }]) => [id, sticker]));
    const completions = new Map(
      [...this.#completions].map(([id, { completion }]) => [id, completion]),
    );
    for (const { change } of this.#pending) {
      const { at } = change;
      switch (change.change.case) {
        case "spaceCreate": {
          const { spaceId, kind, name } = change.change.value;
          const ownerId = kind === SpaceKind.PERSONAL ? this.#memberId : "";
          if (!spaces.has(spaceId)) {
            const numbered = freeSpaceName(name, namesOf(spaces.values()));
            spaces.set(
              spaceId,
              create(SpaceSchema, { id: spaceId, kind, ownerId, name: numbered }),
            );
          }
          break;
        }
        case "spaceRename": {
          const { spaceId, name } = change.change.value;
          const space = spaces.get(spaceId);
          if (space) spaces.set(spaceId, { ...space, name });
          break;
        }
        case "pageCreate": {
          const { pageId, kind, spaceId, number, itemId, width, height } = change.change.value;
          if (!pages.has(pageId)) {
            const page = { id: pageId, kind, spaceId, number, itemId, width, height };
            pages.set(pageId, create(PageSchema, page));
          }
          break;
        }
        case "itemCreate": {
          const { itemId, kind, spaceId, title, description, date } = change.change.value;
          if (!items.has(itemId)) {
            const { startsOn, endsOn, startsAt, endsAt } = change.change.value;
            const time = { startsOn, endsOn, startsAt, endsAt };
            const item = { id: itemId, kind, spaceId, title, description, date, ...time };
            const created = { createdBy: this.#memberId, createdAt: at };
            items.set(itemId, create(ItemSchema, { ...item, ...created }));
          }
          break;
        }
        case "stickerPlace": {
          const { stickerId, pageId, x, y, kind, itemId, occurrence } = change.change.value;
          if (!stickers.has(stickerId) && !this.#deleted.has(`sticker ${stickerId}`)) {
            const sticker = { id: stickerId, pageId, x, y, kind, itemId, occurrence };
            const placed = { placedAt: at, placedBy: this.#memberId };
            stickers.set(stickerId, create(StickerSchema, { ...sticker, ...placed }));
          }
          break;
        }
        case "stickerMove": {
          const { stickerId, x, y, occurrence } = change.change.value;
          const sticker = stickers.get(stickerId);
          if (sticker) {
            const day = occurrence === "" ? sticker.occurrence : occurrence;
            const placed = { placedAt: at, placedBy: this.#memberId };
            stickers.set(stickerId, { ...sticker, x, y, occurrence: day, ...placed });
          }
          break;
        }
        case "stickerRemove":
          stickers.delete(change.change.value.stickerId);
          break;
        case "itemSetTitle": {
          const { itemId, title } = change.change.value;
          const item = items.get(itemId);
          if (item) items.set(itemId, { ...item, title });
          break;
        }
        case "itemSetDescription": {
          const { itemId, description } = change.change.value;
          const item = items.get(itemId);
          if (item) items.set(itemId, { ...item, description });
          break;
        }
        case "itemSetDate": {
          const { itemId, date } = change.change.value;
          const item = items.get(itemId);
          if (item) items.set(itemId, { ...item, date, ...(date === "" ? { time: "" } : {}) });
          break;
        }
        case "itemSetTime": {
          const { itemId, time } = change.change.value;
          const item = items.get(itemId);
          if (item && (item.date !== "" || time === "")) items.set(itemId, { ...item, time });
          break;
        }
        case "eventSetTime": {
          const { itemId, startsOn, endsOn, startsAt, endsAt } = change.change.value;
          const item = items.get(itemId);
          if (item) items.set(itemId, { ...item, startsOn, endsOn, startsAt, endsAt });
          break;
        }
        case "itemSetRepeat": {
          const { itemId, repeat, repeatFrom } = change.change.value;
          const item = items.get(itemId);
          if (item) items.set(itemId, { ...item, repeat, repeatFrom });
          break;
        }
        case "itemMove": {
          const { itemId, spaceId } = change.change.value;
          for (const id of [itemId, ...itemsUnder(itemId, items.values())]) {
            const item = items.get(id);
            if (item) items.set(id, { ...item, spaceId });
          }
          break;
        }
        case "itemSetParent": {
          const { itemId, parentId } = change.change.value;
          const item = items.get(itemId);
          const parent = items.get(parentId);
          if (!item || (parentId !== "" && !parent)) break;
          items.set(itemId, { ...item, parentId });
          if (parent && parent.spaceId !== item.spaceId) {
            for (const id of [itemId, ...itemsUnder(itemId, items.values())]) {
              const moved = items.get(id);
              if (moved) items.set(id, { ...moved, spaceId: parent.spaceId });
            }
          }
          break;
        }
        case "itemDelete": {
          const { itemId } = change.change.value;
          items.delete(itemId);
          const itemPages = new Set(
            [...pages.values()].filter((page) => page.itemId === itemId).map(({ id }) => id),
          );
          for (const id of itemPages) pages.delete(id);
          for (const [id, sticker] of stickers) {
            if (sticker.itemId === itemId || itemPages.has(sticker.pageId)) stickers.delete(id);
          }
          for (const [id, completion] of completions) {
            if (completion.itemId === itemId) completions.delete(id);
          }
          break;
        }
        case "taskTick": {
          const { completionId, itemId, occurrence, nextDate } = change.change.value;
          const done = [...completions.values()].some(
            (each) => each.itemId === itemId && each.occurrence === occurrence,
          );
          const item = items.get(itemId);
          if (!done && item && !this.#deleted.has(`completion ${completionId}`)) {
            const completion = { id: completionId, itemId, occurrence };
            const ticked = { doneAt: at, doneBy: this.#memberId };
            completions.set(completionId, create(CompletionSchema, { ...completion, ...ticked }));
            if (nextDate !== "") items.set(itemId, { ...item, date: nextDate });
          }
          break;
        }
        case "taskUntick": {
          const { itemId, occurrence } = change.change.value;
          for (const [id, completion] of completions) {
            if (completion.itemId === itemId && completion.occurrence === occurrence) {
              completions.delete(id);
              const item = items.get(itemId);
              if (item && occurrence !== "") items.set(itemId, { ...item, date: occurrence });
            }
          }
          break;
        }
      }
    }
    return {
      status: this.#status,
      members: [...this.#members.values()]
        .map(({ member }) => member)
        .sort((a, b) => a.id.localeCompare(b.id)),
      spaces: [...spaces.values()].sort(
        (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id),
      ),
      pages,
      items,
      stickers,
      completions,
      googleConnection: this.#googleConnections.get(this.#memberId)?.connection ?? null,
      unsaved: this.#pending.length,
      problems: [...this.#problems],
    };
  }
}

const calendarPageKinds: Record<CalendarPageKind, PageKind> = {
  month: PageKind.MONTH,
  week: PageKind.WEEK,
  day: PageKind.DAY,
};

function sizeOfCalendarPage(pageId: string, pages: ReadonlyMap<string, PageSize>): PageSize {
  const calendar = calendarPageOf(pageId);
  return pages.get(pageId) ?? pageSizeFor(calendar?.kind ?? "day");
}

function eventTimeOf(item: Item): EventTime | null {
  if (item.startsOn !== "") return { allDay: true, startsOn: item.startsOn, endsOn: item.endsOn };
  if (!item.startsAt || !item.endsAt) return null;
  return { allDay: false, startsAt: timestampMs(item.startsAt), endsAt: timestampMs(item.endsAt) };
}

/** When an event starts on a day, in minutes after its midnight on this device, or null when it
 *  happens all day. */
function startOnDay(time: EventTime, date: string | null): number | null {
  return time.allDay || date === null ? null : minutesIntoLocalDay(time.startsAt, date);
}

/** An event moved to a time on a day, in minutes after its midnight on this device: one with times
 *  starts then and keeps its length, and one all day lasts an hour. At no time, it's all day on the
 *  days it covers. Null when nothing changes. */
function retimeEvent(time: EventTime, date: string, minutes: number | null): EventTime | null {
  if (minutes === null) {
    if (time.allDay) return null;
    const last = localToday(new Date(Math.max(time.endsAt - 1, time.startsAt)));
    return { allDay: true, startsOn: date, endsOn: last < date ? date : last };
  }
  const startsAt = momentInLocalDay(date, minutes);
  const length = time.allDay ? 60 * 60 * 1000 : time.endsAt - time.startsAt;
  if (!time.allDay && startsAt === time.startsAt) return null;
  return { allDay: false, startsAt, endsAt: startsAt + length };
}

function shiftEvent(time: EventTime, from: string, to: string): EventTime {
  const days = daysBetween(from, to);
  if (time.allDay) {
    return {
      allDay: true,
      startsOn: addDays(time.startsOn, days),
      endsOn: addDays(time.endsOn, days),
    };
  }
  const startsAt = new Date(time.startsAt);
  startsAt.setDate(startsAt.getDate() + days);
  return {
    allDay: false,
    startsAt: startsAt.getTime(),
    endsAt: startsAt.getTime() + time.endsAt - time.startsAt,
  };
}

function timeChange(time: EventTime) {
  const { startsOn, endsOn, startsAt, endsAt } = eventTimeFields(time);
  return {
    startsOn,
    endsOn,
    ...(startsAt === null ? {} : { startsAt: timestampFromMs(startsAt) }),
    ...(endsAt === null ? {} : { endsAt: timestampFromMs(endsAt) }),
  };
}

function namesOf(spaces: Iterable<Space>): string[] {
  return Array.from(spaces)
    .filter(({ kind }) => kind !== SpaceKind.INBOX)
    .map(({ name }) => name);
}

type ChangeInit = MessageInitShape<typeof ChangeSchema>["change"];

type RowKindName =
  | "member"
  | "space"
  | "page"
  | "item"
  | "sticker"
  | "completion"
  | "googleConnection";

const rowKindNames: Partial<Record<RowKind, RowKindName>> = {
  [RowKind.MEMBER]: "member",
  [RowKind.SPACE]: "space",
  [RowKind.PAGE]: "page",
  [RowKind.ITEM]: "item",
  [RowKind.STICKER]: "sticker",
  [RowKind.COMPLETION]: "completion",
  [RowKind.GOOGLE_CONNECTION]: "googleConnection",
};

const kindOrder: Record<SpaceKind, number> = {
  [SpaceKind.INBOX]: 0,
  [SpaceKind.PERSONAL]: 1,
  [SpaceKind.SHARED]: 2,
  [SpaceKind.UNSPECIFIED]: 3,
};
