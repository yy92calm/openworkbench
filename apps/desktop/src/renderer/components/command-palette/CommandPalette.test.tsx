import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

describe("CommandPalette", () => {
  beforeEach(() => useUiStore.setState({ paletteOpen: false }));

  it("opens on Cmd/Ctrl+K and filters actions", async () => {
    const user = userEvent.setup();
    renderAt("/skills");

    expect(screen.queryByPlaceholderText("输入命令…")).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText("输入命令…");
    expect(input).toBeInTheDocument();

    await user.type(input, "审核");
    expect(screen.getByText("报告审核（可追溯审查）")).toBeInTheDocument();
    expect(screen.queryByText("打开笔记本")).not.toBeInTheDocument();
  });
});
