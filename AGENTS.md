# Repository instructions

Target: https://github.com/michaeltorbert/homeschool-collector

This is a public source repository for a local activity-discovery preview. Keep personal profiles, settings, decisions, notes, databases, credentials, browser captures and review packets outside Git. Public starter preferences are neutral; never reset an existing local database's saved preferences to new defaults.

GitHub writes attributed to Codex must use the Codex GitHub App: local profile `games-codex`, expected app slug `codex-bot-mt`. Verify app identity and repository access before publication. API writes use `github-app-curl --profile games-codex`; Git HTTPS uses `git-credential-github-app games-codex`, clearing other credential helpers for the operation. Never use the personal GitHub identity for ordinary writes.

Use `npm test` and `npm run build` for relevant source changes. Public feed fixtures are dated evidence, not current coverage proof. Preserve uncertainty, exact source acknowledgements and the independence of bookmarks, visibility and reason decisions. The app remains loopback-only; hosting, scheduling, authentication and native-device behavior require separate implementation and evidence.

## Fresh-conversation entry point

Before issue work, read [docs/ROADMAP.md](docs/ROADMAP.md), README.md, the issue's linked specification, and the full live issue body and all comments. The roadmap is the public planning index; BACKLOG.md links every currently tracked cleanup and future phase. Verify current source/status/worktrees and tests rather than treating old planning or fixture counts as current proof. Do not recreate resolved or superseded findings.

Keep issue, specification and roadmap status aligned when scope or completion changes. Record every actionable/nonblocking review finding as fixed, explicitly rejected with reason, or a linked follow-up issue before closure. Public specs contain neutral product contracts; private household preferences and raw review packets remain outside Git. An open issue does not by itself authorize deployment, external messages, account provisioning or global workflow-policy changes. Use current user model instructions and live skills; historical model rosters or partial verdicts are not present-task consensus.
