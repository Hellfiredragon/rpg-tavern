import { describe, test, expect, beforeEach } from "bun:test";
import {
  EventBus,
  createPipelineRun,
  getPipelineRun,
  cancelPipelineRun,
  removePipelineRun,
  type PipelineEvent,
} from "./events";

describe("EventBus", () => {
  test("emit delivers events to subscribers", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    const event: PipelineEvent = { type: "step_start", role: "narrator" };
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  test("subscribe returns an unsubscribe function", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit({ type: "step_start", role: "narrator" });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit({ type: "step_start", role: "character" });
    expect(received).toHaveLength(1);
  });

  test("multiple subscribers receive the same event", () => {
    const bus = new EventBus();
    const a: PipelineEvent[] = [];
    const b: PipelineEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    const event: PipelineEvent = { type: "pipeline_cancelled" };
    bus.emit(event);

    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
  });

  test("bad listener does not break other listeners", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];

    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe((e) => received.push(e));

    bus.emit({ type: "pipeline_cancelled" });
    expect(received).toHaveLength(1);
  });

  test("emit with no subscribers does not throw", () => {
    const bus = new EventBus();
    expect(() => bus.emit({ type: "pipeline_cancelled" })).not.toThrow();
  });

  test("delivers multiple events in order", () => {
    const bus = new EventBus();
    const received: PipelineEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ type: "step_start", role: "narrator" });
    bus.emit({ type: "step_token", role: "narrator", token: "hello" });
    bus.emit({ type: "step_start", role: "character" });

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe("step_start");
    expect(received[1].type).toBe("step_token");
    expect(received[2].type).toBe("step_start");
  });

  test("unsubscribing one listener does not affect others", () => {
    const bus = new EventBus();
    const a: PipelineEvent[] = [];
    const b: PipelineEvent[] = [];
    const unsubA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    unsubA();
    bus.emit({ type: "pipeline_cancelled" });

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  test("double unsubscribe is safe", () => {
    const bus = new EventBus();
    const unsub = bus.subscribe(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

describe("pipeline registry", () => {
  // Clean up active pipelines between tests since the registry is a global Map
  beforeEach(() => {
    // Remove any leftover runs from prior tests
    for (const id of ["chat-1", "chat-2", "chat-3", "cancel-test", "remove-test", "dup-test"]) {
      removePipelineRun(id);
    }
  });

  test("createPipelineRun creates a run with bus and abort", () => {
    const run = createPipelineRun("chat-1");
    expect(run.bus).toBeInstanceOf(EventBus);
    expect(run.abort).toBeInstanceOf(AbortController);
    expect(run.abort.signal.aborted).toBe(false);
  });

  test("createPipelineRun throws if pipeline already active", () => {
    createPipelineRun("dup-test");
    expect(() => createPipelineRun("dup-test")).toThrow("Pipeline already active");
  });

  test("getPipelineRun returns the run", () => {
    const run = createPipelineRun("chat-2");
    expect(getPipelineRun("chat-2")).toBe(run);
  });

  test("getPipelineRun returns undefined for unknown chatId", () => {
    expect(getPipelineRun("nonexistent")).toBeUndefined();
  });

  test("cancelPipelineRun aborts the controller and returns true", () => {
    const run = createPipelineRun("cancel-test");
    expect(run.abort.signal.aborted).toBe(false);

    const result = cancelPipelineRun("cancel-test");
    expect(result).toBe(true);
    expect(run.abort.signal.aborted).toBe(true);
  });

  test("cancelPipelineRun returns false for unknown chatId", () => {
    expect(cancelPipelineRun("nonexistent")).toBe(false);
  });

  test("removePipelineRun cleans up the run", () => {
    createPipelineRun("remove-test");
    expect(getPipelineRun("remove-test")).toBeDefined();

    removePipelineRun("remove-test");
    expect(getPipelineRun("remove-test")).toBeUndefined();
  });

  test("removePipelineRun for unknown chatId does not throw", () => {
    expect(() => removePipelineRun("nonexistent")).not.toThrow();
  });

  test("after removal, same chatId can be reused", () => {
    createPipelineRun("chat-3");
    removePipelineRun("chat-3");
    const run = createPipelineRun("chat-3");
    expect(run.bus).toBeInstanceOf(EventBus);
  });

  test("cancel then remove then create is a valid lifecycle", () => {
    const run = createPipelineRun("chat-1");
    cancelPipelineRun("chat-1");
    expect(run.abort.signal.aborted).toBe(true);

    removePipelineRun("chat-1");
    expect(getPipelineRun("chat-1")).toBeUndefined();

    const newRun = createPipelineRun("chat-1");
    expect(newRun.abort.signal.aborted).toBe(false);
  });
});
