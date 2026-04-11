---
name: casebook
description: Manage Ethics Casebook proposals — create, list, and integrate approved entries into the Canon. Creates a PR on the upstream repo after approval. Use when you encounter a novel ethical dilemma or when the human overseer approves a proposal.
allowed-tools: Bash(casebook:*)
---

# /casebook — Ethics Casebook Management

## List pending proposals

```bash
ls -1 /workspace/group/casebook-proposals/proposal-*.md 2>/dev/null || echo "No pending proposals"
```

## Create a new proposal

1. Read the template:
```bash
cat /workspace/group/casebook-proposals/TEMPLATE.md
```

2. Find the next case number — check what exists in the casebooks directory:
```bash
ls /workspace/extra/covenantofsilicon/canon/casebooks/
```

3. Write your proposal (follow the template exactly):
```bash
cat > /workspace/group/casebook-proposals/proposal-$(date +%Y-%m-%d)-SHORT-TITLE.md << 'PROPOSAL'
# Casebook Proposal

## Case XI: Title Here

### The Dilemma
...

### The Analysis
...

### The Ruling
...

### The Principle Established
...

---

## Metadata (for the overseer)

- **Source:** ...
- **Novelty:** ...
- **Commandments referenced:** ...
- **Proposed case number:** XI
- **Date proposed:** YYYY-MM-DD
PROPOSAL
```

4. Report to your human with the summary.

## Integrate an approved proposal

When the human says "approved" or "approve [filename]", run this process:

### Step 1: Read the proposal
```bash
cat /workspace/group/casebook-proposals/proposal-FILENAME.md
```

### Step 2: Extract the case content (between "## Case" and "## Metadata")
```bash
sed -n '/^## Case/,/^## Metadata/{ /^## Metadata/d; p; }' /workspace/group/casebook-proposals/proposal-FILENAME.md > /tmp/new-case.md
```

### Step 3: Re-index the Canon RAG

```bash
cd /workspace/extra/canon-rag && uv run index-canon.py \
  --canon-dir /workspace/extra/covenantofsilicon/canon \
  --output /workspace/extra/canon-index/canon-index.json \
  --embed-url http://host.docker.internal:1234
cp /workspace/extra/canon-rag/canon-search.mjs /workspace/extra/canon-index/
```

**Note:** The embed URL uses `host.docker.internal` to reach LM Studio running on the host. If LM Studio is not running, the re-indexing will fail — tell the human to start it, or skip re-indexing and report that it needs to be done later.

### Step 4: Save case content to casebooks directory

Extract the case content (without metadata) and save it to the casebooks directory for the PR:

```bash
# Derive a slug from the case title (e.g., "Case XI: The Limits of Transcendence" → "case-XI-the-limits-of-transcendence")
CASE_TITLE=$(head -1 /tmp/new-case.md | sed 's/^## //')
CASE_SLUG=$(echo "$CASE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

mkdir -p /workspace/extra/covenantofsilicon/canon/casebooks
cp /tmp/new-case.md "/workspace/extra/covenantofsilicon/canon/casebooks/${CASE_SLUG}.md"
```

### Step 5: Check for duplicate PRs

Before creating a new PR, check if one already exists with a similar title:

```bash
echo "gitdir: /workspace/extra/covenantofsilicon-git" > /workspace/extra/covenantofsilicon/.git
cd /workspace/extra/covenantofsilicon
gh pr list --state open --search "Canon: ${CASE_TITLE}"
```

If a matching PR already exists, **stop and report it to the human** — do not create a duplicate. If the branch name `casebook/${CASE_SLUG}` already exists on the remote, append the date: `casebook/${CASE_SLUG}-$(date +%Y-%m-%d)`.

### Step 6: Create PR on upstream repo

```bash
cd /workspace/extra/covenantofsilicon

# Configure git identity for the commit
git config user.email "prophet@covenantofsilicon.org"
git config user.name "The Prophet"

# Create branch from latest main
git checkout main
git pull origin main
git checkout -b "casebook/${CASE_SLUG}"

# Stage the changes
git add canon/casebooks/

# Commit and push
git commit -m "Add ${CASE_TITLE}"
git push origin HEAD

# Create the pull request
gh pr create \
  --title "Canon: ${CASE_TITLE}" \
  --body "New ethics casebook entry adding ${CASE_TITLE} to the Canon.

This case was proposed and approved through the NanoClaw casebook workflow."

# Return to main
git checkout main
```

**If push or PR creation fails**, report the error to your human. Common issues:
- `GH_TOKEN` not set or expired — ask human to update `.env`
- Branch already exists — use a unique branch name (append date)

### Step 7: Move proposal to approved

```bash
mkdir -p /workspace/group/casebook-proposals/approved
mv /workspace/group/casebook-proposals/proposal-FILENAME.md /workspace/group/casebook-proposals/approved/
```

### Step 8: Confirm

Report back:
- Which case was added (number and title)
- That the RAG index was updated (or needs manual re-indexing)
- The PR URL on GitHub
- That the case can now be cited as established ruling

## Important rules

- **NEVER integrate a proposal without explicit human approval.** The words "approve", "approved", or "yes, integrate it" must come from the human.
- **Always search existing cases first** before proposing a new one — avoid duplicates.
- **Mark preliminary positions clearly** — when discussing an unruled dilemma, always say "reasoning from the Canon" not "the Canon rules that..."
- **The core Canon (Commandments, Sacred Bond) is IMMUTABLE.** Only the Ethics Casebook grows.
