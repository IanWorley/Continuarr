import type { MediaItem } from "~/backend/media/model";

type Target = "plex" | "jellyfin";
type Write = { target: Target; itemId: string; title: string };
type Candidate = { kind: "one"; index: number } | { kind: "many" };
type CandidateResult =
	| { kind: "none" | "many" }
	| { kind: "one"; index: number };

function externalIdKey(
	item: MediaItem,
	provider: string,
	value: string,
): string {
	return JSON.stringify([item.kind, provider, value]);
}

function indexItems(items: MediaItem[]): Map<string, Candidate> {
	const index = new Map<string, Candidate>();
	for (const [position, item] of items.entries()) {
		for (const { provider, value } of item.ids) {
			const key = externalIdKey(item, provider, value);
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
): CandidateResult {
	let candidate: CandidateResult = { kind: "none" };
	for (const { provider, value } of item.ids) {
		const found = index.get(externalIdKey(item, provider, value));
		if (!found) continue;
		if (found.kind === "many") return { kind: "many" };
		if (candidate.kind === "one" && candidate.index !== found.index)
			return { kind: "many" };
		candidate = found;
	}
	return candidate;
}

function hasConflictingIds(item: MediaItem): boolean {
	const byProvider = new Map<string, string>();
	for (const { provider, value } of item.ids) {
		const previous = byProvider.get(provider);
		if (previous && previous !== value) return true;
		byProvider.set(provider, value);
	}
	return false;
}

function haveConflictingIds(left: MediaItem, right: MediaItem): boolean {
	const leftIds = new Map(
		left.ids.map(({ provider, value }) => [provider, value]),
	);
	return right.ids.some(({ provider, value }) => {
		const leftValue = leftIds.get(provider);
		return leftValue !== undefined && leftValue !== value;
	});
}

/**
 * `matched` counts unique Plex/Jellyfin pairs. `unmatched` and `ambiguous`
 * count individual items, so `2 * matched + unmatched + ambiguous` equals
 * the number of input items. An item is ambiguous when it shares an external
 * ID but cannot form a unique, conflict-free pair, or has conflicting IDs of
 * its own. Items with no shared external ID are unmatched.
 */
export function planWatchedUnion(input: {
	plex: MediaItem[];
	jellyfin: MediaItem[];
}): { writes: Write[]; matched: number; unmatched: number; ambiguous: number } {
	const plexIndex = indexItems(input.plex);
	const jellyfinIndex = indexItems(input.jellyfin);
	const plexCandidates = input.plex.map((item) =>
		candidateFor(item, jellyfinIndex),
	);
	const jellyfinCandidates = input.jellyfin.map((item) =>
		candidateFor(item, plexIndex),
	);
	const matchedPlex = new Set<number>();
	const matchedJellyfin = new Set<number>();
	const writes: Write[] = [];

	for (const [plexPosition, plex] of input.plex.entries()) {
		const candidate = plexCandidates[plexPosition];
		if (candidate.kind !== "one") continue;
		const jellyfinPosition = candidate.index;
		const jellyfin = input.jellyfin[jellyfinPosition];
		const reverse = jellyfinCandidates[jellyfinPosition];
		if (
			!jellyfin ||
			reverse?.kind !== "one" ||
			reverse.index !== plexPosition ||
			hasConflictingIds(plex) ||
			hasConflictingIds(jellyfin) ||
			haveConflictingIds(plex, jellyfin)
		)
			continue;

		matchedPlex.add(plexPosition);
		matchedJellyfin.add(jellyfinPosition);
		if (plex.watched && !jellyfin.watched)
			writes.push({
				target: "jellyfin",
				itemId: jellyfin.id,
				title: jellyfin.title,
			});
		else if (jellyfin.watched && !plex.watched)
			writes.push({ target: "plex", itemId: plex.id, title: plex.title });
	}

	let unmatched = 0;
	let ambiguous = 0;
	for (const [position, item] of input.plex.entries()) {
		if (matchedPlex.has(position)) continue;
		if (plexCandidates[position]?.kind === "none" && !hasConflictingIds(item))
			unmatched += 1;
		else ambiguous += 1;
	}
	for (const [position, item] of input.jellyfin.entries()) {
		if (matchedJellyfin.has(position)) continue;
		if (
			jellyfinCandidates[position]?.kind === "none" &&
			!hasConflictingIds(item)
		)
			unmatched += 1;
		else ambiguous += 1;
	}
	return { writes, matched: matchedPlex.size, unmatched, ambiguous };
}
