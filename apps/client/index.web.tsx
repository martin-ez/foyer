import "expo";
import { LoadSkiaWeb } from "react-native-skia/lib/module/web";

/** Starts the web app once CanvasKit, which Skia draws with, has loaded. The app comes in a split
 *  bundle, which only loads because Expo's setup is imported first. */
export async function startWebApp() {
  await LoadSkiaWeb({ locateFile: (file) => `/${file}` });
  await import("./src/register-app");
}

startWebApp();
