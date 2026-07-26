import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { DataFlowCard } from "./DataFlowCard";

describe("DataFlowCard", () => {
  it("states both sides of the data flow with the active model", () => {
    render(
      <I18nProvider locale="en">
        <DataFlowCard model="anthropic/claude" workspace="/Users/x/Workbench" />
      </I18nProvider>,
    );
    expect(screen.getByText("Stays on this machine")).toBeInTheDocument();
    expect(screen.getByText(/Sent to your model provider/)).toBeInTheDocument();
    expect(screen.getByText("anthropic/claude")).toBeInTheDocument();
    expect(screen.getByText(/\/Users\/x\/Workbench/)).toBeInTheDocument();
    // The copy must never promise perfection - it states scope, not guarantees.
    expect(screen.queryByText(/no errors|zero hallucination/i)).not.toBeInTheDocument();
  });

  it("shows the unconfigured state without a workspace path", () => {
    render(
      <I18nProvider locale="en">
        <DataFlowCard model={null} workspace={null} />
      </I18nProvider>,
    );
    expect(screen.getByText("no model configured")).toBeInTheDocument();
  });
});
