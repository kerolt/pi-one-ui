/**
 * Shared recursive traversal for component trees.
 *
 * The implementation covers the children/getMountedRoots/seen traversal used by
 * context rendering, grouping and mouse packet handling.
 *
 * The visitor runs once for every non-array object. Returning `false` stops
 * traversal into that node's children and mounted roots.
 */
export function walkComponentTree(
  root: any,
  visitor: (value: any) => boolean | void,
): void {
  const seen = new Set<any>();
  const visit = (value: any): void => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (visitor(value) === false) return;
    const children = value.children;
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
    try {
      const mounted = value.getMountedRoots?.();
      if (Array.isArray(mounted)) {
        for (const root of mounted) visit(root);
      }
    } catch {
      // A lazy proxy may temporarily have no mounted roots while switching renderers.
    }
  };
  visit(root);
}
