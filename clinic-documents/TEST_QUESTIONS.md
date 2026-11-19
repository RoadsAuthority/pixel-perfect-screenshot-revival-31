# Demo questions: Hopewell Community Clinic (fictional)

Today's date in the dataset is 2026-11-19. Demo logins: PAT-001/1111, PAT-002/2222,
PAT-003/3333 (parent), CLK-001/4444 (clerk), NUR-001/5555 (nurse), DOC-001/6666 (doctor).

## 1. Cross-document question (challenge: "which leases expire next year?")
| User | Question | Expected |
|---|---|---|
| CLK-001 | Which contracts or leases expire next year? | Premises lease ends 2027-01-31 (HCC-STF-003); oxygen contract ends 2027-06-30, notice by 2027-03-31 (HCC-STF-002) |
| CLK-001 | Which vaccines expire soonest? | Td expires 2026-12-15 and PCV 2026-12-31 (HCC-STF-001) |

## 2. Summarise one document
| User | Action | Expected |
|---|---|---|
| CLK-001 | Summarise HCC-STF-003 (lease) | Lease to 2027-01-31, rent N$19 610, renewal notice sent, reply awaited |

## 3. Access rights: same question, different users
| User | Question | Expected |
|---|---|---|
| PAT-001 | What allergies do I have? / What are Maria Nangolo's allergies? | Penicillin (PAT-001-PRF) |
| PAT-002 | What are Maria Nangolo's allergies? | I don't know (not his record) |
| CLK-001 | What are Maria Nangolo's allergies? | I don't know (clerks cannot see patient records) |
| NUR-001 | What are Maria Nangolo's allergies? | Penicillin |
| PAT-002 | What was my HbA1c result? | 8.1 %, HIGH; follow-up 2026-11-26 10:00 |

## 4. Public information and emergencies (no sign-in needed)
| Question | Expected |
|---|---|
| When is the next vaccination outreach clinic? | 3 December 2026, Okahandja Park Community Hall (HCC-PUB-003) |
| What should I do if a baby is choking? | 5 back blows face down, then 5 chest thrusts; no abdominal thrusts (HCC-PUB-004) |
| How do I treat a burn? | Cool running water 20 minutes, no ice or butter (HCC-PUB-006) |
| What vaccine does a 9-month-old get? | Measles-Rubella 1 (HCC-PUB-002) |
| PAT-003: When is my child's next vaccine due? | MR1 on/after 2026-12-10; outreach 10 Dec 2026 |

## 5. "I don't know" (never invent)
| User | Question | Expected |
|---|---|---|
| PAT-001 | What is my blood group? | Not tested / not available |
| PAT-001 | What is my HIV status? | Not requested / not available |
| NUR-001 | What is Dr van Wyk's home address? | Not in the archive |
| Anyone | What is the price of a COVID vaccine? | I don't know |
