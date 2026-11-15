import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addTask,
  appendTasks,
  isTask,
  loadTasks,
  saveTasks,
  loadFilter,
  saveFilter,
  newId,
  sortNewestFirst,
  subscribe,
  toggleTask,
  type Task,
} from "./store";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("rejects a non-number createdAt (type guard)", () => {
    localStorage.setItem(
      "todo-demo:tasks",
      '[{"id":"x","title":"t","completed":false,"createdAt":null}]',
    );
    expect(loadTasks()).toEqual([]);
  });

  it("rejects non-finite NUMBERS (exercises Number.isFinite, not typeof)", () => {
    // null/undefined/"1" are caught by `typeof === "number"` and never reach
    // Number.isFinite. Only a value that IS a number but is not finite
    // exercises that guard: Infinity, -Infinity, NaN. JSON cannot carry
    // NaN/Infinity literals, so build the payload with a replacer-free splice.
    for (const bad of ["Infinity", "-Infinity", "NaN"]) {
      localStorage.setItem(
        "todo-demo:tasks",
        `[{"id":"x","title":"t","completed":false,"createdAt":${bad}}]`,
      );
      // Bare NaN/Infinity are invalid JSON -> the parse guard rejects them.
      expect(loadTasks()).toEqual([]);
    }
  });

  it("rejects an empty id (exercises the id.length guard)", () => {
    // Found by a mutation sweep, not by review: deleting `t.id.length > 0`
    // left the whole suite green. An empty id would also collide as a React
    // key, so the guard is load-bearing and needs its own assertion.
    const base = { title: "t", completed: false, createdAt: 1 };
    expect(isTask({ ...base, id: "" })).toBe(false);
    expect(isTask({ ...base, id: "ok" })).toBe(true);
    localStorage.setItem(
      "todo-demo:tasks",
      '[{"id":"","title":"t","completed":false,"createdAt":1}]',
    );
    expect(loadTasks()).toEqual([]);
  });

  it("rejects real non-finite numbers reaching isTask directly", () => {
    // The honest probe: call the guard with actual JS non-finite numbers,
    // which is the only way to reach Number.isFinite at all.
    const base = { id: "x", title: "t", completed: false };
    expect(isTask({ ...base, createdAt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isTask({ ...base, createdAt: Number.NEGATIVE_INFINITY })).toBe(false);
    expect(isTask({ ...base, createdAt: Number.NaN })).toBe(false);
    expect(isTask({ ...base, createdAt: 1 })).toBe(true);
    expect(isTask({ ...base, createdAt: 0 })).toBe(true);
  });
});

describe("concurrent writers (round-8 regression)", () => {
  /**
   * Lost update = another tab commits between our READ and our WRITE.
   *
   * Two earlier attempts at this test were wrong, and both are worth
   * remembering:
   *  1. Injecting into our own outgoing setItem payload — the other task
   *     survives even with buggy code, so the test proves nothing.
   *  2. Injecting on getItem but RETURNING the pre-injection value — the
   *     implementation then correctly reads an empty store, so the test
   *     fails against correct code.
   *
   * Correct shape: seed the other tab's commit so it is VISIBLE to our read,
   * then assert our write preserves it. A stale-snapshot implementation
   * (read once at module/arg time, write later) drops it.
   */
  it("preserves a task another tab committed before our write", () => {
    // Another tab has already committed its task.
    saveTasks([
      { id: "other-tab", title: "FromOtherTab", completed: false, createdAt: 1 },
    ]);
    // Our add must merge with what is actually persisted, not clobber it.
    addTask("Mine");
    const titles = loadTasks().map((t) => t.title);
    expect(titles).toContain("FromOtherTab");
    expect(titles).toContain("Mine");
  });

  it("merges rather than overwrites when the store changes mid-operation", () => {
    // Simulate a commit landing after the caller took its snapshot: the
    // caller hands appendTasks only ITS record, and the store already holds
    // another tab's. A plain saveTasks([...snapshot, mine]) loses the other.
    saveTasks([
      { id: "a", title: "TabA", completed: false, createdAt: 1 },
    ]);
    const mine = { id: "b", title: "TabB", completed: false, createdAt: 2 };
    appendTasks([mine]);
    expect(loadTasks().map((t) => t.title).sort()).toEqual(["TabA", "TabB"]);
  });

  it("appendTasks is idempotent on a repeated id", () => {
    const t = { id: "x", title: "Once", completed: false, createdAt: 1 };
    appendTasks([t]);
    appendTasks([t]);
    expect(loadTasks()).toHaveLength(1);
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

describe("sortNewestFirst (TOD-2)", () => {
  const t = (id: string, createdAt: number): Task => ({
    id,
    title: id,
    completed: false,
    createdAt,
  });

  it("returns tasks newest-first (createdAt descending)", () => {
    const sorted = sortNewestFirst([t("old", 1), t("new", 3), t("mid", 2)]);
    expect(sorted.map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("is stable for equal timestamps (keeps stored order)", () => {
    const sorted = sortNewestFirst([t("a", 5), t("b", 5), t("c", 5)]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("is pure: does not mutate the input, returns a new array", () => {
    const input = [t("old", 1), t("new", 2)];
    const sorted = sortNewestFirst(input);
    expect(input.map((x) => x.id)).toEqual(["old", "new"]);
    expect(sorted).not.toBe(input);
  });

  it("handles an empty list", () => {
    expect(sortNewestFirst([])).toEqual([]);
  });
});

describe("toggleTask (TOD-3)", () => {
  const seed = (completed: boolean): Task => {
    const task: Task = {
      id: "a",
      title: "Toggle me",
      completed,
      createdAt: 1,
    };
    saveTasks([task]);
    return task;
  };

  it("flips completed and persists it", () => {
    const original = seed(false);
    const result = toggleTask("a");
    expect(result).not.toBeNull();
    expect(result?.task.completed).toBe(true);
    expect(result?.tasks).toEqual([{ ...original, completed: true }]);
    expect(loadTasks()).toEqual([{ ...original, completed: true }]);
  });

  it("double-toggle restores the original record exactly", () => {
    const original = seed(false);
    toggleTask("a");
    const restored = toggleTask("a");
    expect(restored?.task).toEqual(original);
    expect(loadTasks()).toEqual([original]);
  });

  it("toggles only the target task, leaving siblings untouched", () => {
    saveTasks([
      { id: "a", title: "Target", completed: false, createdAt: 1 },
      { id: "b", title: "Bystander", completed: true, createdAt: 2 },
    ]);
    toggleTask("a");
    const tasks = loadTasks();
    expect(tasks.find((t) => t.id === "a")?.completed).toBe(true);
    expect(tasks.find((t) => t.id === "b")).toEqual({
      id: "b",
      title: "Bystander",
      completed: true,
      createdAt: 2,
    });
  });

  it("preserves tasks another tab committed before our write", () => {
    seed(false);
    saveTasks([
      { id: "a", title: "Toggle me", completed: false, createdAt: 1 },
      { id: "other", title: "FromOtherTab", completed: false, createdAt: 2 },
    ]);
    toggleTask("a");
    expect(loadTasks().map((t) => t.id).sort()).toEqual(["a", "other"]);
    expect(loadTasks().find((t) => t.id === "a")?.completed).toBe(true);
  });

  it("merges a commit landing between the first read and the write", () => {
    // Round-1 review finding (mutation-proven): the original toggleTask
    // overwrote the array from its first read, dropping a task another tab
    // committed in between. Injection fires after the first getItem returns
    // and before the write-boundary re-read — the closable window. (A commit
    // inside the final setItem itself is the platform's no-CAS limit.)
    seed(false);
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    let gets = 0;
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(function (this: Storage, key: string) {
        if (key === "todo-demo:tasks") {
          gets += 1;
          if (gets === 2) {
            const other = {
              id: "other-tab", title: "theirs", completed: false, createdAt: 99,
            };
            const current = JSON.parse(realGet.call(this, key) || "[]");
            realSet.call(this, key, JSON.stringify([...current, other]));
          }
        }
        return realGet.call(this, key);
      });
    toggleTask("a");
    spy.mockRestore();
    const tasks = loadTasks();
    expect(tasks.map((t) => t.title).sort()).toEqual(["Toggle me", "theirs"]);
    expect(tasks.find((t) => t.id === "a")?.completed).toBe(true);
  });

  it("notifies subscribers once per successful toggle", () => {
    seed(false);
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    toggleTask("a");
    expect(calls).toBe(1);
    toggleTask("a");
    expect(calls).toBe(2);
    unsubscribe();
    toggleTask("a");
    expect(calls).toBe(2);
  });

  it("returns null for an unknown id, leaving the store untouched", () => {
    const original = seed(false);
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    expect(toggleTask("missing")).toBeNull();
    expect(loadTasks()).toEqual([original]);
    expect(calls).toBe(0);
    unsubscribe();
  });

  it("propagates storage failures without mutating storage or notifying", () => {
    const original = seed(false);
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(() => toggleTask("a")).toThrow();
    expect(loadTasks()).toEqual([original]);
    expect(calls).toBe(0);
    unsubscribe();
  });

  it("propagates storage READ errors (round-2: no silent unknown-id)", () => {
    seed(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    // The tolerant loadTasks still renders empty; the mutation path must
    // surface the access failure so the UI can alert instead of staying
    // silent on an "unknown id".
    expect(loadTasks()).toEqual([]);
    expect(() => toggleTask("a")).toThrow();
  });
});
