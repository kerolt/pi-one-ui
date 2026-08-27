import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  InteractionMetricsTracker,
  TURN_SUMMARY_ENTRY_TYPE,
  type MetricsUpdateResult,
} from "./interaction-summary.ts";
import {
  AgentDurationClock,
  snapshotWorkingLineHighStyle,
  WorkingLineController,
} from "./working-line.ts";
import type { PolishedTuiConfig } from "../../app/config/shell.ts";
import type { SessionLifecycle } from "../../app/runtime/session-lifecycle.ts";

export type WorkingLineMessage = Parameters<
  InteractionMetricsTracker["messageUpdate"]
>[0];
export type WorkingLineMessageEnd = Parameters<
  InteractionMetricsTracker["messageEnd"]
>[0];

export type WorkingLineSurfaceContext = {
  readonly pi: ExtensionAPI;
  readonly getConfig: () => PolishedTuiConfig;
  readonly getTheme: () => Theme;
  readonly sessionLifecycle: SessionLifecycle;
  readonly refresh: () => void;
  readonly onAgentActiveChanged: (active: boolean) => void;
};

/**
 * Owns WorkingLine lifecycle, interaction metrics, timing, and summary writes.
 */
export class WorkingLineSurfaceController {
  private readonly context: WorkingLineSurfaceContext;
  private readonly durationClock = new AgentDurationClock();
  private readonly metrics = new InteractionMetricsTracker();
  private readonly workingLine: WorkingLineController;
  private agentRunActive = false;

  /**
   * Creates a WorkingLine controller with one timing and metrics owner.
   *
   * @param context Shared runtime services consumed by WorkingLine.
   */
  constructor(context: WorkingLineSurfaceContext) {
    this.context = context;
    this.workingLine = new WorkingLineController(
      context.getConfig,
      context.getTheme,
      this.durationClock,
      Math.random,
      Date.now,
      () => this.metrics.currentThought(),
    );
  }

  /**
   * Starts a new WorkingLine session and clears interaction state.
   *
   * @param ctx Active Pi extension context.
   */
  startSession(ctx: ExtensionContext): void {
    this.metrics.shutdown();
    this.agentRunActive = false;
    this.durationClock.reset();
    this.context.onAgentActiveChanged(false);
    this.workingLine.startSession(ctx);
  }

  /**
   * Starts an agent run and installs the current working indicator.
   *
   * @param ctx Active Pi extension context.
   */
  agentStart(ctx: ExtensionContext): void {
    const { interactionStarted } = this.metrics.agentStart();
    this.agentRunActive = true;
    if (interactionStarted) this.durationClock.start();
    this.context.onAgentActiveChanged(true);
    this.workingLine.startAgent(ctx);
    this.context.refresh();
  }

  /**
   * Starts a new turn response and selects its stable working message.
   *
   * @param ctx Active Pi extension context.
   */
  turnStart(ctx: ExtensionContext): void {
    this.metrics.turnStart();
    this.workingLine.startTurn(ctx);
  }

  /**
   * Records an assistant message update and refreshes visible metrics.
   *
   * @param message Latest assistant message snapshot.
   * @param event Optional provider streaming event.
   * @param ctx Active Pi extension context.
   * @returns Metrics changes produced by the update.
   */
  messageUpdate(
    message: WorkingLineMessage,
    event: Parameters<InteractionMetricsTracker["messageUpdate"]>[1],
    ctx: ExtensionContext,
  ): MetricsUpdateResult {
    const result = this.metrics.messageUpdate(message, event);
    if (result.usageChanged || result.thoughtChanged) {
      this.workingLine.updateMetrics(
        result.displayTokens,
        this.metrics.currentThought(),
        ctx,
      );
    }
    return result;
  }

  /**
   * Finalizes one assistant message and updates WorkingLine metrics.
   *
   * @param message Final assistant message.
   * @param ctx Active Pi extension context.
   * @returns Message acceptance and display metrics.
   */
  messageEnd(message: WorkingLineMessageEnd, ctx: ExtensionContext) {
    const result = this.metrics.messageEnd(message);
    if (result.status === "accepted") {
      this.workingLine.updateMetrics(
        result.displayTokens,
        this.metrics.currentThought(),
        ctx,
      );
    }
    return result;
  }

  /**
   * Ends an agent run while retaining settled interaction metrics.
   *
   * @param ctx Active Pi extension context.
   */
  agentEnd(ctx: ExtensionContext): void {
    const displayTokens = this.metrics.currentDisplayTokens();
    this.metrics.agentEnd();
    this.agentRunActive = false;
    this.context.onAgentActiveChanged(false);
    this.workingLine.finishAgent(ctx);
    this.workingLine.updateMetrics(
      displayTokens,
      this.metrics.currentThought(),
      ctx,
    );
  }

  /**
   * Starts and finishes one tool activity in the WorkingLine.
   *
   * @param toolCallId Pi tool call identifier.
   * @param toolName Display name of the tool.
   * @param ctx Active Pi extension context.
   */
  toolStart(toolCallId: string, toolName: string, ctx: ExtensionContext): void {
    this.workingLine.startTool(toolCallId, toolName, ctx);
  }

  /**
   * Finishes one tool activity in the WorkingLine.
   *
   * @param toolCallId Pi tool call identifier.
   * @param ctx Active Pi extension context.
   */
  toolEnd(toolCallId: string, ctx: ExtensionContext): void {
    this.workingLine.finishTool(toolCallId, ctx);
  }

  /**
   * Settles completed runs and writes one canonical summary entry.
   *
   * @param ctx Active Pi extension context.
   */
  agentSettled(ctx: ExtensionContext, writeSummary = true): void {
    const settled = this.metrics.settle(ctx.isIdle());
    if (!settled) return;
    this.agentRunActive = settled.nextStartedAt !== undefined;
    if (settled.nextStartedAt === undefined) this.durationClock.finish();
    else this.durationClock.start(settled.nextStartedAt);
    this.context.onAgentActiveChanged(this.agentRunActive);
    this.workingLine.settle(settled.nextTokens, settled.nextThought, ctx);
    const config = this.context.getConfig().components.workingLine;
    if (!writeSummary || !config.enabled || !config.turnSummary) return;
    try {
      this.context.pi.appendEntry(TURN_SUMMARY_ENTRY_TYPE, {
        version: 3,
        ...settled.summary,
        stylePrefix: snapshotWorkingLineHighStyle(
          ctx.ui.theme,
          config,
          this.context.getConfig().colors,
        ),
      });
    } catch {
      // Summary persistence failure must not break settlement cleanup.
    }
  }

  /**
   * Reconciles WorkingLine configuration changes from the settings panel.
   *
   * @param ctx Active Pi extension context.
   * @returns Whether the host working row accepted the change.
   */
  reconcile(ctx: ExtensionContext) {
    return this.workingLine.reconcile(ctx);
  }

  /**
   * Disposes the WorkingLine and clears all interaction-local state.
   *
   * @param ctx Active Pi extension context.
   */
  dispose(ctx: ExtensionContext): void {
    this.workingLine.dispose(ctx);
    this.metrics.shutdown();
    this.durationClock.reset();
    this.agentRunActive = false;
    this.context.onAgentActiveChanged(false);
  }

  /**
   * Returns the shared duration clock used by Editor selectors.
   *
   * @returns Session-local duration clock.
   */
  duration(): AgentDurationClock {
    return this.durationClock;
  }

  /**
   * Reports whether the agent run is currently active.
   *
   * @returns Whether WorkingLine owns an active agent run.
   */
  isAgentActive(): boolean {
    return this.agentRunActive;
  }

  /**
   * Returns the currently active interaction thought snapshot.
   *
   * @returns Current thought metrics.
   */
  currentThought() {
    return this.metrics.currentThought();
  }
}
