import { handleCall } from "./calls";

export { Household } from "./household";

export default {
  fetch: handleCall,
} satisfies ExportedHandler<Env>;
