/** What a development link asks for: what follows `foyer://dev/`, such as `add-strokes`. */
export type DevLink = "add-strokes" | "sign-in";

type Handler = (params: URLSearchParams) => void;

const handlers = new Map<DevLink, Handler>();
const waiting = new Map<DevLink, URLSearchParams>();
const links: readonly string[] = ["add-strokes", "sign-in"] satisfies DevLink[];

/** Follows a link into the iPad app's development builds, such as
 *  `foyer://dev/add-strokes?fixture=circle-and-scribble`, and says whether it was one. A link that
 *  comes before anything handles it waits for its handler. */
export function followDevLink(address: string): boolean {
  const [path = "", query = ""] = address.replace(/^foyer:\/\//, "").split("?");
  const link = /^\/*dev\/([a-z-]+)\/?$/.exec(path)?.[1];
  if (!link || !links.includes(link)) return false;
  const params = new URLSearchParams(query);
  const handler = handlers.get(link as DevLink);
  if (handler) handler(params);
  else waiting.set(link as DevLink, params);
  return true;
}

/** Handles a development link until the returned function is called, starting with one that came
 *  before. */
export function handleDevLink(link: DevLink, handler: Handler): () => void {
  handlers.set(link, handler);
  const params = waiting.get(link);
  waiting.delete(link);
  if (params) handler(params);
  return () => {
    if (handlers.get(link) === handler) handlers.delete(link);
  };
}
