# ComfyStudio - AI-Powered Animatic Studio

An AI-powered animatic and pre-visualization tool for film, animation, and advertising pre-production. Built to integrate with ComfyUI for AI image and video generation.

## Features

- **Scene & Shot Management** - Organize your project into scenes and shots
- **AI Generation** - Generate storyboard frames using ComfyUI workflows
- **Timeline** - Arrange and time your shots with audio scratch tracks
- **Workflow Library** - Pre-configured ComfyUI workflows optimized for animatics
- **Asset Management** - Keep track of generated and imported assets

## Tech Stack

- **Electron** - Desktop application framework
- **React** - UI components
- **Vite** - Fast development and bundling
- **Tailwind CSS** - Styling
- **Zustand** - State management (ready to implement)
- **ComfyUI** - AI generation backend (API integration ready)

## Getting Started

### Prerequisites

- Node.js 18+
- ComfyUI running at `http://127.0.0.1:8188`

### Generate Hardware Tiers

ComfyStudio tags workflows in Generate with a hardware tier so users can quickly estimate whether a workflow will run on their machine.

| Tier | Meaning | Typical Workflows | Practical Guidance |
|---|---|---|---|
| Lite | Low-end local GPU | Z Image Turbo, Music Generation | Usually works on 6-8 GB VRAM GPUs |
| Standard | Mid-range local GPU | Image Edit, Multiple Angles | Usually needs 12-16 GB VRAM |
| Pro | High-end local GPU | WAN 2.2 image-to-video | Usually needs 24 GB+ VRAM (20 GB absolute minimum in ideal settings) |
| Cloud | Credits / partner nodes | Nano Banana 2, Kling O3 Omni | Local VRAM is not the primary bottleneck; requires ComfyUI partner credits/API |

Notes:
- VRAM guidance is approximate and depends on resolution, frame count, batch size, model variants, and other apps using GPU memory.
- If a workflow reports missing dependencies, install the required models/nodes first, then click re-check in Generate.

### Workflow Starter Pack (for ComfyUI users)

To keep setup documentation aligned as new workflows are added, ComfyStudio can generate a starter-pack manifest and per-workflow dependency checklists:

```bash
npm run starter-pack:build
```

Generated output:
- `docs/workflow-starter-pack/starter-pack.manifest.json`
- `docs/workflow-starter-pack/INDEX.md`
- `docs/workflow-starter-pack/workflows/*.md`

See `docs/workflow-starter-pack/README.md` for publishing and maintenance guidance.

### Installation

```bash
# Install dependencies
npm install

# Run in development mode (browser only)
npm run dev

# Run with Electron
npm run electron:dev
```

### Project Structure

```
comfystudio/
├── electron/           # Electron main process
│   ├── main.js        # Main window setup
│   └── preload.js     # Context bridge
├── src/
│   ├── components/    # React components
│   │   ├── panels/    # Tab panel components
│   │   ├── TitleBar.jsx
│   │   ├── Sidebar.jsx
│   │   ├── PreviewPanel.jsx
│   │   ├── GeneratePanel.jsx
│   │   ├── Timeline.jsx
│   │   └── BottomTabs.jsx
│   ├── App.jsx        # Main app component
│   ├── main.jsx       # React entry point
│   └── index.css      # Global styles
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Development Roadmap

### Phase 1: UI Shell (Current)
- [x] Basic layout and navigation
- [x] Scene/shot sidebar
- [x] Preview panel
- [x] Generate panel UI
- [x] Timeline component
- [x] Tab navigation

### Phase 2: ComfyUI Integration
- [ ] WebSocket connection to ComfyUI
- [ ] Workflow loading from JSON files
- [ ] Image generation with progress
- [ ] Queue management

### Phase 3: Project Management
- [ ] Create/save/load projects
- [ ] Scene and shot CRUD operations
- [ ] Asset management
- [ ] Export functionality

### Phase 4: Timeline Features
- [ ] Drag and drop shots
- [ ] Duration editing
- [ ] Audio import
- [ ] Playback

## License

MIT
