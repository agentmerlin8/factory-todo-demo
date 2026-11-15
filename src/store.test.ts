import { describe, it, expect, beforeEach, vi } from "vitest";
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
describe("storage boundary validates entries (round-3 regression)", () => {
  it("drops null entries instead of crashing the render", () => {
    localStorage.setItem("todo-demo:tasks", "[null]");
    expect(loadTasks()).toEqual([]);
  });

  it("drops entries missing required fields", () => {
    localStorage.setItem(
      "todo-demo:tasks",
      JSON.stringify([{ id: "x" }, { title: "no id" }, 42, "str", []]),
    );
    expect(loadTasks()).toEqual([]);
  });

  it("drops entries with wrong field types", () => {
    localStorage.setItem(
      "todo-demo:tasks",
      JSON.stringify([
        { id: 1, title: "a", completed: false, createdAt: 1 },
        { id: "b", title: null, completed: false, createdAt: 1 },
        { id: "c", title: "c", completed: "no", createdAt: 1 },
        { id: "d", title: "d", completed: false, createdAt: "1" },
      ]),
    );
    expect(loadTasks()).toEqual([]);
  });

  it("keeps valid entries and drops only the malformed ones", () => {
    const good = { id: "ok", title: "keep", completed: false, createdAt: 5 };
    localStorage.setItem(
      "todo-demo:tasks",
      JSON.stringify([null, good, { id: "bad" }]),
    );
    expect(loadTasks()).toEqual([good]);
  });

  it("dedupes by id so corrupt stores cannot produce duplicate keys", () => {
    const a = { id: "dup", title: "first", completed: false, createdAt: 1 };
    const b = { id: "dup", title: "second", completed: true, createdAt: 2 };
    localStorage.setItem("todo-demo:tasks", JSON.stringify([a, b]));
    expect(loadTasks()).toEqual([a]);
  });

  it("rejects non-finite createdAt", () => {
    localStorage.setItem(
      "todo-demo:tasks",
      '[{"id":"x","title":"t","completed":false,"createdAt":null}]',
    );
    expect(loadTasks()).toEqual([]);
  });
});

describe("concurrent writers (round-8 regression)", () => {
  it("does not lose a task when another tab commits mid-write", () => {
    const real = Storage.prototype.setItem;
    let injected = false;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (!injected && key === "todo-demo:tasks") {
          injected = true;
          const other = {
            id: "other-tab",
            title: "FromOtherTab",
            completed: false,
            createdAt: 1,
          };
          const seen = JSON.parse(value) as Array<Record<string, unknown>>;
          real.call(this, key, JSON.stringify([...seen, other]));
          return;
        }
        real.call(this, key, value);
      });

    addTask("Mine");
    const titles = loadTasks().map((t) => t.title);
    expect(titles).toContain("Mine");
    expect(titles).toContain("FromOtherTab");
    spy.mockRestore();
  });

  it("re-reads at the write boundary rather than trusting a stale snapshot", () => {
    // Another tab persists BEFORE our add begins.
    saveTasks([{ id: "pre", title: "PreExisting", completed: false, createdAt: 1 }]);
    addTask("New");
    expect(loadTasks().map((t) => t.title)).toEqual(["PreExisting", "New"]);
  });

  it("never duplicates a task id under repeated adds", () => {
    addTask("A");
    addTask("B");
    addTask("C");
    const ids = loadTasks().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
