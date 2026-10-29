/**
 * Test doubles for the two host surfaces the package touches that do not
 * exist in a node test process:
 *
 *  - `__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers[*].rendererConfig
 *     .getInspectorDataForViewAtPoint` — the inspector entry point.
 *  - `require("react-native")` (NativeModules.SourceCode.scriptURL /
 *     Platform.OS) — how the adapter derives the Metro origin.
 *
 * The react-native stub is installed straight into node's require cache
 * because inspector.ts reaches the module through a runtime `require`, not
 * an import (deliberately: it must not hard-depend on RN internals).
 */

import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

type InspectorFn = (
  inspectedView: unknown,
  x: number,
  y: number,
  callback: (viewData: unknown) => boolean | void,
) => void;

const HOOK_KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__";

/** Install a DevTools hook exposing `fn`; returns an uninstaller. */
export function installInspectorHook(fn: InspectorFn): () => void {
  const g = globalThis as Record<string, unknown>;
  const previous = g[HOOK_KEY];
  g[HOOK_KEY] = {
    renderers: new Map([[1, { rendererConfig: { getInspectorDataForViewAtPoint: fn } }]]),
  };
  return () => {
    if (previous === undefined) delete g[HOOK_KEY];
    else g[HOOK_KEY] = previous;
  };
}

/** Install a hook that hands the callback a fixed viewData payload. */
export function installInspectorPayload(viewData: unknown): () => void {
  return installInspectorHook((_view, _x, _y, cb) => {
    cb(viewData);
  });
}

/** Remove any DevTools hook (simulates web/prod where none exists). */
export function removeInspectorHook(): () => void {
  const g = globalThis as Record<string, unknown>;
  const previous = g[HOOK_KEY];
  delete g[HOOK_KEY];
  return () => {
    if (previous !== undefined) g[HOOK_KEY] = previous;
  };
}

/** Put `exports` in node's require cache under `specifier`; returns an uninstaller. */
function stubModule(specifier: string, exports: unknown): () => void {
  const filename = nodeRequire.resolve(specifier);
  const cache = nodeRequire.cache as Record<string, unknown>;
  const previous = cache[filename];
  cache[filename] = { id: filename, filename, loaded: true, children: [], paths: [], exports };
  return () => {
    if (previous === undefined) delete cache[filename];
    else cache[filename] = previous;
  };
}

/**
 * Stub `require("react-native-view-shot")` (an optional peer that does not
 * load in a node process — it is ESM). Callers must re-import
 * src/screenshot.ts afterwards: it resolves the module once, at load.
 */
export function installViewShotStub(
  captureScreen: unknown,
  releaseCapture?: unknown,
): () => void {
  return stubModule("react-native-view-shot", { captureScreen, releaseCapture });
}

/**
 * Stub `require("react-native")` with the bits the adapter reads.
 * Pass `scriptURL: null` to simulate a runtime with no bundle URL.
 */
export function installReactNativeStub(options?: {
  scriptURL?: string | null;
  platformOS?: string;
}): () => void {
  const scriptURL = options?.scriptURL === undefined ? null : options.scriptURL;
  return stubModule("react-native", {
    Platform: { OS: options?.platformOS ?? "ios" },
    NativeModules: {
      SourceCode: scriptURL === null ? {} : { scriptURL },
    },
  });
}
