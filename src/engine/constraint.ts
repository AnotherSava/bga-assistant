// Game-agnostic constraint-propagation kernel.
//
// Models the bipartite-matching deduction problem common to hidden-information
// card games: a finite set of cards must be assigned 1:1 to a finite set of
// placeholders. Each placeholder carries a candidate set of card identities it
// could be. Propagation rules narrow these candidate sets toward a unique
// assignment.
//
// Three rules, applied to fixed-point:
//
//   1. Naked single — a placeholder with one candidate eliminates that card
//      from all other placeholders' candidates.
//   2. Hidden single (per-placeholder) — a card appearing in only one
//      placeholder's candidates must be that placeholder.
//   3. Hidden single (per-container) — a card appearing in only one container's
//      placeholders must be in that container; resolve any matching placeholder
//      there (slots within a container are treated as interchangeable).
//
// Mutation contract: the kernel only mutates `candidates` Sets in place
// (`add`, `delete`, `clear` + `add`). It never replaces the Set reference, so
// callers holding the original Set continue to see all changes.

export interface Placeholder<CardId> {
  candidates: Set<CardId>;
}

export interface PropagateOptions<P> {
  /** When provided, enables hidden-single per-container deduction. Omit to skip that pass. */
  containerOf?: (placeholder: P) => string;
  /** Return true for containers whose placeholders have observable order (e.g. a deck whose
   *  position is later referenced by grouped-draw semantics). For ordered containers,
   *  per-container hidden-single does NOT commit to a specific placeholder — the deduction
   *  "name N is in container C" is already implicit in the candidate sets, and committing
   *  would falsely pin a name to a position the observer cannot actually know.
   *  Defaults to all-unordered. */
  isContainerOrdered?: (containerId: string) => boolean;
  /** Set true to enable naked-N-tuple pruning (pure prune, no commit). Default false to preserve
   *  prior behavior; opt in per-game where the deduction adds value beyond the singleton rules. */
  enableNakedTuples?: boolean;
}

/** Run propagation rules to fixed-point. Returns true if anything changed.
 *  Always runs: naked single, hidden single per-placeholder, naked N-tuples.
 *  Conditional: hidden single per-container — requires `containerOf` callback.
 *  Per-container is a no-op in ordered containers (see `isContainerOrdered`). */
export function propagate<CardId, P extends Placeholder<CardId>>(
  placeholders: ReadonlyArray<P>,
  options: PropagateOptions<P> = {},
): boolean {
  let anyChange = false;
  let changed = true;
  while (changed) {
    changed = false;
    if (nakedSingles(placeholders)) { changed = true; anyChange = true; }
    if (hiddenSinglesPerPlaceholder(placeholders)) { changed = true; anyChange = true; }
    if (options.containerOf && hiddenSinglesPerContainer(placeholders, options.containerOf, options.isContainerOrdered)) { changed = true; anyChange = true; }
    if (options.enableNakedTuples && nakedTuples(placeholders)) { changed = true; anyChange = true; }
  }
  return anyChange;
}

/** Naked single: a placeholder with one candidate removes that card from all others. */
export function nakedSingles<CardId, P extends Placeholder<CardId>>(placeholders: ReadonlyArray<P>): boolean {
  let anyChange = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of placeholders) {
      if (slot.candidates.size !== 1) continue;
      const resolved = slot.candidates.values().next().value as CardId;
      for (const other of placeholders) {
        if (other === slot) continue;
        if (other.candidates.delete(resolved)) {
          changed = true;
          anyChange = true;
        }
      }
    }
  }
  return anyChange;
}

/** Hidden single per-placeholder: a card in only one placeholder's candidates resolves that placeholder. */
export function hiddenSinglesPerPlaceholder<CardId, P extends Placeholder<CardId>>(placeholders: ReadonlyArray<P>): boolean {
  let anyChange = false;
  while (true) {
    const cardToHolders = new Map<CardId, P[]>();
    for (const slot of placeholders) {
      for (const card of slot.candidates) {
        let holders = cardToHolders.get(card);
        if (!holders) { holders = []; cardToHolders.set(card, holders); }
        holders.push(slot);
      }
    }

    let madeChange = false;
    for (const [card, holders] of cardToHolders) {
      if (holders.length !== 1) continue;
      const slot = holders[0];
      if (slot.candidates.size === 1) continue;
      slot.candidates.clear();
      slot.candidates.add(card);
      madeChange = true;
      anyChange = true;
      break;
    }
    if (!madeChange) break;
  }
  return anyChange;
}

/** Naked N-tuple: if N placeholders' combined candidates have size N, those N cards are confined
 *  to those N placeholders — remove them from all other placeholders' candidates. Iterates k=2..M-1
 *  where M is the number of eligible placeholders (those with |candidates| ≤ k). Pure pruning, never
 *  commits a placeholder to a specific name, so it's safe regardless of container order. */
export function nakedTuples<CardId, P extends Placeholder<CardId>>(placeholders: ReadonlyArray<P>): boolean {
  let anyChange = false;
  for (let k = 2; k < placeholders.length; k++) {
    const eligible = placeholders.filter(p => p.candidates.size > 1 && p.candidates.size <= k);
    if (eligible.length < k) continue;

    forEachKSubset(eligible.length, k, indices => {
      const union = new Set<CardId>();
      for (const i of indices) for (const c of eligible[i].candidates) union.add(c);
      if (union.size !== k) return;

      const subsetSet = new Set(indices.map(i => eligible[i]));
      for (const p of placeholders) {
        if (subsetSet.has(p)) continue;
        for (const c of union) {
          if (p.candidates.delete(c)) anyChange = true;
        }
      }
    });
  }
  return anyChange;
}

/** Enumerate all k-element index subsets of [0, n) in lexicographic order. */
function forEachKSubset(n: number, k: number, callback: (indices: number[]) => void): void {
  if (k > n) return;
  const indices = new Array<number>(k);
  for (let i = 0; i < k; i++) indices[i] = i;
  while (true) {
    callback(indices);
    let i = k - 1;
    while (i >= 0 && indices[i] === n - k + i) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

/** Hidden single per-container: a card in only one container's placeholders resolves a slot there.
 *  In ordered containers (e.g. decks), no commit happens — committing would falsely pin a name
 *  to a position the observer cannot know. */
export function hiddenSinglesPerContainer<CardId, P extends Placeholder<CardId>>(
  placeholders: ReadonlyArray<P>,
  containerOf: (placeholder: P) => string,
  isContainerOrdered?: (containerId: string) => boolean,
): boolean {
  let anyChange = false;
  while (true) {
    const cardToContainers = new Map<CardId, Set<string>>();
    for (const slot of placeholders) {
      const container = containerOf(slot);
      for (const card of slot.candidates) {
        let containers = cardToContainers.get(card);
        if (!containers) { containers = new Set(); cardToContainers.set(card, containers); }
        containers.add(container);
      }
    }

    let madeChange = false;
    for (const [card, containers] of cardToContainers) {
      if (containers.size !== 1) continue;
      const container = containers.values().next().value as string;
      if (isContainerOrdered?.(container)) continue;
      const candidates = placeholders.filter(p => containerOf(p) === container && p.candidates.has(card));
      if (candidates.some(p => p.candidates.size === 1)) continue;
      // Slots within an unordered container are interchangeable: pick smallest candidate set.
      const target = candidates.reduce((best, p) => p.candidates.size < best.candidates.size ? p : best, candidates[0]);
      target.candidates.clear();
      target.candidates.add(card);
      madeChange = true;
      anyChange = true;
      break;
    }
    if (!madeChange) break;
  }
  return anyChange;
}
