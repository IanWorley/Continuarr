import {
	type ExternalId,
	externalIdProviderSchema,
	SINGLE_EPISODE,
} from "~/backend/media/episode";
import type { ManualMatch, MediaItem } from "~/backend/media/model";
import {
	NO_POSITION_MS,
	POSITION_TOLERANCE_MS,
	TIMESTAMP_TOLERANCE_MS,
} from "./constants";

type Target = "plex" | "jellyfin";
type Destination = { itemId: string; title: string };
export type WatchedWrite = Destination &
	(
		| { kind: "watched"; target: "plex" }
		| { kind: "watched"; target: "jellyfin"; playedAt?: number }
	);
type PositionWrite = Destination & {
	kind: "position";
	target: Target;
	value: number;
};
type Write = WatchedWrite | PositionWrite;
type Candidate = { kind: "one"; index: number } | { kind: "many" };
type CandidateResult =
	| { kind: "none" | "many" }
	| { kind: "one"; index: number };

function decidePair({
	plex,
	jellyfin,
}: {
	plex: MediaItem;
	jellyfin: MediaItem;
}): { writes: Write[]; positionConflicts: 0 | 1 } {
	const writes: Write[] = [];
	if (plex.watched && !jellyfin.watched)
		writes.push({
			kind: "watched",
			target: "jellyfin",
			itemId: jellyfin.id,
			title: jellyfin.title,
			...(plex.history.lastPlayedAt !== null
				? { playedAt: plex.history.lastPlayedAt }
				: {}),
		});
	else if (jellyfin.watched && !plex.watched)
		writes.push({
			kind: "watched",
			target: "plex",
			itemId: plex.id,
			title: plex.title,
		});

	const plexPosition = plex.history.positionMs ?? NO_POSITION_MS;
	const jellyfinPosition = jellyfin.history.positionMs ?? NO_POSITION_MS;
	if (Math.abs(plexPosition - jellyfinPosition) <= POSITION_TOLERANCE_MS)
		return { writes, positionConflicts: 0 };

	const plexPlayedAt = plex.history.lastPlayedAt;
	const jellyfinPlayedAt = jellyfin.history.lastPlayedAt;
	if (
		plexPlayedAt === null ||
		jellyfinPlayedAt === null ||
		Math.abs(plexPlayedAt - jellyfinPlayedAt) <= TIMESTAMP_TOLERANCE_MS
	)
		return { writes, positionConflicts: 1 };

	const plexIsLater = plexPlayedAt > jellyfinPlayedAt;
	const destination = plexIsLater ? jellyfin : plex;
	const position = plexIsLater ? plexPosition : jellyfinPosition;
	if (position <= NO_POSITION_MS) return { writes, positionConflicts: 0 };

	writes.push({
		kind: "position",
		target: plexIsLater ? "jellyfin" : "plex",
		itemId: destination.id,
		title: destination.title,
		value: position,
	});
	return { writes, positionConflicts: 0 };
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

const seriesNumberRule: MatchRule = {
	keys: (item) => {
		const coordinates = regularCoordinates(item);
		if (!coordinates) return [];
		return seriesIds(item).map(({ provider, value }) =>
			JSON.stringify([
				provider,
				value,
				coordinates.season,
				coordinates.episode,
			]),
		);
	},
	conflicts: ({ plex, jellyfin }) =>
		haveConflictingIds(plex.ids, jellyfin.ids) ||
		haveConflictingIds(seriesIds(plex), seriesIds(jellyfin)),
};

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
 * and episode number, so numbers never override an ID.
 */
function planAutomaticUnion(input: Libraries): {
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
		seriesNumberRule,
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
		const otherSeries = new Set(others.flatMap(seriesIds).map(idKey));
		for (const item of items) {
			if (paired.has(item)) continue;
			const skip = skipFor(item, otherSeries);
			counts[skip.kind] += 1;
			if (skip.reason) counts[skip.reason] += 1;
		}
	}
	return { writes, matched: pairs.length, ...counts, positionConflicts };
}

export function planWatchedUnion(
	input: Libraries & { manualMatches?: ManualMatch[] },
): ReturnType<typeof planAutomaticUnion> & { staleManualMatches?: number } {
	const manual = input.manualMatches ?? [];
	if (!manual.length) return planAutomaticUnion(input);
	const reservedPlex = new Set(manual.map((match) => match.plexItemId));
	const reservedJellyfin = new Set(manual.map((match) => match.jellyfinItemId));
	const plan = planAutomaticUnion({
		plex: input.plex.filter((item) => !reservedPlex.has(item.id)),
		jellyfin: input.jellyfin.filter((item) => !reservedJellyfin.has(item.id)),
	});
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
		plan.matched++;
		const decision = decidePair({ plex, jellyfin });
		plan.writes.push(...decision.writes);
		plan.positionConflicts += decision.positionConflicts;
	}
	return { ...plan, staleManualMatches };
}
