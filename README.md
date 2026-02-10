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
