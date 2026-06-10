# GHL Automation Handoff — Scale & Profit Checkout

This is what the site sends into GHL and what the automation builder can hook into.
Location ID: `mVdYbXfJcF10Y7anuoNt`

## Flow recap

1. **Step 1 (site form):** buyer fills Your Info → A Few Questions. On "Continue to
   Payment" the site **upserts the buyer contact** (fields + tags below) and creates
   an opportunity — *before* payment.
2. **Step 2 (embedded GHL form):** the real charge happens inside the GHL payment
   form. This is where GHL's native **purchase / payment** triggers fire.

---

## 1. Contact custom fields to create/confirm in GHL

The site writes these to the buyer contact by **field key**. Create a custom field
for each (any field type, but match the key):

| Key | Example value | Notes |
|-----|---------------|-------|
| `event_city` | `boston` | Which event (city slug) — primary identifier |
| `ticket_tier` | `VIP` / `General Admission` | |
| `order_amount` | `997` | Indicative amount from the site |
| `agency_state` | `Texas` | Survey answer |
| `has_moa` | `Yes` / `No` | Survey answer |
| `attended_before` | free text | Survey answer |
| `shirt_size` | `Large` | Survey answer |
| `sp2026_ticket_quantity` | `3` | **Set by the PAYMENT FORM**, not the site — the real ticket count (see §6) |

### ⚠️ Custom **Field** vs custom **Value**

`sp2026_ticket_quantity` must be a per-contact **Custom Field**, referenced as
`{{contact.sp2026_ticket_quantity}}`. Do **not** use a location **Custom Value**
(`{{custom_values.…}}`) — those are a single global constant shared by every contact,
so they can't hold a per-buyer count.

## 2. Tags applied to the buyer contact

- `scale-profit-seminar`
- `scale-profit-{city}` (e.g. `scale-profit-boston`)
- `scale-profit-{tier}` (`scale-profit-ga` / `scale-profit-vip`)
- `scale-profit-{city}-{tier}` (e.g. `scale-profit-boston-vip`)

Contact **source**: `Scale & Profit Seminar Checkout`

## 3. Opportunity created (Step 1)

- Created in the **first pipeline / first stage** in the location.
- Name: `First Last — {tier} ({city})`
- `monetaryValue` = order amount, status `open`.

## 4. Embedded payment forms (Step 2)

| Tier | Form URL |
|------|----------|
| GA | `https://go.aiaimastermind.com/widget/form/EB8ObhaPz6Fw2Fq6urY0` |
| VIP | `https://go.aiaimastermind.com/widget/form/VaXtddWW607K6i0P30d8` |

The site appends these as **URL query params** for prefill / capture. To record them
on the order, add form fields whose **query key** matches:

`event_city`, `event_name`, `event_date`, `ticket_tier`,
`first_name`, `last_name`, `email`, `phone`

(`first_name`/`last_name`/`email`/`phone` are native and usually prefill on their own.
The one that matters for tracking is **`event_city`** — add it as a hidden field.)

## 5. Recommended automation triggers

| Goal | Trigger |
|------|---------|
| Fire on actual purchase | **Order Submitted / Payment Received** (from the GHL payment form) |
| Fire when a lead reaches checkout (pre-payment) | **Contact Tag added** = `scale-profit-seminar`, or **Contact Created/Updated** with source `Scale & Profit Seminar Checkout` |
| Branch by event | Filter on `event_city` custom field (or the `scale-profit-{city}` tag) |
| Branch by tier | Filter on `ticket_tier` (or `scale-profit-vip` / `scale-profit-ga` tag) |

---

## 6. Tracking ticket quantity (multiple tickets) + the loop page

**Important:** quantity is chosen **inside the GHL payment form**, not on the site.
The real count must be captured there into the contact field `sp2026_ticket_quantity`.

**Set it up:** add a "Number of Tickets" selector (dropdown 1–5, or the product
quantity field) to each payment form and **map it to the `sp2026_ticket_quantity`
custom field**. Now `{{contact.sp2026_ticket_quantity}}` holds the true per-buyer count.

### Driving the post-purchase "loop" confirmation page

**Goal:** each ticket becomes its own **attendee record** (a separate GHL contact).

1. In the payment form's **On-Submit redirect**, send the buyer to the confirmation
   page (`/confirmation`) with the count + identity, e.g.
   `https://<site>/confirmation?qty={{contact.sp2026_ticket_quantity}}&city={{contact.event_city}}&tier=vip&email={{contact.email}}&first_name={{contact.first_name}}&last_name={{contact.last_name}}`
2. The page reads `qty` and **renders one attendee form per ticket** (it scales
   automatically). Attendee #1 is **pre-filled** with the buyer's name + email so they
   can confirm they're attending (or edit it).
3. On submit, the page saves **each ticket as its own contact** in GHL, tagged
   `scale-profit-attendee` + the event tags. So N tickets → N attendee records.

   Params accepted: `qty`, `city`, `tier`, `email`, `first_name`/`firstName`,
   `last_name`/`lastName`.

> The site previously had a "Who's Attending?" step that created attendee contacts
> exactly this way; it was removed so attendees can be collected post-purchase with
> the correct count.

---

## What YOU provide to the automation builder

- ✅ Confirm/create the **custom fields** in §1 — including `sp2026_ticket_quantity`
  as a per-contact **Custom Field** (not a Custom Value).
- ✅ Add the **hidden `event_city` field** (and any others you want recorded) to both
  payment forms — §4.
- ✅ Add a **"Number of Tickets" selector** to each payment form and map it to
  `sp2026_ticket_quantity` — §6.
- ✅ Provide the **confirmation/loop page URL** once built, and set it as the form's
  on-submit redirect — §6.
- ✅ Confirm the **products & prices** are the two "ACTIVE" products the site reads.
