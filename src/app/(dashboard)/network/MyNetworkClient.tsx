"use client";

// src/app/(dashboard)/network/MyNetworkClient.tsx
//
// Client component for the My Network page. Three sections:
//   1. Pending invites — incoming (accept/decline) + outgoing (no
//      actions — wait for the other side).
//   2. Your connections — list of accepted connections with a "See
//      Contacts" button per row that opens the modal.
//   3. InvitePartnerForm — send a new invite by email.
//
// Clicking "See Contacts" sets the selectedConnectionId state, which
// renders <SeeContactsModal>. The modal owns its own pagination state
// and its own server-side fetch.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AcceptedConnection,
  PendingInvite,
} from "@/lib/network";
import InvitePartnerForm from "./InvitePartnerForm";
import SeeContactsModal from "./SeeContactsModal";

interface Props {
  currentUserEmail: string | null;
  accepted: AcceptedConnection[];
  pending: { incoming: PendingInvite[]; outgoing: PendingInvite[] };
}

export default function MyNetworkClient({
  currentUserEmail,
  accepted,
  pending,
}: Props) {
  const router = useRouter();
  const [selectedConnection, setSelectedConnection] = useState<{
    id: string;
    friendLabel: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleActionComplete = () => {
    // The server components on the page need to re-render after a
    // connection-status change so the new accepted/pending state
    // shows up. router.refresh() re-runs the server component,
    // which re-fetches accepted + pending.
    startTransition(() => {
      router.refresh();
    });
  };

  const hasAnyContent =
    pending.incoming.length > 0 ||
    pending.outgoing.length > 0 ||
    accepted.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        maxWidth: "880px",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "18px",
            fontWeight: 700,
            color: "#F0EEFF",
            letterSpacing: "-0.01em",
          }}
        >
          My Network
        </h2>
        <p style={{ margin: 0, fontSize: "13px", color: "#8B87A8" }}>
          Connected workspaces can browse each other&apos;s contributed
          contacts in-app. Read-only — no export, no download.
        </p>
      </header>

      <InvitePartnerForm
        currentUserEmail={currentUserEmail}
        onSuccess={handleActionComplete}
      />

      {/* Pending invites */}
      {(pending.incoming.length > 0 || pending.outgoing.length > 0) && (
        <PendingSection
          pending={pending}
          onActionComplete={handleActionComplete}
          isPending={isPending}
        />
      )}

      {/* Accepted connections */}
      <ConnectionsSection
        accepted={accepted}
        onSeeContacts={(c) =>
          setSelectedConnection({
            id: c.id,
            friendLabel: friendLabel(c),
          })
        }
      />

      {/* Empty state */}
      {!hasAnyContent && (
        <div
          style={{
            background: "#18181D",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "10px",
            padding: "36px 24px",
            textAlign: "center",
            color: "#4E4A66",
            fontSize: "13px",
          }}
        >
          No connections yet. Send an invite above to get started.
        </div>
      )}

      {selectedConnection && (
        <SeeContactsModal
          connectionId={selectedConnection.id}
          friendLabel={selectedConnection.friendLabel}
          onClose={() => setSelectedConnection(null)}
        />
      )}
    </div>
  );
}

function friendLabel(c: AcceptedConnection): string {
  const name = [c.friend.first_name, c.friend.last_name]
    .filter(Boolean)
    .join(" ");
  return name || c.friend.email || "Connection";
}

// ─────────────────────────────────────────────────────────────
// PendingSection
// ─────────────────────────────────────────────────────────────

function PendingSection({
  pending,
  onActionComplete,
  isPending,
}: {
  pending: { incoming: PendingInvite[]; outgoing: PendingInvite[] };
  onActionComplete: () => void;
  isPending: boolean;
}) {
  return (
    <section
      style={{
        background: "#18181D",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#4E4A66",
        }}
      >
        Pending invites
      </h3>

      {pending.incoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "11px", color: "#8B87A8" }}>
            Incoming — they want to connect with you
          </span>
          {pending.incoming.map((p) => (
            <PendingRow
              key={p.id}
              invite={p}
              direction="incoming"
              onActionComplete={onActionComplete}
              isPending={isPending}
            />
          ))}
        </div>
      )}

      {pending.outgoing.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "11px", color: "#8B87A8" }}>
            Awaiting their reply
          </span>
          {pending.outgoing.map((p) => (
            <PendingRow
              key={p.id}
              invite={p}
              direction="outgoing"
              onActionComplete={onActionComplete}
              isPending={isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PendingRow({
  invite,
  direction,
  onActionComplete,
  isPending,
}: {
  invite: PendingInvite;
  direction: "incoming" | "outgoing";
  onActionComplete: () => void;
  isPending: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = [invite.friend.first_name, invite.friend.last_name]
    .filter(Boolean)
    .join(" ") || invite.friend.email || "Unknown";

  const handleAction = async (action: "accept" | "decline") => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/network/invites/${encodeURIComponent(invite.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      onActionComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "8px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", color: "#F0EEFF", fontWeight: 500 }}>
          {name}
        </div>
        {invite.friend.email && (
          <div style={{ fontSize: "11px", color: "#8B87A8" }}>
            {invite.friend.email}
          </div>
        )}
        {error && (
          <div style={{ fontSize: "11px", color: "#F87171", marginTop: "2px" }}>
            {error}
          </div>
        )}
      </div>

      {direction === "incoming" ? (
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={() => handleAction("decline")}
            disabled={working || isPending}
            style={ghostButtonStyle}
          >
            Decline
          </button>
          <button
            onClick={() => handleAction("accept")}
            disabled={working || isPending}
            style={accentButtonStyle}
          >
            Accept
          </button>
        </div>
      ) : (
        <span style={{ fontSize: "11px", color: "#4E4A66" }}>pending</span>
      )}
    </div>
  );
}

const ghostButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "6px",
  padding: "6px 12px",
  color: "#F0EEFF",
  fontSize: "12px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const accentButtonStyle: React.CSSProperties = {
  background: "#8B5CF6",
  border: "none",
  borderRadius: "6px",
  padding: "6px 12px",
  color: "#fff",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ─────────────────────────────────────────────────────────────
// ConnectionsSection
// ─────────────────────────────────────────────────────────────

function ConnectionsSection({
  accepted,
  onSeeContacts,
}: {
  accepted: AcceptedConnection[];
  onSeeContacts: (c: AcceptedConnection) => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const router = useRouter();

  if (accepted.length === 0) {
    return (
      <section
        style={{
          background: "#18181D",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "10px",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#4E4A66",
          }}
        >
          Your connections
        </h3>
        <span style={{ fontSize: "12px", color: "#4E4A66" }}>
          No accepted connections yet.
        </span>
      </section>
    );
  }

  return (
    <section
      style={{
        background: "#18181D",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#4E4A66",
        }}
      >
        Your connections
      </h3>

      {revokeError && (
        <div
          style={{
            fontSize: "11px",
            color: "#F87171",
            padding: "6px 10px",
            background: "rgba(248,113,113,0.08)",
            borderRadius: "6px",
          }}
        >
          {revokeError}
        </div>
      )}

      {accepted.map((c) => {
        const name = [c.friend.first_name, c.friend.last_name]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "8px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  color: "#F0EEFF",
                  fontWeight: 500,
                }}
              >
                {name || c.friend.email || "Connection"}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#8B87A8",
                  marginTop: "2px",
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                {c.friend.email && (
                  <span>{c.friend.email}</span>
                )}
                {c.friend.phone_number ? (
                  <span>{c.friend.phone_number}</span>
                ) : (
                  <span style={{ color: "#4E4A66" }}>No phone shared</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
              <button
                onClick={() => onSeeContacts(c)}
                style={accentButtonStyle}
              >
                See Contacts
              </button>
              <button
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Revoke this connection? ${name || "Your connection"} will lose access to your contributed contacts immediately.`,
                    )
                  ) {
                    return;
                  }
                  setRevokingId(c.id);
                  setRevokeError(null);
                  try {
                    const res = await fetch(
                      `/api/network/invites/${encodeURIComponent(c.id)}`,
                      { method: "DELETE" },
                    );
                    if (!res.ok) {
                      const data = (await res.json().catch(() => ({}))) as {
                        error?: string;
                      };
                      setRevokeError(data.error ?? `Revoke failed (${res.status})`);
                      return;
                    }
                    router.refresh();
                  } catch (e) {
                    setRevokeError(
                      e instanceof Error ? e.message : "Network error",
                    );
                  } finally {
                    setRevokingId(null);
                  }
                }}
                disabled={revokingId === c.id}
                style={ghostButtonStyle}
              >
                {revokingId === c.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}