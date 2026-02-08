import { describe, test, expect, beforeEach } from "bun:test";
import {
  LLMError,
  classifyHTTPError,
  Semaphore,
  initBackends,
  getBackend,
  getSemaphore,
  listBackendIds,
  type BackendConfig,
  type LLMBackend,
  type CompletionRequest,
  type CompletionResponse,
} from "./backends";

describe("LLMError", () => {
  test("has correct name, message, category, and status", () => {
    const err = new LLMError("test error", "auth", 401);
    expect(err.name).toBe("LLMError");
    expect(err.message).toBe("test error");
    expect(err.category).toBe("auth");
    expect(err.status).toBe(401);
  });

  test("is an instance of Error", () => {
    const err = new LLMError("test", "unknown");
    expect(err).toBeInstanceOf(Error);
  });

  test("status is optional", () => {
    const err = new LLMError("network error", "network");
    expect(err.status).toBeUndefined();
  });
});

describe("classifyHTTPError", () => {
  test("maps 401 to auth", () => {
    const err = classifyHTTPError(401, "Unauthorized");
    expect(err.category).toBe("auth");
    expect(err.status).toBe(401);
  });

  test("maps 403 to auth", () => {
    const err = classifyHTTPError(403, "Forbidden");
    expect(err.category).toBe("auth");
    expect(err.status).toBe(403);
  });

  test("maps 429 to rate_limit", () => {
    const err = classifyHTTPError(429, "Too Many Requests");
    expect(err.category).toBe("rate_limit");
    expect(err.status).toBe(429);
  });

  test("maps 500 to server", () => {
    const err = classifyHTTPError(500, "Internal Server Error");
    expect(err.category).toBe("server");
    expect(err.status).toBe(500);
  });

  test("maps 502 to server", () => {
    const err = classifyHTTPError(502, "Bad Gateway");
    expect(err.category).toBe("server");
    expect(err.status).toBe(502);
  });

  test("maps 503 to server", () => {
    const err = classifyHTTPError(503, "Service Unavailable");
    expect(err.category).toBe("server");
    expect(err.status).toBe(503);
  });

  test("maps 400 to unknown", () => {
    const err = classifyHTTPError(400, "Bad Request");
    expect(err.category).toBe("unknown");
    expect(err.status).toBe(400);
  });

  test("maps 404 to unknown", () => {
    const err = classifyHTTPError(404, "Not Found");
    expect(err.category).toBe("unknown");
    expect(err.status).toBe(404);
  });

  test("truncates long body in error message", () => {
    const longBody = "x".repeat(500);
    const err = classifyHTTPError(400, longBody);
    expect(err.message.length).toBeLessThan(longBody.length);
  });
});

describe("Semaphore", () => {
  test("Semaphore(1) allows one, queues second", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    const release1 = await sem.acquire();
    order.push(1);

    // Second acquire should be queued
    let release2Fn: (() => void) | undefined;
    const p2 = sem.acquire().then((r) => { release2Fn = r; order.push(2); });

    // Give a tick for p2 to enter the queue
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([1]);

    release1();
    await p2;
    expect(order).toEqual([1, 2]);
    release2Fn!();
  });

  test("Semaphore(3) allows 3 concurrent acquires", async () => {
    const sem = new Semaphore(3);
    const releases: Array<() => void> = [];

    for (let i = 0; i < 3; i++) {
      releases.push(await sem.acquire());
    }
    expect(releases).toHaveLength(3);

    // Fourth should be queued
    let resolved = false;
    const p4 = sem.acquire().then((r) => { resolved = true; return r; });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);

    releases[0]();
    const release4 = await p4;
    expect(resolved).toBe(true);
    release4();
    releases[1]();
    releases[2]();
  });

  test("releases in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];

    const r1 = await sem.acquire();

    const p2 = sem.acquire().then((r) => { order.push("a"); return r; });
    const p3 = sem.acquire().then((r) => { order.push("b"); return r; });

    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();

    expect(order).toEqual(["a", "b"]);
  });

  test("release after release does not over-count", async () => {
    const sem = new Semaphore(1);
    const r1 = await sem.acquire();
    r1();

    // Should be able to acquire again
    const r2 = await sem.acquire();
    r2();
  });
});

describe("backend registry", () => {
  function mockBackend(config: BackendConfig): LLMBackend {
    return {
      config,
      async complete() { return { content: "mock", finishReason: "stop" }; },
      async *stream() { return { content: "mock", finishReason: "stop" } as CompletionResponse; },
    };
  }

  beforeEach(() => {
    initBackends([], mockBackend);
  });

  test("initBackends + getBackend round-trip", () => {
    const configs: BackendConfig[] = [
      { id: "a", name: "A", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 1 },
      { id: "b", name: "B", type: "koboldcpp", url: "", apiKey: "", model: "", streaming: false, maxConcurrent: 2 },
    ];
    initBackends(configs, mockBackend);

    expect(getBackend("a")).toBeDefined();
    expect(getBackend("a")!.config.name).toBe("A");
    expect(getBackend("b")).toBeDefined();
    expect(getBackend("b")!.config.type).toBe("koboldcpp");
  });

  test("getBackend returns undefined for unknown ID", () => {
    expect(getBackend("nonexistent")).toBeUndefined();
  });

  test("listBackendIds returns all registered IDs", () => {
    const configs: BackendConfig[] = [
      { id: "x", name: "X", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 1 },
      { id: "y", name: "Y", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 1 },
    ];
    initBackends(configs, mockBackend);

    const ids = listBackendIds();
    expect(ids).toContain("x");
    expect(ids).toContain("y");
    expect(ids).toHaveLength(2);
  });

  test("getSemaphore returns the corresponding semaphore", () => {
    const configs: BackendConfig[] = [
      { id: "s", name: "S", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 5 },
    ];
    initBackends(configs, mockBackend);

    const sem = getSemaphore("s");
    expect(sem).toBeDefined();
    expect(sem).toBeInstanceOf(Semaphore);
  });

  test("getSemaphore returns undefined for unknown ID", () => {
    expect(getSemaphore("nonexistent")).toBeUndefined();
  });

  test("initBackends clears previous backends", () => {
    const configs1: BackendConfig[] = [
      { id: "old", name: "Old", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 1 },
    ];
    initBackends(configs1, mockBackend);
    expect(getBackend("old")).toBeDefined();

    initBackends([], mockBackend);
    expect(getBackend("old")).toBeUndefined();
    expect(listBackendIds()).toEqual([]);
  });

  test("initBackends with empty array clears all", () => {
    initBackends([
      { id: "a", name: "A", type: "openai", url: "", apiKey: "", model: "", streaming: true, maxConcurrent: 1 },
    ], mockBackend);
    expect(listBackendIds()).toHaveLength(1);

    initBackends([], mockBackend);
    expect(listBackendIds()).toHaveLength(0);
  });
});
