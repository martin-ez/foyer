import { create, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { pointsPerSecond } from "@foyer/shared";
import { HouseholdMessageSchema } from "@foyer/shared/gen/foyer/sync/v1/sync_pb";

/** How long a device can stay on a page without the household hearing from it, by a message or
 *  the "ping" devices send every 30 seconds. */
export const silenceLimit = 60_000;

/** How many positions devices can send in a day, by midnight UTC, before the live lane stops
 *  passing them on: a third of the free plan's 100,000 daily requests, which each message a device
 *  sends counts against. */
export const dailyPointLimit = Math.floor(100_000 / 3);

/** How many of a connection's positions the household counts in memory before it adds them to the
 *  day's stored count. It also adds them when the connection closes. */
export const unsavedPointLimit = 100;

/** What the live lane keeps with a connection, which survives the household sleeping. */
export type LiveConnection = {
  /** When the device last sent something on the live lane. */
  heardAt: number;
  /** The page the device is on, and where it last pointed there and when. */
  page: { id: string; position: { x: number; y: number } | null; pointedAt: number } | null;
  /** How many positions the device can send at once, filled back up at `pointsPerSecond`. */
  allowance: number;
  allowanceAt: number;
  /** The day, by UTC, of the positions the device sent that aren't in the stored count yet. */
  day: string;
  unsavedPoints: number;
};

type Attachment = { memberId: string; live?: LiveConnection };

type Device = { socket: WebSocket; attachment: Attachment; live: LiveConnection };

type HouseholdMessageInit = MessageInitShape<typeof HouseholdMessageSchema>["message"];

/** The live lane of a connection that has just opened. */
export function newLiveConnection(now: number): LiveConnection {
  return {
    heardAt: now,
    page: null,
    allowance: pointsPerSecond,
    allowanceAt: now,
    day: utcDay(now),
    unsavedPoints: 0,
  };
}

/** Keeps track of which page each connected device is on and where it's pointing, and tells the
 *  devices on a page about each other. Only the day's count of positions is stored. */
export class LiveLane {
  readonly #ctx: DurableObjectState;
  readonly #canSeePage: (memberId: string, pageId: string) => boolean;
  readonly #wake: (at: number) => void;
  #stored: { day: string; points: number } | null = null;

  /** `wake` asks for the household's alarm, which runs `checkForSilence`, at a time. */
  constructor(
    ctx: DurableObjectState,
    canSeePage: (memberId: string, pageId: string) => boolean,
    wake: (at: number) => void,
  ) {
    this.#ctx = ctx;
    this.#canSeePage = canSeePage;
    this.#wake = wake;
  }

  /** Puts a device on a page its member can see, or on no page, and tells the devices on the page
   *  it left and the page it entered who is there. A device that enters while the day's limit for
   *  positions is reached is told so. */
  enter(socket: WebSocket, pageId: string): void {
    const now = Date.now();
    const device = this.#device(socket);
    if (!device) return;
    const left = device.live.page?.id;
    const visible = this.#canSeePage(device.attachment.memberId, pageId);
    device.live.page = visible ? { id: pageId, position: null, pointedAt: 0 } : null;
    device.live.heardAt = now;
    this.#keep(device);
    if (left !== undefined && left !== pageId) this.#announce(left, now);
    if (!visible) return;
    this.#announce(pageId, now);
    if (this.#pointsToday(now) >= dailyPointLimit) send(socket, { case: "liveLimit", value: {} });
    this.#scheduleSilenceCheck(now);
  }

  /** Takes a device off its page, and tells the others on it. */
  leave(socket: WebSocket): void {
    const now = Date.now();
    const device = this.#device(socket);
    if (!device) return;
    const left = device.live.page?.id;
    device.live.page = null;
    device.live.heardAt = now;
    this.#keep(device);
    if (left !== undefined) this.#announce(left, now);
  }

  /** Passes where a device points on its page on to the other members' devices there, unless it
   *  comes faster than `pointsPerSecond` or the day's limit is reached, which every device is told
   *  of. Every position counts towards the limit. */
  point(socket: WebSocket, x: number, y: number): void {
    const now = Date.now();
    const device = this.#device(socket);
    if (!device) return;
    const { live } = device;
    const today = utcDay(now);
    if (live.day !== today) {
      live.day = today;
      live.unsavedPoints = 0;
    }
    live.unsavedPoints += 1;
    live.heardAt = now;
    const refilled = ((now - live.allowanceAt) * pointsPerSecond) / 1000;
    live.allowance = Math.min(pointsPerSecond, live.allowance + Math.max(0, refilled));
    live.allowanceAt = now;

    const page = Number.isFinite(x) && Number.isFinite(y) ? live.page : null;
    if (page) {
      page.position = { x, y };
      page.pointedAt = now;
    }
    const allowed = page !== null && live.allowance >= 1;
    if (allowed) live.allowance -= 1;
    if (live.unsavedPoints >= unsavedPointLimit) this.#savePoints(live, now);
    this.#keep(device);

    const used = this.#pointsToday(now);
    if (used > dailyPointLimit) {
      send(socket, { case: "liveLimit", value: {} });
      return;
    }
    if (page && allowed) {
      const memberId = device.attachment.memberId;
      for (const other of this.#onPage(page.id, now)) {
        if (other.attachment.memberId === memberId) continue;
        send(other.socket, { case: "pointed", value: { memberId, x, y } });
      }
    }
    if (used === dailyPointLimit) {
      for (const each of this.#devices()) send(each.socket, { case: "liveLimit", value: {} });
    }
  }

  /** Takes a device whose connection is closing off its page, tells the others on it, and stores
   *  the positions it sent today in the day's count. */
  closed(socket: WebSocket): void {
    const now = Date.now();
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment?.live) return;
    const device = { socket, attachment, live: attachment.live };
    const left = device.live.page?.id;
    this.#savePoints(device.live, now);
    device.live.page = null;
    this.#keep(device);
    if (left !== undefined) this.#announce(left, now);
  }

  /** Takes every device off a page its member can no longer see, such as the page of a task that
   *  moved out of their sight or was deleted, and tells the others on it. The device isn't told, as
   *  when it enters a page it can't see. */
  checkSight(): void {
    const now = Date.now();
    const left = new Set<string>();
    for (const device of this.#devices()) {
      const page = device.live.page;
      if (!page || this.#canSeePage(device.attachment.memberId, page.id)) continue;
      device.live.page = null;
      this.#keep(device);
      left.add(page.id);
    }
    for (const pageId of left) this.#announce(pageId, now);
  }

  /** Takes every device the household hasn't heard from for `silenceLimit` off its page, closes its
   *  connection, which the device opens again if it's still there, and tells the others on the
   *  page. Checks again later while someone shares a page. */
  checkForSilence(): void {
    const now = Date.now();
    for (const device of this.#devices()) {
      if (!device.live.page || !this.#silent(device, now)) continue;
      this.closed(device.socket);
      try {
        device.socket.close(1000, "Not heard from for a minute.");
      } catch {}
    }
    this.#scheduleSilenceCheck(now);
  }

  #announce(pageId: string, now: number): void {
    const onPage = this.#onPage(pageId, now);
    const limited = this.#pointsToday(now) >= dailyPointLimit;
    const pointedAt = ({ live }: Device) => (live.page?.position ? live.page.pointedAt : -1);
    for (const device of onPage) {
      const latest = new Map<string, Device>();
      for (const other of onPage) {
        const memberId = other.attachment.memberId;
        const known = latest.get(memberId);
        if (memberId === device.attachment.memberId) continue;
        if (!known || pointedAt(other) > pointedAt(known)) latest.set(memberId, other);
      }
      const members = [...latest]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([memberId, other]) => {
          const position = limited ? null : other.live.page?.position;
          return position ? { memberId, position } : { memberId };
        });
      send(device.socket, { case: "here", value: { pageId, members } });
    }
  }

  #scheduleSilenceCheck(now: number): void {
    const membersOn = new Map<string, Set<string>>();
    const devices = this.#devices().filter(({ live }) => live.page);
    for (const { attachment, live } of devices) {
      const pageId = live.page?.id ?? "";
      membersOn.set(pageId, (membersOn.get(pageId) ?? new Set()).add(attachment.memberId));
    }
    const deadlines = devices
      .filter(({ live }) => (membersOn.get(live.page?.id ?? "")?.size ?? 0) > 1)
      .map((device) => this.#lastHeard(device) + silenceLimit);
    if (deadlines.length === 0) return;
    this.#wake(Math.max(now, Math.min(...deadlines)));
  }

  #onPage(pageId: string, now: number): Device[] {
    return this.#devices().filter(
      (device) => device.live.page?.id === pageId && !this.#silent(device, now),
    );
  }

  #silent(device: Device, now: number): boolean {
    return now - this.#lastHeard(device) >= silenceLimit;
  }

  #lastHeard({ socket, live }: Device): number {
    const pinged = this.#ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
    return Math.max(live.heardAt, pinged);
  }

  #devices(): Device[] {
    return this.#ctx.getWebSockets().flatMap((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const device = this.#device(socket);
      return device ? [device] : [];
    });
  }

  #device(socket: WebSocket): Device | null {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    return attachment?.live ? { socket, attachment, live: attachment.live } : null;
  }

  #keep({ socket, attachment, live }: Device): void {
    socket.serializeAttachment({ ...attachment, live });
  }

  #pointsToday(now: number): number {
    const today = utcDay(now);
    const unsaved = this.#devices()
      .filter(({ live }) => live.day === today)
      .reduce((sum, { live }) => sum + live.unsavedPoints, 0);
    return this.#storedPoints(today) + unsaved;
  }

  #storedPoints(day: string): number {
    if (this.#stored?.day !== day) {
      const [row] = this.#ctx.storage.sql
        .exec<{ points: number }>("SELECT points FROM live_points WHERE day = ?", day)
        .toArray();
      this.#stored = { day, points: row?.points ?? 0 };
    }
    return this.#stored.points;
  }

  #savePoints(live: LiveConnection, now: number): void {
    const today = utcDay(now);
    if (live.unsavedPoints > 0 && live.day === today) {
      const stored = this.#storedPoints(today);
      const { sql } = this.#ctx.storage;
      sql.exec(
        `INSERT INTO live_points (day, points) VALUES (?, ?)
         ON CONFLICT (day) DO UPDATE SET points = points + excluded.points`,
        today,
        live.unsavedPoints,
      );
      sql.exec("DELETE FROM live_points WHERE day < ?", today);
      this.#stored = { day: today, points: stored + live.unsavedPoints };
    }
    live.day = today;
    live.unsavedPoints = 0;
  }
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function send(socket: WebSocket, message: HouseholdMessageInit): void {
  try {
    socket.send(toBinary(HouseholdMessageSchema, create(HouseholdMessageSchema, { message })));
  } catch {}
}
