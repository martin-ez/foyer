import { Redirect, useLocalSearchParams } from "expo-router";
import { firstScreenHref, readFirstScreen } from "../shell/first-screen";

/** Opens the first screen chosen on this device, keeping what the address says, such as why
 *  sign-in didn't work. */
export default function Home() {
  const params = useLocalSearchParams();
  const first = firstScreenHref(readFirstScreen());
  return <Redirect href={{ pathname: first.pathname, params: { ...params, ...first.params } }} />;
}
