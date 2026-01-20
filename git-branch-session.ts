/**
 * Git Branch Session Sync Plugin
 *
 * This plugin automatically associates git branches with OpenCode sessions and
 * switches branches when switching between sessions.
 *
 * Features:
 * 1. Detects when an agent creates a new git branch
 * 2. Associates the branch with the current session
 * 3. Automatically switches branches when switching sessions
 * 4. Handles uncommitted changes gracefully
 *
 * Storage: Branch mappings are stored in .opencode/branch-session-map.json
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"

interface BranchMapping {
  [sessionID: string]: {
    branch: string
    createdAt: number
  }
}

export const GitBranchSessionPlugin: Plugin = async ({ project, directory, $, client }) => {
  const mappingFile = path.join(directory, ".opencode", "branch-session-map.json")

  // Load the branch-session mapping from disk
  async function loadMapping(): Promise<BranchMapping> {
    try {
      const file = Bun.file(mappingFile)
      if (await file.exists()) {
        return await file.json()
      }
    } catch (e) {
      console.log("[git-branch-session] Error loading mapping:", e)
    }
    return {}
  }

  // Save the branch-session mapping to disk
  async function saveMapping(mapping: BranchMapping): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(mappingFile)
      await $`mkdir -p ${dir}`.quiet().nothrow()
      await Bun.write(mappingFile, JSON.stringify(mapping, null, 2))
    } catch (e) {
      console.log("[git-branch-session] Error saving mapping:", e)
    }
  }

  // Get the current git branch
  async function getCurrentBranch(): Promise<string | null> {
    try {
      const result = await $`git branch --show-current`.quiet().nothrow().cwd(directory)
      if (result.exitCode === 0) {
        const branch = result.stdout.toString().trim()
        return branch || null
      }
    } catch (e) {
      console.log("[git-branch-session] Error getting current branch:", e)
    }
    return null
  }

  // Check if there are uncommitted changes
  async function hasUncommittedChanges(): Promise<boolean> {
    try {
      const result = await $`git status --porcelain`.quiet().nothrow().cwd(directory)
      return result.exitCode === 0 && result.stdout.toString().trim().length > 0
    } catch {
      return false
    }
  }

  // Check if a branch exists
  async function branchExists(branch: string): Promise<boolean> {
    try {
      const result = await $`git show-ref --verify --quiet refs/heads/${branch}`
        .quiet()
        .nothrow()
        .cwd(directory)
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  // Switch to a git branch
  async function switchToBranch(branch: string): Promise<{
    success: boolean
    message: string
  }> {
    const currentBranch = await getCurrentBranch()

    // Already on the target branch
    if (currentBranch === branch) {
      return { success: true, message: `Already on branch '${branch}'` }
    }

    // Check for uncommitted changes
    if (await hasUncommittedChanges()) {
      return {
        success: false,
        message: `Cannot switch to '${branch}': uncommitted changes in working tree. Please commit or stash your changes first.`,
      }
    }

    // Check if branch exists
    if (!(await branchExists(branch))) {
      return {
        success: false,
        message: `Cannot switch: branch '${branch}' does not exist`,
      }
    }

    // Switch to the branch
    try {
      const result = await $`git checkout ${branch}`.quiet().nothrow().cwd(directory)
      if (result.exitCode === 0) {
        return { success: true, message: `Switched to branch '${branch}'` }
      }
      return {
        success: false,
        message: `Failed to switch to '${branch}': ${result.stderr.toString()}`,
      }
    } catch (e) {
      return {
        success: false,
        message: `Failed to switch to '${branch}': ${e}`,
      }
    }
  }

  // Patterns to detect branch creation commands
  const BRANCH_CREATE_PATTERNS = [
    /git\s+checkout\s+-b\s+["']?([^\s"']+)["']?/,
    /git\s+switch\s+-c\s+["']?([^\s"']+)["']?/,
    /git\s+branch\s+["']?([^\s"']+)["']?\s*$/,
  ]

  // Extract branch name from a command if it creates a branch
  function extractBranchFromCommand(command: string): string | null {
    for (const pattern of BRANCH_CREATE_PATTERNS) {
      const match = command.match(pattern)
      if (match) {
        return match[1]
      }
    }
    return null
  }

  return {
    // Listen for tool execution to detect branch creation
    "tool.execute.after": async (input, output) => {
      // Only care about bash tool
      if (input.tool !== "bash") return

      // Get the command from metadata or output
      const command = String(output.metadata?.command || output.output || "")

      // Check if this command creates a branch
      const branch = extractBranchFromCommand(command)
      if (branch) {
        const mapping = await loadMapping()
        mapping[input.sessionID] = {
          branch,
          createdAt: Date.now(),
        }
        await saveMapping(mapping)

        // Log the association
        await client.app.log({
          body: {
            service: "git-branch-session",
            level: "info",
            message: `Associated session ${input.sessionID.slice(0, 12)}... with branch '${branch}'`,
          },
        })
      }
    },

    // Listen for session.selected event to auto-switch branches
    event: async ({ event }) => {
      // session.selected is a new event type added in this PR
      if (event.type !== "session.selected") return

      // Type assertion since this is a new event type
      const properties = event.properties as {
        info: { id: string }
        previousSessionID?: string
      }

      const session = properties.info
      const mapping = await loadMapping()
      const entry = mapping[session.id]

      if (!entry) {
        // No branch associated with this session
        return
      }

      const currentBranch = await getCurrentBranch()
      if (currentBranch === entry.branch) {
        // Already on the correct branch
        return
      }

      // Attempt to switch branches
      const result = await switchToBranch(entry.branch)

      // Log the result
      await client.app.log({
        body: {
          service: "git-branch-session",
          level: result.success ? "info" : "warn",
          message: result.message,
        },
      })

      // If switching failed due to uncommitted changes, show a toast
      if (!result.success && result.message.includes("uncommitted changes")) {
        // The TUI will show this via the event system
        console.log(`[git-branch-session] ${result.message}`)
      }
    },

    // Custom tools for manual branch management
    tool: {
      // Show the branch associated with current session
      git_branch_show: tool({
        description: "Show the git branch associated with the current session",
        args: {},
        async execute(_args, ctx) {
          const mapping = await loadMapping()
          const entry = mapping[ctx.sessionID]
          const currentBranch = await getCurrentBranch()

          if (entry) {
            return `Session branch: ${entry.branch}\nCurrent branch: ${currentBranch || "unknown"}`
          }

          return `No branch associated with this session.\nCurrent branch: ${currentBranch || "unknown"}`
        },
      }),

      // Associate a branch with the current session
      git_branch_set: tool({
        description: "Associate a git branch with the current session",
        args: {
          branch: tool.schema.string().describe("The branch name to associate"),
        },
        async execute(args, ctx) {
          const mapping = await loadMapping()
          mapping[ctx.sessionID] = {
            branch: args.branch,
            createdAt: Date.now(),
          }
          await saveMapping(mapping)

          return `Associated session with branch '${args.branch}'`
        },
      }),

      // Switch to the branch associated with a session
      git_branch_switch: tool({
        description: "Switch to the git branch associated with a session",
        args: {
          sessionID: tool.schema
            .string()
            .optional()
            .describe("Session ID to switch to (uses current session if not provided)"),
        },
        async execute(args, ctx) {
          const targetSessionID = args.sessionID || ctx.sessionID
          const mapping = await loadMapping()
          const entry = mapping[targetSessionID]

          if (!entry) {
            return `No branch associated with session ${targetSessionID}`
          }

          const result = await switchToBranch(entry.branch)
          return result.message
        },
      }),

      // List all branch-session associations
      git_branch_list: tool({
        description: "List all session-branch associations",
        args: {},
        async execute() {
          const mapping = await loadMapping()
          const entries = Object.entries(mapping)

          if (entries.length === 0) {
            return "No branch associations found"
          }

          const lines = entries.map(([sessionID, entry]) => {
            const date = new Date(entry.createdAt).toLocaleString()
            return `${sessionID.slice(0, 12)}...: ${entry.branch} (${date})`
          })

          return lines.join("\n")
        },
      }),

      // Remove a branch association
      git_branch_unset: tool({
        description: "Remove the branch association for the current session",
        args: {},
        async execute(_args, ctx) {
          const mapping = await loadMapping()
          const entry = mapping[ctx.sessionID]

          if (!entry) {
            return "No branch was associated with this session"
          }

          delete mapping[ctx.sessionID]
          await saveMapping(mapping)

          return `Removed branch association '${entry.branch}' from this session`
        },
      }),
    },
  }
}
