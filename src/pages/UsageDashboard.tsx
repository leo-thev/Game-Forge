import { useEffect, useState } from "react";
import { Activity, CalendarClock, RefreshCw, Users } from "lucide-react";
import type { Translator, UsageStats } from "../types";
import { Button, Heading } from "../components/UI";
import { getUsageStats } from "../lib/cloudStorage";
import type { GameforgeSupabase } from "../lib/supabase";

export function UsageDashboard({ client, t }: { client: GameforgeSupabase; t: Translator }) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await getUsageStats(client));
    } catch (caught) {
      console.error("GAMEFORGE could not load private usage statistics.", caught);
      setError(caught instanceof Error ? caught.message : t("Usage statistics could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [client]);

  const lastActivity = stats?.lastActivityAt
    ? new Date(stats.lastActivityAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : t("No activity recorded yet.");

  return <div className="page-content usage-dashboard">
    <Heading eyebrow={t("PRIVATE ADMIN")} title={t("Usage dashboard")} description={t("See aggregate usage of GAMEFORGE. No emails, IP addresses, or project content are collected.")} actions={<Button variant="secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} />{t("Refresh")}</Button>} />
    {error && <p className="usage-error" role="alert">{error}</p>}
    {loading && !stats ? <div className="usage-loading" role="status">{t("Loading usage statistics...")}</div> : stats && <>
      <section className="usage-stat-grid" aria-label={t("Usage statistics")}>
        <article className="usage-stat-card"><span><Activity size={16} /></span><small>{t("Recorded visits")}</small><strong>{stats.totalVisits.toLocaleString()}</strong><p>{t("Signed-in visits, counted at most once every 30 minutes per account.")}</p></article>
        <article className="usage-stat-card"><span><Users size={16} /></span><small>{t("Accounts created")}</small><strong>{stats.accountsCreated.toLocaleString()}</strong><p>{t("Total accounts registered in this Supabase project.")}</p></article>
        <article className="usage-stat-card"><span><Users size={16} /></span><small>{t("Active in the last 7 days")}</small><strong>{stats.activeUsers7d.toLocaleString()}</strong><p>{t("Unique signed-in accounts.")}</p></article>
        <article className="usage-stat-card"><span><Users size={16} /></span><small>{t("Active in the last 30 days")}</small><strong>{stats.activeUsers30d.toLocaleString()}</strong><p>{t("Unique signed-in accounts.")}</p></article>
        <article className="usage-stat-card usage-stat-wide"><span><CalendarClock size={16} /></span><small>{t("Last recorded activity")}</small><strong>{lastActivity}</strong></article>
      </section>
      <p className="usage-privacy-note">{t("Only aggregate figures are shown here. Account IDs are stored privately to count unique active accounts; they are never returned by the statistics API.")}</p>
    </>}
  </div>;
}
