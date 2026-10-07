# בונים דשבורד בעלים אחד: מע"מ 18%, חריגות ועמוד בית

**שורה תחתונה:** הדשבורד הנכון לאביהו הוא **מערכת מדורגת, לא מסך אחד**: עמוד בית עם פאנל "דורש תשומת לב היום" למעלה, כרטיס אחד בעל מבנה זהה לכל דומיין (adigital, OSPA, Personal, Ventures), ואז עמודי דומיין, עמודי branch ורשומה בודדת (חשבונית, חוזה, תיק). זה מתיישב עם העקרונות המתועדים של Few ו-NN/g (מסך אחד, מעט מספרים, כל מספר עם הקשר, עמודות וקווים במקום עוגות ומדי-מחוג, צבע התראה רק לחריגים) ועם דפוסי הדשבורדים הנפוצים בפועל (פריסה מדורגת, ניווט בין עמודים). **אזהרה מרכזית 1: מע"מ בישראל הוא 18% מ-1 בינואר 2025, לא 17%** (ההנחה בפרויקט מיושנת); המע"מ חייב להישמר כפרמטר מתוארך וכ-`vat_rate` על כל מסמך, ולא כקבוע בקוד. **אזהרה מרכזית 2: סף מספר ההקצאה ירד ל-5,000 ש"ח לפני מע"מ מ-1 ביוני 2026**, כלומר היום (אוקטובר 2026) כמעט כל חשבונית retainer ללקוח עוסק מורשה עשויה לדרוש מספר, ולכן "חשבונית ללא מספר הקצאה" היא התראה אדומה ראשונה. כיוון שקיימים היום רק נתוני adigital, ההמלצה לבנות קודם סכמה, פרמטרים, עמוד adigital, משימות ופאנל החריגים, ולהציג דומיינים ריקים כ"אין נתונים" ולא כ-0. רוב ספי ההתראה והיעדים להלן הם **דעה או הסקה** ולא נתונים מתועדים, וסומנו ככאלה.

**מקרא אמינות** (בכל הדו"ח): **[עובדה]** = מקור רשמי או מתועד; **[משני]** = מקור משני (בלוג, משרד, ספק כלי) שלא אומת מול מקור רשמי; **[דעה]** = practitioner או הערכה לא מקורית; **[הסקה]** = מסקנה שלי. מספרים ללא הפניה הם הערכות לא מקוריות.

## דגלים אדומים: מע"מ 18% וספי מספר הקצאה

**[עובדה/משני]** המע"מ עלה מ-17% ל-18% מ-1.1.2025 ([Herzog Law](https://herzoglaw.co.il/en/news-and-insights/vat-updates-for-2025-vat-rate-increase-israel-invoices-reform-and-the-economic-plan-bill/); [Capitax](https://www.capitax.co.il/content/2/3090)). אישור זה מגיע ממשרד עו"ד ומשרד רו"ח ולא מדף gov.il שנבדק, אך שני מקורות עצמאיים מסכימים (ביטחון גבוה). **[הסקה]** המשמעות לנתונים: טבלת `Parameters/vat-rates` עם `{from: 2025-01-01, rate: 0.18}` ושורה קודמת ל-0.17 למסמכי עבר; כל חשבונית נושאת `vat_rate` משלה; הסנכרון בודק `vat_amount ≈ amount_net × vat_rate` ומתריע על סטייה (מעל אגורה לשורה). כל KPI של הכנסה מחושב **לפני מע"מ**; מזומן וחובות מוצגים **כולל מע"מ**.

**[עובדה]** רשות המסים מפרסמת סף מספר הקצאה על הסכום **לפני מע"מ**: 20,000 ש"ח ב-2025, 10,000 מ-1.1.2026, 5,000 מ-1.6.2026; השירות חל על עוסקים מורשים, והמספר נדרש לניכוי מס תשומות מעל הסף ([gov.il](https://www.gov.il/en/service/request-assignment-number-for-tax-invoice)); הטבלה המלאה כולל 25,000 במאי 2024 מופיעה גם בחדשות ([Bizportal](https://www.bizportal.co.il/general/news/article/20032314)). **ביטחון:** גבוה לספים עצמם. **[משני]** פרטי המנגנון (המספר נדרש לפני שהחשבונית מגיעה ללקוח; קוד לקוח 999999998 חוסם ניכוי; מ-1.8.2025 חסר מספר משפיע גם על הכרה בהוצאה למס הכנסה) מגיעים מבלוגים בלבד ([Beancount](https://beancount.io/blog/2026/09/22/israel-invoice-allocation-number-5000-nis-osek-murshe-b2b-guide); [InvoiceDataExtraction](https://invoicedataextraction.com/blog/cheshboniot-mispar-hakatzaa-suppliers-to-excel)); **ביטחון נמוך-בינוני, לאמת מול רו"ח.** כמו כן לא אושר אם קבלה בלבד או הנפקה בתאריך תשלום משנים את החובה. הדו"ח הקודם בשיחה הזכיר רק "מעל 5,000 מ-2026" ממקור משני יחיד; כאן הנוסח המדויק גובר: 10,000 עד 31.5.2026 ו-5,000 מ-1.6.2026.

**[הסקה]** `allocation_required` מחושב בסנכרון, לא מוקלד: `amount_net > threshold(issue_date)` לפי טבלה מתוארכת ב-`Parameters/allocation-thresholds`. אם חשבונית אחת מאגדת retainer ותוספות, הסכום נבחן אחרי הצירוף. **[משני, סתירה פתוחה]** סף הדיווח החודשי למע"מ מופיע כ-1,775,000 במקור אחד וכ-1,725,000 באחר, ומועדי הדיווח (15/19/23 בחודש) מגיעים מאגרגטור באיכות נמוכה ([Skillselion](https://skillselion.com/skills/skills-il/tax-and-finance/israeli-vat-reporting); [Kintsugi](https://trykintsugi.com/sales-tax-guides/middle-east/israel.md)); יש לשמור `vat_filing_day` כפרמטר ולאשר עם רו"ח.

## מה מומחים קובעים ומה נשאר דעה

**[עובדה]** Few מגדיר דשבורד כ"תצוגת מידע במסך אחד" ומונה שגיאות: מורכבות יתר, יותר מדי התראות ("crying wolf"), צבעי אדום/ירוק שלא ניתן להבדיל, מספרים ללא הקשר, גרף לא מתאים, ועמודות שאינן מתחילות באפס ([Perceptual Edge](https://www.perceptualedge.com/articles/Whitepapers/Dashboard_Design.pdf)). הוא ממליץ על sparklines לרקע היסטורי, ועל הצגת סטייה מהיעד ישירות; ועל bullet graph (סרגל ליניארי עם סמן יעד ורצועות איכות בגוון אחד בעוצמות שונות) במקום מדי-מחוג ([Bullet Graph spec](https://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf)). NN/g: אורך ומיקום הם התכונות היעילות ביותר לכמויות, עוגות/donut/gauge/treemap לא מומלצים, צבע לקטגוריות ולא לכמויות ([NN/g](https://www.nngroup.com/articles/dashboards-preattentive/)). Geckoboard: היררכיה לפי גודל ומיקום, קיבוץ מדדים קשורים, תווית/השוואה/יעד כדי שיהיה ברור אם המספר טוב או חריג, עיגול מספרים, ועקביות ([Geckoboard](https://support.geckoboard.com/en/articles/10306664-planning-your-dashboard-design-and-layout)). סקירה של 83 דשבורדים אמיתיים: פריסה מדורגת 49%, מקובצת 33%, מספרים בודדים 88%, חותמת עדכון 64%, drill-down 55%, ניווט בין עמודים 76%, sparklines 21% ([Bach et al.](https://ar5iv.labs.arxiv.org/html/2205.00757)); זה תיאור של מה שנהוג, לא כלל.

**[דעה/הסקה]** לא נמצא מקור מוסמך למספר KPI מקסימלי למסך, לכלל "5 שניות", לספי ימים להתראות, או לדשבורד של בעלים של כמה עסקים ותחומי חיים. הכלל "4-6 אריחים לאזור" נשען על דפוס Monarch/RentRedi ([Monarch](https://www.monarch.com/landing/net-worth); [RentRedi](https://rentredi.com/blog/rentredi-portfolio-performance-dashboard-tracks-cash-flow-metrics-for-entire-rental-portfolio/)) והוא עיצוב שלי. אותו דבר לגבי "אל תסכם דומיינים לא קשורים לסכום אחד": זו עמדה שלי, שאותה אני מחריג בצורה מפורשת להלן עבור הכנסה ורווח עסקיים, כי אביהו דרש "הכנסות ורווחים כוללים".

## פריסה מומלצת: בית, דומיין, branch, רשומה

**[הסקה]** שכבות ניווט: **L0 בית → L1 דומיין → L2 branch/עסק → L3 רשומה**. לא יותר, בהתאם לממצא על ניווט ו-drill-down.

**עמוד הבית (מובייל: עמודה אחת, בסדר הזה):**

| אזור | תוכן | כלל |
|---|---|---|
| כותרת | חותמת "סונכרן לאחרונה" לכל דומיין, מתג "הסתר סכומים" | נתון ישן מעל 3 ימים נצבע כאזהרה (דעה); הכרחי כי הסנכרון חד-כיווני ותלוי בעדכון ה-vault |
| 1. דורש תשומת לב היום | עד 7 פריטים, ממוינים לפי חומרה ואז תאריך, עם ספירה "ועוד N" וקישור לכל; מצב "הכול תקין" מפורש | התראות רק לפי הכללים בטבלה למטה; snooze עם תאריך |
| 2. שורת גיבור | הכנסה חודש נוכחי (ex-VAT) מול חודש קודם ויעד; רווח חודשי; חובות פתוחים כולל מע"מ ומתוכם באיחור; משימות באיחור | כל מספר: דלתא + sparkline 12 חודשים |
| 3. כרטיס לכל דומיין | עסקים (adigital ו-OSPA כשורות), Personal, Entrepreneurship (נדל"ן, משפטי, השקעות, כספים) | מבנה זהה: כותרת, מספר ראשי, דלתא, sparkline, סטטוס |
| 4. 30 הימים הקרובים | תשלומים וחיובים, גבייה צפויה, מועדי מע"מ, חוזים וגבולות | רשימה לפי תאריך |

**הכנסה ורווח כוללים (הכרעה):** מציגים שורה "קבוצה" עם **מתג בסיס**: *100% מהעסקים* מול *החלק שלי*. adigital נספר לפי אחוז הבעלות שלו (שאלה פתוחה), OSPA ב-100% ובנוסף "החלק שלי = 50%". אסור לחבר 100% של OSPA ל-adigital תחת כותרת "ההכנסה שלי". הכנסה מוצגת ex-VAT, רווח לפני ובלי שכר בעלים נפרד לפי הגדרה אחת קבועה (שאלה פתוחה). **[הסקה]**

**עמודי דומיין:** *עסקים* (לשוניות adigital ו-OSPA), *Personal*, *Entrepreneurship* (לשוניות נדל"ן, משפטי, השקעות, כספים). **עמודי branch:** מבנה אחיד: פס KPI עליון (5-8), טרנד, טבלת רשומות פתוחות עם מיון, ורשימת נתונים חסרים. **עמוד OSPA:** כרגע branch יחיד (מודיעין), אך הסכמה כוללת `branch` כדי ש-Jerusalem, Ramat Gan ו-Beit Shemesh יתווספו כעמודות באותו עמוד. עמוד ramp-up ורשימת milestones לפני פתיחה נבנים רק כשמתחילה פתיחת branch שנייה.

## KPI לכל branch: נוסחאות ושדות frontmatter

**כללי סכמה משותפים** (תואם לדו"ח ה-vault הקודם, בלי לחזור עליו): לכל note `id` יציב, `type`, `domain` (`adigital | ospa | personal | ventures`), `status`, `updated`; כסף בשדות `amount_net`, `vat_rate`, `vat_amount`, `amount_gross`, `currency` (`ILS`); תאריכים `YYYY-MM-DD`; enums באנגלית. **[הסקה]** חשבוניות הן בבעלות מערכת Paperless (מסמך חוקי); ה-vault מחזיק `external_id` ו-`allocation_number` שמיובאים מה-CSV. מבנה ה-CSV של Paperless לא נחקר (שאלה פתוחה), ולכן הוא מגדיר את מיפוי השדות. הנוסחאות להלן הן **[הסקה]** על בסיס הגדרות סטנדרטיות, אלא אם צוין מקור.

### A1. adigital

| KPI | נוסחה | שדות |
|---|---|---|
| MRR retainer | Σ `monthly_fee_net` של לקוחות `status: active` עם חוזה בתוקף | client: `monthly_fee_net`, `contract_start`, `contract_end`, `status` |
| הכנסה מול חיוב | חיוב = Σ `amount_net` של חשבוניות מס שהונפקו בחודש; הכנסה = לפי `service_period`; פער = איחור בהנפקה | invoice: `issue_date`, `service_period`, `doc_type`, `amount_net` |
| מקורות הכנסה | retainer / עמלה (ממוצע 3 חודשים) / פרויקט חד-פעמי, בנפרד | invoice: `revenue_stream` (`retainer|commission|project`) |
| חובות באיחור (aging) | לפי `days_past_due = today - due_date`: שוטף, 1-30, 31-60, 61-90, 90+; כולל מע"מ, לפי לקוח | invoice: `due_date`, `amount_gross`, `paid_amount`, `last_payment_date`, `promise_to_pay_date`, `dispute` |
| גבייה בחודש | מזומן שנכנס / (יתרת פתיחה + חיוב כולל מע"מ) | `paid_amount`, `last_payment_date` |
| ריכוז לקוחות | max(הכנסה 3 חודשים של לקוח) / סך; וגם top-3 | מחושב |
| רווחיות לקוח | (הכנסת לקוח − עלות ישירה − עלות כללית מוקצית) / הכנסה; AMI: מתחת ל-10% "לא ראוי להישאר" ([AMI](https://agencymanagementinstitute.com/5-key-agency-metrics/)) | expense: `client_id`, `amount_net`; time: `client_id`, `month`, `hours` |
| burn של retainer | שעות החודש / (`monthly_fee_net` / `target_hourly_rate`); יעד ניצול 85-95% לפי ספק ([Ravetree](https://www.ravetree.com/blog/how-ravetree-can-help-you-manage-client-retainers)) | `target_hourly_rate` |
| רווח חודשי | הכנסה ex-VAT − כל ההוצאות ex-VAT | expense: `category`, `date` |
| חידושים | `notice_deadline = contract_end − notice_period_days` | `auto_renew`, `notice_period_days`, `last_price_increase_date` |
| מע"מ לתשלום (הערכה) | מע"מ עסקאות (חשבוניות מס וחשבוניות מס קבלה בתקופה) − מע"מ תשומות | `vat_amount`, expense `vat_amount` |

**[דעה]** בהתאם לספקים, מדדים כמו LTV/CAC, הכנסה לעובד, churn חודשי באחוזים, HHI ו-NRR מיותרים ב-9 לקוחות: הפסד לקוח אחד שווה 11% logo churn, ולכן מציגים רשימת לקוחות שאבדו/הוזלו ולא אחוז ([SPP](https://www.spp.co/blog/agency-kpis/); [Swydo](https://www.swydo.com/?p=21674); ספקים, מקור הנתונים לא ברור). **[משני/דעה]** יעדי השוואה (שולי רווח גולמי 50-60%, ריכוז לקוח בודד מתחת ל-15% בריא ומעל 40% מסוכן) מגיעים מבלוג ספק אמריקאי ([Swydo](https://www.swydo.com/?p=21674)); ביטחון נמוך לשוק ישראלי ולסוכנות של 9 לקוחות.

### A2. OSPA / Head Spa (מודיעין; אביהו 50%)

**[עובדה]** נוסחאות הליבה מתועדות אצל Zenoti: Avg ticket = הכנסת שירות / כרטיסי שירות; Occupancy = תורים מוזמנים / זמינים; no-show; Retail share; Wages vs sales ([Zenoti](https://www.zenoti.com/thecheckin/30-key-performance-indicators-kpis-for-salons-and-spas)); ושימור לפי Boulevard = (לקוחות שטופלו − חדשים) / לקוחות בתחילת התקופה ([Boulevard](https://www.joinblvd.com/blog/client-retention-formula)). אין מקור אחד ל-head spa. כיוון שאין חיבור POS, הרשומה היא **note חודשי אחד לכל branch** (`id: ospa-modiin-2026-09`), שמולא מ-CSV של Paperless ומסיכום ידני.

| KPI | נוסחה | שדות (ב-note החודשי) |
|---|---|---|
| הכנסה נטו לפי זרם | Σ ex-VAT: שירותים, retail, גיפט קארדס שנמכרו, חבילות | `revenue_services_net`, `revenue_retail_net`, `giftcards_sold_net`, `packages_sold_net` |
| טיפולים ו-avg ticket | `revenue_services_net` / `service_tickets` | `treatments_count`, `service_tickets` |
| ניצול חדרים | `booked_treatment_hours` / `available_room_hours` | `available_room_hours`, `booked_treatment_hours` |
| no-show + ביטול מאוחר | (`noshow_count` + `late_cancel_count`) / `booked_appts` | שלושת השדות |
| לקוחות חדשים מול חוזרים; ביקור שני | `new_clients`, `returning_clients`; ביקור שני = חדשים שחזרו תוך 90 יום / חדשים | `new_clients`, `returning_clients`, `second_visit_90d` |
| rebooking | ביקורים עם תור עתידי בצ'קאוט / ביקורים שהושלמו | `rebooked_visits`, `completed_visits` |
| עלות עבודה | (שכר + עלויות מעסיק + עמלות) / הכנסה נטו; עלות מטפלות / הכנסת שירות | `labor_cost_total`, `therapist_cost` |
| צריכה (COGS) ושכירות | `cogs_consumables` / הכנסה; (`rent_occupancy`) / הכנסה | שדות באותם שמות |
| תרומת branch (4-wall) | הכנסה − COGS − עבודה − תפוסה − שיווק branch − שונות ישירות | `marketing_spend`, `other_direct` |
| CAC גס | `marketing_spend` / `new_clients` | כנ"ל |
| הכנסה מוכרת מול מזומן; הכנסה נדחית | יתרת גיפט קארדס וחבילות שטרם מומשו = פתיחה + מכירות − מימושים; הכנסה מוכרת עם מימוש, ללא הערכת breakage עד שיש היסטוריה ([Beancount](https://beancount.io/blog/2026/07/16/med-spa-bookkeeping-deferred-revenue-packages-gift-cards-memberships-guide), בלוג חשבונאות med-spa) | `deferred_revenue_balance` |
| מזומן וביקורות | יתרה; דירוג ומספר ביקורות Google | `cash_balance`, `google_rating`, `google_reviews` |

**בנצ'מרקים (כל הציטוטים לשוק אחר, לא head spa ולא ישראלי):** ניצול חציוני 56% ו-75th percentile כ-75% (נתוני ספק, ורטיקל barbershop; [Zenoti](https://www.zenoti.com/thecheckin/salon-and-barbershop-metrics-guide)), ביטול 4% (barbershop, באותו מקור), שימור ממוצע 45% ומצטיינים 70% (מספרות אמריקאיות, [Boulevard](https://www.joinblvd.com/blog/client-retention-formula)), rebooking תוך 24 שעות 43-57% (ANZ 2020, [Kitomba](https://www.kitomba.com/blog/industry-insights-rebooking-rates-for-the-hair-and-beauty-industry-and-how-to-improve-yours/)). **ביטחון בינוני לשוק הנדון, נמוך לספא.** אחוזי עבודה (45-55%), שכירות (10-15%), צריכה (5-8%) ותרומת branch (20-30%) הם **[דעה, ללא מקור]**; יש לקבוע יעדים מנתוני מודיעין בפועל, בשדה `plan_*` נפרד, לא כבנצ'מרק.

**פאנל שותף (50%):** חשבון הון לכל שותף = יתרת פתיחה + הון שהוזרם + חלק ברווח − משיכות ± הלוואות; `cash_available_to_distribute` = מזומן − רזרבה (1-3 חודשי הוצאות, דעה) − הכנסה נדחית − מע"מ ומס לתשלום − התחייבויות capex. שדות: partner note עם `ownership_pct`, `loan_balance`, `loan_date`, `interest_terms`, `draws_ytd`. **[משני]** משיכה של בעל מניות מהותי מחברה עלולה להיחשב הכנסה חייבת לפי סעיף 3(ט) לפקודה, והלוואות עד 100,000 ש"ח שומרות על אופי הלוואה ([CPA Dray](https://cpa-dray.com/en/blog/tax-on-directors-loans/); בלוג משרד רו"ח, לאמת); לכן התראה על יתרה שמתקרבת ל-100,000 ש"ח או בת מעל שנתיים. שכר ניהול מוצג בנפרד מחלוקת רווח כדי שלא לעוות EBITDA.

### B. Personal

| KPI | נוסחה | שדות |
|---|---|---|
| משימות | פתוחות, באיחור, ל-7 ימים, לפי תחום | task: `domain`, `area` (`home|general`), `due`, `status`, `priority`, `next_action` |
| רישום חיובים קבועים | סכום וזמן ל-30 יום | bill: `amount`, `frequency`, `due_day`, `next_due`, `autopay`, `contract_end` |
| תקציב מול ביצוע (ברמת קטגוריה) | `budget − actual`, אחוז ניצול | `month`, `category`, `budget`, `actual` |
| תזרים חודשי ושיעור חיסכון | הכנסות − הוצאות (בלי העברות פנימיות); (הכנסה − הוצאה) / הכנסה | `income_total`, `spend_total` |
| תחזוקה | `next_due = last_done + interval` | maintenance: `last_done`, `interval_days`, `warranty_end` |
| חודשי רזרבה | נזילות / הוצאה חודשית ממוצעת מהותית | `liquid_cash`, `essential_spend_avg` |

**[הסקה]** משימות הן שורות (Tasks plugin) ולא notes ולכן דורשות ID ללכידת שורה או פורמט Tasks אחד קבוע בסנכרון; הן אינן חלק מסנכרון הכספים.

### C1. נדל"ן | C2. משפטי | C3. השקעות | C4. כספים

**[עובדה]** הנוסחאות מתועדות: NOI = הכנסה − הוצאות תפעול לפני שירות חוב; cap rate = NOI / שווי; LTV = יתרת הלוואה / שווי; cash-on-cash = תזרים שנתי לפני מס / מזומן שהושקע; DSCR = NOI / שירות חוב שנתי ([ManageCasa](https://managecasa.com/articles/top-10-key-performance-indicators-kpi-for-rental-properties)). יעדים שם (cash-on-cash 8-12%, DSCR ≥1.25, תפוסה מעל 95% (vacancy מתחת ל-5%)) הם **[משני]**, מוכוונים לארה"ב, ולא אומתו לישראל. ארבעה אריחי תיק לפי RentRedi (NOI, תזרים, cash-on-cash, הון עצמי) מסופקים לפי נכס וסך תיק.

| תחום | KPI ונוסחה | שדות |
|---|---|---|
| נדל"ן | תפוסה = יחידות תפוסות / סך; תשואה ברוטו = שכירות שנתית / מחיר רכישה; NOI חודשי; הון = שווי − הלוואות; סולם סיום חוזים (120/90/60 יום) | property: `purchase_price`, `current_value`, `value_date`, `monthly_rent`, `lease_end`, `tenant`, `rent_paid_this_month`, `deposit`; loan: `track_type` (`prime|fixed|cpi`), `balance`, `rate`, `next_reset_date`, `monthly_payment`, `end_date` |
| משפטי | תיקים לפי סטטוס; מועד הבא; תאריך התיישנות; שכ"ט שולם מול תקציב, חוב פתוח | matter: `counterparty`, `forum`, `case_number`, `next_deadline`, `deadline_type` (`hard|soft`), `limitation_date`, `limitation_basis`, `limitation_verified_by_lawyer`, `lawyer`, `fee_type`, `fee_budget`, `fee_billed`, `fee_paid`, `exposure_amount`, `next_action` |
| השקעות | הקצאה לפי סוג; שיעור מזומן; ריכוז מקסימלי ("מעל 10% בנייר = חריג", דעה); תרומות, דיבידנדים YTD; תשואה שדווחה על ידי הברוקר | account: `balance`, `balance_date`, `asset_class`, `contributions_ytd`, `income_ytd`, `reported_return` |
| כספים | נזילות; runway = נזילות / burn חודשי; סולם פירעון לפי שנה; ריבית משוקללת = Σ(יתרה × ריבית) / Σ יתרה; נתח פריים; DSCR תיק | `liquid_assets`, `monthly_burn`, loans כנ"ל; ownership: `entity`, `my_pct`, `stake_value`, `valuation_basis`, `valuation_date`, `loans_given` |

**[הסקה]** שווי נקי = Σ(אחוז בעלות × הון של ישות) + נכסים אישיים − התחייבויות אישיות, ולעולם לא גם נכסי הישות עצמם (ספירה כפולה); הלוואת בעלים מוצגת בנפרד. הפרמטרים של מסים וחוקים (מס רכישה, פטור שכירות, LTV) משתנים מדי שנה ומאוחסנים ב-`Parameters` עם תאריך ומקור, לא בקוד; **[משני]** הנתונים בנושא נשארו לא מאומתים מול רשות המסים ובנק ישראל, ולכן לא הוכנסו לדו"ח כספים. **[משני, לא מאומת]** התיישנות אזרחית 7 שנים בישראל נזכרת רק מהזיכרון; יש לקבל אישור עורך הדין ולכן הדגל `limitation_verified_by_lawyer`.

## כללי חריגה והתראה: מעט, ניתנים לפעולה, ניתנים להגדרה

**[עובדה]** Few מזהיר מ"crying wolf", ומקור משני מייחס עייפות התראות בעיקר לספים רגישים מדי שמופעלים על שונות רגילה ([Think Insights](https://thinkinsights.net/playbooks/data-literacy-dashboards-alerts-operational-monitoring-playbook)). **[דעה]** כל הספים שלהלן הם ברירות מחדל לא מקוריות, שמורות ב-`Parameters/thresholds` ונכוונות אחרי חודש שימוש; מקסימום 7 פריטים בפאנל.

| חומרה | כלל | תחום |
|---|---|---|
| אדום | `allocation_required` ו-`allocation_number` ריק | adigital |
| אדום | `vat_amount` לא תואם ל-`amount_net × vat_rate`, או `vat_rate` חסר | כל החשבוניות |
| אדום | חשבונית באיחור מעל 30 יום; איחור מעל מנוי חודשי אחד; מעל 60 יום: עצירת הוצאות מקדמה על חשבון הלקוח; מעל 90: הפרשה (הערכה 25-100%, דעה, לאמת עם רו"ח) | adigital |
| אדום | מועד משפטי קשיח בעוד 3 ימים או פחות / באיחור; `limitation_date` בלי אישור עו"ד, בטווח 30 יום | משפטי |
| אדום | מזומן מתחת לרצפה (`cash_floor`) או runway מתחת ל-3 חודשים (דעה) | כספים, OSPA |
| כתום | חשבונית באיחור 1-30 יום; `promise_to_pay_date` שעבר | adigital |
| כתום | retainer שטרם הונפק ב-3 ימי עבודה ראשונים בחודש | adigital |
| כתום | burn של retainer מעל 90% (Ravetree משתמשים ב-50/75/90, ספק) | adigital |
| כתום | `notice_deadline` תוך 60/30 יום; אין העלאת מחיר מעל 12 חודשים | adigital |
| כתום | מועד דיווח מע"מ תוך 7 ימים עם מסמכים לא מותאמים | adigital, OSPA |
| כתום | סיום חוזה שכירות תוך 120/90/60 יום; תשלום שכירות חסר אחרי היום ה-10 | נדל"ן |
| כתום | מועד קשיח תוך 7 ימים (7/3/1 גרסת בעלים; מקור משני מזכיר 14/7/1, [JobCannon](https://jobcannon.io/skills/legal-case-management)); שכ"ט מחויב מעל 80% מהתקציב | משפטי |
| כתום | ניצול OSPA מתחת ליעד התוכנית חודשיים ברצף; `second_visit_90d` יורד; הכנסה נדחית מעל מזומן | OSPA |
| כתום | יתרת הלוואת שותף מעל 80,000 ש"ח או מעל שנתיים | OSPA, חשבון שותפים |
| כתום | נתון ישן: דומיין שלא עודכן מעל 3 ימים (חודשי: מעל 35); חשבונית ב-CSV ללא note ב-vault ולהפך | כל הדומיינים |

כל פריט בפאנל מכיל: מה, כמה (₪ או ימים), למי, ופעולה מוצעת. התראות לא משתמשות בצבע בלבד: אייקון וטקסט נוספים (Few מזהיר מאדום/ירוק בלבד). **[הסקה]**

## עיצוב, גרפים ו-RTL: כללים קצרים

**גרפים.** כרטיס מספר ראשי + דלתא + sparkline; bullet bars מול יעד (הכנסה חודשית, תקציב, ניצול); עמודות מתחילות באפס; ללא עוגות ומדי-מחוג; מספרים מעוגלים בתצוגה וערך מלא בלחיצה; צבע סטטוס רק לחריגים, אחרת ניטרלי ([Perceptual Edge](https://www.perceptualedge.com/articles/Whitepapers/Dashboard_Design.pdf); [NN/g](https://www.nngroup.com/articles/dashboards-preattentive/)). **[הסקה]** ל-SVG inline (sparklines, bullet bars, עמודות) אין תלות וה-RTL נשלט ב-CSS; לטרנד מפורט מספיקה ספרייה אחת: uPlot (כ-50KB; [uPlot](https://github.com/leeoniya/uPlot), benchmark של היוצר) או Chart.js. תמיכת RTL בספריות אלה לא אומתה.

**RTL.** **[עובדה]** `dir="rtl"` על `html`, ללא קביעת כיוון בסיס ב-CSS; מאפייני CSS לוגיים (`margin-inline-start`, `text-align: start`); `dir="auto"` בשדות קלט ([W3C](https://www.w3.org/International/questions/qa-html-dir)). Material: פריסה, ניווט וחצי כיוון מתהפכים; מספרים, אייקונים לא כיווניים וגרפים לא מתהפכים, אך "תהליך בזמן" כן ([Material](https://m1.material.io/usability/bidirectionality.html)). AG Charts מציג ציר ללא היפוך אוטומטי, עם מקרא ו-tooltip מתהפכים, וסימן מינוס נשאר משמאל ([AG Charts](https://ag-grid.com/charts/javascript/rtl.md)). **[לא נפתר]** לא נמצא מקור ביחס לכיוון ציר הזמן בגרפים עבריים: המקורות מתנגשים. **[הסקה]** ממליצים על דגל תצורה יחיד (`chart_time_direction`), ברירת מחדל שמאל-לימין ל-sparklines וטבלאות עמודות הפוכות, ובדיקה עם אביהו. מחרוזות מעורבות (שם לקוח באנגלית, מספר חשבונית, "₪1,200") ב-`<bdi>`; פורמט כסף דרך `Intl.NumberFormat('he-IL', {style:'currency', currency:'ILS'})` ולא ידני; ספרות לטיניות, tabular numerals; מטרות מגע 44px ומעלה (כל אלה **[דעה/ידע רקע, לא אומתו בסשן]**, כולל WCAG 4.5:1 לטקסט). פרטיות: מתג "הסתר סכומים" (ברירת מחדל מוסתר במכשיר חדש), קריאה בלבד, אימות חזק, `noindex` וללא caching (**[דעה]**; אין מקור שנמצא).

**מצבי ריק.** דומיין ללא נתונים מציג "אין נתונים עדיין" ולא 0, ואינו נכלל בסכומי הקבוצה. לא נמצא מקור על empty states; זו החלטת עיצוב שלי.

## מה לבנות קודם ומה לדחות

**[הסקה]** העיקרון: מתחילים ברישומים יציבים ובמדדים שניתן לחשב מנתונים קיימים, ודוחים מה שדורש לכידה רציפה או חישוב משוקלל-זמן (כך גם ממליץ המחקר על רישומי נדל"ן, חוב ומשפט).

| שלב | מה נבנה | למה עכשיו |
|---|---|---|
| 0 | `Parameters` (מע"מ מתוארך, ספי הקצאה, ספי התראה); סכמת invoice/client/task; אימות בסנכרון (`vat_amount`, `allocation_required`, `id` כפול); חותמת "סונכרן" | נועל את דגלי המע"מ וההקצאה לפני שנאגרים נתונים שגויים |
| 1 | עמוד adigital: MRR, חיוב מול גבייה, aging, ריכוז, מע"מ משוער, חידושים; משימות (כל הדומיינים); עמוד בית עם פאנל חריגים ושורת גיבור לדומיין אחד; מצבי ריק לשאר | הנתון היחיד שקיים; מחזיר ערך מהר, והפאנל כבר שימושי |
| 2 | OSPA: note חודשי אחד (השדות בטבלת OSPA למעלה) + עמוד branch בודד + חשבון שותפים; הכנסה וחלק שלי | מאפשר "הכנסה ורווח כוללים"; כ-15 דקות בחודש |
| 3 | רישומים: נדל"ן (rent roll, הלוואות, סולם חוזים), משפטי (תיקים, מועדים, שכ"ט), חיובים קבועים אישיים, ownership register | יציבים ונדירים לעדכון; ערך גבוה בהתראות מועד |
| 4 | השקעות ורבעון: הקצאה, ריכוז; כספים מאוחדים: runway, סולם פירעון, תחזית 13 שבועות לפריטים גדולים | תלוי בנתוני שלבים 2-3 |
| דחוי | רווחיות לקוח לפי שעות (עד שיש timesheet גס), CAC לפי ערוץ, NPS, XIRR/TWR, cohorts, ramp-up ו-cannibalisation (עד branch שני), רווחיות לפי מטפלת, breakage, תחזיות תרחישים | דורשים נתונים שאין או אינם משתלמים בהיקף הנוכחי |

## שאלות פתוחות לאביהו

1. **בעלות ב-adigital:** 100%? זה קובע את מתג "החלק שלי" ואת הגדרת "רווח" (לפני או אחרי שכר בעלים).
2. **Paperless:** אילו עמודות יש ב-CSV (מספר הקצאה? `due_date`? סטטוס תשלום? שיעור מע"מ)? מיפוי השדות תלוי בכך.
3. **סטטוס מע"מ:** עוסק מורשה בכל הישויות? דיווח חודשי או דו-חודשי? האם הלקוחות עוסקים מורשים (ממילא קובע אם חל מספר הקצאה)? יש לאמת עם רו"ח את הספים ואת מועדי הדיווח.
4. **גובה ה-retainers ותנאי תשלום** (שוטף+?), כולל אם יש חשבוניות מעל 5,000 ש"ח לפני מע"מ בלי מספר.
5. **OSPA:** מבנה משפטי (חברה/שותפות/ישות אישית של אביהו), האם ניתן לקבל ייצוא ממערכת התורים/קופה, ואיך משולם שכר הניהול.
6. **תחום משפטי:** מי עורך הדין שמאשר תאריכי התיישנות, ואילו תיקים פעילים כיום.
7. **מינוח vault:** הדו"ח הקודם השתמש ב-`gurzad` ולא ב-`adigital` כ-`domain`; מה השם הסופי?
8. **העדפות:** כיוון ציר זמן בגרפים, והאם הדשבורד נגיש בציבור (קובע דרישות אימות).

## מסקנה

ההבחנה החשובה: רוב העבודה בדשבורד בעלים כאן אינה בחירת מדדים אלא הנדסת סכמה. קל להגדיר 60 מדדים; מה שקובע הוא אם `vat_rate`, `allocation_number`, `due_date` ו-`updated` נשמרים נכון מהרשומה הראשונה. שגיאת מע"מ 17% או התעלמות מסף הקצאה ירדו בשקט למספרים של כל הדשבורד, ולכן שלב 0 קודם לכל גרף.

הממצא השני: מעט מדי מהעצות על דשבורד מבוססות מקורות איכותיים. עקרונות עיצוב ותיעוד טכני של Obsidian מתועדים היטב; ספי התראה, יעדי רווחיות ל-head spa, ועיצוב ציר זמן עברי נשארים דעה. לכן המערכת צריכה להיות ניתנת לכיוון (`thresholds`, `plan_*`) ולהשוות את אביהו לעצמו, ולא לבנצ'מרקים אמריקאיים.
