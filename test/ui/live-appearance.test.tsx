import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { useTerminalAppearance } from "../../src/app/hooks/useTerminalAppearance";
import type { TerminalAppearance } from "../../src/theme/detect";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Probe({
  appearancePromise,
  followPalette,
}: {
  appearancePromise: Promise<TerminalAppearance>;
  followPalette: boolean;
}) {
  const appearance = useTerminalAppearance(appearancePromise, followPalette);
  return <text>{`ink:${appearance.ink} bg:${appearance.background ?? "null"}`}</text>;
}

type Setup = Awaited<ReturnType<typeof testRender>>;

async function settledFrame(setup: Setup): Promise<string> {
  for (let i = 0; i < 20; i++) {
    try {
      await setup.flush();
      return setup.captureCharFrame();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("OutputBusy")) throw error;
      await sleep(15);
    }
  }
  throw new Error("frame never settled");
}

async function waitFor(setup: Setup, predicate: (frame: string) => boolean): Promise<string> {
  const deadline = Date.now() + 3000;
  let frame = "";
  while (Date.now() < deadline) {
    frame = await settledFrame(setup);
    if (predicate(frame)) return frame;
    await sleep(15);
  }
  throw new Error(`timed out; last frame:\n${frame}`);
}

describe("live terminal appearance", () => {
  test("follows palette changes when ink is auto", async () => {
    const boot = Promise.resolve<TerminalAppearance>({ ink: "dark", background: "#101418" });
    const setup = await testRender(<Probe appearancePromise={boot} followPalette />, {
      width: 30,
      height: 3,
    });
    try {
      await waitFor(setup, (f) => f.includes("bg:#101418"));
      setup.renderer.emit("palette", { defaultBackground: "#f4f6fb" });
      const light = await waitFor(setup, (f) => f.includes("ink:light"));
      expect(light).toContain("bg:#f4f6fb");
      setup.renderer.emit("palette", {});
      await sleep(50);
      expect(await settledFrame(setup)).toContain("ink:light bg:#f4f6fb");
      setup.renderer.emit("palette", { defaultBackground: "#0b0d10" });
      const dark = await waitFor(setup, (f) => f.includes("ink:dark"));
      expect(dark).toContain("bg:#0b0d10");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("a late boot detection does not clobber a newer live palette", async () => {
    let resolveBoot: (value: TerminalAppearance) => void = () => undefined;
    const boot = new Promise<TerminalAppearance>((resolve) => {
      resolveBoot = resolve;
    });
    const setup = await testRender(<Probe appearancePromise={boot} followPalette />, {
      width: 30,
      height: 3,
    });
    try {
      await settledFrame(setup);
      setup.renderer.emit("palette", { defaultBackground: "#f4f6fb" });
      await waitFor(setup, (f) => f.includes("ink:light"));
      resolveBoot({ ink: "dark", background: "#101418" });
      await sleep(50);
      expect(await settledFrame(setup)).toContain("bg:#f4f6fb");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("ignores palette changes when ink is pinned", async () => {
    const boot = Promise.resolve<TerminalAppearance>({ ink: "dark", background: null });
    const setup = await testRender(<Probe appearancePromise={boot} followPalette={false} />, {
      width: 30,
      height: 3,
    });
    try {
      await waitFor(setup, (f) => f.includes("ink:dark"));
      expect(setup.renderer.listenerCount("palette")).toBe(0);
      setup.renderer.emit("palette", { defaultBackground: "#f4f6fb" });
      await sleep(50);
      expect(await settledFrame(setup)).toContain("ink:dark bg:null");
    } finally {
      await setup.renderer.destroy();
    }
  });
});
