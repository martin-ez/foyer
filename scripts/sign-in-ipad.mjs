// Signs a real iPad in to the local backend, which it can't reach at localhost: signs in without
// Google here, at localhost, and shows the iPad's one-time code as a QR code. The iPad's camera
// opens it in the development build as foyer://dev/sign-in?code=…, which works for a minute.
//
//   pnpm sign-in-ipad [email]
import qrcode from "qrcode-terminal";

const backend = "http://localhost:8787";
const email = process.argv[2] ?? "you@example.com";

let returned;
try {
  returned = await fetch(`${backend}/auth/dev?email=${encodeURIComponent(email)}&app=ipad`, {
    redirect: "manual",
  });
} catch {
  fail(`The local backend doesn't answer at ${backend}. Start it first.`);
}
if (returned.status === 404) fail("The local backend doesn't let people sign in without Google.");
const answer = new URL(returned.headers.get("Location") ?? "foyer://signed-in");
const code = answer.searchParams.get("code");
if (!code) fail(`${email} can't sign in: ${answer.searchParams.get("error") ?? "no code"}.`);

const link = `foyer://dev/sign-in?code=${encodeURIComponent(code)}`;
qrcode.generate(link, { small: true }, (drawn) => {
  console.log(drawn);
  console.log(`Scan this with the iPad's camera within a minute to sign in as ${email}.`);
});

function fail(message) {
  console.error(message);
  console.error("docs/development.md explains how to record stroke fixtures on a real iPad.");
  process.exit(1);
}
