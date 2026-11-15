import { describe, it, expect, beforeEach } from "vitest";
import { loadTasks, saveTasks, loadFilter, saveFilter, newId } from "./store";

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