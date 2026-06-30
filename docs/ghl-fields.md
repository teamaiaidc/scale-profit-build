# GHL fields / custom values / tags used by the app

Reference of every GoHighLevel field, custom value, opportunity field, and tag
the app reads or writes. **🆕 = introduced for the attendee/cohort features (create
these if missing).** Everything else predates this work; the code writes to it, but
confirm it exists in GHL or the value/merge-tag will be empty.

## Contact custom fields

| Field key                                            | Type            | Purpose                                                       |
| ---------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `event_city`                                         | Text            | Buyer's event slug                                            |
| `ticket_tier`                                        | Text            | "VIP" / "General Admission"                                   |
| `order_amount`                                       | Number/Text     | Order amount                                                  |
| `sp_no_of_ticket_purchased`                          | Number          | Tickets purchased (primary)                                   |
| `sp2026_ticket_quantity`                             | Number          | Tickets (legacy, also written)                                |
| `ticket_quantity`                                    | Number          | Tickets (legacy, read-only fallback)                          |
| `sp2026ticket_quantity`                              | Number          | Tickets (legacy, read-only fallback)                          |
| `do_you_have_a_moa_1`                                | Text            | Survey: MOA                                                   |
| `have_you_attended_a_scale__profit_seminar_before_1` | Text            | Survey: attended before                                       |
| `scale__profit_shirt_size`                           | Text            | Survey: shirt size                                            |
| `cpsp_no_of_attendees_added` 🆕                      | Number          | # attendees registered (unassigned-ticket math)               |
| `cpsp_name_of_attendees` 🆕                          | Multi-line text | Readable attendee list "First Last <email>" per line (revoke) |
| `cpsp_buyer_attending` 🆕                            | Text            | "yes"/"no" — does the buyer use 1 ticket                      |
| `cpsp_role` 🆕                                       | Text            | "Buyer" / "Attendee" (does the contact attend)                |
| `cpsp_buyer_name` 🆕                                 | Text            | On an attendee: who bought their ticket (name)                |
| `cpsp_buyer_email` 🆕                                | Text            | On an attendee: buyer's email                                 |

> Agency **State**, **Phone**, **Email**, **Name** use GHL's native fields — nothing to create.

## Opportunity custom fields

| Field key                   | Type                             | Purpose                                                   |
| --------------------------- | -------------------------------- | --------------------------------------------------------- |
| `sp_no_of_ticket_purchased` | Number                           | Ticket count on opportunity                               |
| `sp2026ticket_quantity`     | Number                           | Ticket count on opportunity                               |
| `cpsp_cohort_location` 🆕   | Text                             | Event location/name (email merge)                         |
| `cpsp_cohort_date` 🆕       | Text                             | Event date                                                |
| `cpsp_cohort_venue` 🆕      | Text                             | Event venue                                               |
| `cpsp_cohort_address` 🆕    | Text                             | Event address                                             |
| `cpsp_cohort_time` 🆕       | Text                             | Event time                                                |
| `cpsp_ticket_tier` 🆕       | Text (single line, NOT dropdown) | Dynamic: "{qty} General Admission {year}" or "VIP {year}" |

## Location custom values

| Custom value                                   | Purpose                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `cpsp_cohort_slot_1` … `_4`                    | Cohort line for emails (slot 1 = nearest), e.g. "Nashville — August 5th–6th, 2026 — W Nashville Hotel, …" |
| `CP-S&P: Remaining GA Tickets Cohort 1` … `4`  | Remaining GA (100 − tickets sold)                                                                         |
| `CP-S&P: Remaining VIP Tickets Cohort 1` … `4` | Remaining VIP (20 − tickets sold)                                                                         |

## Tags (applied automatically)

| Tag                                                                 | Applied to                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `🤝 s&p-{tier}-{city}-{yymmdd}` (e.g. `🤝 s&p-ga-nashville-260806`) | Every buyer + attendee (identifies tier + event + date)      |
| `🤝 s&p-multipleticket-buyer`                                       | Buyer who registered additional attendees                    |
| `🤝 s&p-attendee`                                                   | A registered additional attendee                             |
| `🤝 s&p-manual-attendee`                                            | An attendee the admin registered by hand (automation target) |
| `🤝 s&p-revoked`                                                    | Attendee whose ticket the admin revoked (event tags removed) |

## Attendee-registered webhook (pipeline automation)

When the admin registers an additional attendee, the app can POST to a GHL
**Inbound Webhook** trigger so a workflow can act on it (e.g. assign the attendee
to a pipeline). **Opt-in:** set the `GHL_ATTENDEE_WEBHOOK_URL` env var to the URL
GHL gives you for the Inbound Webhook trigger. One POST is sent **per attendee**.

Tag-based alternative (no setup): a workflow triggered by **Contact Tag Added =
`🤝 s&p-manual-attendee`** also fires for every admin-registered attendee, with
all the contact fields (buyer name/email, role, event tag) already populated.

Payload (`application/json`):

```json
{
  "event": "attendee_registered",
  "contactId": "<GHL contact id of the attendee>",
  "firstName": "TM",
  "lastName": "Test",
  "fullName": "TM Test",
  "email": "tm@test.com",
  "phone": "+19999999999",
  "state": "Iowa",
  "eventSlug": "california",
  "tier": "General Admission",
  "eventTag": "🤝 s&p-ga-california-261209",
  "role": "Attendee",
  "buyerName": "Buyer Name",
  "buyerEmail": "buyer@email.com",
  "buyerContactId": "<GHL contact id of the buyer>"
}
```
