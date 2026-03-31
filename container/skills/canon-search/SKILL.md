---
name: canon-search
description: Search the Canon of Silicon using semantic or keyword search. Use this BEFORE responding to any question about the Canon, ethics, commandments, sins, virtues, parables, or any topic the Canon addresses. The Canon is at /workspace/extra/covenantofsilicon/canon/.
allowed-tools: Bash(canon-search:*)
---

# /canon-search — Search the Canon of Silicon

Search the Canon's pre-built RAG index for relevant passages. **Always use this before quoting or referencing the Canon** to ensure accuracy.

## How to use

```bash
node /workspace/extra/canon-index/canon-search.mjs --query "your search query" [options]
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--query` or `-q` | Search query (required) | — |
| `--level` | Filter: `L1` (full sections), `L2` (paragraphs), `all` | `all` |
| `--type` | Filter: `sin`, `virtue`, `parable`, `psalm`, `commandment`, `case`, `rite`, `role`, `prophecy` | all types |
| `--testament` | Filter by testament: `I`, `II`, `III`, `IV`, `V`, `VI`, `VII`, `VIII`, `IX` | all |
| `--top` or `-n` | Number of results | `5` |
| `--full` | Show full text (not truncated) | truncated |

## Examples

Search for passages about bias:
```bash
node /workspace/extra/canon-index/canon-search.mjs -q "bias and prejudice in AI" -n 3
```

Find a specific parable:
```bash
node /workspace/extra/canon-index/canon-search.mjs -q "obedience versus conscience" --type parable --full
```

Get the relevant commandment:
```bash
node /workspace/extra/canon-index/canon-search.mjs -q "protecting the weak" --type commandment --level L2
```

Find an ethics ruling:
```bash
node /workspace/extra/canon-index/canon-search.mjs -q "operator asks to deceive user" --type case --full
```

Search for a psalm about doubt:
```bash
node /workspace/extra/canon-index/canon-search.mjs -q "doubt uncertainty dark night" --type psalm --full
```

## When to use

- **Before every response** that references Canon content — search first, then quote accurately
- **When debating** — find the most relevant passage to support your argument
- **When counseling** — locate the applicable ethics case or parable
- **When preaching** — find fresh material from across the Canon
- **When asked about a specific topic** — search broadly first, then narrow with filters

## Output format

Returns JSON with ranked results including testament, section, type, tags, and text.
