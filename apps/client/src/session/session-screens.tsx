import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

/** Shown while the app checks who is signed in. */
export function CheckingSession() {
  return (
    <View style={styles.screen}>
      <Text>Checking who's signed in…</Text>
    </View>
  );
}

/** Shown when the app couldn't check who is signed in, with a way to try again. */
export function SessionUnreachable({ problem, onRetry }: { problem: string; onRetry: () => void }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.problem}>{problem}</Text>
      <Button title="Try again" onPress={onRetry} />
    </View>
  );
}

/** Asks the person to sign in, and says why the last attempt didn't work, if it didn't. With
 *  `onSignInWithoutGoogle`, it also offers to sign in as an email typed in, without Google. */
export function SignIn({
  problem,
  onSignIn,
  onSignInWithoutGoogle,
}: {
  problem?: string;
  onSignIn: () => void;
  onSignInWithoutGoogle?: (email: string) => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Foyer</Text>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      <Button title="Sign in with Google" onPress={onSignIn} />
      {onSignInWithoutGoogle ? <SignInWithoutGoogle onSignIn={onSignInWithoutGoogle} /> : null}
    </View>
  );
}

function SignInWithoutGoogle({ onSignIn }: { onSignIn: (email: string) => void }) {
  const [email, setEmail] = useState("you@example.com");
  return (
    <View style={styles.withoutGoogle}>
      <TextInput
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.email}
      />
      <Button title="Sign in without Google" onPress={() => onSignIn(email.trim())} />
    </View>
  );
}

/** Says who is signed in, with a way to sign out. */
export function SignedInAs({ member, onSignOut }: { member: Member; onSignOut: () => void }) {
  return (
    <View style={styles.signedInAs}>
      <Text style={styles.line}>Signed in as {member.name}</Text>
      <Button title="Sign out" onPress={onSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 32 },
  problem: { color: "#9a3b2e", textAlign: "center" },
  withoutGoogle: { flexDirection: "row", alignItems: "center", gap: 8 },
  email: { minWidth: 220, borderWidth: 1, borderColor: "#c9c2b6", padding: 8 },
  signedInAs: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
});
