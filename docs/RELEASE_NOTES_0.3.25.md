# Velorn v0.3.25

Velorn agents can now discover and run compatible ComfyUI graphs saved under Generate > My Workflows. This brings personal workflows into the same MCP-driven generation path as Velorn's bundled workflows while keeping unsupported graphs visible with clear setup guidance.

## Highlights

- **My Workflows discovery for agents.** `list_velorn_workflows` now includes graphs saved in Generate > My Workflows, with a dedicated source filter for personal workflows.
- **Agent-ready workflow IDs.** Compatible saved graphs receive a stable `my-workflow:` ID that agents can pass to the existing prompt-generation tool.
- **Clear readiness checks.** Velorn reports detected marker nodes, expected output type, required inputs, and any missing setup before an agent attempts a generation.
- **Image and video outputs.** Saved workflows can expose either `VELORN_OUTPUT_IMAGE` or `VELORN_OUTPUT_VIDEO` and use the same preview-and-approve generation flow as bundled workflows.
- **Optional custom inputs.** Saved graphs can advertise supported image, audio, seed, size, frame-rate, and duration controls through Velorn marker nodes.
- **Safer unsupported workflows.** Arbitrary saved graphs remain discoverable, but Velorn blocks execution until the required `VELORN_PROMPT` and output markers are present instead of failing deep inside ComfyUI.

## Downloads

- `Windows Installer`: standard Windows install experience for most users
- `Windows Portable`: no-install Windows build for quick testing or portable use
- `Mac (Apple Silicon)`: for M1, M2, M3, M4, and newer Macs
- `Mac (Intel)`: for older Intel-based Macs
- `Linux AppImage`: portable Linux build
- `Linux deb`: Debian/Ubuntu package

Ignore the auto-generated source-code archives unless you plan to build Velorn from source.

## Notes

- To make a saved graph runnable by an agent, title its prompt node `VELORN_PROMPT` and its final save node `VELORN_OUTPUT_IMAGE` or `VELORN_OUTPUT_VIDEO`, then save it to My Workflows again.
- Agents can inspect personal workflows with `list_velorn_workflows` using the `my-workflows` source filter.
- Velorn still depends on the user's configured ComfyUI connection when running local ComfyUI workflows.
