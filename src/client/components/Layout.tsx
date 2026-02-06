import { Link, Outlet, useLocation } from "react-router-dom";

export function Layout() {
  const location = useLocation();
  const onSettings = location.pathname === "/settings";

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">RPG Tavern</h1>
        <div className="header-actions">
          {onSettings ? (
            <Link to="/adventure" className="btn-sm" title="Back to adventures">&larr; Adventures</Link>
          ) : (
            <Link to="/settings" className="settings-gear-btn" title="Settings">&#9881;</Link>
          )}
        </div>
      </header>
      <div className="tab-panel active">
        <Outlet />
      </div>
    </div>
  );
}
