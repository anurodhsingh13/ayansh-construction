# Ayansh Construction

A small, dependency-free Node.js website for Ayansh Construction. It serves a responsive public portfolio and enquiry form, plus a password-protected admin dashboard. Site content and enquiries are stored in SQLite.

## Contents

- [Requirements](#requirements)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [How the application works](#how-the-application-works)
- [API reference](#api-reference)
- [Database](#database)
- [Security and deployment](#security-and-deployment)
- [Maintaining this reference](#maintaining-this-reference)

## Requirements

- Node.js 22.5 or newer. The app uses the built-in `node:sqlite` module; there are no npm package dependencies.
- npm is optional if you start the server with `node server.js`.

Check the installed version:

```powershell
node --version
```

## Run locally

Open PowerShell in the project directory and set an admin password of at least 12 characters for the current terminal session:

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-unique-password"
npm.cmd start
```

Or run the server directly:

```powershell
node server.js
```

Open these pages in a browser:

- Public website: <http://localhost:3000/>
- Admin dashboard: <http://localhost:3000/admin>

For development, `npm.cmd run dev` starts Node's watch mode and restarts the server when files change. Stop either process with `Ctrl+C`.

The server requires `ADMIN_PASSWORD` on every start. In PowerShell it must be set again in each new terminal unless configured as a Windows user environment variable.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | None; required | Admin sign-in password. Must be at least 12 characters. |
| `PORT` | `3000` | Local HTTP port. Must be an integer from 1 to 65535. |
| `DB_PATH` | `./ayansh-construction.db` | SQLite database file location. |
| `NODE_ENV` | Unset | Set to `production` behind HTTPS so the admin session cookie includes `Secure`. |

PowerShell example:

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-unique-password"
$env:PORT = "3000"
$env:DB_PATH = "C:\path\to\your\site.db"
node server.js
```

Do not put secrets in source files or commit them. `.env` is ignored by Git, but this project does not load `.env` automatically; configure variables in the process environment.

## Project structure

| Path | Responsibility |
| --- | --- |
| `server.js` | Node HTTP server, SQLite schema and starter data, input validation, API routes, admin sessions, security headers, and static file serving. |
| `public/index.html` | Public single-page site structure: hero, services, about, projects, process, public works callout, contact form, and footer. |
| `public/site.js` | Loads public content from the API, renders service and project cards, controls the mobile navigation, and submits enquiries. |
| `public/admin.html` | Admin sign-in and dashboard markup with Enquiries, Services, Projects, and Site settings sections. |
| `public/admin.js` | Admin sign-in, dashboard rendering, content editing, service ordering, enquiry status changes, and sign-out. |
| `public/styles.css` | Shared public and admin styling, responsive layouts, and reduced-motion handling. |
| `public/logo-mark.png` | Cropped emblem from the supplied Ayansh Construction logo, used in the public and admin brand links and as the browser icon. |
| `package.json` | Project metadata, `start` and `dev` scripts, and minimum Node version. |
| `.gitignore` | Excludes dependencies, environment files, and SQLite database/WAL files. |

## How the application works

1. `server.js` validates the required password and port, opens the SQLite database, and creates tables if needed.
2. Default business settings and four starter service records are inserted only when their respective tables are empty. Existing settings and content are preserved on later starts.
3. The built-in HTTP server binds to `127.0.0.1`. It serves the HTML, CSS, JavaScript, and favicon from `public/`, and exposes JSON endpoints under `/api/`.
4. `public/site.js` fetches `/api/site` and inserts database-backed business details, services, and projects into the public page. Hero and About photos remain hard-coded in `public/index.html`.
5. Enquiry form submissions are validated and stored in SQLite. Admin changes are sent to protected endpoints and reflected on the public page after reload.

The public page is a single scrolling page. The admin dashboard has four tabs:

- **Enquiries:** view contact details and messages, set follow-up status (`New`, `In progress`, `Contacted`, or `Closed`), and delete records.
- **Services:** add, edit, delete, and reorder service cards; image URLs are optional.
- **Projects:** add, edit, delete, and choose the one featured project; image URLs are optional.
- **Site settings:** change business name, owner, location, phone, optional email, and About text.

Admin changes do not require a build step. Public data is read from the database each time `/api/site` is requested.

## API reference

### Public endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/site` | Returns public settings, ordered services, projects, and the featured project. |
| `POST` | `/api/enquiries` | Validates and saves an enquiry. Requires a same-origin `Origin` header. |

### Admin endpoints

All `/api/admin/*` endpoints except login require a valid session. State-changing requests also require the same-origin check and `X-CSRF-Token` header returned at login or in admin data.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/login` | Verifies the password and creates a session. |
| `POST` | `/api/admin/logout` | Ends the current session. |
| `GET` | `/api/admin/data` | Returns public content, enquiries, and the session CSRF token. |
| `PATCH` | `/api/admin/enquiries/:id` | Changes an enquiry's follow-up status. |
| `DELETE` | `/api/admin/enquiries/:id` | Deletes an enquiry. |
| `POST` | `/api/admin/services` | Creates a service. |
| `PUT` / `DELETE` | `/api/admin/services/:id` | Updates or deletes a service. |
| `POST` | `/api/admin/services/reorder` | Sets the order of all services. |
| `POST` | `/api/admin/projects` | Creates a project. |
| `PUT` / `DELETE` | `/api/admin/projects/:id` | Updates or deletes a project. |
| `POST` | `/api/admin/projects/:id/featured` | Makes a project the featured project and clears the previous selection. |
| `PATCH` | `/api/admin/settings` | Updates public business details. |

JSON request bodies are limited to 64 KiB. Text and image URLs are validated server-side; non-empty image URLs must use HTTPS.

## Database

By default, the database is created as `ayansh-construction.db` in the project root the first time the server starts. SQLite write-ahead logging is enabled, and foreign-key checks are turned on. The tables are:

- `settings`: key/value business information and About copy.
- `services`: service titles, descriptions, image URLs, and display positions.
- `projects`: portfolio details, image URLs, and featured flag.
- `enquiries`: submitted contact information, project description, status, and creation time.
- `sessions`: hashed admin session tokens, CSRF tokens, and expiration timestamps.

The database and its `-wal` / `-shm` companion files are ignored by Git. Back up the database while the application is stopped, or use a SQLite-aware backup procedure while it is running. Treat enquiry data and backups as private information.

## Security and deployment

- The admin password is provided through the environment and must be at least 12 characters. The server derives a scrypt hash at startup and compares passwords in constant time.
- Admin sessions expire after eight hours. The cookie is HTTP-only and `SameSite=Strict`; `Secure` is added when `NODE_ENV=production`.
- State-changing admin requests require a matching origin and CSRF token. Login attempts are limited per client address in the running process.
- Static responses include content-type sniffing protection, a restrictive Content Security Policy, a referrer policy, and cache control.
- The server listens only on loopback (`127.0.0.1`). For remote access, place it behind a properly configured HTTPS reverse proxy and restrict host/network access. Do not expose the Node server directly to the public internet.
- Use secure environment-variable management, a process manager, durable database backups, and appropriate privacy and retention practices before using this for real enquiries.
- Google Fonts and Unsplash photos are remote. A network connection is needed for those assets; system fonts and other page content remain available without them.

## Maintaining this reference

When code or behavior changes, update this README in the same change. In particular, keep the project structure, configuration table, routes, database description, security notes, and run instructions aligned with the implementation. Record significant user-facing or architectural changes in a short dated entry below.

### Change notes

- 2026-10-20: Reworked the README into a project reference based on the current source files.
- 2026-10-20: Invalid percent-encoding in request paths now returns a client error, and malformed session cookies are treated as unauthenticated requests.
- 2026-10-20: Added the supplied logo emblem to public and admin branding and set it as the browser icon.
- 2026-10-20: Matched the public brand lockup text to the logo's “Building your tomorrow” tagline and removed the unused former favicon.
