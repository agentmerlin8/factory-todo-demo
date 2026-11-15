import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { loadTasks } from "./store";

beforeEach(() => {
  localStorage.clear();
});

describe("TOD-1 — add a task", () => {
  it("typing + Add creates a visible task", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Buy oat milk");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getByRole("listitem")).toHaveTextContent("Buy oat milk");
    expect(input).toHaveValue("");
    expect(loadTasks().map((t) => t.title)).toEqual(["Buy oat milk"]);
  });

  it("Enter submits", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "Ship the demo{Enter}");

    expect(screen.getByRole("listitem")).toHaveTextContent("Ship the demo");
    expect(loadTasks().map((t) => t.title)).toEqual(["Ship the demo"]);
    expect(input).toHaveValue(""); // review nit: assert input clears after submit
  });

  it("whitespace-only input is rejected and the input keeps focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.queryByRole("listitem")).toBeNull();
    expect(loadTasks()).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("empty input is rejected and the input keeps focus", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.queryByRole("listitem")).toBeNull();
    expect(loadTasks()).toEqual([]);
    expect(input).toHaveFocus();
  });

  it("new tasks appear immediately and accumulate in the list", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole("textbox", { name: /new task/i });
    await user.type(input, "First{Enter}");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.type(input, "Second{Enter}");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("First");
    expect(items[1]).toHaveTextContent("Second");
    expect(input).toHaveFocus();
  });

  it("reload restores the task (store round-trip)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.type(
      screen.getByRole("textbox", { name: /new task/i }),
      "Persist me{Enter}",
    );
    expect(loadTasks().map((t) => t.title)).toEqual(["Persist me"]);

    // Simulate a page reload: tear down the tree, mount fresh from the store.
    unmount();
    render(<App />);
    expect(screen.getByRole("listitem")).toHaveTextContent("Persist me");
  });
});
