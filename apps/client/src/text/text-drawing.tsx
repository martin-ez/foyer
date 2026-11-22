import type { PageSize } from "@foyer/shared";
import { DashPathEffect, Group, Line, Paragraph } from "react-native-skia";
import type { Point } from "../page/sheet-camera";
import type { LaidOutGroup } from "./text-layout";
import { markerWidth } from "./text-layout";

const cutColour = "#b5432f";

/** The Skia elements of a page's text groups, bottom first, in the page's own points, cut off at
 *  the page's edges. A group that runs past the bottom of the page is marked there. `moved` draws
 *  one group moved by some distance, as while it's dragged. */
export function TextDrawing({
  groups,
  page,
  moved,
}: {
  groups: readonly LaidOutGroup[];
  page: PageSize;
  moved?: { groupId: string; by: Point } | null;
}) {
  return (
    <Group clip={{ x: 0, y: 0, width: page.width, height: page.height }}>
      {groups.map(({ group, height, blocks }) => {
        const by = moved?.groupId === group.id ? moved.by : { x: 0, y: 0 };
        const x = group.x + by.x;
        const y = group.y + by.y;
        return (
          <Group key={group.id}>
            {blocks.map((block) => (
              <Group key={block.id}>
                {block.marker ? (
                  <Paragraph
                    paragraph={block.marker}
                    x={x + block.markerLeft}
                    y={y + block.top}
                    width={markerWidth}
                  />
                ) : null}
                <Paragraph
                  paragraph={block.paragraph}
                  x={x + block.left}
                  y={y + block.top}
                  width={block.width}
                />
              </Group>
            ))}
            {y + height > page.height ? (
              <Line
                p1={{ x, y: page.height - 1.5 }}
                p2={{ x: x + group.width, y: page.height - 1.5 }}
                color={cutColour}
                strokeWidth={3}
                style="stroke"
              >
                <DashPathEffect intervals={[6, 4]} />
              </Line>
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}
