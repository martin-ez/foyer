import { formatRepeat, type MonthlyOn, weekdays } from "@foyer/shared";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Checkbox } from "./checkbox";
import {
  chooseFrequency,
  chooseFrom,
  describeMonthly,
  describeRepeat,
  type Frequency,
  monthlyOptions,
  type RepeatChoice,
  weekdayName,
} from "./repeats";

const frequencies: { frequency: Frequency | null; label: string; unit: string }[] = [
  { frequency: null, label: "Never", unit: "" },
  { frequency: "daily", label: "Daily", unit: "days" },
  { frequency: "weekly", label: "Weekly", unit: "weeks" },
  { frequency: "monthly", label: "Monthly", unit: "months" },
  { frequency: "yearly", label: "Yearly", unit: "years" },
];

/** Chooses how a task repeats: never, or every few days, weeks, months or years, on chosen days
 *  of the week or of the month, with its next date following the schedule or counted from when
 *  it's done. Choices start from `date`: its weekday, its day of the month, or its day and month. */
export function RepeatPicker({
  choice,
  date,
  onChange,
}: {
  choice: RepeatChoice;
  /** The task's date, or today when it has none. */
  date: string;
  onChange: (choice: RepeatChoice) => void;
}) {
  const { rule, from } = choice;
  const unit = frequencies.find(({ frequency }) => frequency === rule?.frequency)?.unit ?? "";
  const setRule = (changed: NonNullable<RepeatChoice["rule"]>) => onChange({ from, rule: changed });

  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Repeats">
      <Text style={styles.line}>Repeats</Text>
      <View style={styles.row}>
        {frequencies.map(({ frequency, label }) => (
          <Choice
            key={label}
            label={label}
            chosen={(rule?.frequency ?? null) === frequency}
            onChoose={() => onChange(chooseFrequency(choice, frequency, date))}
          />
        ))}
      </View>
      {rule ? (
        <>
          <View style={styles.row}>
            <Text style={styles.line}>Every</Text>
            <TextInput
              style={styles.input}
              value={rule.interval > 0 ? String(rule.interval) : ""}
              onChangeText={(text) => {
                const digits = text.replace(/\D/g, "").slice(0, 3);
                setRule({ ...rule, interval: digits === "" ? 0 : Number(digits) });
              }}
              inputMode="numeric"
              accessibilityLabel={`Repeat every how many ${unit}`}
            />
            <Text style={styles.line}>{unit}</Text>
          </View>
          <View style={styles.row}>
            <Choice
              label="On its schedule"
              chosen={from === "schedule"}
              onChoose={() => onChange(chooseFrom(choice, "schedule", date))}
            />
            <Choice
              label="After it's done"
              chosen={from === "completion"}
              onChoose={() => onChange(chooseFrom(choice, "completion", date))}
            />
          </View>
          {from === "schedule" && rule.frequency === "weekly" ? (
            <View style={styles.row}>
              {weekdays.map((day) => {
                const on = rule.days.includes(day);
                return (
                  <Checkbox
                    key={day}
                    checked={on}
                    label={weekdayName(day)}
                    onChange={(checked) =>
                      setRule({
                        ...rule,
                        days: checked ? [...rule.days, day] : rule.days.filter((d) => d !== day),
                      })
                    }
                  >
                    <Text style={styles.line}>{weekdayName(day).slice(0, 3)}</Text>
                  </Checkbox>
                );
              })}
            </View>
          ) : null}
          {from === "schedule" && rule.frequency === "monthly" ? (
            <View style={styles.row}>
              {optionsWith(rule.on, monthlyOptions(date)).map((on) => (
                <Choice
                  key={JSON.stringify(on)}
                  label={describeMonthly(on)}
                  chosen={rule.on !== null && sameMonthly(rule.on, on)}
                  onChoose={() => setRule({ ...rule, on })}
                />
              ))}
            </View>
          ) : null}
          {rule.interval > 0 ? <Text style={styles.line}>{describeRepeat(choice)}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function optionsWith(chosen: MonthlyOn | null, options: MonthlyOn[]): MonthlyOn[] {
  if (!chosen || options.some((on) => sameMonthly(on, chosen))) return options;
  return [chosen, ...options];
}

function sameMonthly(a: MonthlyOn, b: MonthlyOn): boolean {
  const asRule = (on: MonthlyOn) => formatRepeat({ frequency: "monthly", interval: 1, on });
  return asRule(a) === asRule(b);
}

function Choice({
  label,
  chosen,
  onChoose,
}: {
  label: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={chosen}
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onChoose}
      style={[styles.choice, chosen ? styles.chosen : null]}
    >
      <Text style={[styles.choiceText, chosen ? styles.chosenText : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  line: { fontSize: 12, color: "#6b6459" },
  input: {
    width: 48,
    borderColor: "#d8d2c4",
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  choice: {
    borderColor: "#d8d2c4",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chosen: { backgroundColor: "#6b6459", borderColor: "#6b6459" },
  choiceText: { fontSize: 12, color: "#2b2620" },
  chosenText: { color: "#fffdf8" },
});
