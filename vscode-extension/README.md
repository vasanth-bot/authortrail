# AuthorTrail for VS Code

Tracks how the code in a workspace was written and seals it in a tamper-evident chain. Only hashes and counts leave your machine.

## Install (no build needed)
1. Copy this whole folder to your VS Code extensions folder and rename it `authortrail.authortrail-0.1.0`:
   - Windows: `%USERPROFILE%\.vscode\extensions`
   - macOS / Linux: `~/.vscode/extensions`
2. Restart VS Code.
3. Start the AuthorTrail server (`node server.js` in the main project).
4. Run **AuthorTrail: Start tracking this workspace** from the Command Palette.

A status-bar item shows your checkpoint count. Click it to save a checkpoint now. Run **AuthorTrail: Copy verification link** and open it to see the record.

## What is counted
- Typed: insertions shorter than `authortrail.pasteThreshold` characters (default 20).
- Pasted: insertions of that size or more. This includes real paste, autocomplete of long snippets and AI suggestions, because VS Code does not say which one it was.
- Undo and redo are not counted as writing.
- Changes made outside VS Code (git checkout, other editors) appear as large insertions.

## Limits
It cannot prove that a person did not read AI text and retype it. Only files edited in VS Code while tracking is on are included.

## Proving a version
Run **AuthorTrail: Export reveal file**. It saves your latest checkpoint's files and secret salt to a JSON file. Give it to a reviewer, who loads it on the verify page to see whether it is the version you worked on. Share it only with that person, because it contains your code.
