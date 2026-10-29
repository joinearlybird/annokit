/**
 * Pending-list mutations that must feel instant on device but stay honest
 * when the server disagrees.
 *
 * Kept out of the React components so the optimistic/revert semantics are
 * unit-testable without rendering the RN tree (the same reason payload.ts
 * exists separately from the composer).
 */
import { seg } from "./url";

import type { ServerAnnotation } from "./types";

/** The `setPending` shape React's `useState` gives us. */
export type PendingUpdater = (
  update: (prev: ServerAnnotation[]) => ServerAnnotation[],
) => void;

/** Just the transport surface this module needs (keeps tests dependency-free). */
export interface DeleteCapableTransport {
  del(path: string): Promise<boolean>;
}

/** The protocol route for removing one annotation (AnnoKit Protocol v1). */
export function deleteAnnotationPath(annotationId: string): string {
  return `/annotations/${seg(annotationId)}`;
}

/**
 * `DELETE /annotations/:aid` with an optimistic local removal: the row and
 * its marker disappear immediately, and are restored at their original
 * index if the server call fails (or the app is offline). Resolves true
 * when the deletion stuck.
 */
export async function deleteAnnotation(
  transport: DeleteCapableTransport,
  annotationId: string,
  setPending: PendingUpdater,
): Promise<boolean> {
  let removed: ServerAnnotation | null = null;
  let removedIndex = -1;

  setPending((prev) => {
    const index = prev.findIndex((a) => a.id === annotationId);
    if (index === -1) return prev;
    removed = prev[index];
    removedIndex = index;
    return [...prev.slice(0, index), ...prev.slice(index + 1)];
  });

  const ok = await transport.del(deleteAnnotationPath(annotationId));
  if (ok) return true;

  // Revert: put it back where it was, unless something else re-added it.
  const restore = removed as ServerAnnotation | null;
  if (restore) {
    setPending((prev) => {
      if (prev.some((a) => a.id === annotationId)) return prev;
      const at = Math.min(Math.max(removedIndex, 0), prev.length);
      return [...prev.slice(0, at), restore, ...prev.slice(at)];
    });
  }
  return false;
}
