import { defineConfig } from "vitest/config";

const skiaWithoutReactNative = "react-native-skia/lib/commonjs/headless";

export default defineConfig({
  resolve: {
    alias: [{ find: /^react-native-skia$/, replacement: skiaWithoutReactNative }],
  },
  test: {
    setupFiles: ["./test/load-skia.ts"],
  },
});
