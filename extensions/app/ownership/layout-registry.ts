export const LAYOUT_OWNERSHIP = {
  header: "header",
  context: "context",
  workingLine: "working-line",
  editor: "editor",
  footer: "footer",
  overlay: "overlay",
  input: "overlay",
} as const;

export type LayoutId = keyof typeof LAYOUT_OWNERSHIP;
export type LayoutOwner = (typeof LAYOUT_OWNERSHIP)[LayoutId];

type Claim = {
  owner: LayoutOwner;
  token: object;
};

/**
 * Tracks ownership of host UI seams. A layout can be claimed once and its
 * release callback is safe to call repeatedly or after another owner wins.
 */
export class LayoutRegistry {
  private readonly claims = new Map<LayoutId, Claim>();

  /**
   * Claims one layout for a runtime token.
   *
   * @returns A release function that only removes this token's claim.
   */
  claim(layout: LayoutId, token: object): () => void {
    const owner = LAYOUT_OWNERSHIP[layout];
    const current = this.claims.get(layout);
    if (current && current.token !== token) {
      throw new Error(
        `UI layout ${layout} is already owned by ${current.owner}`,
      );
    }
    this.claims.set(layout, { owner, token });
    return () => {
      if (this.claims.get(layout)?.token === token) this.claims.delete(layout);
    };
  }

  /**
   * Returns the canonical owner assigned to a claimed layout.
   */
  ownerOf(layout: LayoutId): LayoutOwner | undefined {
    return this.claims.get(layout)?.owner;
  }

  /**
   * Reports whether a runtime token currently claims the layout.
   */
  isClaimed(layout: LayoutId): boolean {
    return this.claims.has(layout);
  }

  /**
   * Releases all claims, normally during runtime disposal.
   */
  clear(): void {
    this.claims.clear();
  }
}
