# Security Specification — SmartCare AI Firestore Rules

## 1. Data Invariants
1. **Identity & Privilege Isolation**: No user may self-assign `role: "admin"` during `users/{userId}` creation or update unless already verified by `isAdmin()`.
2. **PII Isolation**: User email, phone numbers, and emergency notes reside strictly in `/users/{userId}/private/{docId}` and are readable/writable only by the owning user or an administrator.
3. **Patient Scope & Master Gate**: Readings and alerts under `/patients/{patientId}` cannot be created unless the parent `/patients/{patientId}` document exists and the caller is the owning patient or an administrator.
4. **Terminal State Locking**: Once an alert's `status` transitions to `"resolved"`, non-admin caregivers and patients cannot reopen or mutate its fields.
5. **Temporal & Ownership Integrity**: `createdAt` and `ownerUid` fields are immutable on update; `createdAt` and `updatedAt` must strictly equal `request.time`.
6. **Zero Unbounded Arrays & Strict Keys**: Every document enforces `hasAll` + `hasOnly` on create and `affectedKeys().hasOnly(...)` on update, with bounded arrays (`triggeredMetrics.size() <= 8`, `callLog.size() <= 12`) and strict string `.size()` limits.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Self-Admin Escalation**: `users/{uid}` create with `{ uid, displayName: "Attacker", role: "admin", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }` by non-admin.
2. **Ghost Field Injection (Shadow Update)**: `patients/{id}` update adding `{ isVerifiedClinical: true }` alongside valid `updatedAt`.
3. **Unverified Email Spoof**: Request where `request.auth.token.email == "aasiyahadiya7575@gmail.com"` and `email_verified == false`.
4. **Cross-User PII Snooping**: Authenticated user B attempting `get` on `/users/{userA}/private/contact`.
5. **Blanket List Scraping**: Unfiltered `list` query on `/patients` or `/devices` attempting to read documents where `ownerUid != request.auth.uid` and caller is not linked caregiver/admin.
6. **Orphaned Reading Injection**: Creating `/patients/nonexistent_id/readings/r1` where parent patient does not exist.
7. **ID Poisoning (Denial of Wallet)**: Creating `/devices/{1500_char_string}` or invalid regex `bad/id$1`.
8. **Type / Boundary Poisoning**: Updating alert `followUpAction` with a 2,000-character string or boolean.
9. **Terminal Alert Reopening**: Non-admin attempting to update an alert whose `existing().status == "resolved"` back to `"active"`.
10. **Owner Hijack on Update**: Changing `ownerUid` on an existing `/devices/{deviceId}` or `/patients/{patientId}`.
11. **Backdated Timestamp Spoof**: Creating a reading with a client-supplied past timestamp instead of `request.time`.
12. **Unbounded Array Flood**: Creating an alert with 25 entries in `triggeredMetrics` or `callLog`.
