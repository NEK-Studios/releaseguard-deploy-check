# RG-EXPO-RN: Expo is declared without react-native

Severity: **warning**

## Reports when

`expo` is listed in `dependencies` or `devDependencies`, and `react-native` is in neither.

## Why it matters

Every Expo SDK release is built for one React Native version. If the manifest does not pin it, the pairing is left to chance.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "expo": "~57.0.0",
    "react": "19.2.0"
  }
}
```

## Fix

Run `npx expo install react-native` so that Expo picks the version that matches your SDK, and keep using `npx expo install --check` and `expo-doctor`.

## Limits and known false alarms

- This rule does not check whether the versions fit together. `expo install --check` does that.
- `peerDependencies` and packages provided by a monorepo root are not seen.

[All rules](README.md)
