import type { MessageInitShape } from "@bufbuild/protobuf";
import { liveLimitLiftsAt, pointsPerSecond } from "@foyer/shared";
import type {
  DeviceMessageSchema,
  HouseholdMessage,
} from "@foyer/shared/gen/foyer/sync/v1/sync_pb";

/** Someone else on the device's page, and where they last pointed on it, in points from its
 *  top-left corner, or null before they point and while the day's limit is reached. */
export type OnPage = { memberId: string; position: { x: number; y: number } | null };

/** What the device knows of the live lane. */
export type LiveState = {
  /** The page the device is on, or null. */
  pageId: string | null;
  /** The other members on the page, each once, as the household last said. */
  here: OnPage[];
  /** Whether the household's limit for positions is reached for the day, until midnight UTC. */
  limited: boolean;
};

/** The shortest time between two positions the device sends. */
export const pointInterval = 1000 / pointsPerSecond;

type DeviceMessageInit = MessageInitShape<typeof DeviceMessageSchema>["message"];

/** Tells the household which page the device is on and where it's pointing, and keeps what the
 *  household says about who else is there. The device is on its page only while connected and in
 *  the foreground. It sends positions only while someone else is there, at most
 *  `pointInterval` apart, and none while the day's limit is reached. */
export class LiveLane {
  readonly #send: (message: DeviceMessageInit) => void;
  readonly #listeners = new Set<() => void>();
  #pageId: string | null = null;
  #active = true;
  #connected = false;
  #here: OnPage[] = [];
  #limitLiftsAt = 0;
  #lastPointAt = Number.NEGATIVE_INFINITY;
  #waiting: { x: number; y: number } | null = null;
  #pointTimer: ReturnType<typeof setTimeout> | undefined;
  #liftTimer: ReturnType<typeof setTimeout> | undefined;
  #state: LiveState;

  /** `send` sends a message on the device's sync connection. */
  constructor(send: (message: DeviceMessageInit) => void) {
    this.#send = send;
    this.#state = this.#currentState();
  }

  /** What the device knows now. The same object until something changes. */
  readonly getState = (): LiveState => this.#state;

  /** Calls a listener whenever the state changes, until the returned function is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Puts the device on a page, leaving the one it was on. */
  enter(pageId: string): void {
    if (pageId === this.#pageId) return;
    this.#pageId = pageId;
    this.#forgetPage();
    if (this.#isOnPage()) this.#send({ case: "enter", value: { pageId } });
    this.#changed();
  }

  /** Takes the device off its page. */
  leave(): void {
    if (this.#pageId === null) return;
    const wasOnPage = this.#isOnPage();
    this.#pageId = null;
    this.#forgetPage();
    if (wasOnPage) this.#send({ case: "leave", value: {} });
    this.#changed();
  }

  /** Follows whether the app is in the foreground: going to the background leaves the page, and
   *  coming back enters it again. */
  setActive(active: boolean): void {
    if (active === this.#active) return;
    const wasOnPage = this.#isOnPage();
    this.#active = active;
    if (wasOnPage) {
      this.#forgetPage();
      this.#send({ case: "leave", value: {} });
    } else if (this.#isOnPage() && this.#pageId !== null) {
      this.#send({ case: "enter", value: { pageId: this.#pageId } });
    }
    this.#changed();
  }

  /** Says where the device is pointing on its page, in points from its top-left corner, when
   *  someone else is there. A position that comes sooner than `pointInterval` after the last one
   *  sent waits until then, replaced by any that come after it. */
  point(x: number, y: number): void {
    if (!this.#canPoint()) return;
    const wait = this.#lastPointAt + pointInterval - Date.now();
    if (wait <= 0) {
      this.#sendPoint(x, y);
      return;
    }
    this.#waiting = { x, y };
    this.#pointTimer ??= setTimeout(() => {
      this.#pointTimer = undefined;
      const waiting = this.#waiting;
      this.#waiting = null;
      if (waiting && this.#canPoint()) this.#sendPoint(waiting.x, waiting.y);
    }, wait);
  }

  /** Enters the device's page again once its connection is open. */
  connected(): void {
    this.#connected = true;
    this.#liftLimitLater();
    if (this.#isOnPage() && this.#pageId !== null) {
      this.#send({ case: "enter", value: { pageId: this.#pageId } });
    }
    this.#changed();
  }

  /** Forgets who else is on the page once the connection closes. */
  disconnected(): void {
    this.#connected = false;
    this.#forgetPage();
    clearTimeout(this.#liftTimer);
    this.#changed();
  }

  /** Keeps what the household says on the live lane. Returns whether the message was one. */
  receive(message: HouseholdMessage["message"]): boolean {
    switch (message.case) {
      case "here":
        if (message.value.pageId !== this.#pageId || !this.#isOnPage()) return true;
        this.#here = message.value.members.map(({ memberId, position }) => ({
          memberId,
          position: position && !this.#isLimited() ? { x: position.x, y: position.y } : null,
        }));
        break;
      case "pointed": {
        const { memberId, x, y } = message.value;
        this.#limitLiftsAt = 0;
        this.#here = this.#here.map((each) =>
          each.memberId === memberId ? { memberId, position: { x, y } } : each,
        );
        break;
      }
      case "liveLimit":
        this.#limitLiftsAt = liveLimitLiftsAt(Date.now());
        this.#waiting = null;
        this.#here = this.#here.map(({ memberId }) => ({ memberId, position: null }));
        this.#liftLimitLater();
        break;
      default:
        return false;
    }
    this.#changed();
    return true;
  }

  #isOnPage(): boolean {
    return this.#pageId !== null && this.#active && this.#connected;
  }

  #canPoint(): boolean {
    return this.#isOnPage() && this.#here.length > 0 && !this.#isLimited();
  }

  #isLimited(): boolean {
    return Date.now() < this.#limitLiftsAt;
  }

  #liftLimitLater(): void {
    clearTimeout(this.#liftTimer);
    if (this.#isLimited()) {
      this.#liftTimer = setTimeout(() => this.#changed(), this.#limitLiftsAt - Date.now());
    }
  }

  #sendPoint(x: number, y: number): void {
    this.#lastPointAt = Date.now();
    this.#send({ case: "point", value: { x, y } });
  }

  #forgetPage(): void {
    this.#here = [];
    this.#waiting = null;
    clearTimeout(this.#pointTimer);
    this.#pointTimer = undefined;
  }

  #changed(): void {
    this.#state = this.#currentState();
    for (const listener of this.#listeners) listener();
  }

  #currentState(): LiveState {
    return { pageId: this.#pageId, here: this.#here, limited: this.#isLimited() };
  }
}
