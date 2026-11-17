import type { Member } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import type { OnPage } from "../sync/live-lane";
import type { Point } from "./sheet-camera";

/** The width and height of a marker, in points of the page. */
export const markerSize = 24;

/** The space between the page's top-left corner and the first marker waiting at its edge, and
 *  between markers there, in points of the page. */
export const edgeSpacing = 8;

/** Someone else on the page, as a marker: their first-name initial, in their colour, with its
 *  pointed corner at `at`, in points from the page's top-left corner. */
export type Marker = {
  memberId: string;
  name: string;
  initial: string;
  colour: string;
  at: Point;
  /** Whether `at` is where they last pointed, rather than a spot at the page's edge. */
  pointing: boolean;
};

/** The markers of the others on a page, in the order of their member ids. Those who haven't
 *  pointed yet, or whose positions the day's limit holds back, wait in a row along the page's top
 *  edge. */
export function markersOn(here: readonly OnPage[], members: readonly Member[]): Marker[] {
  const names = new Map(members.map(({ id, name }) => [id, name]));
  let waiting = 0;
  return [...here]
    .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    .map(({ memberId, position }) => {
      const name = names.get(memberId) ?? "";
      const at = position ?? {
        x: edgeSpacing + waiting++ * (markerSize + edgeSpacing),
        y: edgeSpacing,
      };
      return {
        memberId,
        name,
        initial: initialOf(name),
        colour: markerColour(memberId),
        at: { x: at.x, y: at.y },
        pointing: position !== null,
      };
    });
}

/** The first letter of a name, in capitals, or "?" for a blank name. */
export function initialOf(name: string): string {
  const [first] = Array.from(name.trim().normalize("NFC"));
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

/** A member's colour, as `#rrggbb`, worked out from their id alone, so every device shows the
 *  same one and nothing is stored. A white initial on it has a contrast of at least 4.5 to 1. */
export function markerColour(memberId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < memberId.length; index++) {
    hash ^= memberId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hue = hash % 360;
  let lightness = 0.45;
  let colour = hsl(hue, 0.65, lightness);
  while (contrastWithWhite(colour) < 4.5) {
    lightness -= 0.01;
    colour = hsl(hue, 0.65, lightness);
  }
  return `#${colour.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    return Math.round((lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [channel(0), channel(8), channel(4)];
}

function contrastWithWhite([red, green, blue]: [number, number, number]): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  return 1.05 / (luminance + 0.05);
}
