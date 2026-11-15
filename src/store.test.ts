import { describe, it, expect, beforeEach } from "vitest";
import {
  addTask,
  loadTasks,
  saveTasks,
  loadFilter,
  saveFilter,
  newId,
  subscribe,
} from "./store";

beforeEach(() => {
  localStorage.clear();
});

describe("store persistence seam", () => {
  it("round-trips tasks through localStorage", () => {
    const tasks = [
      { id: "a", title: "one", completed: false, createdAt: 1 },
    ];
    saveTasks(tasks);
    expect(loadTasks()).toEqual(tasks);
  });

  it("returns empty list when nothing stored", () => {
    expect(loadTasks()).toEqual([]);
  });

  it("returns empty list on corrupt storage", () => {
    localStorage.setItem("todo-demo:tasks", "{not json");
    expect(loadTasks()).toEqual([]);
  });

  it("defaults filter to all", () => {
    expect(loadFilter()).toBe("all");
  });

  it("round-trips filter", () => {
    saveFilter("completed");
    expect(loadFilter()).toBe("completed");
  });

  it("rejects invalid filter values", () => {
    localStorage.setItem("todo-demo:filter", "bogus");
    expect(loadFilter()).toBe("all");
  });

  it("newId produces unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });
});

describe("addTask (TOD-1)", () => {
  it("appends a task and persists it", () => {
    const first = addTask("Water the plants");
    const second = addTask("Read one chapter");

    const tasks = loadTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(first);
    expect(tasks[1]).toEqual(second);
    expect(tasks.map((t) => t.title)).toEqual([
      "Water the plants",
      "Read one chapter",
    ]);
  });

  it("creates well-formed tasks: unique id, trimmed title, not completed, timestamp", () => {
    const before = Date.now();
    const a = addTask("  Stretch for five minutes  ");
    const b = addTask("Journal");
    const after = Date.now();
    if (!a || !b) throw new Error("addTask rejected a valid title");

    expect(a.title).toBe("Stretch for five minutes");
    expect(a.completed).toBe(false);
    expect(typeof a.id).toBe("string");
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBeGreaterThanOrEqual(before);
    expect(a.createdAt).toBeLessThanOrEqual(after);
  });

  it("rejects empty and whitespace-only titles: returns null, stores nothing", () => {
    expect(addTask("")).toBeNull();
    expect(addTask("   ")).toBeNull();
    expect(addTask("\t\n ")).toBeNull();
    expect(loadTasks()).toEqual([]);
  });

  it("notifies subscribers when a task is added, not when rejected", () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });

    addTask("Ping");
    expect(calls).toBe(1);
    addTask("   ");
    expect(calls).toBe(1);

    unsubscribe();
    addTask("After unsubscribe");
    expect(calls).toBe(1);
  });
});