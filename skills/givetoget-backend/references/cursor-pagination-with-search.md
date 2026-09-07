# Cursor-based pagination with optional search — Next.js route + Supabase

## When to use

Any UI that displays a potentially-large list of rows from Supabase and
must NEVER load the full set into the browser in one request. The
canonical case on this project is the My Network "See Contacts" modal
(PRD §5.7 hard requirement), but the pattern applies anywhere a
read-only browse view could face a 1k+ row result.

## Hard rules

1. **The client NEVER holds the full list.** Every page is a fresh
   server roundtrip. No "load all then paginate client-side", no
   infinite-scroll cache, no offset/limit that grows without bound.
2. **Cursor stability across inserts.** The cursor must be a tuple
   ordered by `(created_at DESC, id DESC)` so a new row inserted
   between page 1 and page 2 cannot cause a row to appear twice or
   get skipped (the classic offset-pagination failure mode).
3. **Search is a server-side filter**, never client-side filter over
   the loaded page. A 25-row page after a search that hit only on row
   25,000 should still cost one query.
4. **Page size capped** (1 ≤ pageSize ≤ 100) so a malicious caller
   can't request pageSize=10000.

## Cursor shape

For `(created_at DESC, id DESC)` ordering, the "rows after this cursor"
predicate is:

```
created_at < cursor.created_at
  OR (created_at = cursor.created_at AND id < cursor.id)
```

In PostgREST:

```ts
query = query.or(
  `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
);
```

The id tiebreaker matters because many rows share a `created_at` (bulk
imports insert hundreds of rows in the same millisecond).

## Server route handler (Next.js)

```ts
// GET /api/network/contacts/[connectionId]?cursor_created_at=...&cursor_id=...&q=...&pageSize=25
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const { workspaceId: callerWorkspaceId } = await getWorkspaceContext();
  if (!callerWorkspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  // 1. Authorization FIRST — fetch the connection row, verify the
  //    caller is on either side AND the row is accepted. NEVER issue
  //    the contacts query before this check; the helper itself does
  //    not authorize (it's a pure data accessor).
  const conn = await getConnectionById(connectionId);
  if (!conn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    callerWorkspaceId !== conn.requester_workspace_id &&
    callerWorkspaceId !== conn.recipient_workspace_id
  ) {
    return NextResponse.json({ error: "Not part of this connection" }, { status: 403 });
  }
  if (conn.status !== "accepted") {
    return NextResponse.json(
      { error: `Connection is ${conn.status}; contacts are gated.` },
      { status: 403 },
    );
  }

  // 2. Derive the friend's workspace_id (the side that isn't the caller).
  const friendWorkspaceId =
    conn.requester_workspace_id === callerWorkspaceId
      ? conn.recipient_workspace_id
      : conn.requester_workspace_id;

  // 3. Parse query params. pageSize clamped at the helper layer.
  const url = new URL(req.url);
  const cursorCreatedAt = url.searchParams.get("cursor_created_at");
  const cursorId = url.searchParams.get("cursor_id");
  const q = url.searchParams.get("q") ?? "";
  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : 25;

  let cursor: { created_at: string; id: string } | null = null;
  if (cursorCreatedAt && cursorId) {
    cursor = { created_at: cursorCreatedAt, id: cursorId };
  }

  // 4. Delegate to the typed helper.
  const page = await searchConnectionContacts({
    connectionId,
    friendWorkspaceId,
    cursor,
    searchTerm: q,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });

  return NextResponse.json(page);
}
```

## Helper (data-only — no authorization)

```ts
// src/lib/network.ts
export async function searchConnectionContacts(
  args: SearchConnectionContactsArgs,
): Promise<ConnectionContactsPage> {
  const { supabase } = await getWorkspaceContext();
  const pageSize = Math.min(Math.max(args.pageSize ?? 25, 1), 100);

  let query = supabase
    .from("contacts")
    .select("id, first_name, last_name, title, company_name, email, ..., created_at")
    .eq("contributed_by_workspace_id", args.friendWorkspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  if (args.cursor) {
    const c = args.cursor;
    query = query.or(
      `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
    );
  }

  // ILIKE search — escape the wildcard characters so a user typing a
  // literal "_" gets a literal match, not "any single char".
  const term = (args.searchTerm ?? "").trim();
  if (term.length > 0) {
    const safe = term.replace(/[%_\\]/g, (m) => "\\" + m);
    const wild = `%${safe}%`;
    query = query.or(
      `first_name.ilike.${wild},last_name.ilike.${wild},company_name.ilike.${wild},title.ilike.${wild}`,
    );
  }

  const { data, error } = await query;
  if (error || !data) return { rows: [], nextCursor: null };

  // nextCursor: only emit when we got a full page (assume there may be more).
  // Fewer rows than pageSize → no more pages.
  const last = data.length === pageSize ? data[data.length - 1] : null;
  return {
    rows: data as ConnectionContactRow[],
    nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
  };
}
```

## Modal client (React)

```tsx
const [page, setPage] = useState<ConnectionContactsPage | null>(null);
const [loading, setLoading] = useState(false);
const [searchInput, setSearchInput] = useState("");
const [activeSearch, setActiveSearch] = useState("");
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const fetchPage = useCallback(
  async (cursor: { created_at: string; id: string } | null) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/network/contacts/${encodeURIComponent(connectionId)}`,
        window.location.origin,
      );
      if (cursor) {
        url.searchParams.set("cursor_created_at", cursor.created_at);
        url.searchParams.set("cursor_id", cursor.id);
      }
      if (activeSearch.trim().length > 0) {
        url.searchParams.set("q", activeSearch.trim());
      }
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(url.toString());
      if (!res.ok) { /* show error, clear page */ return; }
      setPage((await res.json()) as ConnectionContactsPage);
    } finally {
      setLoading(false);
    }
  },
  [connectionId, activeSearch],
);

// First-page load on mount AND whenever the active search changes.
useEffect(() => { fetchPage(null); }, [fetchPage]);

// Debounce search input → activeSearch.
useEffect(() => {
  if (debounceRef.current) clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => setActiveSearch(searchInput), 250);
  return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
}, [searchInput]);
```

Pagination controls are `← First page` (re-fetches with `cursor=null`) and
`Next page →` (uses `page.nextCursor`). When `nextCursor` is null, the
Next button is disabled.

## What this pattern deliberately does NOT do

- No offset-based pagination (`?page=N`). Offset has the well-known
  "rows shift while paging" failure mode that breaks stability when
  the underlying table sees concurrent inserts.
- No client-side filter over a fully-loaded page list. Search is a
  server-side re-query with the cursor reset to the first page.
- No `select('*')`. List the columns explicitly so the response shape
  is stable and you don't accidentally surface a column that shouldn't
  be in the modal (e.g. `password_hash` if it ever lived on the table).
- No service-role key from the route handler. The anon-keyed server
  client + RLS is sufficient; the contacts_network_select policy from
  008 makes connection-gated rows visible to the caller's session.

## Tests worth adding when you ship a paginated read

- A 5,000-row contribution from a friend. Open the modal; the first
  page loads in < 500ms. Click Next five times — five roundtrips, no
  re-render with all 5,000 rows.
- Insert a new contact mid-paging. Click Next from page 1 → page 2.
  The new row appears on its natural page (not duplicated, not
  skipped).
- Search "x" → the page re-queries, returns only matching rows,
  `nextCursor` reflects the new search.
- Search with literal `_` and `%` characters — should be escaped,
  not treated as wildcards.
- Page size of 10000 → clamped to 100 (or whatever cap you set).