# Restructure GameState and Type PipelineResults

## Overview

Separate Innovation's GameState into plain serializable data and pure functions,
and add type safety to PipelineResults with a discriminated union.

## Status: Draft — needs detailed discussion

## Findings to include

### 1. Separate GameState logic from data (Review Finding #3)

Innovation's `GameState` mixes data (Maps, Sets, card zones) with methods (constraint
propagation, queries, serialization) and a `CardDatabase` reference. This forces explicit
`toJSON()`/`fromJSON()` at every context boundary. If the state were plain serializable
data with logic in separate pure functions, Chrome could auto-serialize it — eliminating
the manual serialization layer.

### 2. Type `PipelineResults` with a discriminated union (Review Finding #3)

Replace `any` on `gameLog` and `gameState` with game-specific types, discriminated
by `gameName`. Depends on item 1 settling the final shape of GameState, and on the
flow unification in the review findings plan (item 3.5) which makes `gameState`
nullable for unsupported games.
