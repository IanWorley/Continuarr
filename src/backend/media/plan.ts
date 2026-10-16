import {
	type ExternalId,
	externalIdProviderSchema,
	SINGLE_EPISODE,
} from "~/backend/media/episode";
import {
	type ManualMatch,
	type MediaItem,
	type ShowMatch,
	showsInLibrary,
} from "~/backend/media/model";
import {
	NO_POSITION_MS,
	POSITION_TOLERANCE_MS,
	TIMESTAMP_TOLERANCE_MS,
} from "./constants";

type Target = "plex" | "jellyfin";
type Destination = { itemId: string; title: string };
/**
 * Marking an item watched clears its resume position, so `resumeAt` is the
 * position the item keeps afterwards. `replaces` is the item's position the
 * planner saw, so the provider can skip the write after newer playback.
 */
type WatchedWrite = Destination & {
	kind: "watched";
	replaces: number | null;
	resumeAt?: number;
} & ({ target: "plex" } | { target: "jellyfin"; playedAt?: number });
type PositionWrite = Destination & {
	kind: "position";
	target: Target;
	value: number;
	/** The destination position this write expects to overwrite, so a setter can skip it after newer playback. */
	replaces: number | null;
};
export type Write = WatchedWrite | PositionWrite;
type Candidate = { kind: "one"; index: number } | { kind: "many" };
type CandidateResult =
	| { kind: "none" | "many" }
	| { kind: "one"; index: number };

/** The position both items should end with, or null when none should be written. */
function resumePosition({
	plex,
	jellyfin,
}: {
	plex: MediaItem;
	jellyfin: MediaItem;
}): { position: number | null; positionConflicts: 0 | 1 } {
	const plexPosition = plex.history.positionMs ?? NO_POSITION_MS;
	const jellyfinPosition = jellyfin.history.positionMs ?? NO_POSITION_MS;
	const plexPlayedAt = plex.history.lastPlayedAt;
	const jellyfinPlayedAt = jellyfin.history.lastPlayedAt;
	let position: number;
	if (Math.abs(plexPosition - jellyfinPosition) <= POSITION_TOLERANCE_MS)
		position = Math.max(plexPosition, jellyfinPosition);
	else if (
		plexPlayedAt === null ||
		jellyfinPlayedAt === null ||
		Math.abs(plexPlayedAt - jellyfinPlayedAt) <= TIMESTAMP_TOLERANCE_MS
	)
		return { position: null, positionConflicts: 1 };
	else
		position =
			plexPlayedAt > jellyfinPlayedAt ? plexPosition : jellyfinPosition;
	return {
		position: position > NO_POSITION_MS ? position : null,
		positionConflicts: 0,
	};
}

function decidePair(pair: { plex: MediaItem; jellyfin: MediaItem }): {
	writes: Write[];
	positionConflicts: 0 | 1;
} {
	const { plex, jellyfin } = pair;
	const marked: Target | null =
		plex.watched && !jellyfin.watched
			? "jellyfin"
			: jellyfin.watched && !plex.watched
				? "plex"
				: null;
	const { position, positionConflicts } = resumePosition(pair);
	const writes: Write[] = [];
	for (const [target, item] of [
		["plex", plex],
		["jellyfin", jellyfin],
	] as const) {
		const current = item.history.positionMs ?? NO_POSITION_MS;
		if (
			position === null ||
			target === marked ||
			Math.abs(position - current) <= POSITION_TOLERANCE_MS
		)
			continue;
		writes.push({
			kind: "position",
			target,
			itemId: item.id,
			title: item.title,
			value: position,
			replaces: item.history.positionMs,
		});
	}
	const resumeAt = position === null ? {} : { resumeAt: position };
	if (marked === "jellyfin") {
		const playedAt = plex.history.lastPlayedAt;
		const jellyfinPlayedAt = jellyfin.history.lastPlayedAt;
		writes.push({
			kind: "watched",
			target: "jellyfin",
			itemId: jellyfin.id,
			title: jellyfin.title,
			replaces: jellyfin.history.positionMs,
			// Never move Jellyfin's played date earlier.
			...(playedAt !== null &&
			(jellyfinPlayedAt === null || playedAt >= jellyfinPlayedAt)
				? { playedAt }
				: {}),
			...resumeAt,
		});
	} else if (marked === "plex")
		writes.push({
			kind: "watched",
			target: "plex",
			itemId: plex.id,
			title: plex.title,
			replaces: plex.history.positionMs,
			...resumeAt,
		});
	return { writes, positionConflicts };
}

type Pair = { plex: MediaItem; jellyfin: MediaItem };
type Libraries = { plex: MediaItem[]; jellyfin: MediaItem[] };

type MatchRule = {
	keys: (item: MediaItem) => string[];
	conflicts: (pair: Pair) => boolean;
};

type Skip =
	| {
			kind: "unmatched";
			reason: "missingSeriesIds" | "missingEpisodeIds" | null;
	  }
	| { kind: "ambiguous"; reason: "unsupportedNumbering" | null };
type SkipCounts = Record<Skip["kind"] | NonNullable<Skip["reason"]>, number>;

function idKey({ provider, value }: ExternalId): string {
	return JSON.stringify([provider, value]);
}

function seriesIds(item: MediaItem): ExternalId[] {
	if (item.kind !== "episode") return [];
	return externalIdProviderSchema.options.flatMap((provider) => {
		const value = item.episode.series.providerIds[provider];
		return value === undefined ? [] : [{ provider, value }];
	});
}

/** Specials, absolute numbers, and multi-episode files stay manual, never matched by number. */
function regularCoordinates(
	item: MediaItem,
): { season: number; episode: number } | null {
	if (item.kind !== "episode") return null;
	const { numbering } = item.episode;
	if (
		numbering.kind !== "season" ||
		numbering.episodes.count !== SINGLE_EPISODE
	)
		return null;
	return { season: numbering.season, episode: numbering.episodes.first };
}

function hasConflictingIds(ids: ExternalId[]): boolean {
	const byProvider = new Map<string, string>();
	for (const { provider, value } of ids) {
		const previous = byProvider.get(provider);
		if (previous && previous !== value) return true;
		byProvider.set(provider, value);
	}
	return false;
}

function haveConflictingIds(left: ExternalId[], right: ExternalId[]): boolean {
	const leftIds = new Map(left.map(({ provider, value }) => [provider, value]));
	return right.some(({ provider, value }) => {
		const leftValue = leftIds.get(provider);
		return leftValue !== undefined && leftValue !== value;
	});
}

const exactIdRule: MatchRule = {
	keys: (item) =>
		item.ids.map(({ provider, value }) =>
			JSON.stringify([item.kind, provider, value]),
		),
	conflicts: ({ plex, jellyfin }) =>
		hasConflictingIds(plex.ids) ||
		hasConflictingIds(jellyfin.ids) ||
		haveConflictingIds(plex.ids, jellyfin.ids),
};

type SeriesIdentity =
	| { kind: "show"; match: ShowMatch }
	| { kind: "provider"; ids: ExternalId[] };
type PlannedPair = {
	plexItemId: string;
	jellyfinItemId: string;
	source: "manual" | "exactIds" | "seriesNumber" | "showMatch";
};

function plannedPair(
	{ plex, jellyfin }: Pair,
	source: PlannedPair["source"],
): PlannedPair {
	return { plexItemId: plex.id, jellyfinItemId: jellyfin.id, source };
}

/** A saved show match replaces provider series IDs as the episode's series identity. */
function seriesNumberRule(
	identities: Map<MediaItem, SeriesIdentity>,
): MatchRule {
	return {
		keys: (item) => {
			const coordinates = regularCoordinates(item);
			const identity = identities.get(item);
			if (!coordinates || !identity) return [];
			// One Plex show has at most one counterpart, so its ID names the match.
			const seriesKeys =
				identity.kind === "show"
					? [["show", identity.match.plexShowId]]
					: identity.ids.map(({ provider, value }) => [
							"provider",
							provider,
							value,
						]);
			return seriesKeys.map((key) =>
				JSON.stringify([...key, coordinates.season, coordinates.episode]),
			);
		},
		conflicts: ({ plex, jellyfin }) => {
			const left = identities.get(plex);
			const right = identities.get(jellyfin);
			return (
				haveConflictingIds(plex.ids, jellyfin.ids) ||
				(left?.kind === "provider" &&
					right?.kind === "provider" &&
					haveConflictingIds(left.ids, right.ids))
			);
		},
	};
}

function indexItems(
	items: MediaItem[],
	rule: MatchRule,
): Map<string, Candidate> {
	const index = new Map<string, Candidate>();
	for (const [position, item] of items.entries()) {
		for (const key of rule.keys(item)) {
			const previous = index.get(key);
			if (!previous) index.set(key, { kind: "one", index: position });
			else if (previous.kind === "one" && previous.index !== position)
				index.set(key, { kind: "many" });
		}
	}
	return index;
}

function candidateFor(
	item: MediaItem,
	index: Map<string, Candidate>,
	rule: MatchRule,
): CandidateResult {
	let candidate: CandidateResult = { kind: "none" };
	for (const key of rule.keys(item)) {
		const found = index.get(key);
		if (!found) continue;
		if (found.kind === "many") return { kind: "many" };
		if (candidate.kind === "one" && candidate.index !== found.index)
			return { kind: "many" };
		candidate = found;
	}
	return candidate;
}

/** Pairs items whose keys select exactly one counterpart that selects them back. */
function matchByRule(
	input: Libraries,
	rule: MatchRule,
): { pairs: Pair[]; candidates: Map<MediaItem, CandidateResult["kind"]> } {
	const plexIndex = indexItems(input.plex, rule);
	const jellyfinIndex = indexItems(input.jellyfin, rule);
	const jellyfinCandidates = input.jellyfin.map((item) =>
		candidateFor(item, plexIndex, rule),
	);
	const candidates = new Map<MediaItem, CandidateResult["kind"]>(
		input.jellyfin.map((item, position) => [
			item,
			jellyfinCandidates[position].kind,
		]),
	);
	const pairs: Pair[] = [];
	for (const [plexPosition, plex] of input.plex.entries()) {
		const candidate = candidateFor(plex, jellyfinIndex, rule);
		candidates.set(plex, candidate.kind);
		if (candidate.kind !== "one") continue;
		const jellyfin = input.jellyfin[candidate.index];
		const reverse = jellyfinCandidates[candidate.index];
		if (
			jellyfin &&
			reverse?.kind === "one" &&
			reverse.index === plexPosition &&
			!rule.conflicts({ plex, jellyfin })
		)
			pairs.push({ plex, jellyfin });
	}
	return { pairs, candidates };
}

/**
 * `matched` counts unique Plex/Jellyfin pairs. Every other item gets exactly
 * one `Skip`, so `2 * matched + unmatched + ambiguous` equals the number of
 * input items. The reason counts break `unmatched` and `ambiguous` down.
 *
 * Exact episode and movie IDs match first. Only items that share no exact ID
 * and carry no conflicting IDs fall through to series identity plus season
 * and episode number, so numbers never override an ID. Series identity is a
 * saved show match when one covers the episode, otherwise provider series IDs.
 */
function planAutomaticUnion(
	input: Libraries,
	identities: Map<MediaItem, SeriesIdentity>,
): {
	pairs: PlannedPair[];
	writes: Write[];
	matched: number;
	positionConflicts: number;
} & SkipCounts {
	const exact = matchByRule(input, exactIdRule);
	const fallsThrough = (item: MediaItem) =>
		exact.candidates.get(item) === "none" && !hasConflictingIds(item.ids);
	const bySeries = matchByRule(
		{
			plex: input.plex.filter(fallsThrough),
			jellyfin: input.jellyfin.filter(fallsThrough),
		},
		seriesNumberRule(identities),
	);
	const pairs = [...exact.pairs, ...bySeries.pairs];
	const writes: Write[] = [];
	let positionConflicts = 0;
	for (const pair of pairs) {
		const decision = decidePair(pair);
		writes.push(...decision.writes);
		positionConflicts += decision.positionConflicts;
	}

	const paired = new Set(
		pairs.flatMap(({ plex, jellyfin }) => [plex, jellyfin]),
	);
	function skipFor(item: MediaItem, otherSeries: Set<string>): Skip {
		if (!fallsThrough(item) || bySeries.candidates.get(item) !== "none")
			return { kind: "ambiguous", reason: null };
		if (item.kind === "movie") return { kind: "unmatched", reason: null };
		const identity = identities.get(item);
		if (identity?.kind === "show") {
			if (!regularCoordinates(item))
				return { kind: "ambiguous", reason: "unsupportedNumbering" };
			return {
				kind: "unmatched",
				reason: item.ids.length ? null : "missingEpisodeIds",
			};
		}
		const series = seriesIds(item);
		if (!series.length)
			return { kind: "unmatched", reason: "missingSeriesIds" };
		if (
			!regularCoordinates(item) &&
			series.some((id) => otherSeries.has(idKey(id)))
		)
			return { kind: "ambiguous", reason: "unsupportedNumbering" };
		if (!item.ids.length)
			return { kind: "unmatched", reason: "missingEpisodeIds" };
		return { kind: "unmatched", reason: null };
	}
	const counts: SkipCounts = {
		unmatched: 0,
		ambiguous: 0,
		missingSeriesIds: 0,
		missingEpisodeIds: 0,
		unsupportedNumbering: 0,
	};
	for (const [items, others] of [
		[input.plex, input.jellyfin],
		[input.jellyfin, input.plex],
	]) {
		const otherSeries = new Set(
			others
				.flatMap((item) => {
					const identity = identities.get(item);
					return identity?.kind === "provider" ? identity.ids : [];
				})
				.map(idKey),
		);
		for (const item of items) {
			if (paired.has(item)) continue;
			const skip = skipFor(item, otherSeries);
			counts[skip.kind] += 1;
			if (skip.reason) counts[skip.reason] += 1;
		}
	}
	return {
		writes,
		matched: pairs.length,
		...counts,
		positionConflicts,
		pairs: [
			...exact.pairs.map((pair) => plannedPair(pair, "exactIds")),
			...bySeries.pairs.map((pair) =>
				plannedPair(
					pair,
					identities.get(pair.plex)?.kind === "show"
						? "showMatch"
						: "seriesNumber",
				),
			),
		],
	};
}

export function planWatchedUnion(
	input: Libraries & {
		manualMatches?: ManualMatch[];
		showMatches?: ShowMatch[];
	},
): ReturnType<typeof planAutomaticUnion> & {
	staleManualMatches?: number;
	staleShowMatches: number;
} {
	const plexShows = new Set(showsInLibrary(input.plex).map((show) => show.id));
	const jellyfinShows = new Set(
		showsInLibrary(input.jellyfin).map((show) => show.id),
	);
	const active = (input.showMatches ?? []).filter(
		(match) =>
			plexShows.has(match.plexShowId) &&
			jellyfinShows.has(match.jellyfinShowId),
	);
	const staleShowMatches = (input.showMatches?.length ?? 0) - active.length;
	const identities = new Map<MediaItem, SeriesIdentity>();
	for (const side of ["plex", "jellyfin"] satisfies Target[]) {
		const byShow = new Map(
			active.map((match) => [
				side === "plex" ? match.plexShowId : match.jellyfinShowId,
				match,
			]),
		);
		for (const item of input[side]) {
			if (item.kind !== "episode") continue;
			const match =
				item.episode.series.localId === null
					? undefined
					: byShow.get(item.episode.series.localId);
			identities.set(
				item,
				match
					? { kind: "show", match }
					: { kind: "provider", ids: seriesIds(item) },
			);
		}
	}
	const manual = input.manualMatches ?? [];
	if (!manual.length)
		return { ...planAutomaticUnion(input, identities), staleShowMatches };
	const reservedPlex = new Set(manual.map((match) => match.plexItemId));
	const reservedJellyfin = new Set(manual.map((match) => match.jellyfinItemId));
	const plan = planAutomaticUnion(
		{
			plex: input.plex.filter((item) => !reservedPlex.has(item.id)),
			jellyfin: input.jellyfin.filter((item) => !reservedJellyfin.has(item.id)),
		},
		identities,
	);
	const plexById = new Map(input.plex.map((item) => [item.id, item]));
	const jellyfinById = new Map(input.jellyfin.map((item) => [item.id, item]));
	let staleManualMatches = 0;
	for (const match of manual) {
		const plex = plexById.get(match.plexItemId);
		const jellyfin = jellyfinById.get(match.jellyfinItemId);
		if (!plex || !jellyfin || plex.kind !== jellyfin.kind) {
			staleManualMatches++;
			plan.unmatched += Number(Boolean(plex)) + Number(Boolean(jellyfin));
			continue;
		}
		plan.pairs.push(plannedPair({ plex, jellyfin }, "manual"));
		plan.matched = plan.pairs.length;
		const decision = decidePair({ plex, jellyfin });
		plan.writes.push(...decision.writes);
		plan.positionConflicts += decision.positionConflicts;
	}
	return { ...plan, staleManualMatches, staleShowMatches };
}
