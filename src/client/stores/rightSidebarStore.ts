import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { AgentProvider } from "../../shared/types"

/**
 * The right sidebar is one column of widgets (agents, git, attachments,
 * ports, quick actions, usage). It is either open or closed per project;
 * there are no panels to pick between.
 */
export interface ProjectRightSidebarVisibilityState {
  widgetsOpen: boolean
}

/** The widget disclosures whose open state is remembered per project. */
// Usage is one card per harness, so one disclosure each. The bare "usage" is
// the single card from before that, left in the type so persisted state reads.
export type WidgetDisclosureId = "changes" | "history" | "ports" | "quickActions" | "usage" | `usage:${AgentProvider}`

export interface ProjectRightSidebarUiState {
  /**
   * Disclosures the user has opened or closed. Unset means never touched, and
   * the widget falls back to its default (open when it holds only a few rows).
   */
  expanded: Partial<Record<WidgetDisclosureId, boolean>>
  summary: string
  description: string
}

interface RightSidebarState {
  size: number
  projects: Record<string, ProjectRightSidebarVisibilityState>
  projectUi: Record<string, ProjectRightSidebarUiState>
  toggleWidgets: (projectId: string) => void
  openWidgets: (projectId: string) => void
  hideWidgets: (projectId: string) => void
  setSize: (size: number) => void
  setWidgetExpanded: (projectId: string, id: WidgetDisclosureId, expanded: boolean) => void
  setCommitDraft: (projectId: string, draft: Pick<ProjectRightSidebarUiState, "summary" | "description">) => void
  clearCommitDraft: (projectId: string) => void
  clearProject: (projectId: string) => void
}

export const DEFAULT_RIGHT_SIDEBAR_SIZE = 420
export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 370

function clampSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_RIGHT_SIDEBAR_SIZE
  return Math.max(RIGHT_SIDEBAR_MIN_WIDTH_PX, size)
}

function createDefaultProjectUiState(): ProjectRightSidebarUiState {
  return {
    expanded: {},
    summary: "",
    description: "",
  }
}

function isWidgetsOpen(projects: Record<string, ProjectRightSidebarVisibilityState>, projectId: string) {
  return projects[projectId]?.widgetsOpen ?? false
}

/**
 * v8 folded the git / browser panels into one widget column: any panel that
 * was open (or the pre-panel `isVisible` flag) now means the widgets are open.
 * The embedded browser's state, the Changes/History picker and the per-file
 * diff collapse state (diffs open in the viewer now) are dropped.
 */
export function migrateRightSidebarStore(persistedState: unknown, version = 0) {
  if (!persistedState || typeof persistedState !== "object") {
    return { size: DEFAULT_RIGHT_SIDEBAR_SIZE, projects: {}, projectUi: {} }
  }

  const state = persistedState as {
    size?: number
    projects?: Record<string, Partial<{ isVisible: boolean; rightPanel: string; widgetsOpen: boolean }>>
    projectUi?: Record<string, Partial<ProjectRightSidebarUiState> & { viewMode?: unknown }>
  }
  const projects = Object.fromEntries(
    Object.entries(state.projects ?? {}).map(([projectId, layout]) => [
      projectId,
      {
        widgetsOpen: layout.widgetsOpen
          ?? (layout.rightPanel !== undefined ? layout.rightPanel !== "hidden" : Boolean(layout.isVisible)),
      },
    ])
  )
  const projectUi = Object.fromEntries(
    Object.entries(state.projectUi ?? {}).map(([projectId, ui]) => [
      projectId,
      {
        expanded: ui.expanded ?? {},
        summary: ui.summary ?? "",
        description: ui.description ?? "",
      },
    ])
  )

  // Sizes before v7 were percentages of the window, not pixels.
  const size = version >= 7 && state.size !== undefined ? clampSize(state.size) : DEFAULT_RIGHT_SIDEBAR_SIZE
  return { size, projects, projectUi }
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set) => ({
      size: DEFAULT_RIGHT_SIDEBAR_SIZE,
      projects: {},
      projectUi: {},
      toggleWidgets: (projectId) =>
        set((state) => ({
          projects: { ...state.projects, [projectId]: { widgetsOpen: !isWidgetsOpen(state.projects, projectId) } },
        })),
      openWidgets: (projectId) =>
        set((state) => (isWidgetsOpen(state.projects, projectId)
          ? state
          : { projects: { ...state.projects, [projectId]: { widgetsOpen: true } } })),
      hideWidgets: (projectId) =>
        set((state) => (isWidgetsOpen(state.projects, projectId)
          ? { projects: { ...state.projects, [projectId]: { widgetsOpen: false } } }
          : state)),
      setSize: (size) => set({ size: clampSize(size) }),
      setWidgetExpanded: (projectId, id, expanded) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        // `?? {}`: a state persisted before this map existed has no `expanded`.
        if (current.expanded?.[id] === expanded) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              expanded: { ...current.expanded, [id]: expanded },
            },
          },
        }
      }),
      setCommitDraft: (projectId, draft) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.summary === draft.summary && current.description === draft.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: draft.summary,
              description: draft.description,
            },
          },
        }
      }),
      clearCommitDraft: (projectId) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (!current.summary && !current.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: "",
              description: "",
            },
          },
        }
      }),
      clearProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removedLayout, ...restProjects } = state.projects
          const { [projectId]: _removedUi, ...restProjectUi } = state.projectUi
          return { projects: restProjects, projectUi: restProjectUi }
        }),
    }),
    {
      name: "right-sidebar-layouts",
      version: 8,
      migrate: migrateRightSidebarStore,
    }
  )
)

/** Reactive: whether this project's widget column is open. */
export function useWidgetsOpen(projectId: string | null | undefined) {
  return useRightSidebarStore((store) => (projectId ? isWidgetsOpen(store.projects, projectId) : false))
}
