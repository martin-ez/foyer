import { create } from "@bufbuild/protobuf";
import { MemberSchema } from "@foyer/shared/gen/foyer/member/v1/member_pb";
import { describe, expect, it } from "vitest";
import { edgeSpacing, initialOf, markerColour, markerSize, markersOn } from "../src/page/presence";

const sam = "019a8f4e-5c00-7000-8000-000000000002";
const kim = "019a8f4e-5c00-7000-8000-000000000003";
const ali = "019a8f4e-5c00-7000-8000-000000000004";
const members = [
  create(MemberSchema, { id: sam, name: "Sam" }),
  create(MemberSchema, { id: kim, name: "kim" }),
  create(MemberSchema, { id: ali, name: "Ali" }),
];

describe("markersOn", () => {
  it("shows each member where they last pointed, with their initial and colour", () => {
    expect(markersOn([{ memberId: sam, position: { x: 120, y: 340.5 } }], members)).toEqual([
      {
        memberId: sam,
        name: "Sam",
        initial: "S",
        colour: markerColour(sam),
        at: { x: 120, y: 340.5 },
        pointing: true,
      },
    ]);
  });

  it("lines up those who haven't pointed along the page's top edge, apart", () => {
    const markers = markersOn(
      [
        { memberId: ali, position: null },
        { memberId: kim, position: { x: 300, y: 400 } },
        { memberId: sam, position: null },
      ],
      members,
    );

    expect(markers.map(({ name, at, pointing }) => ({ name, at, pointing }))).toEqual([
      { name: "Sam", at: { x: edgeSpacing, y: edgeSpacing }, pointing: false },
      { name: "kim", at: { x: 300, y: 400 }, pointing: true },
      { name: "Ali", at: { x: edgeSpacing * 2 + markerSize, y: edgeSpacing }, pointing: false },
    ]);
  });

  it("keeps the same order whatever order the household lists members in", () => {
    const here = [
      { memberId: kim, position: null },
      { memberId: sam, position: null },
    ];

    expect(markersOn(here, members)).toEqual(markersOn([...here].reverse(), members));
  });

  it("shows a member the device doesn't know yet with a question mark", () => {
    const stranger = "019a8f4e-5c00-7000-8000-000000000009";

    expect(markersOn([{ memberId: stranger, position: null }], members)).toMatchObject([
      { memberId: stranger, name: "", initial: "?" },
    ]);
  });

  it("shows nobody on a page with nobody else on it", () => {
    expect(markersOn([], members)).toEqual([]);
  });
});

describe("initialOf", () => {
  it("is the name's first letter in capitals", () => {
    expect(initialOf("sam")).toBe("S");
    expect(initialOf("  Ali ")).toBe("A");
  });

  it("keeps an accent typed as a separate mark", () => {
    expect(initialOf("élodie")).toBe("É");
  });

  it("keeps a letter written with two code units whole", () => {
    expect(initialOf("𝒜lex")).toBe("𝒜");
  });

  it("is a question mark for a blank name", () => {
    expect(initialOf("")).toBe("?");
    expect(initialOf("   ")).toBe("?");
  });
});

describe("markerColour", () => {
  const ids = Array.from(
    { length: 200 },
    (_, index) => `019a8f4e-5c00-7000-8000-${String(index).padStart(12, "0")}`,
  );

  it("is the same colour for the same member every time", () => {
    expect(markerColour(sam)).toBe(markerColour(sam));
    expect(markerColour(sam)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives members ids that differ by one character different colours", () => {
    expect(new Set(ids.map(markerColour)).size).toBeGreaterThan(150);
  });

  it("is dark enough for a white initial to read on it", () => {
    for (const id of ids) expect(contrastWithWhite(markerColour(id))).toBeGreaterThanOrEqual(4.5);
  });
});

function contrastWithWhite(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05);
}
