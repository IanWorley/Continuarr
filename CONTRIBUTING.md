# Contributing to Continuarr

Keep pull requests focused and describe both the behavior change and how it was verified. Automated labels help maintainers triage the review; they do not block or close a pull request.

## Contributor trust

The vouch workflow classifies each pull-request author with exactly one trust label:

- `vouch:trusted` means the author is a repository collaborator, a bot, or is listed in `.github/VOUCHED.td`.
- `vouch:unvouched` means the author has not been vouched for yet.
- `vouch:denounced` means the author is explicitly denounced in the trust list.

Maintainers can vouch for a contributor by adding `github:username` to `.github/VOUCHED.td`. To denounce a contributor, add `-github:username reason`, including a concise reason after the username. Keep entries sorted alphabetically by username.

After changing the trust list, merge the change into `main`; all open pull requests are then rechecked. A repository owner, member, or collaborator can also comment `/recheck-vouch` by itself on an open pull request to re-run its classification.

## Review size

Size labels count additions plus deletions from the merge-base diff while ignoring whitespace-only and blank-line-only changes. Test files are excluded when production files change, so the label reflects the production review surface. A test-only pull request is sized using its test changes.

Pull requests labeled `size:L` or larger should be split when they contain separable behavior. Large generated or mechanical changes may remain together when splitting would make the review less clear.

The PR-size boundaries and test-file rules have focused tests. Run them locally with:

```bash
bun run test:pr-size
```
