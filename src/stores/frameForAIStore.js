import { create } from 'zustand'

/**
 * Store for "frame from timeline" sent to Generate tab for AI extend/keyframe.
 * When set, Generate tab can use this frame as input for LTX2 i2v or WAN 2.2 i2v.
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
