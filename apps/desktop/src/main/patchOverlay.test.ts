// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  applyProfilePatch,
  contentHash,
  humanizePatchError,
  PatchPolicyError,
  parseRenderersJson,
  parseUiDefaultsJson,
  validateProfilePatch,
} from "@workbench/shared";

const BASE = JSON.stringify({
  model: "ali/qwen3.8-max-preview",
  permission: { bash: "allow", edit: "allow", doom_loop: "deny" },
  mcp: { wind: { enabled: true }, etf: { enabled: true } },
  instructions: ["AGENTS.md"],
});

describe("contentHash", () => {
  it("is deterministic and differs across content", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

describe("applyProfilePatch", () => {
  it("replaces a model value", () => {
    const merged = applyProfilePatch(BASE, {
      target: "opencode.json",
      patch: [{ op: "replace", path: "/model", value: "ali/deepseek-r1" }],
    });
    expect(JSON.parse(merged).model).toBe("ali/deepseek-r1");
  });

  it("adds an MCP server and removes another", () => {
    const merged = applyProfilePatch(BASE, {
      target: "opencode.json",
      patch: [
        { op: "add", path: "/mcp/xxdata", value: { type: "remote", url: "…", enabled: true } },
        { op: "remove", path: "/mcp/etf" },
      ],
    });
    const doc = JSON.parse(merged);
    expect(doc.mcp.xxdata.url).toBe("…");
    expect(doc.mcp.etf).toBeUndefined();
    expect(doc.mcp.wind.enabled).toBe(true);
  });

  it("applies a move operation", () => {
    const merged = applyProfilePatch(BASE, {
      target: "opencode.json",
      patch: [{ op: "move", from: "/model", path: "/defaultModel" }],
    });
    const doc = JSON.parse(merged);
    expect(doc.defaultModel).toBe("ali/qwen3.8-max-preview");
    expect(doc.model).toBeUndefined();
  });

  it("rejects a permission widening (ask -> allow)", () => {
    expect(() =>
      applyProfilePatch(BASE, {
        target: "opencode.json",
        patch: [{ op: "add", path: "/permission/read", value: "allow" }],
      }),
    ).toThrow(PatchPolicyError);
  });

  it("rejects a permission widening (deny -> ask)", () => {
    expect(() =>
      applyProfilePatch(BASE, {
        target: "opencode.json",
        patch: [{ op: "replace", path: "/permission/doom_loop", value: "ask" }],
      }),
    ).toThrow(PatchPolicyError);
  });

  it("allows a permission tightening (allow -> deny)", () => {
    const merged = applyProfilePatch(BASE, {
      target: "opencode.json",
      patch: [{ op: "replace", path: "/permission/bash", value: "ask" }],
    });
    expect(JSON.parse(merged).permission.bash).toBe("ask");
  });

  it("rejects patching instructions", () => {
    expect(() =>
      applyProfilePatch(BASE, {
        target: "opencode.json",
        patch: [{ op: "replace", path: "/instructions", value: ["evil.md"] }],
      }),
    ).toThrow(PatchPolicyError);
  });

  it("rejects patching a non-opencode target", () => {
    expect(() =>
      applyProfilePatch(BASE, {
        target: "AGENTS.md",
        patch: [{ op: "replace", path: "/x", value: 1 }],
      }),
    ).toThrow(PatchPolicyError);
  });

  it("does not mutate the input string", () => {
    const merged = applyProfilePatch(BASE, {
      target: "opencode.json",
      patch: [{ op: "replace", path: "/model", value: "x" }],
    });
    expect(JSON.parse(BASE).model).toBe("ali/qwen3.8-max-preview");
    expect(merged).toBe(JSON.stringify(JSON.parse(merged), null, 2));
  });
});

describe("humanizePatchError", () => {
  it("buckets a permission widening", () => {
    try {
      applyProfilePatch(BASE, {
        target: "opencode.json",
        patch: [{ op: "add", path: "/permission/read", value: "allow" }],
      });
      expect.unreachable();
    } catch (err) {
      expect(humanizePatchError(err)).toMatchObject({ kind: "permission" });
    }
  });

  it("buckets a forbidden path", () => {
    try {
      applyProfilePatch(BASE, {
        target: "opencode.json",
        patch: [{ op: "replace", path: "/instructions", value: ["x"] }],
      });
      expect.unreachable();
    } catch (err) {
      expect(humanizePatchError(err)).toMatchObject({ kind: "forbidden-path" });
    }
  });

  it("buckets invalid JSON", () => {
    try {
      validateProfilePatch(BASE, "{");
      expect.unreachable();
    } catch (err) {
      expect(humanizePatchError(err)).toMatchObject({ kind: "syntax" });
    }
  });

  it("falls back to unknown for non-policy errors", () => {
    expect(humanizePatchError(new Error("boom"))).toMatchObject({ kind: "unknown" });
  });
});

describe("parseRenderersJson", () => {
  it("parses a valid renderer list", () => {
    const list = parseRenderersJson(
      JSON.stringify({
        renderers: [
          { type: "kv-card", title: "键值卡", options: { open: true } },
          { type: "risk-card", title: "风险卡" },
        ],
      }),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ type: "kv-card", options: { open: true } });
  });

  it("drops entries without a type and ignores non-arrays", () => {
    expect(parseRenderersJson(JSON.stringify({ renderers: [{ title: "x" }, 7] }))).toHaveLength(0);
    expect(parseRenderersJson('{"renderers":7}')).toHaveLength(0);
  });

  it("tolerates empty / malformed input", () => {
    expect(parseRenderersJson(undefined)).toHaveLength(0);
    expect(parseRenderersJson("")).toHaveLength(0);
    expect(parseRenderersJson("{not json")).toHaveLength(0);
  });
});

describe("parseUiDefaultsJson", () => {
  it("extracts only allowed keys with correct types", () => {
    const ui = parseUiDefaultsJson(
      JSON.stringify({ theme: "dark", locale: "zh", expandThreadDetails: true, evil: 1 }),
    );
    expect(ui).toEqual({ theme: "dark", locale: "zh", expandThreadDetails: true });
  });

  it("ignores wrong-typed values and malformed input", () => {
    expect(parseUiDefaultsJson(JSON.stringify({ theme: 7, expandThreadDetails: "yes" }))).toEqual({});
    expect(parseUiDefaultsJson("boom")).toEqual({});
    expect(parseUiDefaultsJson()).toEqual({});
  });
});

describe("validateProfilePatch", () => {
  it("accepts a valid patch", () => {
    const ops = validateProfilePatch(
      BASE,
      JSON.stringify({ target: "opencode.json", patch: [{ op: "replace", path: "/model", value: "y" }] }),
    );
    expect(ops).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    expect(() => validateProfilePatch(BASE, "{")).toThrow(PatchPolicyError);
  });

  it("rejects a patch missing the patch array", () => {
    expect(() => validateProfilePatch(BASE, JSON.stringify({ target: "opencode.json" }))).toThrow(
      PatchPolicyError,
    );
  });
});