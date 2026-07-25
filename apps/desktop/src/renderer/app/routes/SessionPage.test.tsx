import { screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

const base = "/example";

describe("SessionPage", () => {
  beforeEach(() => useUiStore.setState({ inspectorOpen: true }));

  it("shows a not-found state for an unknown session", () => {
    renderAt(`${base}/nope`);
    expect(screen.getByText("未找到会话")).toBeInTheDocument();
  });
});
