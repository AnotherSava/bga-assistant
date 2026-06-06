---
name: No defensive fallbacks
description: Do not add fallback values that mask invalid data — let null/errors surface naturally
type: feedback
---

Do not add defensive fallbacks (e.g. `?? "?"`, `?? 0`, `?? "unknown"`) that silently produce plausible-looking output from invalid data.

**Why:** Defensive fallbacks hide bugs in upstream logic. A visible `null` in output or a runtime error is easier to catch and debug than output that looks correct but isn't.

**How to apply:** Trust that inputs are correct. Only add validation at true system boundaries (user input, external APIs). For internal data flowing between modules, let invalid values propagate naturally so they fail visibly.
