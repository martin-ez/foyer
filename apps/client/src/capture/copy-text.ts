import { Share } from "react-native";

/** Offers text to copy: on the iPad, in the share sheet, whose actions include Copy. */
export async function copyText(text: string): Promise<void> {
  await Share.share({ message: text });
}
