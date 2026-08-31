import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { installFlushDockedBash } from "../../extensions/features/flush-docked-bash.ts";

test("handleBashCommand 结束后立刻 flush pending bash", async () => {
  const proto = InteractiveMode.prototype as any;
  const real = proto.handleBashCommand;
  proto.handleBashCommand = async function (this: any) {
    this.ran = true;
  };
  try {
    installFlushDockedBash();
    const ctx = {
      ran: false,
      flushed: 0,
      flushPendingBashComponents() {
        this.flushed++;
      },
    };
    await proto.handleBashCommand.call(ctx);
    expect(ctx.ran).toBe(true);
    expect(ctx.flushed).toBe(1);
  } finally {
    proto.handleBashCommand = real;
  }
});
