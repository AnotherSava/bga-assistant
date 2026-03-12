// Section layout configuration: visibility/layout defaults.
// Section order follows the SECTION_IDS array order.

export type Visibility = "show" | "hide" | "none" | "unknown" | "base" | "echoes" | "cities";
export type Layout = "wide" | "tall";
export type Filter = "all" | "unknown";

export interface SectionConfig {
  defaultVisibility: Visibility;
  defaultFilter?: Filter;
  defaultLayout?: Layout;
}

export const SECTION_IDS = [
  "hand-opponent",
  "hand-me",
  "score-opponent",
  "score-me",
  "forecast-opponent",
  "forecast-me",
  "deck",
  "cards",
  "achievements",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Display labels for sections (matching rendered titles). */
export const SECTION_LABELS: Record<SectionId, string> = {
  "hand-opponent": "Hand \u2014 opponent",
  "hand-me": "Hand \u2014 me",
  "score-opponent": "Score \u2014 opponent",
  "score-me": "Score \u2014 me",
  "forecast-opponent": "Forecast \u2014 opponent",
  "forecast-me": "Forecast \u2014 me",
  "deck": "Deck",
  "cards": "Cards",
  "achievements": "Achievements",
};

/** Default section configuration. Order follows SECTION_IDS array. */
export const DEFAULT_SECTION_CONFIG: Record<SectionId, SectionConfig> = {
  "hand-opponent":  { defaultVisibility: "show" },
  "hand-me":        { defaultVisibility: "show" },
  "score-opponent":    { defaultVisibility: "none" },
  "score-me":          { defaultVisibility: "none" },
  "forecast-opponent": { defaultVisibility: "show" },
  "forecast-me":       { defaultVisibility: "show" },
  "deck":              { defaultVisibility: "base" },
  "cards":          { defaultVisibility: "base", defaultFilter: "unknown", defaultLayout: "wide" },
  "achievements":   { defaultVisibility: "none", defaultLayout: "wide" },
};

/** Visibility toggle options for a section. */
export interface ToggleOption {
  mode: string;
  label: string;
  active: boolean;
}

export interface Toggle {
  targetId: string;
  defaultMode: string;
  options: ToggleOption[];
}

/** Build a visibility toggle config for a section. */
export function visibilityToggle(sectionId: SectionId, defaultVisibility: Visibility, hasUnknown: boolean): Toggle {
  const modeMap: Record<string, string> = { show: "all", hide: "none", none: "none", unknown: "unknown" };
  const defaultMode = modeMap[defaultVisibility] ?? "none";

  const options: ToggleOption[] = hasUnknown
    ? [
        { mode: "none", label: "None", active: defaultMode === "none" },
        { mode: "all", label: "All", active: defaultMode === "all" },
        { mode: "unknown", label: "Unknown", active: defaultMode === "unknown" },
      ]
    : [
        { mode: "none", label: "Hide", active: defaultMode === "none" },
        { mode: "all", label: "Show", active: defaultMode === "all" },
      ];

  return { targetId: sectionId, defaultMode, options };
}

/** Build a layout toggle config for a section. */
export function layoutToggle(sectionId: SectionId, defaultLayout: Layout): Toggle {
  return {
    targetId: sectionId,
    defaultMode: defaultLayout,
    options: [
      { mode: "wide", label: "Wide", active: defaultLayout === "wide" },
      { mode: "tall", label: "Tall", active: defaultLayout === "tall" },
    ],
  };
}

/** Build a composite set toggle (Hide/Base/Echoes/Cities) for merged sections. */
export function compositeToggle(sectionId: SectionId, defaultVisibility: Visibility): Toggle {
  const defaultMode = defaultVisibility === "base" || defaultVisibility === "echoes" || defaultVisibility === "cities" ? defaultVisibility : "none";
  return {
    targetId: sectionId,
    defaultMode,
    options: [
      { mode: "none", label: "Hide", active: defaultMode === "none" },
      { mode: "base", label: "Base", active: defaultMode === "base" },
      { mode: "echoes", label: "Echoes", active: defaultMode === "echoes" },
      { mode: "cities", label: "Cities", active: defaultMode === "cities" },
    ],
  };
}

/** Sections that require the Echoes expansion. */
export const ECHOES_ONLY_SECTIONS: ReadonlySet<SectionId> = new Set(["forecast-opponent", "forecast-me"]);

/** Number of columns in tall layout (one per color). */
export const TALL_COLUMNS = 5;
