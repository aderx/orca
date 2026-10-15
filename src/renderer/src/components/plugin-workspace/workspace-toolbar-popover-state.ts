import { create } from 'zustand'

type OpenPopover = { worktreeId: string; path: string; id: string }

// Activating an empty workspace moves the toolbar from the titlebar into its tab group.
export const useWorkspaceToolbarPopoverState = create<{
  openPopover: OpenPopover | null
  setOpenPopover: (value: OpenPopover | null) => void
}>((set) => ({
  openPopover: null,
  setOpenPopover: (openPopover) => set({ openPopover })
}))
