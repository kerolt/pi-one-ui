import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelLabelSource } from "../app/config/shell.ts";
import {
  buildCacheReadLabel,
  buildCacheWriteLabel,
  buildContextLabel,
  buildCostLabel,
  buildTokenLabel,
  formatProviderLabel,
  getUsageTotals,
  invalidateUsageTotalsCache,
} from "../shared/format.ts";
import { emptyGitStatus } from "./git-data.ts";
import type { GitStatusSummary } from "./git-data.ts";
import type { PackageVersionResult } from "./package-data.ts";
import type { RuntimeInfo } from "./runtime-data.ts";
import type { FooterTelemetry } from "./telemetry.ts";

export type FooterState = GitStatusSummary & {
  modelLabel: string;
  modelId: string;
  modelName: string;
  providerLabel: string;
  contextLabel: string;
  tokenLabel: string;
  cacheReadLabel: string;
  cacheWriteLabel: string;
  costLabel: string;
  subscription: boolean;
  autoCompaction: boolean;
  runtime?: RuntimeInfo;
  packageVersion?: PackageVersionResult;
  sessionStartEpoch?: number;
};

export function createInitialState(gitDefaults: GitStatusSummary): FooterState {
  return {
    modelLabel: "no-model",
    modelId: "",
    modelName: "",
    providerLabel: "Unknown",
    contextLabel: "--",
    tokenLabel: "↑0 ↓0",
    cacheReadLabel: "",
    cacheWriteLabel: "",
    costLabel: "$0.000",
    subscription: false,
    autoCompaction: false,
    runtime: undefined,
    packageVersion: undefined,
    sessionStartEpoch: Date.now(),
    ...gitDefaults,
  };
}

export function modelLabelFor(
  state: Pick<FooterState, "modelId" | "modelName">,
  source: ModelLabelSource,
): string {
  return source === "name"
    ? state.modelName || state.modelId || "no-model"
    : state.modelId || "no-model";
}

export type SessionStateSynchronizer = (
  state: FooterState,
  ctx: ExtensionContext,
  cacheHitIcon: string,
  telemetry: FooterTelemetry,
) => void;

export type SessionStateServiceContext = {
  readonly getCacheHitIcon: () => string;
  readonly resolveTelemetry: (ctx: ExtensionContext) => FooterTelemetry;
  readonly syncState: SessionStateSynchronizer;
};

/**
 * Owns the shared Footer state lifecycle used by the runtime and surfaces.
 */
export class SessionStateService {
  readonly state: FooterState;
  private readonly context: SessionStateServiceContext;

  /**
   * Creates a session state service with neutral Git defaults.
   *
   * @param context Runtime selectors for icons and optional telemetry.
   */
  constructor(context: SessionStateServiceContext) {
    this.context = context;
    this.state = createInitialState(emptyGitStatus());
  }

  /**
   * Resets session-scoped state and invalidates cached usage totals.
   */
  startSession(): void {
    this.state.sessionStartEpoch = Date.now();
    invalidateUsageTotalsCache();
  }

  /**
   * Invalidates cached usage totals before a fresh state synchronization.
   */
  invalidateUsageCache(): void {
    invalidateUsageTotalsCache();
  }

  /**
   * Synchronizes model, context, usage, cost, and telemetry fields.
   *
   * @param ctx Active Pi extension context.
   */
  sync(ctx: ExtensionContext): void {
    this.context.syncState(
      this.state,
      ctx,
      this.context.getCacheHitIcon(),
      this.context.resolveTelemetry(ctx),
    );
  }
}

/**
 * Synchronizes a Footer state snapshot with the active Pi context.
 *
 * @param state Mutable Footer state snapshot.
 * @param ctx Active Pi extension context.
 * @param cacheHitIcon Cache-hit icon used by the token formatter.
 * @param telemetry Optional telemetry values.
 */
export function syncState(
  state: FooterState,
  ctx: ExtensionContext,
  cacheHitIcon: string,
  telemetry: FooterTelemetry = {},
): void {
  const totals = getUsageTotals(ctx);
  const m = ctx.model;
  state.modelId = m?.id ?? "";
  state.modelName = m?.name ?? "";
  // Retained as a compatibility snapshot only; production surfaces format from raw fields.
  state.modelLabel = modelLabelFor(state, "id");
  state.providerLabel = formatProviderLabel(ctx.model?.provider);
  state.contextLabel = buildContextLabel(ctx);
  state.tokenLabel = buildTokenLabel(totals, cacheHitIcon);
  state.cacheReadLabel = buildCacheReadLabel(totals.cacheRead);
  state.cacheWriteLabel = buildCacheWriteLabel(totals.cacheWrite);
  state.costLabel = buildCostLabel(totals);
  state.subscription = telemetry.subscription === true;
  state.autoCompaction = telemetry.autoCompaction === true;
}
