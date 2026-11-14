/** A page's width divided by its height. */
export const placeholderPageAspectRatio = 3 / 4;

/** The largest page that fits in the given space, or an empty size when there is no room. */
export function fitPage(maxWidth: number, maxHeight: number) {
  if (maxWidth <= 0 || maxHeight <= 0) return { width: 0, height: 0 };
  const width = Math.min(maxWidth, maxHeight * placeholderPageAspectRatio);
  return { width, height: width / placeholderPageAspectRatio };
}
