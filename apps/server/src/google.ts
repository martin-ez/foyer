import { env } from "cloudflare:workers";
import type { GoogleAccount } from "./household";

/** The Google OAuth client that people sign in with. */
export type GoogleClient = { id: string; secret: string };

/** A Google account that signed in, and whether Google has verified its email. */
export type SignedInGoogleAccount = GoogleAccount & { emailVerified: boolean };

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const issuers = ["https://accounts.google.com", "accounts.google.com"];

/** The client set by `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or null, logging why, when
 *  either is missing. */
export function googleClient(): GoogleClient | null {
  const id = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    console.error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET aren't both set, so nobody can sign in with Google.",
    );
    return null;
  }
  return { id, secret };
}

/** The address that asks Google to sign someone in, sharing only their name and email, and to send
 *  them back to `redirectUri` with a code. `codeChallenge` is the SHA-256 hash of the verifier that
 *  must come with the code, written in base64url. */
export function googleSignInAddress(
  client: GoogleClient,
  request: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const address = new URL(authorizationEndpoint);
  address.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: request.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return address.toString();
}

/** Exchanges the code that Google sent back for the account that signed in. Google answers the
 *  Worker directly, so its ID token is trusted without checking its signature. Throws when Google
 *  refuses the code or answers with a token that isn't for this client. */
export async function googleAccountFor(
  client: GoogleClient,
  answer: { code: string; codeVerifier: string; redirectUri: string },
): Promise<SignedInGoogleAccount> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: answer.code,
      code_verifier: answer.codeVerifier,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: answer.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google refused the code, with ${response.status}: ${await response.text()}`);
  }
  const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
  if (typeof idToken !== "string") throw new Error("Google's answer has no ID token");

  const claims = readIdToken(idToken);
  if (claims.aud !== client.id) throw new Error("Google's ID token is for another client");
  if (typeof claims.iss !== "string" || !issuers.includes(claims.iss)) {
    throw new Error("Google's ID token comes from another issuer");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error("Google's ID token has expired");
  }
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") {
    throw new Error("Google's ID token has no account id or email");
  }
  return {
    subject: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true,
    name: firstName(claims) ?? claims.email.split("@")[0] ?? claims.email,
  };
}

function readIdToken(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Google's ID token has no claims");
  const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}

function firstName(claims: Record<string, unknown>): string | undefined {
  for (const name of [claims.given_name, claims.name]) {
    if (typeof name === "string" && name.trim() !== "") return name.trim();
  }
  return undefined;
}
