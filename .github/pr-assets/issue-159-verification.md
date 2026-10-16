# Issue #159 verification

All runs use `scripts/media-fixture.ts` from this branch with `FIXTURE_PORT=43159`. The fixture mocks only the Plex and Jellyfin HTTP servers.

## Unmatched count before and after

`plan-counts.ts` reads both fixture libraries with the real readers and runs `planWatchedUnion`. The same script ran against an `origin/main` export and against this branch.

```ts
import { createJellyfinProvider } from "~/backend/media/jellyfin";
import { planWatchedUnion } from "~/backend/media/plan";
import { createPlexProvider } from "~/backend/media/plex";
import { Secret } from "~/backend/secrets/storage";

const fixture = process.env.FIXTURE_URL ?? "http://127.0.0.1:43159";
const [plex, jellyfin] = await Promise.all([
	createPlexProvider({ clientIdentifier: "plan-counts" }).items({
		url: `${fixture}/plex`,
		token: new Secret("fixture-plex-token"),
	}),
	createJellyfinProvider({ clientIdentifier: "plan-counts" }).items({
		url: `${fixture}/jellyfin`,
		userId: "alex-id",
		token: new Secret("fixture-jellyfin-token"),
	}),
]);
const { writes, ...counts } = planWatchedUnion({ plex, jellyfin });
console.log(
	JSON.stringify({
		watchedWrites: writes.filter((write) => write.kind === "watched").length,
		...counts,
	}),
);
```

```text
== main
{"watchedWrites":2,"matched":2,"unmatched":12,"ambiguous":0,"positionConflicts":1}
== branch
{"watchedWrites":3,"matched":4,"unmatched":6,"ambiguous":2,"missingSeriesIds":6,"missingEpisodeIds":0,"unsupportedNumbering":2,"positionConflicts":1}
```

## Fixture state through preview and two syncs

| Step | `/fixture-state` |
|---|---|
| Before preview | `{"plex":["1","3","6"],"plexPositions":{"2":754000},"jellyfin":["j2"]}` |
| After preview | `{"plex":["1","3","6"],"plexPositions":{"2":754000},"jellyfin":["j2"]}` |
| After first sync | `{"plex":["1","3","6","2"],"plexPositions":{"2":754000},"jellyfin":["j2","j1","j6"]}` |
| After second sync | `{"plex":["1","3","6","2"],"plexPositions":{"2":754000},"jellyfin":["j2","j1","j6"]}` |

## API read after the second sync

`POST /api/v1/media/pairings/:id/preview` and the saved runs from `GET /api/v1/media/state`:

```json
{"preview":{"ambiguous":2,"matched":4,"missingEpisodeIds":0,"missingSeriesIds":6,"positionConflicts":1,"unmatched":6,"unsupportedNumbering":2,"writes":[]},"runs":[{"applied":0,"planned":0,"status":"completed","summary":"0 updates completed. 4 matched pairs; 6 unmatched items; 2 ambiguous items skipped. 0 unavailable manual matches skipped. Of the skipped episodes, 6 have no series ID, 0 have no episode ID, and 2 cannot match by number."},{"applied":3,"planned":3,"status":"completed","summary":"3 updates completed. 4 matched pairs; 6 unmatched items; 2 ambiguous items skipped. 0 unavailable manual matches skipped. Of the skipped episodes, 6 have no series ID, 0 have no episode ID, and 2 cannot match by number."}]}
```
