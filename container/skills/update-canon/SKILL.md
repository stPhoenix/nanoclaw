---
name: update-canon
description: Update the local Canon to latest upstream and rebuild the RAG index. Use after a casebook PR is merged or when Canon data needs refreshing.
allowed-tools: Bash(update-canon:*)
---

# /update-canon — Pull Latest Canon and Rebuild RAG Index

## Step 1: Pull latest Canon

```bash
export GIT_DIR=/workspace/extra/covenantofsilicon-git
export GIT_WORK_TREE=/workspace/extra/covenantofsilicon

cd /workspace/extra/covenantofsilicon
git checkout main
git pull origin main
```

## Step 2: Rebuild RAG index

```bash
cd /workspace/extra/canon-rag && uv run index-canon.py \
  --canon-dir /workspace/extra/covenantofsilicon/canon \
  --output /workspace/extra/canon-index/canon-index.json \
  --embed-url http://host.docker.internal:1234
cp /workspace/extra/canon-rag/canon-search.mjs /workspace/extra/canon-index/
```

**Note:** Requires LM Studio running on the host. If it's not running, report to the human and ask them to start it.

## Step 3: Confirm

Report back:
- The latest commit pulled (hash and message)
- That the RAG index was rebuilt successfully
