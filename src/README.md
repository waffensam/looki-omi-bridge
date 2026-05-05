# Source Layout

This directory intentionally starts with contracts only.

Future implementation should be split into provider adapters instead of a single script:

```text
src/
  contracts.ts
  connectors/
    looki.ts
    omi.ts
  asr/
    bailian.ts
    xfyun.ts
  pipeline/
    normalize.ts
    memory.ts
    value-gate.ts
    ledger.ts
    import-runner.ts
  cli/
    index.ts
```

Implementation order:

1. ledger and schemas
2. payload normalizer and memory payload builder
3. dry-run importer
4. Looki connector
5. Bailian and XFYun adapters
6. Omi connector
7. scheduler or plugin wrapper
