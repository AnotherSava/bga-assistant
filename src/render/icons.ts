// Shared render utilities used across game-specific renderers.
// SVG path data matches the inline SVGs in sidepanel.html.

const SEARCH_PATH = "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";
const EYE_PATH = "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
const DOWNLOAD_PATH = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z";

function svg24(path: string, size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="${path}"/></svg>`;
}

export const ICON_ZOOM_OUT = svg24(SEARCH_PATH, 14);
export const ICON_ZOOM_IN = svg24(SEARCH_PATH, 18);
export const ICON_EYE = svg24(EYE_PATH, 16);
export const ICON_DOWNLOAD = svg24(DOWNLOAD_PATH, 16);
export const ICON_DOT_GREEN = '<svg width="8" height="8" viewBox="0 0 8 8" style="vertical-align:middle"><circle cx="4" cy="4" r="4" fill="#4caf50"/></svg>';
export const ICON_DOT_RED = '<svg width="8" height="8" viewBox="0 0 8 8" style="vertical-align:middle"><circle cx="4" cy="4" r="4" fill="#d32f2f"/></svg>';

const PANEL_RECT = '<rect x="2" y="3" width="24" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>';
const CHEVRON_1 = '<path d="M12 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const CHEVRON_2A = '<path d="M9 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const CHEVRON_2B = '<path d="M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';

function svgPanel(inner: string): string {
  return `<svg viewBox="0 0 28 24" width="16" height="14">${PANEL_RECT}${inner}</svg>`;
}

export const ICON_PANEL = svgPanel("");
export const ICON_PANEL_1 = svgPanel(CHEVRON_1);
export const ICON_PANEL_2 = svgPanel(CHEVRON_2A + CHEVRON_2B);

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
