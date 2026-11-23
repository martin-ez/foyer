import type { Stroke } from "@foyer/shared/gen/foyer/ink/v1/ink_pb";
import type { HouseholdSync } from "../sync/household-sync";

/** The web app has no Apple Pencil, so there is no view over the page to write with. */
export function PagePencil(_: {
  pageId: string;
  strokes: readonly Stroke[];
  sync: HouseholdSync;
  onErasing: (strokeIds: ReadonlySet<string>) => void;
}) {
  return null;
}

/** The web app has no Apple Pencil, so there are no tools for it. */
export function InkBar() {
  return null;
}
