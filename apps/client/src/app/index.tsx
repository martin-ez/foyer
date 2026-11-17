import { Redirect, useLocalSearchParams } from "expo-router";

/** Opens the Calendar, keeping what the address says, such as why sign-in didn't work. */
export default function Home() {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname: "/calendar", params }} />;
}
