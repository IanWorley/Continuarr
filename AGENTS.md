# Agent guide

## Pull request verification

Every pull request must show how the change was verified. Fill in the `## Verification` section of `.github/pull_request_template.md` with evidence, not intentions.

- **List the checks you ran and their results**, such as `bun run typecheck`, `bunx biome check .`, `bun run build`, and `bun test` (include the test count). If a check failed or was skipped, say so and why.
- **Exercise the behavior you changed.** Describe the scenarios you tried in the running app or through the API and what you observed. The `continuarr-test-session` skill in `.agents/skills/` covers launching an isolated fixture environment.
- **Attach screenshots for any visible UI change.** Commit the PNG to `.github/pr-assets/` and embed it with a URL pinned to a commit SHA so the image survives branch deletion:

  ```markdown
  ![Sign-in form with required-field errors](https://raw.githubusercontent.com/IanWorley/Continuarr/<sha>/.github/pr-assets/sign-in-validation.png)
  ```

  Use descriptive file names and alt text. Capture both desktop and mobile widths when the layout is responsive.
- **For non-visual changes**, include another concrete artifact instead: command output, an API request and response, a log excerpt, or a failing test that now passes. Leave out credentials and secrets.
