import { useLocalSearchParams } from "expo-router";
import { TasksScreen } from "../../tasks/tasks-screen";

export default function Tasks() {
  const { show } = useLocalSearchParams<{ show?: string }>();
  return <TasksScreen openOnToday={show === "today"} />;
}
