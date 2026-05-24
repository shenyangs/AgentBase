import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "./json-schema";

describe("validateJsonSchema", () => {
  it("rejects missing required fields", () => {
    expect(() =>
      validateJsonSchema(
        {},
        {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } }
        }
      )
    ).toThrow(/path is required/);
  });

  it("rejects wrong primitive types", () => {
    expect(() => validateJsonSchema({ count: "1" }, { type: "object", properties: { count: { type: "integer" } } })).toThrow(/integer/);
  });
});
