/**
 * Optional expo-router integration. Loaded lazily so apps without
 * expo-router (or web exports that tree-shake differently) never crash —
 * they just lose route-keyed markers (pathname stays null) and the ability
 * to JUMP to a note left on another screen (the notes list says so instead
 * of offering a jump that would do nothing).
 *
 * Everything here is best-effort by design: a dev overlay that can throw
 * inside someone else's navigator is worse than one that quietly does less.
 */

import { errorCategory } from "./log";

type UsePathname = () => string;
type NavigateFn = (href: string) => void;

interface ExpoRouterModule {
  usePathname?: UsePathname;
  router?: { navigate?: NavigateFn; push?: NavigateFn };
}

let usePathnameImpl: UsePathname | null = null;
let navigateImpl: NavigateFn | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("expo-router") as ExpoRouterModule;
  if (typeof mod.usePathname === "function") usePathnameImpl = mod.usePathname;
  // `navigate` before `push`: jumping to a note is "go to that screen", not
  // "stack another copy of it" — repeated jumps should not build a history
  // the user has to unwind.
  const nav = mod.router?.navigate ?? mod.router?.push;
  if (typeof nav === "function") navigateImpl = nav.bind(mod.router);
} catch {
  usePathnameImpl = null;
  navigateImpl = null;
}

/**
 * Hook: current route pathname, or null when expo-router is unavailable.
 * The impl is fixed at module load, so hook call order is stable.
 */
export function useRoutePathname(): string | null {
  if (!usePathnameImpl) return null;
  try {
    return usePathnameImpl();
  } catch {
    // Rendered outside a router context.
    return null;
  }
}

/** Whether this host can be navigated at all (expo-router present). */
export function routerNavigationAvailable(): boolean {
  return navigateImpl !== null;
}

/**
 * Go to a route. True when the navigation was actually attempted.
 *
 * Fails soft in every direction a dev overlay can be wrong about the host's
 * routing: no router, no path, or a router that throws because the route no
 * longer exists. The caller's job is then to carry on and open the detail
 * anyway — reading the note is the point; landing on its screen is a bonus.
 */
export function navigateToRoute(path: string | null | undefined): boolean {
  if (!navigateImpl || typeof path !== "string" || !path.trim()) return false;
  try {
    navigateImpl(path);
    return true;
  } catch (e) {
    // The route path is the host app's own, not a credential — but the
    // error object can carry anything the router put in it.
    console.warn(`[annokit] navigation to ${path} failed: ${errorCategory(e)}`);
    return false;
  }
}
