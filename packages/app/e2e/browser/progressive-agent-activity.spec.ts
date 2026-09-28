import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("folds completed thinking and exploration with desktop and compact detail access", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ toolCallDetailLevel: "detailed", autoExpandReasoning: false }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "progressive-activity-",
    title: "Progressive activity fixture",
    model: "ten-second-stream",
  });

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Inspect, edit, and verify the stream.");
    await agent.client.waitForFinish(agent.agentId, 60_000);

    const group = page.getByTestId("activity-group").first();
    await expect(group).toBeVisible({ timeout: 30_000 });
    await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("activity-collapsed-desktop.png") });

    await group.getByRole("button").first().click();
    await expect.poll(() => group.getByTestId("tool-call-badge").count()).toBeGreaterThanOrEqual(3);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("activity-expanded-desktop.png") });

    await group.getByRole("button").first().click();
    await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(group).toBeVisible();
    await group.getByRole("button").first().click();
    const sheet = page.getByTestId("tool-call-group-sheet");
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.getByTestId("tool-call-badge").count()).toBeGreaterThanOrEqual(3);
    await expect(sheet).toBeInViewport({ ratio: 0.5, timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("activity-expanded-compact.png") });
  } finally {
    await agent.cleanup();
  }
});
