# Release conventions

- Use `Minecraft Workbench v<version>` for GitHub release titles.
- Write English first, then Simplified Chinese. Keep notes to concise additions, improvements and fixes; acknowledgements and relevant links are optional.
- Omit test reports, implementation walkthroughs and conversation context from release notes.
- Before packaging, remove one-off debug scripts, demo data and unused code from the project. Keep useful regression tests in the development tree, outside the VSIX.
- Run the package-content check before distributing a VSIX. Ship runtime code, assets, manifests, documentation and licenses only.
