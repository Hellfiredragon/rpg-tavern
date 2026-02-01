import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/adventure", label: "Adventure" },
  { to: "/lorebook", label: "Lorebook" },
  { to: "/settings", label: "Settings" },
];

export function TabNav() {
  return (
    <nav className="tab-bar">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => "tab" + (isActive ? " active" : "")}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
