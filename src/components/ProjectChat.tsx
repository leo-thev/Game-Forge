import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CornerUpLeft, Link2, MessageSquareText, Pin, Send, Trash2 } from "lucide-react";
import type { ProjectResource, ProjectTeamMember, Translator } from "../types";
import type { GameforgeSupabase } from "../lib/supabase";

type ProjectMessage = {
  id: string;
  project_id: string;
  author_id: string;
  resource_id: string | null;
  reply_to_id: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  message: string;
  created_at: string;
};

type MessageReaction = {
  project_id: string;
  message_id: string;
  user_id: string;
  emoji: string;
};

const reactionEmojis = ["👍", "❤️", "😂", "😮", "🎉"];
const messageColumns = "id, project_id, author_id, resource_id, reply_to_id, pinned_at, pinned_by, message, created_at";
const reactionKey = (reaction: MessageReaction) => `${reaction.message_id}:${reaction.user_id}:${reaction.emoji}`;

export function ProjectChat({ client, projectId, currentUserId, isProjectOwner, resources, teamMembers, t }: {
  client: GameforgeSupabase;
  projectId: string;
  currentUserId: string;
  isProjectOwner: boolean;
  resources: ProjectResource[];
  teamMembers: ProjectTeamMember[];
  t: Translator;
}) {
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [draft, setDraft] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [replyTo, setReplyTo] = useState<ProjectMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setReactions([]);
    setReplyTo(null);
    setLoading(true);
    setError("");

    const channel = client.channel(`gameforge-chat-${projectId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "gameforge_project_messages",
        filter: `project_id=eq.${projectId}`,
      }, payload => {
        if (payload.eventType === "DELETE") {
          const removedId = (payload.old as ProjectMessage).id;
          setMessages(current => current.filter(message => message.id !== removedId)
            .map(message => message.reply_to_id === removedId ? { ...message, reply_to_id: null } : message));
          setReactions(current => current.filter(reaction => reaction.message_id !== removedId));
          setReplyTo(current => current?.id === removedId ? null : current);
        } else {
          const incoming = payload.new as ProjectMessage;
          setMessages(current => [...new Map(
            [...current.filter(message => message.id !== incoming.id), incoming].map(message => [message.id, message]),
          ).values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-100));
        }
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "gameforge_project_message_reactions",
        filter: `project_id=eq.${projectId}`,
      }, payload => {
        const changed = (payload.eventType === "DELETE" ? payload.old : payload.new) as MessageReaction;
        const key = reactionKey(changed);
        if (payload.eventType === "DELETE") {
          setReactions(current => current.filter(reaction => reactionKey(reaction) !== key));
        } else {
          setReactions(current => current.some(reaction => reactionKey(reaction) === key)
            ? current
            : [...current, changed]);
        }
      })
      .subscribe((status, subscriptionError) => {
        if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
          setError(subscriptionError?.message ?? t("Live chat connection failed."));
        }
      });

    void (async () => {
      try {
        const [messageResult, reactionResult] = await Promise.all([
          client.from("gameforge_project_messages")
            .select(messageColumns)
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .limit(100),
          client.from("gameforge_project_message_reactions")
            .select("project_id, message_id, user_id, emoji")
            .eq("project_id", projectId),
        ]);
        if (!active) return;
        if (messageResult.error) throw messageResult.error;
        if (reactionResult.error) throw reactionResult.error;
        const loadedMessages = [...(messageResult.data ?? []) as ProjectMessage[]].reverse();
        setMessages(current => [...new Map(
          [...loadedMessages, ...current].map(message => [message.id, message]),
        ).values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-100));
        setReactions(current => [...new Map(
          [...(reactionResult.data ?? []) as MessageReaction[], ...current].map(reaction => [reactionKey(reaction), reaction]),
        ).values()]);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : t("Project chat could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, projectId, t]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const { data, error: sendError } = await client.from("gameforge_project_messages")
        .insert({
          project_id: projectId,
          author_id: currentUserId,
          resource_id: resourceId || null,
          reply_to_id: replyTo?.id ?? null,
          message,
        })
        .select(messageColumns)
        .single();
      if (sendError) throw sendError;
      const sent = data as ProjectMessage;
      setMessages(current => current.some(item => item.id === sent.id) ? current : [...current, sent].slice(-100));
      setDraft("");
      setResourceId("");
      setReplyTo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Message could not be sent."));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    const key = `${messageId}:${currentUserId}:${emoji}`;
    if (busyAction) return;
    setBusyAction(key);
    setError("");
    try {
      const existing = reactions.some(reaction => reactionKey(reaction) === key);
      if (existing) {
        const { error: deleteError } = await client.from("gameforge_project_message_reactions")
          .delete()
          .eq("project_id", projectId)
          .eq("message_id", messageId)
          .eq("user_id", currentUserId)
          .eq("emoji", emoji);
        if (deleteError) throw deleteError;
        setReactions(current => current.filter(reaction => reactionKey(reaction) !== key));
      } else {
        const reaction: MessageReaction = { project_id: projectId, message_id: messageId, user_id: currentUserId, emoji };
        const { error: insertError } = await client.from("gameforge_project_message_reactions").insert(reaction);
        if (insertError) throw insertError;
        setReactions(current => current.some(item => reactionKey(item) === key) ? current : [...current, reaction]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Reaction could not be saved."));
    } finally {
      setBusyAction("");
    }
  };

  const togglePin = async (message: ProjectMessage) => {
    if (busyAction) return;
    setBusyAction(`pin:${message.id}`);
    setError("");
    const pinnedAt = message.pinned_at ? null : new Date().toISOString();
    try {
      const { data, error: pinError } = await client.from("gameforge_project_messages")
        .update({ pinned_at: pinnedAt, pinned_by: pinnedAt ? currentUserId : null })
        .eq("id", message.id)
        .eq("project_id", projectId)
        .select(messageColumns)
        .single();
      if (pinError) throw pinError;
      const updated = data as ProjectMessage;
      setMessages(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Pin could not be updated."));
    } finally {
      setBusyAction("");
    }
  };

  const deleteMessage = async (message: ProjectMessage) => {
    if (busyAction || !window.confirm(t("Delete this message?"))) return;
    setBusyAction(`delete:${message.id}`);
    setError("");
    try {
      const { error: deleteError } = await client.from("gameforge_project_messages")
        .delete()
        .eq("id", message.id)
        .eq("project_id", projectId);
      if (deleteError) throw deleteError;
      setMessages(current => current.filter(item => item.id !== message.id)
        .map(item => item.reply_to_id === message.id ? { ...item, reply_to_id: null } : item));
      setReactions(current => current.filter(reaction => reaction.message_id !== message.id));
      if (replyTo?.id === message.id) setReplyTo(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Message could not be deleted."));
    } finally {
      setBusyAction("");
    }
  };

  const resourceById = new Map(resources.map(resource => [resource.id, resource]));
  const messageById = new Map(messages.map(message => [message.id, message]));
  const teamById = new Map(teamMembers.map(member => [member.id, member]));
  const pinnedMessages = messages.filter(message => message.pinned_at);
  const displayName = (authorId: string) => teamById.get(authorId)?.displayName
    ?? (authorId === currentUserId ? t("You") : t("Collaborator"));
  const authorIdentity = (authorId: string) => {
    const roles = teamById.get(authorId)?.roles ?? [];
    return <span className="project-chat-author-identity">
      <strong>{displayName(authorId)}</strong>
      {roles.map(role => <small className="project-role-badge" key={role}>{t(role)}</small>)}
    </span>;
  };

  return <section className="project-chat panel" aria-label={t("Project chat")}>
    <header className="project-chat-heading">
      <span className="workspace-stat-icon blue"><MessageSquareText size={15} /></span>
      <div><h2>{t("Project chat")}</h2><p>{t("Talk with project collaborators and attach a linked resource.")}</p></div>
    </header>
    <div className="project-chat-messages" aria-live="polite">
      {pinnedMessages.length > 0 && <aside className="project-chat-pinned-list" aria-label={t("Pinned messages")}>
        <strong><Pin size={12} />{t("Pinned messages")}</strong>
        {pinnedMessages.map(message => <button key={message.id} type="button" onClick={() => document.getElementById(`chat-message-${message.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          <span>{displayName(message.author_id)}</span>{message.message}
        </button>)}
      </aside>}
      {loading ? <div className="project-chat-empty">{t("Loading messages...")}</div>
        : messages.length === 0 ? <div className="project-chat-empty">{t("No messages yet. Start the conversation.")}</div>
          : messages.map(message => {
            const attached = message.resource_id ? resourceById.get(message.resource_id) : undefined;
            const parent = message.reply_to_id ? messageById.get(message.reply_to_id) : undefined;
            const isOwnReaction = (emoji: string) => reactions.some(reaction =>
              reaction.message_id === message.id && reaction.user_id === currentUserId && reaction.emoji === emoji);
            return <article className={`project-chat-message ${message.author_id === currentUserId ? "project-chat-own" : ""} ${message.pinned_at ? "project-chat-pinned" : ""}`} id={`chat-message-${message.id}`} key={message.id}>
              <header>
                {authorIdentity(message.author_id)}
                <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</time>
              </header>
              {message.pinned_at && <div className="project-chat-pinned-label"><Pin size={11} />{t("Pinned")}</div>}
              {message.reply_to_id && <a className="project-chat-reply-quote" href={parent ? `#chat-message-${parent.id}` : undefined}>
                <CornerUpLeft size={12} /><span>{parent ? `${t("Replying to")} ${displayName(parent.author_id)}: ${parent.message}` : t("Reply to an earlier message")}</span>
              </a>}
              <p>{message.message}</p>
              {attached && <a className="project-chat-attachment" href="#project-resources"><Link2 size={13} /><span>{attached.title}</span><small>{t(attached.kind)} · {t(attached.category)}</small></a>}
              <div className="project-chat-reactions">
                {reactionEmojis.map(emoji => {
                  const count = reactions.filter(reaction => reaction.message_id === message.id && reaction.emoji === emoji).length;
                  return <button key={emoji} type="button" className={`project-chat-reaction ${isOwnReaction(emoji) ? "project-chat-reaction-own" : ""}`} aria-label={`${t("React with")} ${emoji}`} aria-pressed={isOwnReaction(emoji)} disabled={Boolean(busyAction)} onClick={() => void toggleReaction(message.id, emoji)}>{emoji}{count > 0 && <span>{count}</span>}</button>;
                })}
              </div>
              <footer className="project-chat-message-actions">
                <button type="button" onClick={() => setReplyTo(message)}><CornerUpLeft size={12} />{t("Reply")}</button>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => void togglePin(message)}><Pin size={12} />{t(message.pinned_at ? "Unpin" : "Pin")}</button>
                {(message.author_id === currentUserId || isProjectOwner) && <button type="button" disabled={Boolean(busyAction)} onClick={() => void deleteMessage(message)}><Trash2 size={12} />{t("Delete")}</button>}
              </footer>
            </article>;
          })}
      <div ref={bottomRef} />
    </div>
    {error && <p className="project-chat-error" role="alert">{error}</p>}
    <form className="project-chat-compose" onSubmit={event => void send(event)}>
      {replyTo && <div className="project-chat-replying"><CornerUpLeft size={13} /><span>{t("Replying to")} {displayName(replyTo.author_id)}: {replyTo.message}</span><button type="button" aria-label={t("Cancel reply")} onClick={() => setReplyTo(null)}>×</button></div>}
      <textarea aria-label={t("Message")} rows={2} maxLength={4000} placeholder={t("Write a message...")} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={handleKeyDown} />
      <div className="project-chat-compose-actions">
        <label className="project-chat-resource"><Link2 size={13} /><select aria-label={t("Attach linked resource")} value={resourceId} onChange={event => setResourceId(event.target.value)}><option value="">{t("Attach resource (optional)")}</option>{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.title}</option>)}</select></label>
        <button className="project-chat-send" type="submit" disabled={!draft.trim() || sending} aria-label={t("Send message")}><Send size={14} />{t("Send")}</button>
      </div>
    </form>
  </section>;
}
