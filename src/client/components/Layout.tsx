import { Link, Outlet, useLocation } from "react-router-dom";

export function Layout() {
  const location = useLocation();
  const path = location.pathname;

  // Detect adventure context: /adventure/:slug/... (slug is non-empty, not just /adventure)
  const advMatch = path.match(/^\/adventure\/([^/]+)/);
  const adventureSlug = advMatch ? decodeURIComponent(advMatch[1]) : null;

  const onSettings = path === "/settings" || (adventureSlug && path.endsWith("/settings"));

  // Settings link: preserve adventure context
  const settingsLink = adventureSlug
    ? `/adventure/${encodeURIComponent(adventureSlug)}/settings`
    : "/settings";

  // Back link: return to adventure or picker
  const backLink = adventureSlug
    ? `/adventure/${encodeURIComponent(adventureSlug)}`
    : "/adventure";
  const backLabel = adventureSlug ? "\u2190 Back" : "\u2190 Adventures";

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">RPG Tavern</h1>
        <div className="header-actions">
          {onSettings ? (
            <Link to={backLink} className="btn-sm" title={backLabel}>{backLabel}</Link>
          ) : (
            <Link to={settingsLink} className="settings-gear-btn" title="Settings">&#9881;</Link>
          )}
        </div>
      </header>
      <div className="tab-panel active">
        <Outlet />
      </div>
    </div>
  );
}
