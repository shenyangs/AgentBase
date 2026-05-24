# Tool Design Request Fixture

Design a `read_json` tool for AgentBase.

Requirements:

- Input: workspace-relative `path` and optional `maxBytes`.
- Permissions: `fs:read`.
- Risk: `low`.
- Output: `summary`, `preview`, `artifacts`, and `metadata.truncated`.
- Trace: rely on runtime `tool.started/completed/failed`; emit no secrets.
- Tests: schema validation, path escape rejection, large output truncation.
