---
layout: layout.ree
title: "Why Webpages Need Localized URLs (And Your App Absolutely Doesn't)"
published_at: "2026-06-17"
---

# Why Webpages Need Localized URLs (And Your App Absolutely Doesn't)

We've shipped multilingual marketing sites, multilingual documentation, and multilingual back-office apps - sometimes for the same client, in the same year - and we keep watching the same mistake get made: teams pick one URL strategy for "internationalization" and apply it everywhere.

It doesn't work. The rules for language handling are completely different depending on whether you're publishing content or running an application. Get this wrong and you'll break SEO, confuse users, or quietly make your non-English-speaking coworkers feel like second-class citizens of your own product.

---

## The Webpage Case: Language Belongs in the URL - Down to the Slug

When you're publishing content - a blog, a marketing site, a documentation portal - the URL _is_ the identity of the page. Search engines index URLs. People share links. Journalists copy-paste addresses into articles. The URL is part of the document, not metadata about it.

If your landing page lives at `example.com/` and you serve French to French visitors and English to English visitors based on the `Accept-Language` header alone, you've created an invisible problem: two people sharing "the same link" are seeing different content. Worse, Google sees one URL with one language, and that's the only version it indexes. Your French SEO is dead before you've written a single French sentence.

A locale prefix like `/fr/` is a step in the right direction. It only goes halfway. The slug itself needs to be translated too - a French speaker searching for "premiers pas" won't find `/fr/getting-started`, because the URL is still English to them.

```
❌ /en/getting-started        - locale prefix, English slug
❌ /fr/getting-started        - locale prefix, still English slug
✅ /getting-started           - English page, English slug
✅ /premiers-pas              - French page, French slug
✅ /erste-schritte            - German page, German slug
```

Each URL is a fully localized, independently addressable document. The slug is part of the content. Translate it.

### The Hybrid Approach: Locale Prefix and Translated Slug

There's a valid middle ground, especially useful at scale: combine the locale prefix with a translated slug.

```
✅ /en/getting-started        - English prefix, English slug
✅ /fr/premiers-pas           - French prefix, French slug
✅ /de/erste-schritte         - German prefix, German slug
```

This is the best of both. The locale prefix makes routing trivial - your server knows which language tree to serve without doing a slug lookup. The translated slug still captures local search keywords and reads natively to a French or German speaker. It also makes the site structure visually obvious from the address bar alone: everything under `/fr/` is French, full stop.

The tradeoff is a slightly longer URL and a slug-translation map you have to maintain per language. For most content sites that's a fair price, and it pairs cleanly with `hreflang` annotations so search engines understand these are equivalent pages in different languages:

```html
<link rel="alternate" hreflang="en" href="https://example.com/en/getting-started" />
<link rel="alternate" hreflang="fr" href="https://example.com/fr/premiers-pas" />
<link rel="alternate" hreflang="de" href="https://example.com/de/erste-schritte" />
```

Either approach - translated slug alone, or locale prefix with translated slug - is fine. What is never fine is a locale prefix with an untranslated slug. That's the worst of both worlds: longer URLs that still aren't readable in the user's language, and no SEO upside to show for it.

---

## The App Case: Language Does Not Belong in the URL

Now open Slack. Open Figma. Open Linear. Open your company's internal project tool.

Notice something? The URL doesn't say `/en/`. It doesn't carry English slugs. It never will. That's correct, and it's intentional.

In an application, you're not publishing documents - you're giving a person access to _their data_. The content isn't "an English article" or "a French article." It's _your_ tasks, _your_ calendar, _your_ codebase. Language is a property of the user, not the resource.

Your coworker in Tokyo and your coworker in Berlin are looking at the same sprint board. It has one URL. One canonical identity. They each see it in their own language because their profile says so - not because they're at different addresses.

```
❌ app.example.com/en/projects/42       - locale in the URL
❌ app.example.com/projets/42           - translated slug in an app
✅ app.example.com/projects/42          - canonical, language-agnostic
```

If you put the language in the URL of an app, you immediately run into a stack of absurd edge cases:

- A user switches their language in settings. Do you redirect them to a new URL? What happens to their open tabs?
- You're sending an email notification with a link to a ticket. Which language prefix do you use? The sender's? The recipient's? What if the comment thread has both?
- Someone shares a link to ticket #42 in a Slack channel where half the team speaks Spanish and half speaks English. Does the link change shape depending on who clicked it?

There is no clean answer to any of these - because you've modeled the problem incorrectly from the start.

---

## The Mental Model

|                           | Webpage / Content Site           | Application                   |
| ------------------------- | -------------------------------- | ----------------------------- |
| What's being served       | A document                       | A user's data                 |
| Language is a property of | The content                      | The user                      |
| Language stored in        | The URL and slug                 | User profile or session       |
| Slug translated?          | Yes                              | No                            |
| Locale prefix?            | Optional (slug must match)       | Never                         |
| Shareable link behavior   | Both users see the same language | Each user sees their language |
| SEO matters               | Yes                              | No                            |

---

## Where It Gets Blurry

Some products live in both worlds. A public marketing site with a "Log in" button that transitions into an authenticated app is the most common shape we deal with, and the right answer is usually a clean subdomain split:

- The **marketing and docs subdomain** uses fully localized URLs with translated slugs - `docs.example.com/fr/premiers-pas`.
- The **app subdomain** does not - `app.example.com/projects/42`.

This isn't pedantry. It's being honest about what each URL represents. The marketing page is a document you want indexed and shared in a specific language. The project board is a workspace your user happens to view in a specific language. Those are different things, and the URL should say so.

---

## The One-Line Summary

> If two people with different languages can share a URL and _should_ see the same content, give it a fully localized URL with a translated slug. If they should each see it _their way_, keep language out of the URL entirely.

Webpages are documents. Apps are mirrors. Treat them accordingly.
