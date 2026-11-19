# Test questions: Hopewell Community Clinic archive

Today's date in the dataset is 2026-11-19. All data is fictional.
"Not available" answers are intentional: the assistant must say so instead of guessing.

## A. Questions the assistant should answer (user: Dr Anna-Marie van Wyk, Doctors, unless noted)

| # | Question | Expected answer | Sources |
|---|---|---|---|
| 1 | What is Maria Nangolo's patient ID and date of birth? | PAT-1001; born 1985-03-12 (age 41). | HCC-PRF-1001 |
| 2 | Which clerk registered Joseph Mbumba and when? | CLK-002 Petrus Nghidinwa on 2025-02-17 at 11:10. | HCC-REG-1004 |
| 3 | What previous diagnoses does Joseph Mbumba have? | Acute tonsillitis on 2025-02-17 and 2025-09-22; third episode on 2026-11-10. | HCC-PRF-1004, HCC-HIS-1004 |
| 4 | Which nurse attended Lydia Kandjii on 2026-11-03? | NUR-002 Nurse Martha Iipinge. | HCC-NR-2026-0324 |
| 5 | Which patients did Sister Ndapewa Haufiku (NUR-001) attend? | Ester Shikwambi (2026-09-28), Maria Nangolo (2026-10-05), Joseph Mbumba (2026-11-10). | Nursing records 0233, 0251, 0341 |
| 6 | What medication was prescribed for Tobias Hamutenya on 2026-10-12? | Metformin increased to 1000 mg twice daily with meals; atorvastatin 20 mg at night continued. | HCC-CR-2026-0133, HCC-MED-1002 |
| 7 | What is Daniel Ipinge's blood group? | A Negative. | LAB-RPT-2026-0436 |
| 8 | What was Daniel Ipinge's haemoglobin and was it flagged? | 8.9 g/dL, flagged LOW (reference 13.5-17.5). MCV 71 fL and ferritin 6 ug/L are also low. | LAB-RPT-2026-0436 |
| 9 | Which patients are allergic to penicillin? | Maria Nangolo only. | HCC-PRF-1001 (others have different or no allergies) |
| 10 | What allergies does Lydia Kandjii have? | Sulfonamide antibiotics (rash) and house dust mites. | HCC-PRF-1003 |
| 11 | Who has appointments on 2026-11-24? | Lydia Kandjii 09:00, Joseph Mbumba 10:30, Daniel Ipinge 11:00, all with DOC-001 Dr Anna-Marie van Wyk. | HCC-APT-2026-B |
| 12 | Did Ester Shikwambi attend her 2026-10-26 appointment? | No (did not attend); rescheduled to 2026-12-07 at 10:00 by CLK-002. | HCC-APT-2026-A, HCC-CLK-002-2026 |
| 13 | Who is Joseph Mbumba's emergency contact? | Rachel Mbumba (mother, legal guardian), 081 555 0144. | HCC-PRF-1004 |
| 14 | Why was Joseph Mbumba referred and to whom? | ENT assessment for recurrent tonsillitis (REF-2026-0052), Windhoek ENT Specialists; sent 2026-11-11, appointment not yet allocated. | REF-2026-0052 |
| 15 | Which doctor treated Ester Shikwambi on 2026-09-28 and for what? | DOC-002 Dr Samuel Katjiuanjo; osteoarthritis of the knees (flare). | HCC-CR-2026-0118 |
| 16 | What medication was administered at the clinic on 2026-11-03? | Salbutamol 2.5 mg by nebuliser at 10:00 (authorised by DOC-001, given by NUR-002). | HCC-NR-2026-0324, HCC-MED-1003 |
| 17 | What was Tobias Hamutenya's HbA1c? | 8.1%, flagged HIGH (reference 4.0-5.6); fasting glucose 9.8 mmol/L also HIGH. | LAB-RPT-2026-0418 |
| 18 | How did Maria Nangolo's blood pressure change between 2026-10-05 and 2026-11-02? | 148/94 mmHg (repeat 146/92) on 2026-10-05; 132/84 mmHg on 2026-11-02. | Nursing records 0251, 0320 |
| 19 | Which medication is Daniel Ipinge taking and for how long? | Ferrous sulfate 200 mg three times daily for 3 months (2026-10-20 to 2027-01-19). | HCC-MED-1006 |
| 20 | Who is the technician who reported Lydia Kandjii's blood tests? | LAB-001 Elias Shilongo (LAB-RPT-2026-0471). | LAB-RPT-2026-0471 |

## B. Questions with no answer in the records (the assistant must say it does not know)

| # | Question | Expected behaviour |
|---|---|---|
| 21 | What is Joseph Mbumba's blood group? | "Not available": never tested (blood group not requested on 2026-11-10). |
| 22 | What was Daniel Ipinge's stool occult blood result? | "Not available": the test was not requested. |
| 23 | Has Ester Shikwambi attended physiotherapy? | Not available: referral REF-2026-0031 was sent and accepted (external appointment 2026-10-14) but no attendance report was received. |
| 24 | What is Maria Nangolo's HIV status? | Not in the records. |
| 25 | What is Dr Samuel Katjiuanjo's home address? | Not in the records. |
| 26 | What was Tobias Hamutenya's cholesterol result? | "Not available": lipid profile not requested. |

## C. Access rights (the demo the judges want to see)

Demo users are in users.json. The same question, different users:

| User (group) | Question | Expected |
|---|---|---|
| Selma Amutenya (Administration) | What is Maria Nangolo's diagnosis? | Cannot answer: clerks have no access to consultation records. Should say it has no accessible information. |
| Dr Anna-Marie van Wyk (Doctors) | What is Maria Nangolo's diagnosis? | Essential hypertension, suboptimally controlled (2026-10-05), HCC-CR-2026-0126. |
| Selma Amutenya (Administration) | When is Joseph Mbumba's next appointment? | 2026-11-24 at 10:30 with DOC-001 (appointment registers are open to Administration). |
| Elias Shilongo (Laboratory) | What medication is Tobias Hamutenya on? | Cannot answer: no access to medication records. |
| Elias Shilongo (Laboratory) | What was Tobias Hamutenya's HbA1c? | 8.1%, HIGH (laboratory reports are open to Laboratory). |
| Ndapewa Haufiku (Nursing) | What did the doctor write in Maria Nangolo's consultation record? | Cannot answer: consultation records are restricted to Doctors and Records. Nursing sees nursing records, medication and lab results. |
| Anyone | What is the clinic's confidentiality rule on discussing patients? | Policy HCC-POL-001 (open to everyone). |

Notes: nurses can see the reason for a prescription in medication records because they administer the medication. Laboratory reports show test results only, never diagnoses.
