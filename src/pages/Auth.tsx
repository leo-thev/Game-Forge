import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button, Field } from "../components/UI";
import type { Language, Translator } from "../types";
import type { GameforgeSupabase } from "../lib/supabase";
import forgeLogo from "../assets/forge-logo.png";

type Props = {
  client: GameforgeSupabase;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translator;
};

export function Auth({ client, language, onLanguageChange, t }: Props) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const invitePending = Boolean(new URLSearchParams(window.location.search).get("invite")
    || sessionStorage.getItem("gameforge.pending-invite"));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signUp") {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        if (!data.session) setNotice(t("Account created, but email confirmation is still enabled. Turn off Confirm email in your Supabase email provider settings, then try again."));
      } else {
        const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Authentication failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-screen">
    <section className="auth-card">
      <header className="auth-brand"><span className="brand-mark"><img src={forgeLogo} alt="" /></span><strong>GAMEFORGE</strong><small>STUDIO</small></header>
      <div className="eyebrow"><span className="eyebrow-line" /> {t(invitePending ? "PROJECT INVITATION" : "YOUR CREATOR WORKSPACE")}</div>
      <h1>{t(mode === "signIn" ? "Welcome back." : "Create your account.")}</h1>
      <p className="auth-description">{t(invitePending ? "Sign in or create an account to join this project." : "Sign in to sync your Roblox projects securely across your devices.")}</p>
      <form className="auth-form" onSubmit={event => void submit(event)}>
        <Field label={t("Email address")} type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
        <label className="field auth-password-field">
          <span>{t("Password")}</span>
          <span className="auth-password-control">
            <input type={showPassword ? "text" : "password"} autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={mode === "signIn" ? undefined : 8} required value={password} onChange={event => setPassword(event.target.value)} />
            <button type="button" className="auth-password-toggle" aria-label={t(showPassword ? "Hide password" : "Show password")} title={t(showPassword ? "Hide password" : "Show password")} onClick={() => setShowPassword(visible => !visible)}>
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
        </label>
        {error && <p className="auth-message auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-message auth-success" role="status">{notice}</p>}
        <Button type="submit" disabled={busy} className="auth-submit">{busy ? t("Please wait...") : t(mode === "signIn" ? "Sign in" : "Create account")}<ArrowRight size={15} /></Button>
      </form>
      <div className="auth-switch">{t(mode === "signIn" ? "New to GAMEFORGE?" : "Already have an account?")} <button onClick={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setError(""); setNotice(""); }}>{t(mode === "signIn" ? "Create an account" : "Sign in")}</button></div>
      <div className="auth-language" role="group" aria-label={t("Language")}>
        {(["fr", "en"] as Language[]).map(option => <button key={option} className={language === option ? "auth-language-active" : ""} aria-pressed={language === option} onClick={() => onLanguageChange(option)}>{option.toUpperCase()}</button>)}
      </div>
    </section>
  </main>;
}
