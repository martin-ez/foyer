/** How long typing has to pause before a block's text is sent. */
export const typingPause = 1000;

/** Holds what someone types in blocks until it's sent: when typing pauses, when they leave the
 *  block, or when everything is flushed. Each block's latest text is sent once, not every key. */
export class BlockDrafts {
  readonly #send: (blockId: string, markdown: string) => void;
  readonly #unsent = new Map<string, { markdown: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(send: (blockId: string, markdown: string) => void) {
    this.#send = send;
  }

  /** Keeps a block's new text, to send once typing pauses. */
  type(blockId: string, markdown: string): void {
    clearTimeout(this.#unsent.get(blockId)?.timer);
    const timer = setTimeout(() => this.leave(blockId), typingPause);
    this.#unsent.set(blockId, { markdown, timer });
  }

  /** Sends a block's text now, if any is unsent. */
  leave(blockId: string): void {
    const unsent = this.#unsent.get(blockId);
    if (!unsent) return;
    clearTimeout(unsent.timer);
    this.#unsent.delete(blockId);
    this.#send(blockId, unsent.markdown);
  }

  /** Forgets a block's unsent text, as when it's deleted. */
  drop(blockId: string): void {
    clearTimeout(this.#unsent.get(blockId)?.timer);
    this.#unsent.delete(blockId);
  }

  /** Sends every block's unsent text now. */
  flush(): void {
    for (const blockId of [...this.#unsent.keys()]) this.leave(blockId);
  }
}
