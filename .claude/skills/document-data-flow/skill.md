---
name: document-data-flow
description: Create or update the data flow architecture document (docs/data-flow.md).
allowed-tools: Read, Glob, Grep, Write, Edit, Agent
---

# Document Data Flow

Create or update `docs/data-flow.md` — a reference document tracing how data moves between the Chrome extension's three contexts (content script, background service worker, side panel).

## When to run

- After adding a new game pipeline
- After changing message protocols between components
- After modifying serialization boundaries or adding new message types

## Workflow

### Step 1: Research current data flow

Read these files to understand the current state:
- `src/extract.ts` — content script, what it extracts and returns
- `src/background.ts` — orchestration, pipeline, message handling
- `src/sidepanel/sidepanel.ts` — rendering, message handling, downloads
- `src/models/types.ts` — shared types
- Game-specific modules under `src/games/*/`

### Step 2: Update the document

Update `docs/data-flow.md` covering:
- Component overview (content script, background, side panel)
- Serialization constraint (why toJSON/fromJSON exist)
- Data flow diagrams for each flow (extraction, live tracking, ZIP download)
- Message protocol tables (all message types, both directions)
- Connection management and asset resolution

### General formatting rules

- Component names are capitalized: Content Script, Background Service Worker, Side Panel
- Component names in headers and flow diagrams use bold italic: `***Background Service Worker***`
- Component names in running text use italic: `*Background Service Worker*`
- Do not hardcode file paths in component headers — a component may span multiple files
- Each component section in the overview ends with a "Key files:" bulleted list with brief descriptions
- Component descriptions in the overview list responsibilities but should not include method names — save those for the detailed flow diagrams
- Method/function references must include their file or class prefix: `background.runPipeline()`, `GameState.toJSON()`. Lowercase prefix = module file, uppercase prefix = class. Omit the prefix only when all methods listed together belong to the same file/class and it is specified explicitly.

### Formatting rules for data flow diagrams

Each flow section has this structure:
1. **Summary paragraph** — what this flow does, in 1-2 sentences
2. **Triggers** — bulleted list of what initiates this flow
3. **Horizontal rule** (`---`) — separates the description from the flow steps
4. **Flow steps** — alternating component headers and numbered action lists

**Component headers** in flow steps use bold italic on their own line:

```
***Background Service Worker***
```

**Action lists** are numbered Markdown lists under each component header. Include
method names with file/class prefixes:

```
***Background Service Worker***

1. Classify the current tab URL via `background.classifyNavigation()`
2. Determine gameName and tableNumber, lock against concurrent extractions
3. Send `"loading"` message to *Side Panel*
4. Inject `dist/extract.js` into the BGA page
```

**Data transitions** between components use fenced code blocks with `⇩` prefix.
Each line inside the block starts with `⇩` followed by three spaces:

````
```
⇩   RawExtractionData (auto-serialized by Chrome):
⇩   { players, gamedatas: {my_hand, cards}, packets: RawPacket[] }
```
````

If no data is passed across a boundary, say so explicitly:

````
```
⇩   (no data passed to Content Script)
```
````

**Key rules:**
- Do NOT mix actions and data — the code block region is only for data labels
- Data transitions always appear between two component headers
- Messages (e.g. `"resultsReady"`, `"getResults"`) are data — show them in code blocks

### Formatting rules for branching flows

When a flow branches (e.g., supported vs unsupported game), use an HTML `<table>` with:
- One column per branch, headers (`<th>`) describing each branch
- One row per component step — each cell contains the data received (code block) then the component name and its actions
- Use `valign="top"` on `<td>` elements so shorter branches align to the top
- Empty `<td></td>` for rows where only one branch continues
- Use Markdown inside `<td>` (with a blank line after the opening tag) for formatting
- Each component gets its own row to keep numbered lists independent

### Step 3: Verify

- Ensure all message types from the source code appear in the protocol tables
- Ensure new game pipelines are represented in the extraction flow
- Check that the document is consistent with actual code
