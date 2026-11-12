This is Foyer's Expo app, built as a native iPad app (a development build, not Expo Go) and as a web app. Pages are drawn with React Native Skia v3, published as `react-native-skia`.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

The same applies to Skia: v3 differs from `@shopify/react-native-skia`. Its docs are in https://github.com/wcandillon/react-native-skia/tree/main/apps/docs/docs.

## Commands

Run these from the repository root:

```bash
pnpm --filter @foyer/client exec expo install <package>  # ALWAYS use instead of pnpm add — resolves SDK-compatible versions
pnpm --filter @foyer/client web                          # start the web app
pnpm --filter @foyer/client ios                          # build and run on an iPad simulator
pnpm check                                            # type checks, lint and formatting
pnpm format                                           # fix formatting and import order
```

Run `pnpm check` before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Skia on the web

- `index.web.tsx` loads CanvasKit before the app starts, so any screen can import Skia directly.
- `postinstall` copies `canvaskit.wasm` into `public/`. It is generated: never commit it.

## Rules

- `ios/` is generated (Continuous Native Generation). Never create or edit it by hand — configure native behavior in `app.json` and config plugins.
- After adding a library with native code, rebuild the development build with `pnpm --filter @foyer/client ios`.
- Prefer recommended Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md
