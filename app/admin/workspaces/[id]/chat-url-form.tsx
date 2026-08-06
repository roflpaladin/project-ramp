import { setChatUrls } from "./chat-url-actions";

interface ChatUrlFormProps {
  workspaceId: string;
  chatUrl: string | null;
  internalChatUrl: string | null;
}

/**
 * Seller write path for the two chat-presence urls (T32-3). setChatUrls
 * (chat-url-actions.ts, T32-2) already exists but had no FE consumer -- this
 * is that consumer. A blank field clears the url (matches
 * setChatUrls/parseChatUrlField's empty-string-in, null-out contract).
 *
 * Plain form + Server Action, no client-side state, matching addLink's
 * shape in page.tsx -- setChatUrls returns void and re-renders via
 * revalidatePath, so there's nothing for useActionState to surface yet.
 * Wrapped in a <details> disclosure by the caller (page.tsx) so it doesn't
 * permanently occupy the top-right chrome next to ChatPresence.
 */
export function ChatUrlForm({ workspaceId, chatUrl, internalChatUrl }: ChatUrlFormProps) {
  const action = setChatUrls.bind(null, workspaceId);

  return (
    <form action={action} className="wsl-chat-form">
      <label className="wsl-field">
        Team chat link (buyer-visible)
        <input
          className="wsl-input"
          type="url"
          name="chat_url"
          placeholder="https://…"
          defaultValue={chatUrl ?? ""}
        />
      </label>
      <label className="wsl-field">
        Internal war room link (seller-only, never shown to the buyer)
        <input
          className="wsl-input"
          type="url"
          name="internal_chat_url"
          placeholder="https://…"
          defaultValue={internalChatUrl ?? ""}
        />
      </label>
      <button type="submit" className="wsl-btn">
        Save chat links
      </button>
    </form>
  );
}
