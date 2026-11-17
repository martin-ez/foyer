import { useState } from "react";
import { addDays, localToday } from "./calendar-date";
import type { OpenPage } from "./open-page";

/** Which page is open, starting with today's day page, and ways to move between days and to open
 *  one of a space's pages. Moving between days leaves a space's page for the day shown before it. */
export function useOpenPage() {
  const [day, setDay] = useState(localToday);
  const [space, setSpace] = useState<{ spaceId: string; number: number } | null>(null);
  const showDay = (date: string) => {
    setSpace(null);
    setDay(date);
  };

  const page: OpenPage = space === null ? { kind: "day", date: day } : { kind: "space", ...space };
  return {
    page,
    previousDay: () => showDay(addDays(day, -1)),
    nextDay: () => showDay(addDays(day, 1)),
    today: () => showDay(localToday()),
    /** Opens one of a space's pages, numbered from 1. */
    openSpace: (spaceId: string, number: number) => setSpace({ spaceId, number }),
  };
}
