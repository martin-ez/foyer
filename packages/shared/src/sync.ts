/** The backend's address for sync connections, which are WebSockets. */
export const syncPath = "/sync";

/** The code the household closes a sync connection with when it carries no session, or one that
 *  has ended. The device stops reconnecting until someone signs in. */
export const signedOutCloseCode = 4401;
