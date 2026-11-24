import { followDevLink } from "../shell/dev-links";

/** Opens the route a link into the iPad app names. In development builds, the links checks and
 *  recording use, such as `foyer://dev/add-strokes?fixture=…`, are followed where the app is. */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (__DEV__ && followDevLink(path)) return initial ? "/" : null;
  } catch (error) {
    console.error(`Following ${path} failed: ${error}`);
    return initial ? "/" : null;
  }
  return path;
}
