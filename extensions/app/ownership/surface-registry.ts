export const SURFACE_OWNERSHIP = {
  header: "header",
  context: "context",
  workingLine: "working-line",
  editor: "editor",
  footer: "footer",
  overlay: "overlay",
  input: "overlay",
} as const;

export type SurfaceId = keyof typeof SURFACE_OWNERSHIP;
export type SurfaceOwner = (typeof SURFACE_OWNERSHIP)[SurfaceId];

type Claim = {
  owner: SurfaceOwner;
  token: object;
};

/**
 * Tracks ownership of host UI seams. A surface can be claimed once and its
 * release callback is safe to call repeatedly or after another owner wins.
 */
export class SurfaceRegistry {
  private readonly claims = new Map<SurfaceId, Claim>();

  /**
   * Claims one surface for a runtime token.
   *
   * @returns A release function that only removes this token's claim.
   */
  claim(surface: SurfaceId, token: object): () => void {
    const owner = SURFACE_OWNERSHIP[surface];
    const current = this.claims.get(surface);
    if (current && current.token !== token) {
      throw new Error(
        `UI surface ${surface} is already owned by ${current.owner}`,
      );
    }
    this.claims.set(surface, { owner, token });
    return () => {
      if (this.claims.get(surface)?.token === token)
        this.claims.delete(surface);
    };
  }

  /**
   * Returns the canonical owner assigned to a claimed surface.
   */
  ownerOf(surface: SurfaceId): SurfaceOwner | undefined {
    return this.claims.get(surface)?.owner;
  }

  /**
   * Reports whether a runtime token currently claims the surface.
   */
  isClaimed(surface: SurfaceId): boolean {
    return this.claims.has(surface);
  }

  /**
   * Releases all claims, normally during runtime disposal.
   */
  clear(): void {
    this.claims.clear();
  }
}
