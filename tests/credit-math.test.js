// Credit-math algorithm test harness — give-to-get.com export-generator.
//
// Mirrors the free/paid credit logic in
// supabase/functions/export-generator/index.ts (Steps 1.5 + 2 of the
// post-fix version):
//   1. Fetch accepted workspace_connections rows for the caller's workspace.
//   2. Build freeWorkspaceIds Set: caller's own workspace + all accepted
//      partner workspaces.
//   3. For each contact, count free if contributed_by_workspace_id is in Set.
//   4. contactCount = total; paidCount = contactCount - freeCount;
//      creditsSpent = paidCount.
//
// Pure, deterministic. Run: node tests/credit-math.test.js
// All 8 cases must pass.

function computeCreditMath(workspaceId, connectionRows, contactRows) {
  // Step 1+2: freeWorkspaceIds Set construction
  const freeWorkspaceIds = new Set([workspaceId]);
  for (const row of connectionRows ?? []) {
    const r = {
      requester_workspace_id: row.requester_workspace_id,
      recipient_workspace_id: row.recipient_workspace_id,
      status: row.status,
    };
    if (r.status !== "accepted") continue; // explicit guard
    if (r.requester_workspace_id === workspaceId) {
      freeWorkspaceIds.add(r.recipient_workspace_id);
    } else if (r.recipient_workspace_id === workspaceId) {
      freeWorkspaceIds.add(r.requester_workspace_id);
    }
  }

  // Step 3+4: count free vs paid
  const contactCount = contactRows.length;
  let freeCount = 0;
  for (const row of contactRows) {
    const cid = row.contributed_by_workspace_id;
    if (cid && freeWorkspaceIds.has(cid)) {
      freeCount++;
    }
  }
  const paidCount = contactCount - freeCount;
  const creditsSpent = paidCount;

  return { contactCount, freeCount, paidCount, creditsSpent };
}

// Smoke check against a known-good reference case.
const refWorkspaceId = "W-A";
const refConnections = [
  { requester_workspace_id: "W-A", recipient_workspace_id: "W-B", status: "accepted" },
];
const refContacts = [
  { contributed_by_workspace_id: "W-A" },
  { contributed_by_workspace_id: "W-B" },
  { contributed_by_workspace_id: "W-C" },
];
const refResult = computeCreditMath(refWorkspaceId, refConnections, refContacts);
const refPass =
  refResult.contactCount === 3 &&
  refResult.freeCount === 2 &&
  refResult.paidCount === 1 &&
  refResult.creditsSpent === 1;

const A = "W-A";
const B = "W-B";
const C = "W-C";
const D = "W-D";
const E = "W-E";
const F = "W-F";

const contactsStd = {
  1: { id: "C1", contributed_by_workspace_id: A }, // own-contribution
  2: { id: "C2", contributed_by_workspace_id: B }, // partner of A
  3: { id: "C3", contributed_by_workspace_id: C }, // general pool
  4: { id: "C4", contributed_by_workspace_id: D }, // general pool
  5: { id: "C5", contributed_by_workspace_id: E }, // general pool
  6: { id: "C6", contributed_by_workspace_id: F }, // pending partner
};

function makeConn(...rows) {
  return rows;
}

function runCase(name, contacts, expected, connections) {
  const contactRows = contacts.map((id) => contactsStd[id]);
  const result = computeCreditMath(A, connections ?? makeConn(
    { requester_workspace_id: A, recipient_workspace_id: B, status: "accepted" },
  ), contactRows);
  const pass =
    result.contactCount === expected.contactCount &&
    result.freeCount === expected.freeCount &&
    result.paidCount === expected.paidCount &&
    result.creditsSpent === expected.creditsSpent;
  console.log(`${name} [${pass ? "PASS" : "FAIL"}]`);
  console.log(`  expected: ${JSON.stringify(expected)}`);
  console.log(`  actual:   ${JSON.stringify(result)}`);
  return pass;
}

let allPass = refPass;

allPass = runCase(
  "Case 1: all own-contribution + all partner (zero credit charge)",
  [1, 2],
  { contactCount: 2, freeCount: 2, paidCount: 0, creditsSpent: 0 },
) && allPass;

allPass = runCase(
  "Case 2: mix of all three categories (partial charge)",
  [1, 2, 3],
  { contactCount: 3, freeCount: 2, paidCount: 1, creditsSpent: 1 },
) && allPass;

allPass = runCase(
  "Case 3: zero balance, all-free selection (succeeds)",
  [1, 2],
  { contactCount: 2, freeCount: 2, paidCount: 0, creditsSpent: 0 },
) && allPass;

allPass = runCase(
  "Case 4: zero balance, any paid contact (fails 402)",
  [1, 2, 3],
  { contactCount: 3, freeCount: 2, paidCount: 1, creditsSpent: 1, willFailBalance: true },
) && allPass;

allPass = runCase(
  "Case 5: partner has no contacts (empty partner workspace)",
  [3],
  { contactCount: 1, freeCount: 0, paidCount: 1, creditsSpent: 1 },
) && allPass;

allPass = runCase(
  "Case 6: multiple accepted connections",
  [1, 2, 4, 5, 3],
  { contactCount: 5, freeCount: 4, paidCount: 1, creditsSpent: 1 },
  makeConn(
    { requester_workspace_id: A, recipient_workspace_id: B, status: "accepted" },
    { requester_workspace_id: A, recipient_workspace_id: D, status: "accepted" },
    { requester_workspace_id: A, recipient_workspace_id: E, status: "accepted" },
  ),
) && allPass;

allPass = runCase(
  "Case 7: no connections at all (control case, identical to today)",
  [2, 3, 4],
  { contactCount: 3, freeCount: 0, paidCount: 3, creditsSpent: 3 },
  makeConn(),
) && allPass;

allPass = runCase(
  "Case 8: PENDING connection does NOT count as free",
  [1, 6],
  { contactCount: 2, freeCount: 1, paidCount: 1, creditsSpent: 1 },
  makeConn(
    { requester_workspace_id: A, recipient_workspace_id: F, status: "pending" },
  ),
) && allPass;

console.log();
console.log("=".repeat(70));
console.log(allPass ? "ALL 8 CASES PASS" : "SOME CASES FAILED");
console.log("=".repeat(70));
process.exit(allPass ? 0 : 1);