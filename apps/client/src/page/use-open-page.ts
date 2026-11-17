import { useState } from "react";
import { addDays, localToday } from "./calendar-date";
import type { OpenPage } from "./open-page";

/** Which page is open, starting with today's day page, and ways to move between days and to open
 *  a space's first page. Moving between days leaves a space's page for the day shown before it. */
export function useOpenPage() {
  const [day, setDay] = useState(localToday);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const showDay = (date: string) => {
    setSpaceId(null);
    setDay(date);
  };

  const page: OpenPage =
    spaceId === null ? { kind: "day", date: day } : { kind: "space", spaceId, number: 1 };
  return {
    page,
    previousDay: () => showDay(addDays(day, -1)),
    nextDay: () => showDay(addDays(day, 1)),
    today: () => showDay(localToday()),
    openSpace: (id: string) => setSpaceId(id),
  };
}
