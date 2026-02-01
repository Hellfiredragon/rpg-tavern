import { Outlet } from "react-router-dom";
import { TabNav } from "./TabNav";

export function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">RPG Tavern</h1>
        <TabNav />
      </header>
      <div className="tab-panel active">
        <Outlet />
      </div>
    </div>
  );
}
