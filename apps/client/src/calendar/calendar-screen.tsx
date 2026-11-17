import { useState } from "react";
import { Button, StyleSheet, View } from "react-native";
import { addDays, localToday } from "../page/calendar-date";
import { describePage, type OpenPage } from "../page/open-page";
import { PageView } from "../page/page-view";
import { TitleBar } from "../shell/bars";
import { useHousehold } from "../shell/household";

/** The household's calendar, open on today's day page, with ways to move between days. */
export function CalendarScreen() {
  const { state } = useHousehold();
  const [day, setDay] = useState(localToday);
  const page: OpenPage = { kind: "day", date: day };

  return (
    <View style={styles.fill}>
      <TitleBar title={describePage(page, state)}>
        <Button title="Previous day" onPress={() => setDay(addDays(day, -1))} />
        <Button title="Today" onPress={() => setDay(localToday())} />
        <Button title="Next day" onPress={() => setDay(addDays(day, 1))} />
      </TitleBar>
      <PageView page={page} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
