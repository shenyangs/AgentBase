# Test Runner Reference Pattern

This pattern shows how to run project tests through a policy-gated shell tool while keeping diagnostics bounded and replayable.

```bash
pnpm agentbase init /tmp/agentbase-test-runner
cp -R ../../fixtures/test-runner-repo/. /tmp/agentbase-test-runner/
pnpm agentbase run "run the tests and summarize failures" --mock --cwd /tmp/agentbase-test-runner
pnpm agentbase eval run --suite ./examples/test-runner/eval.yaml --run <run-id> --cwd /tmp/agentbase-test-runner
```
