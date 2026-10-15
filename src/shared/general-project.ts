/**
 * Chats that belong to no project live in one reserved project, "General",
 * rooted at the user's home directory. Keeping it a real project record means
 * the sidebar, chat snapshots, terminals and uploads all work unchanged; the
 * places where "a project" means "a repository you are working in" (git,
 * diffs, worktree probes, the concurrent-agents notice) check this id and
 * stay out.
 *
 * The record is created on first use (`EventStore.ensureGeneralProject`). It
 * is never indexed by path, so opening the home directory as an ordinary
 * project still gives a separate project.
 */
export const GENERAL_PROJECT_ID = "kanna-general"
export const GENERAL_PROJECT_TITLE = "General"

export function isGeneralProjectId(projectId: string | null | undefined): boolean {
  return projectId === GENERAL_PROJECT_ID
}

/**
 * Told to the agent on every turn of a General chat: there is no project, so
 * before writing anything it should settle where the work goes.
 */
export function buildGeneralChatNotice(homeDir: string): string {
  return [
    "This chat is not attached to a project. It runs in the user's home directory",
    `(${homeDir}), which is not a codebase to change.`,
    "- Answer questions and do one-off tasks directly.",
    "- Before creating or editing files, settle where they belong: ask the user,",
    "  unless they already named a place. Never scatter files in the home directory.",
    "- When work lands in an existing project or folder, read its conventions",
    "  (CLAUDE.md, AGENTS.md, README, nearby code) before changing it.",
  ].join("\n")
}
