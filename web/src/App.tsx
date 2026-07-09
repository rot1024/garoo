import { createContext, useCallback, useEffect, useState } from "react";
import { Routes, Route, useLocation, type Location } from "react-router-dom";
import { ensureSession, clearKey } from "@/lib/auth";
import Login from "@/components/Login";
import Gallery from "@/pages/Gallery";
import Detail from "@/pages/Detail";
import { Loader2 } from "lucide-react";

interface AuthContextValue {
  /** Drop the session (e.g. on a 401 mid-browse) and return to the login screen. */
  onUnauthorized: () => void;
  /** Explicit sign-out: forget the stored key and show login. */
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  onUnauthorized: () => {},
  signOut: () => {},
});

type Status = "checking" | "authed" | "anon";

export default function App() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    ensureSession().then((ok) => {
      if (alive) setStatus(ok ? "authed" : "anon");
    });
    return () => {
      alive = false;
    };
  }, []);

  const onUnauthorized = useCallback(() => setStatus("anon"), []);
  const signOut = useCallback(() => {
    clearKey();
    setStatus("anon");
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "anon") {
    return <Login onSuccess={() => setStatus("authed")} />;
  }

  return (
    <AuthContext.Provider value={{ onUnauthorized, signOut }}>
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
