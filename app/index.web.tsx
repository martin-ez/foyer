// Expo's setup includes the loader for split bundles, which the import of the app below needs.
import "expo";
import { LoadSkiaWeb } from "react-native-skia/lib/module/web";

// Skia draws with CanvasKit on the web, which must load before any screen imports Skia.
LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(() => import("./src/start"));
