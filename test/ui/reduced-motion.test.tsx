import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { StatusArea } from "../../src/app/components/StatusArea";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("StatusArea reducedMotion", () => {
  test("with reducedMotion, spinner is static across ticks", async () => {
    const setup = await testRender(
      <StatusArea loading error={undefined} stale={false} reducedMotion width={40} />,
      {
        width: 40,
        height: 5,
      },
    );
    try {
      await setup.flush();
      const first = setup.captureCharFrame();
      expect(first).toContain("syncing");
      expect(first).toContain("|");
      await sleep(350);
      await setup.flush();
      const second = setup.captureCharFrame();
      expect(second).toContain("syncing");
      expect(second).toContain("|");
      expect(second).toBe(first);
      await sleep(300);
      await setup.flush();
      const third = setup.captureCharFrame();
      expect(third).toBe(first);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("without reducedMotion, spinner animates", async () => {
    const setup = await testRender(
      <StatusArea loading error={undefined} stale={false} width={40} />,
      {
        width: 40,
        height: 5,
      },
    );
    try {
      await setup.flush();
      const first = setup.captureCharFrame();
      expect(first).toContain("syncing");
      let changed: string | null = null;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        await sleep(40);
        await setup.flush().catch(() => undefined);
        const frame = setup.captureCharFrame();
        if (frame !== first) {
          changed = frame;
          break;
        }
      }
      expect(changed).not.toBeNull();
      expect(changed).toContain("syncing");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("reducedMotion=false renders the animated spinner", async () => {
    const setup = await testRender(
      <StatusArea loading error={undefined} stale={false} reducedMotion={false} width={40} />,
      { width: 40, height: 5 },
    );
    try {
      await setup.flush();
      const first = setup.captureCharFrame();
      let changed: string | null = null;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        await sleep(40);
        await setup.flush().catch(() => undefined);
        const frame = setup.captureCharFrame();
        if (frame !== first) {
          changed = frame;
          break;
        }
      }
      expect(changed).not.toBeNull();
    } finally {
      await setup.renderer.destroy();
    }
  });
});
