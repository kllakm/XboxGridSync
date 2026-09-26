# Project Rules & Development Workflow: Xbox Grid Sync

This document establishes the mandatory **Definition of Done (DoD)** that must be strictly followed on **every single change, prompt, or bug fix** made to this repository.

---

## 📜 Definition of Done (Mandatory on Every Prompt)

Whenever any code, bug fix, feature, or UI modification is performed in this repository, you **MUST** complete all of the following steps before considering the task complete:

### 1. Implement & Verify Changes
- Complete the requested code implementation, bug fix, optimization, or UI design change.
- Verify that changes compile cleanly and test with Node/scripts if applicable.

### 2. Auto-Increment Version (SemVer)
- Evaluate whether the change represents a:
  - **Major** (breaking architectural changes, complete re-architecture)
  - **Minor** (new feature, new launcher scanner, new artwork source)
  - **Patch** (bug fixes, UI polish, performance improvements, documentation changes)
- Update the version in `package.json`.
- Ensure the version number is synchronized and dynamically displayed in the application UI (e.g., Titlebar badge and Settings dialog).

### 3. Update Documentation & Changelog (`README.md`)
- Add a new entry under `## Changelog` in `README.md`.
- Include the version number, release date (`YYYY-MM-DD`), and a clear bulleted list of what was added, improved, or fixed.

### 4. Recompile Both Executables (`/dist/`)
- Execute the dual-build release command:
  ```powershell
  npm run build
  ```
- Verify that both distribution outputs are successfully refreshed in the `/dist/` folder:
  1. Standalone Portable Executable: `dist/XboxGridSync-portable.exe`
  2. Windows Installer Package: `dist/XboxGridSync-Setup.exe`
- **NEVER** mark a prompt or turn complete without verifying that the compiled binaries in `/dist/` reflect the latest changes.

### 5. Provide One-Click GitHub CLI Release Command
- In your final response on every prompt, **ALWAYS** include a ready-to-run GitHub CLI PowerShell command formatted with the current version and concise release notes:
  ```powershell
  gh release create v<VERSION> .\dist\XboxGridSync-portable.exe .\dist\XboxGridSync-Setup.exe --title "v<VERSION> - <TITLE>" --notes "<CONCISE_CHANGELOG_SUMMARY>"
  ```

