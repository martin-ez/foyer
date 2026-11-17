/** Copies text to the clipboard. Fails when the browser doesn't allow it. */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
