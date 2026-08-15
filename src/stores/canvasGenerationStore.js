import { create } from 'zustand'

const makeId = () => `canvas-generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useCanvasGenerationStore = create((set) => ({
  jobs: [],
  addJob: (job = {}) => {
    const id = job.id || makeId()
    set((state) => ({ jobs: [{ id, createdAt: new Date().toISOString(), status: 'queued', ...job }, ...state.jobs] }))
    return id
  },
  updateJob: (id, patch = {}) => set((state) => ({ jobs: state.jobs.map((job) => job.id === id ? { ...job, ...patch } : job) })),
  dismissJob: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  dismissCompleted: () => set((state) => ({ jobs: state.jobs.filter((job) => !['completed', 'failed'].includes(job.status)) })),
}))
