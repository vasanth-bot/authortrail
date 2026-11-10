# AuthorTrail

Verifiable proof of how a piece of writing or code was made. Only hashes and counts are stored, never your text.

## Run
`node server.js`, then open http://localhost:3000 (Node 18+, nothing to install).

## Connect VS Code
1. Copy the `vscode-extension` folder into your VS Code extensions folder and rename it `authortrail.authortrail-0.1.0`
   (Windows: `%USERPROFILE%\.vscode\extensions`, Mac/Linux: `~/.vscode/extensions`). Restart VS Code.
2. On the Write page, copy the connection code under "Connect VS Code".
3. In VS Code, run **AuthorTrail: Start tracking this workspace** and paste the code when asked.
4. The workspace now appears in your Write page list with a Verify link, next to your editor documents.

See `vscode-extension/README.md` for what is counted and its limits.

## Connect your browser
Load `browser-extension` as an unpacked extension (see its README). Documents written in the browser appear in the same list.

## Originality score and AI coach
Every record has an originality percentage: 70% how the text was entered (typed versus pasted), 15% revision while drafting, 15% writing pace. It describes the writing process. It is not an AI detector and cannot tell whether someone retyped another text.
Low scores come with rule-based suggestions. The **AI coach** turns them into personalised advice using the Anthropic API. Start the server with your key in an environment variable, and never put the key in a file you share:

    ANTHROPIC_API_KEY=your-key node server.js          # macOS / Linux
    $env:ANTHROPIC_API_KEY="your-key"; node server.js   # Windows PowerShell

Optional: `AUTHORTRAIL_MODEL` changes the model (default `claude-sonnet-5-5`). The coach receives writing statistics only, plus your draft if you choose to send it from the editor. It is limited to 20 requests per document per hour.

## Modules and pages
- **Dashboard** and **editor**: documents from the editor, VS Code and the browser, with originality badges.
- **Record (verify) page**: integrity stamp, originality score, timeline, version-match check, certificate PDF, evidence download, share controls, AI use declaration.
- **Insights**: daily activity chart, streak, goals, average originality.
- **Classroom**: teachers create classes; students submit records; flags for large pastes, low originality, broken chains and work done after submission; CSV export.
- **Settings**: connection code, goal, export all data, clear device.
- **Independent check**: verify a downloaded evidence file offline.
- **Resources**: setup guide, what it proves, security and privacy, FAQ, API reference.

## Accounts
Sign up and log in at `login.html`. Passwords are hashed with scrypt and sessions last 30 days. Your account owns your connection code, so logging in on another device shows the same records. There is no password reset in this version.

## Free online hosting (GitHub + Neon + Render)
Set `DATABASE_URL` to a Postgres connection string (for example from Neon) and the server stores everything in that database instead of `data/db.json`. Without it, the server uses the local file and needs no install. See the step-by-step guide in the chat or `setup.html`.

## Cloud save and the database
The verification record holds only fingerprints and counts. Separately, the editor can save a copy of your text to your account (on by default, untick it in the editor), and the VS Code extension can do the same with the setting `authortrail.cloudSave`. Saved files appear on the **Files** page. With a Postgres database, readable tables `users`, `documents` and `files` are kept in step so you can inspect them in the Neon console.
