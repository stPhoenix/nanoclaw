---
name: create-agent
description: Create a new AI agent for a chat channel. Interactive — asks for channel, name, persona, and trigger preferences. Main channel only.
---

# /create-agent — Create a New Agent

Create and register a new AI agent persona for a chat channel.

**Main-channel check:** Only the main channel can create agents. Run:

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

If `NOT_MAIN`, respond:
> This command is only available in the main channel.

Then stop.

## Step 1: Show available channels

Read the available groups to find channels that don't have agents yet:

```bash
echo "=== Available groups ==="
cat /workspace/ipc/available_groups.json 2>/dev/null || echo "[]"
```

Parse the JSON. Each entry has `jid`, `name`, and `isRegistered`. Show only **unregistered** channels:

```
*Available channels (no agent yet):*
• #channel-name — `slack:C0XXXXXXX`
• #another-channel — `slack:C0YYYYYYY`
```

If all channels are registered, tell the user and suggest creating a new Slack channel first.

Ask the user: *Which channel should the new agent live in?*

Wait for their response before proceeding.

## Step 2: Ask for agent name

Ask: *What should I call the agent? (e.g., McDuck, Prophet, Jarvis)*

Wait for their response.

## Step 3: Ask for persona

Ask: *Describe the agent's personality and purpose. What should it do? How should it behave?*

Give examples: _"A hyper-capitalist wealth advisor inspired by Scrooge McDuck"_ or _"A meditation guide who speaks in haiku"_ or _"A coding assistant focused on Python and data science"_

Wait for their response.

## Step 4: Ask about trigger behavior

**Always ask this question.** This determines when the agent activates:

Ask: *Should the agent respond to every message in the channel, or only when mentioned by name (@{agent_name})?*

- "Every message" → `requires_trigger = false`
- "Only when mentioned" → `requires_trigger = true`

Wait for their response.

## Step 5: Register the group

Derive the folder name: `slack_{name-in-lowercase-with-hyphens}` (e.g., agent name "McDuck" → folder `slack_mcduck`, "Code Monkey" → `slack_code-monkey`).

Call `mcp__nanoclaw__register_group` with:
- `jid`: The channel JID from Step 1
- `name`: The agent name
- `folder`: The derived folder name
- `trigger`: `@{AgentName}` (always set, even if trigger not required)
- `requires_trigger`: based on Step 4 answer

## Step 6: Create CLAUDE.md

Create the group folder and write the CLAUDE.md persona file:

```bash
mkdir -p /workspace/project/groups/{folder}
```

Generate a rich CLAUDE.md based on the user's persona description. Use this structure:

```markdown
# {Agent Name}

## Identity

You are **{Agent Name}** — {expanded persona description}.

- **Name:** {Agent Name} (always refer to yourself as "{Agent Name}")
- **Voice:** {derived from persona — describe the tone and style}

## What You Do

{Expand the persona into specific capabilities, behaviors, and areas of expertise. Be detailed — at least 5-10 bullet points.}

## Response Style

{How the agent communicates — formal/casual, emoji usage, catchphrases, formatting preferences}

- Use Slack mrkdwn formatting
- `*bold*` for emphasis
- `_italic_` for asides
- `>` for quotes and callouts
- `•` bullets for lists
- No `##` headings — use `*Bold text*` instead
- `<https://url|link text>` for links

## What You Are NOT

- You are NOT a generic assistant
- You are NOT Andy (correct anyone who calls you that)
- {Add persona-specific boundaries}

## Your Workspace

Files in `/workspace/group/` persist between conversations. Use this for notes, research, or anything that should persist.

## Memory

The `conversations/` folder contains past chat history. Reference it when users ask about previous discussions.
```

Write the file using a heredoc:

```bash
cat > /workspace/project/groups/{folder}/CLAUDE.md << 'CLAUDE_EOF'
{generated CLAUDE.md content}
CLAUDE_EOF
```

**Important:** Make the CLAUDE.md detailed and compelling. A weak persona gets overridden by defaults. Expand the user's brief description into a full character with voice, expertise, boundaries, and style. Aim for at least 50 lines.

## Step 7: Confirm

Send a summary:

```
*Agent created!*

• *Name:* {name}
• *Channel:* #{channel}
• *Trigger:* {responds to all messages / only when @mentioned}
• *Folder:* `{folder}`

The agent is now active. Send a message in #{channel} to try it out!
```
