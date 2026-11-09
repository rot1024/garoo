import { createContext, useCallback, useEffect, useState } from "react";
import { Routes, Route, useLocation, type Location } from "react-router-dom";
import { getSession } from "@/lib/api";
import Gallery from "@/pages/Gallery";
import Detail from "@/pages/Detail";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthContextValue {
  /** The Access session was rejected mid-browse (e.g. expired) — ask to reload. */
  onUnauthorized: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  onUnauthorized: () => {},
});

type Status = "checking" | "authed" | "anon";

// Login is handled entirely by Cloudflare Access in front of the Worker: by the
// time this SPA loads, the user has already authenticated. "anon" only happens
// when the Access session expired (or Access is misconfigured); reloading the
// page sends the user back through the Access login.
export default function App() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    getSession().then((ok) => {
      if (alive) setStatus(ok ? "authed" : "anon");
    });
    return () => {
      alive = false;
    };
  }, []);

  const onUnauthorized = useCallback(() => setStatus("anon"), []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "anon") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-8 text-center shadow-xl">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">garoo gallery</h1>
            <p className="text-sm text-muted-foreground">
              認証の有効期限が切れました。再読み込みしてログインしてください
            </p>
          </div>
          <Button className="w-full" onClick={() => window.location.reload()}>
            再読み込み
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ onUnauthorized }}>
      <AppRoutes />
    </AuthContext.Provider>
  );
}

// Modal routing: when a detail link is opened from the gallery it carries a
// `backgroundLocation` in state. We render the main <Routes> against that
// background (so the gallery stays mounted — scroll and filters preserved) and
// render the detail a second time as a modal over it. A direct deep-link has no
// background, so the detail renders as a full page instead.
function AppRoutes() {
  const location = useLocation();
  const state = location.state as { backgroundLocation?: Location } | null;
  const background = state?.backgroundLocation;

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/" element={<Gallery />} />
        <Route path="/p/:provider/:id" element={<Detail />} />
      </Routes>
      {background && (
        <Routes>
          <Route path="/p/:provider/:id" element={<Detail modal />} />
        </Routes>
      )}
    </>
  );
}
