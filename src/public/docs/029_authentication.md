---
title:Authentication
---

# Authentication

<a name="introduction"></a>

## Introduction

reepolee ships with a complete, invite-only authentication system. There is no open registration - every account is created by an admin who sends an invitation to a specific email address. The invited user visits a unique registration link, sets a name and password, and is logged in immediately.

This page covers the runtime side of authentication: how sessions are stored, how the login flow works, and how the active user becomes available in your templates and route handlers. The other pages in the Security section cover the rest:

- [Authorization](/security/authorization) - protecting routes with middleware and function guards, the tags model
- [Invitations & Registration](/security/invitations) - sending invitations and completing registration
- [Profile & Password](/security/profile-and-password) - letting users manage their own account

<a name="sessions"></a>

## Sessions

A session is a record in the `sessions` table keyed by a UUID. The UUID is sent to the browser in an `HttpOnly`, `SameSite=Lax` cookie named `sid`. The cookie has a 7-day maximum age; the session record has the same TTL enforced server-side. See [Sessions & KV](/database/sessions-and-kv) for the storage details.

The session payload carries enough about the user to render most pages without an extra database query:

```ts
export interface Session_data {
	user_id: number;
	email: string;
	name: string;
	nickname: string;
	avatar_filename: string;
	display_name: string;
	tags: string; // comma-separated, e.g. "user,admin"
	created_at: number;
}
```

<a name="resolving-the-session"></a>

## Resolving the Session

`resolve_session(req)` from `$routes/auth/middleware` reads the cookie, looks the session up in the database, checks it hasn't expired, and returns an `Auth_context`:

```ts
export interface Auth_context {
	session_id: string | null;
	session: Session_data | null;
	/** Convenience object safe to spread into render() data. */
	current_user: User_public | null;
}
```

`resolve_session()` never throws. If there's no cookie, no matching session, or the session has expired, you get back an `Auth_context` with `session: null` and `current_user: null`. Your handler decides what to do with that - guard the route, render a logged-out view, or proceed.

The render layer calls `resolve_session()` automatically when you pass `ctx` to `render()`, so every template gets `props.user` filled in (or `null` if no session). You don't have to do anything in the handler:

```html
{#if props.user }
<span>Hello, {= props.user.display_name }</span>
<form method="POST" action="/auth/logout">
	<button>Log out</button>
</form>
{:else }
<a href="/auth/login">Log in</a>
{/if }
```

`display_name` is computed from the user's nickname → name → email in that order, so it's never empty. `props.user.tags` is the comma-separated tag string for that user - checking it client-side is fine for showing/hiding navigation, but never rely on it for actual access control. That's [Authorization](/security/authorization)'s job.

<a name="the-login-flow"></a>

## The Login Flow

`POST /auth/login` runs through these steps:

1. Reads the form body and runs validation. Empty email or password re-renders the form with errors.
2. Looks up the user by email (lowercased). Missing user, missing `hashed_password`, or unverified account all surface the same generic error - `"Invalid email or password"` - to avoid leaking which addresses exist.
3. Verifies the password with `Bun.password.verify(submitted, hashed)`. Bun handles bcrypt (and argon2) natively - no library to install.
4. Creates a session via `create_user_session(user)` and returns a `303 See Other` redirect to `/` with the `sid` cookie attached.

The handler shape, condensed:

```ts
const user = await get_user_by_email(data.email);
if (!user || !user.hashed_password || !user.verified_at) {
	return render("auth/login/form", {
		data: { form_error: translated.errors.invalid_email_or_password, ...translated },
		ctx,
	});
}

const password_valid = await Bun.password.verify(data.password, user.hashed_password);
if (!password_valid) {
	return render("auth/login/form", {
		data: { form_error: translated.errors.invalid_email_or_password, ...translated },
		ctx,
	});
}

const session_cookie = await create_user_session(user);
const headers = new Headers({ Location: "/" });
headers.append("Set-Cookie", session_cookie.toString());
return new Response(null, { status: 303, headers });
```

`create_user_session()` lives in `$routes/auth/helpers` and does three things: generate a session UUID, write the session record, and construct the `Set-Cookie` header value.

<a name="the-logout-flow"></a>

## The Logout Flow

Logout always uses `POST` - `GET` would let any link or image preload sign the user out. The handler reads the session ID from the cookie, deletes the session record, sends back a `Clear-Site-Data` header, and redirects to login:

```ts
export async function post_auth_logout(req: BunRequest): Promise<Response> {
	const session_id = get_session_id_from_request(req);
	if (session_id) {
		await destroy_session(session_id);
	}

	const headers = new Headers({
		Location: "/auth/login",
		"Clear-Site-Data": "cache, storage",
	});
	headers.append("Set-Cookie", build_clear_cookie().toString());

	return new Response(null, { status: 303, headers });
}
```

`Clear-Site-Data` tells the browser to clear cached responses and storage for the origin - useful when an account ends and you want the next person on that browser to start fresh. `build_clear_cookie()` returns a cookie with the same name and a `Max-Age=0`, which expires the existing cookie immediately.

<a name="password-hashing"></a>

## Password Hashing

`Bun.password.hash(password)` produces a hash you store in the `users.hashed_password` column. `Bun.password.verify(submitted, stored)` checks a submitted password against the stored hash. Both are async:

```ts
const hashed = await Bun.password.hash(plain_password);
const valid = await Bun.password.verify(submitted_password, hashed);
```

By default Bun uses argon2id with sensible parameters - a strong choice that doesn't need configuration. If you ever need to change the algorithm, both functions accept an options object with an `algorithm` field; the new hash format is self-describing, so old and new hashes coexist in the same column.

The minimum password length is enforced in your validation schema, not at the hashing layer. The default in `config/db_structure.ts` is 8 characters in production and 1 in development (so test accounts are easy to create) - see [Generators](/database/generators#configuration).

<a name="seeded-admin-account"></a>

## The Seeded Admin Account

When you initialise the database for the first time, your `init-sqlite.sql` (or `init-mysql.sql`) seeds an admin user. The default seed:

```sql
INSERT INTO users (id, email, invitation_code, tags) VALUES
    (1, 'you@example.com', 'invite123', 'user,admin');
```

The user has no `hashed_password` and no `verified_at` - so they can't log in. To complete registration, visit:

```
/auth/register/you@example.com/invite123
```

Set a password and you're in.

<a name="api-summary"></a>

## API Summary

The auth runtime exposes a small set of functions that show up across handlers. The full source for each is in `routes/auth/`:

| Function                       | Source                         | Purpose                                   |
| ------------------------------ | ------------------------------ | ----------------------------------------- |
| `resolve_session(req)`         | `routes/auth/middleware.ts`    | Reads cookie, returns `Auth_context`      |
| `require_auth(ctx, req?)`      | `routes/auth/middleware.ts`    | Returns redirect Response if not authed   |
| `require_tag(ctx, tag)`        | `routes/auth/middleware.ts`    | Returns redirect/403 if no tag            |
| `require_auth_mw()`            | `lib/middleware`               | Middleware wrapper for `require_auth`     |
| `require_tag_mw(tag)`          | `lib/middleware`               | Middleware wrapper for `require_tag`      |
| `create_user_session(user)`    | `routes/auth/helpers.ts`       | Creates session, returns Set-Cookie value |
| `destroy_session(session_id)`  | `routes/auth/session_store.ts` | Deletes the session record                |
| `refresh_session(id, partial)` | `routes/auth/session_store.ts` | Updates the session in place              |

When and how to use each guard is covered in [Authorization](/security/authorization).
