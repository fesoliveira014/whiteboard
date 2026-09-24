import { EventEmitter } from "node:events";

import { expect, it, vi } from "vitest";

import { openUrlInBrowser } from "./store-auth";

it("opens Windows login URLs without interpreting shell metacharacters", async () => {
  const child = new EventEmitter();
  const unref = vi.fn<() => void>();

  const spawn = vi.fn<
    NonNullable<NonNullable<Parameters<typeof openUrlInBrowser>[1]>["spawn"]>
  >(() => ({ on: child.on.bind(child), unref }));

  const url = "https://example.com/device?code=one&next=two%20words";
  await openUrlInBrowser(url, { platform: "win32", spawn });

  expect(spawn).toHaveBeenCalledWith(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", url],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  expect(unref).toHaveBeenCalledOnce();
  expect(() =>
    child.emit("error", new Error("no registered browser")),
  ).not.toThrow();
});
