import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AdventurePage } from "./pages/AdventurePage";
import { LorebookPage } from "./pages/LorebookPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/adventure" replace />} />
        <Route path="/adventure" element={<AdventurePage />} />
        <Route path="/adventure/:slug" element={<AdventurePage />} />
        <Route path="/lorebook" element={<LorebookPage />} />
        <Route path="/lorebook/:slug" element={<LorebookPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/adventure" replace />} />
      </Route>
    </Routes>
  );
}
