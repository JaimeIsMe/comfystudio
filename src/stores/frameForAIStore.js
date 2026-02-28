import { create } from 'zustand'

/**
 * Store for "frame from timeline" sent to Generate tab for AI extend/keyframe.
 * When set, Generate tab can use this frame as input for image-to-video workflows.
 */
export const useFrameForAIStore = create((set) => ({
  /** { blobUrl, file, mode: 'extend'|'keyframe' } or null */
  frame: null,

  setFrame: (frame) => {
    set({ frame })
  },

  clearFrame: () => {
    set((state) => {
      if (state.frame?.blobUrl) {
        try {
          URL.revokeObjectURL(state.frame.blobUrl)
        } catch (_) {}
      }
      return { frame: null }
    })
  },
}))
