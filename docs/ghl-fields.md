# GHL fields / custom values / tags used by the app

Reference of every GoHighLevel field, custom value, opportunity field, and tag
the app reads or writes. **🆕 = introduced for the attendee/cohort features (create
these if missing).** Everything else predates this work; the code writes to it, but
confirm it exists in GHL or the value/merge-tag will be empty.

## Contact custom fields
| Field key | Type | Purpose |
|---|---|---|
| `event_city` | Text | Buyer's event slug |
| `ticket_tier` | Text | "VIP" / "General Admission" |
| `order_amount` | Number/Text | Order amount |
| `sp_no_of_ticket_purchased` | Number | Tickets purchased (primary) |
| `sp2026_ticket_quantity` | Number | Tickets (legacy, also written) |
| `ticket_quantity` | Number | Tickets (legacy, read-only fallback) |
| `sp2026ticket_quantity` | Number | Tickets (legacy, read-only fallback) |
| `do_you_have_a_moa_1` | Text | Survey: MOA |
| `have_you_attended_a_scale__profit_seminar_before_1` | Text | Survey: attended before |
| `scale__profit_shirt_size` | Text | Survey: shirt size |
| `sp_attendees_added` 🆕 | Number | # attendees registered (unassigned-ticket math) |
| `sp_attendees` 🆕 | Multi-line text | JSON list of registered attendees (revoke) |
| `sp_buyer_attending` 🆕 | Text | "yes"/"no" — does the buyer use 1 ticket |

> Agency **State**, **Phone**, **Email**, **Name** use GHL's native fields — nothing to create.

## Opportunity custom fields
| Field key | Type | Purpose |
|---|---|---|
| `sp_no_of_ticket_purchased` | Number | Ticket count on opportunity |
| `sp2026ticket_quantity` | Number | Ticket count on opportunity |
| `sp_cohort_location` | Text | Cohort city (email merge) |
| `sp_cohort_date` | Text | Cohort date |
| `sp_cohort_venue` | Text | Cohort venue |
| `sp_cohort_address` | Text | Cohort address |
| `sp_cohort_time` | Text | Cohort time |
| `cpsp_ticket_purchaser` 🆕 | Text | Who bought an attendee's ticket |

## Location custom values
| Custom value | Purpose |
|---|---|
| `cpsp_cohort_slot_1` … `_4` | Cohort line for emails (slot 1 = nearest), e.g. "Nashville — August 5th–6th, 2026 — W Nashville Hotel, …" |
| `CP-S&P: Remaining GA Tickets Cohort 1` … `4` | Remaining GA (100 − tickets sold) |
| `CP-S&P: Remaining VIP Tickets Cohort 1` … `4` | Remaining VIP (20 − tickets sold) |

## Tags (applied automatically)
| Tag | Applied to |
|---|---|
| `🤝 s&p-{tier}-{city}-{yymmdd}` (e.g. `🤝 s&p-ga-nashville-260806`) | Every buyer + attendee (identifies tier + event + date) |
| `🤝 s&p-multipleticket-buyer` | Buyer who registered additional attendees |
| `🤝 s&p-attendee` | A registered additional attendee |
