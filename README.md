# OpenCode Git Branch Session Plugin

An [OpenCode](https://opencode.ai) plugin that automatically associates git branches with sessions and switches branches when switching between sessions.

## Features

- **Automatic branch detection**: When an agent creates a new git branch (`git checkout -b`, `git switch -c`, `git branch`), it's automatically associated with the current session
- **Auto-switch on session change**: When you switch to a different session, the plugin automatically switches to the associated git branch
- **Uncommitted changes protection**: Won't switch branches if there are uncommitted changes in your working tree
- **Manual tools**: Provides tools for manual branch management

## Requirements

This plugin requires OpenCode with the `session.selected` event support. This feature was added in [this PR](https://github.com/anomalyco/opencode/pull/XXX).

## Installation

### Option 1: Add to your project

Copy `git-branch-session.ts` to your project's `.opencode/plugins/` directory:

```bash
mkdir -p .opencode/plugins
curl -o .opencode/plugins/git-branch-session.ts https://raw.githubusercontent.com/R44VC0RP/opencode-git-branch-plugin/main/git-branch-session.ts
```

### Option 2: Add globally

Copy to your global OpenCode plugins directory:

```bash
mkdir -p ~/.config/opencode/plugins
curl -o ~/.config/opencode/plugins/git-branch-session.ts https://raw.githubusercontent.com/R44VC0RP/opencode-git-branch-plugin/main/git-branch-session.ts
```

### Option 3: Install via npm (coming soon)

```bash
# Add to opencode.json
{
  "plugin": ["opencode-git-branch-plugin"]
}
```

## How It Works

1. **Agent creates a branch**: When an agent runs `git checkout -b feature/my-feature`, the plugin detects this
2. **Association stored**: The branch name is stored in `.opencode/branch-session-map.json` with the session ID
3. **Session switch**: When you switch to a different session in OpenCode, the `session.selected` event fires
4. **Auto-switch**: The plugin receives the event and runs `git checkout` to switch to the associated branch

## Available Tools

The plugin provides these tools that the agent can use:

| Tool | Description |
|------|-------------|
| `git_branch_show` | Show the git branch associated with the current session |
| `git_branch_set` | Manually associate a branch with the current session |
| `git_branch_switch` | Switch to the git branch associated with a session |
| `git_branch_list` | List all session-branch associations |
| `git_branch_unset` | Remove the branch association for the current session |

## Storage

Branch mappings are stored in `.opencode/branch-session-map.json`:

```json
{
  "ses_abc123...": {
    "branch": "feature/my-feature",
    "createdAt": 1705764000000
  }
}
```

## Edge Cases

- **Uncommitted changes**: If you have uncommitted changes, the plugin will NOT switch branches and will log a warning
- **Deleted branches**: If a branch no longer exists, the switch will fail gracefully
- **Multiple sessions, same branch**: Multiple sessions can be associated with the same branch

## License

MIT
