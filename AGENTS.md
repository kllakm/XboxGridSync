# Agent Instructions for Xbox Grid Sync

Follow all guidelines codified in [PROJECT_RULES.md](file:///c:/GitHub/XboxGridSync/PROJECT_RULES.md).

## Mandatory Workflow on Every Turn:
1. Implement the requested change.
2. Increment the version according to SemVer in `package.json` and ensure it reflects in the app UI.
3. Update `## Changelog` in `README.md` with the new version, date, and bullets of changes.
4. Run `npm run build` to recompile BOTH `dist/XboxGridSync-portable.exe` and `dist/XboxGridSync-Setup.exe`.
5. Verify `/dist/` output before completing the turn.
6. Provide a ready-to-run GitHub CLI PowerShell command (`gh release create v<VERSION> ...`) at the end of the reply.

