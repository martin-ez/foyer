import { limitItemDescription, limitItemTitle, sameEventTime } from "@foyer/shared";
import type { Item } from "@foyer/shared/gen/foyer/item/v1/item_pb";
import { CalendarState, type Space } from "@foyer/shared/gen/foyer/space/v1/space_pb";
import { useState } from "react";
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useHousehold } from "../shell/household";
import { Checkbox } from "../tasks/checkbox";
import { EventNesting } from "../tasks/task-nesting";
import {
  describeEventTime,
  draftOf,
  type EventTimeDraft,
  newEventDraft,
  timeFromDraft,
  timeOf,
  upcomingEvents,
} from "./events";

/** The events that haven't ended, soonest first, with ways to add one and to open one to change,
 *  move or delete it: `open` is the event that's open, or "new" for a new one. Events go only in
 *  spaces that have a Google calendar. */
export function EventsPanel({
  open,
  onOpen: setOpen,
}: {
  open: string | "new" | null;
  onOpen: (open: string | "new" | null) => void;
}) {
  const { state } = useHousehold();
  const { height } = useWindowDimensions();
  const withCalendar = spacesWithCalendar(state.spaces);
  const openEvent = open === null || open === "new" ? undefined : state.items.get(open);

  if (open === "new" || openEvent) {
    return (
      <EventEditor
        key={openEvent?.id ?? "new"}
        event={openEvent}
        spaces={withCalendar}
        onOpenTask={setOpen}
        onClose={() => setOpen(null)}
      />
    );
  }
  const upcoming = upcomingEvents(state.items.values());
  const spaceName = (spaceId: string) =>
    state.spaces.find(({ id }) => id === spaceId)?.name ?? "a space";
  return (
    <View style={[styles.panel, { maxHeight: height * 0.3 }]}>
      <View style={styles.row}>
        <Text style={styles.heading}>Upcoming events</Text>
        <Button
          title="New event"
          disabled={withCalendar.length === 0}
          onPress={() => setOpen("new")}
        />
      </View>
      {withCalendar.length === 0 ? (
        <Text style={styles.line}>Events go in spaces with a Google calendar.</Text>
      ) : null}
      <ScrollView accessibilityRole="list" accessibilityLabel="Upcoming events">
        {upcoming.length === 0 ? <Text style={styles.line}>Nothing coming up.</Text> : null}
        {upcoming.map((event) => {
          const time = timeOf(event);
          const from = event.createdBy === "" ? ", added in Google Calendar" : "";
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={`Event: ${event.title}`}
              onPress={() => setOpen(event.id)}
              style={styles.event}
            >
              <Text style={styles.title}>{event.title}</Text>
              <Text style={styles.line}>
                {time ? describeEventTime(time) : ""} · {spaceName(event.spaceId)}
                {from}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The spaces events can go in: those with a Google calendar. */
export function spacesWithCalendar(spaces: readonly Space[]): Space[] {
  return spaces.filter(({ calendarState }) => calendarState !== CalendarState.NONE);
}

type EventEdits = { title?: string; description?: string; time?: EventTimeDraft };

/** A new event's fields, or an event's, to save, with ways to put the event under a task, move it
 *  to another of `spaces` and delete it. */
export function EventEditor({
  event,
  spaces,
  onOpenTask,
  onClose,
}: {
  event: Item | undefined;
  /** The spaces it can go in, which have a Google calendar. */
  spaces: Space[];
  onOpenTask: (itemId: string) => void;
  onClose: () => void;
}) {
  const { state, sync } = useHousehold();
  const { height } = useWindowDimensions();
  const [edits, setEdits] = useState<EventEdits>({});
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const time = event ? timeOf(event) : null;
  const title = edits.title ?? event?.title ?? "";
  const description = edits.description ?? event?.description ?? "";
  const draft = edits.time ?? (time ? draftOf(time) : newEventDraft());
  const chosen = timeFromDraft(draft);
  const problem = sync.titleProblem(title) ?? ("problem" in chosen ? chosen.problem : null);
  const edit = (more: EventEdits) => setEdits((before) => ({ ...before, ...more }));
  const editTime = (more: Partial<EventTimeDraft>) => edit({ time: { ...draft, ...more } });

  const save = () => {
    if (problem || "problem" in chosen) return;
    if (!event) {
      sync.addEvent(spaceId, { title, description, time: chosen });
      onClose();
      return;
    }
    if (edits.title !== undefined && title.trim() !== event.title) {
      sync.setTitle(event.id, title);
    }
    if (edits.description !== undefined && description !== event.description) {
      sync.setDescription(event.id, description);
    }
    if (edits.time !== undefined && (!time || !sameEventTime(time, chosen))) {
      sync.setEventTime(event.id, chosen);
    }
    setEdits({});
  };
  const others = spaces.filter(({ id }) => id !== event?.spaceId);
  const spaceOf = event && state.spaces.find(({ id }) => id === event.spaceId);

  return (
    <View
      style={[styles.panel, { maxHeight: height * 0.45 }]}
      accessibilityLabel={event ? `Event: ${event.title}` : "New event"}
    >
      <ScrollView contentContainerStyle={styles.form}>
        {event?.createdBy === "" ? <Text style={styles.line}>Added in Google Calendar</Text> : null}
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => edit({ title: limitItemTitle(text) })}
          placeholder="Title"
          accessibilityLabel="Title"
        />
        <TextInput
          style={[styles.input, styles.description]}
          value={description}
          onChangeText={(text) => edit({ description: limitItemDescription(text) })}
          placeholder="Description"
          accessibilityLabel="Description"
          multiline
        />
        <Checkbox
          checked={draft.allDay}
          label="All day"
          onChange={(allDay) => editTime({ allDay })}
        >
          <Text style={styles.line}>All day</Text>
        </Checkbox>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={draft.startsOn}
            onChangeText={(startsOn) => editTime({ startsOn })}
            placeholder="First day, as in 2026-11-17"
            accessibilityLabel="First day"
          />
          {draft.allDay ? null : (
            <TextInput
              style={styles.input}
              value={draft.startTime}
              onChangeText={(startTime) => editTime({ startTime })}
              placeholder="Starts at, as in 19:00"
              accessibilityLabel="Starts at"
            />
          )}
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={draft.endsOn}
            onChangeText={(endsOn) => editTime({ endsOn })}
            placeholder="Last day, as in 2026-11-17"
            accessibilityLabel="Last day"
          />
          {draft.allDay ? null : (
            <TextInput
              style={styles.input}
              value={draft.endTime}
              onChangeText={(endTime) => editTime({ endTime })}
              placeholder="Ends at, as in 20:00"
              accessibilityLabel="Ends at"
            />
          )}
        </View>
        {event ? (
          <Text style={styles.line}>In {spaceOf?.name ?? "a space"}</Text>
        ) : (
          <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Space">
            {spaces.map((space) => (
              <Checkbox
                key={space.id}
                checked={space.id === spaceId}
                label={`In ${space.name}`}
                onChange={() => setSpaceId(space.id)}
              >
                <Text style={styles.line}>{space.name}</Text>
              </Checkbox>
            ))}
          </View>
        )}
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.row}>
          <Button
            title={event ? "Save" : "Add event"}
            disabled={problem !== null || (event !== undefined && Object.keys(edits).length === 0)}
            onPress={save}
          />
          <Button title="Close" onPress={onClose} />
        </View>
        {event ? (
          <EventNesting event={event} state={state} sync={sync} onOpenTask={onOpenTask} />
        ) : null}
        {event && others.length > 0 ? (
          <>
            <Text style={styles.line}>Move to</Text>
            <View style={styles.row}>
              {others.map((space) => (
                <Button
                  key={space.id}
                  title={space.name}
                  accessibilityLabel={`Move to ${space.name}`}
                  onPress={() => sync.moveEvent(event.id, space.id)}
                />
              ))}
            </View>
          </>
        ) : null}
        {event ? (
          <Button
            title="Delete event"
            onPress={() => {
              sync.deleteEvent(event.id);
              onClose();
            }}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#fffdf8",
    borderBottomColor: "#d8d2c4",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  form: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  heading: { fontSize: 14, fontWeight: "600", flexGrow: 1 },
  event: { paddingVertical: 4 },
  title: { fontSize: 14, color: "#3d3830" },
  line: { fontSize: 12, color: "#6b6459" },
  input: { borderColor: "#d8d2c4", borderWidth: 1, paddingHorizontal: 6, paddingVertical: 4 },
  description: { minHeight: 60, textAlignVertical: "top" },
  problem: { fontSize: 12, color: "#9a3b2e" },
});
