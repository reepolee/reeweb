---
layout: layout.ree
title: "Your First Reeweb Blog Post"
published_at: "2026-06-15"
last_updated_at: "2026-06-20"
description: "The frontmatter Reeweb understands out of the box - dates, excerpt, category, author, and the draft flag - in one copy-me starter post."
excerpt: "Copy this file, change the frontmatter, write Markdown. Reeweb handles RSS, the sitemap, hreflang, and drafts for you."
category: "Guides"
author: "Reeweb"
draft: false
---

# Your First Reeweb Blog Post

This post exists to be copied. Duplicate the file, rename it, edit the
frontmatter, and write your Markdown below the `---` block.

## Frontmatter Reeweb understands

| Field             | What it does                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `title`           | Page + listing + feed title. **Required.**                             |
| `published_at`    | Publish date (`YYYY-MM-DD`). **Required.** Drives ordering and feeds.   |
| `last_updated_at` | Optional. Surfaces as `<lastmod>` in the sitemap.                       |
| `description`     | SEO/meta description and the listing/feed summary.                      |
| `excerpt`         | Short blurb; used as the summary when `description` is absent.          |
| `category`        | Presentational; passed straight through to your template.              |
| `author`          | A name string, or `{ name, email, url }`. `authors:` takes a list.     |
| `draft`           | `true` generates the post but hides it (see below). Defaults to `false`.  |

The set is validated during SSG by `blog/_schema.ts` - a missing `title`,
an unparseable `published_at`, or a wrong type fails generation loudly.

## Drafts: generated-but-hidden review URLs

Set `draft: true` (or `published: false`) and the post is still rendered and
reachable at its URL - so you can send a reviewer the link - but it is absent
from the blog listing, the RSS/JSON feeds, and the sitemap, and it carries
`<meta name="robots" content="noindex">`. To the outside world it does not
exist. Flip `draft` back to `false` (and make sure `published_at` is not in the
future) to publish. There is no scheduler and no auth: a draft is the per-post
equivalent of a soft-launch language.

That's it - write Markdown from here and you have a blog.
