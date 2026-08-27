import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Symbol used to identify factories created by the Editor layout. */
export const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");

/** Symbol used to retain the wrapped third-party editor factory. */
export const ZENTUI_EDITOR_BASE_FACTORY = Symbol.for(
  "pi-zentui.editor-base-factory",
);

/** Symbol used to identify the active Editor layout owner. */
export const ZENTUI_EDITOR_OWNER = Symbol.for("pi-zentui.editor-owner");

export type EditorFactory = NonNullable<
  Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;

export type ZentuiEditorFactory = EditorFactory & {
  [ZENTUI_EDITOR_FACTORY]?: true;
  [ZENTUI_EDITOR_BASE_FACTORY]?: EditorFactory;
  [ZENTUI_EDITOR_OWNER]?: symbol;
};

/**
 * Reports whether a factory was marked as an Editor layout factory.
 *
 * @param factory Candidate host editor factory.
 * @returns Whether the factory carries the Editor layout marker.
 */
export function isZentuiEditorFactory(
  factory: EditorFactory | undefined,
): boolean {
  return Boolean(
    (factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_FACTORY],
  );
}

/**
 * Returns the third-party factory wrapped by an Editor layout factory.
 *
 * @param factory Candidate host editor factory.
 * @returns The retained base factory, when present.
 */
export function getZentuiEditorBaseFactory(
  factory: EditorFactory | undefined,
): EditorFactory | undefined {
  return (factory as ZentuiEditorFactory | undefined)?.[
    ZENTUI_EDITOR_BASE_FACTORY
  ];
}

/**
 * Reports whether a factory belongs to the supplied Editor layout owner.
 *
 * @param factory Candidate host editor factory.
 * @param ownerToken Owner token to compare.
 * @returns Whether the owner marker matches.
 */
export function isOwnedEditorFactory(
  factory: EditorFactory | undefined,
  ownerToken: symbol,
): boolean {
  return (
    (factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_OWNER] ===
    ownerToken
  );
}

/**
 * Marks a factory as owned by the Editor layout.
 *
 * @param factory Factory to mark.
 * @param ownerToken Owner token written to the factory.
 * @returns The marked factory.
 */
export function markEditorFactory<T extends EditorFactory>(
  factory: T,
  ownerToken: symbol,
): T {
  const marked = factory as T & ZentuiEditorFactory;
  marked[ZENTUI_EDITOR_FACTORY] = true;
  marked[ZENTUI_EDITOR_OWNER] = ownerToken;
  return factory;
}

/**
 * Retains a base factory on an Editor wrapper for safe restoration.
 *
 * @param factory Wrapper factory to mark.
 * @param baseFactory Third-party factory wrapped by the layout.
 * @param ownerToken Owner token written to the wrapper.
 * @returns The marked wrapper.
 */
export function markWrappedEditorFactory<T extends EditorFactory>(
  factory: T,
  baseFactory: EditorFactory,
  ownerToken: symbol,
): T {
  const marked = markEditorFactory(factory, ownerToken) as T &
    ZentuiEditorFactory;
  marked[ZENTUI_EDITOR_BASE_FACTORY] = baseFactory;
  return factory;
}
