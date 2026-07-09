import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginWithKey } from "@/lib/auth";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    const ok = await loginWithKey(key).catch(() => false);
    setBusy(false);
    if (ok) onSuccess();
    else setError("キーが正しくありません。もう一度お試しください");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-8 shadow-xl"
      >
        <div className="space-y-1.5 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">garoo gallery</h1>
          <p className="text-sm text-muted-foreground">
            アクセスキーを入力してください
          </p>
        </div>
        <Input
          type="password"
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="access key"
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !key}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          ログイン
        </Button>
      </motion.form>
    </div>
  );
}
