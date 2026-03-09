# Security Policy

## Reporting a Vulnerability

Please do not post new security vulnerabilities publicly in issues, discussions, screenshots, or social posts before the maintainer has had a chance to review them.

Instead:

1. Contact the maintainer through a private channel.
2. Include clear reproduction steps, impact, affected version or commit, and any suggested mitigation.
3. If secrets, keys, or private user data may be exposed, say that immediately.

## What to Include

Helpful reports usually include:

- The affected platform: Windows, macOS, or Linux.
- Whether the issue is in Electron packaging, local file handling, ComfyUI integration, workflow JSONs, or API key storage.
- Minimal reproduction steps.
- Logs, screenshots, or proof-of-concept details when safe to share privately.

## Scope Notes

High-priority areas for this project include:

- Local file access and project folder handling.
- API key storage and prompt queue authentication.
- Bundled workflow JSON files and generated release artifacts.
- Electron packaging and preload or bridge behavior.

## Disclosure

Please allow reasonable time for validation and a fix before public disclosure. If a report cannot be handled privately yet because no contact channel is available, avoid publishing exploit details and instead open a minimal request asking for a private contact path.
