# Code Guidelines

- Add less code; delete more code. Prefer simplifying existing logic over adding abstractions or dependencies.
- Remove obsolete code and unused paths when making changes.
- Backward compatibility is not required. Do not add compatibility layers, legacy fallbacks, or migration code solely to preserve old behavior.

## Project Requirements

- The standalone application must support packet capture itself. Reading existing capture logs alone does not satisfy this requirement.
- After building, show a clickable absolute path to the runnable local EXE. Do not offer a ZIP download unless requested.
- Overwrite the existing application in dist/endfield-action-capture; do not create version-specific output directories.
