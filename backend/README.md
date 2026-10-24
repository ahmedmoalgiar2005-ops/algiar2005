# AL.GIAR Backend

Node.js + Express + SQLite API for the AL.GIAR platform: student and admin login,
subscriptions and payments, and the functions library with editing.

## Structure
```
backend/
  package.json        dependencies and start script
  .env.example        configuration template (copy to .env)
  public/index.html   the website (served by the same server)
  seed/functions.json the function library, loaded on first run
  src/db.js           database schema
  src/auth.js         login tokens and role checks
  src/server.js       API routes and website hosting
```

## Run it (one command for the whole site)
1. Install Node.js 20.6 or newer.
2. `cd backend && npm install`
3. `cp .env.example .env`, then set `JWT_SECRET` (64+ random characters), `ADMIN_CODE`, and `ADMIN_PASS`.
4. `npm start`
5. Open **http://localhost:3000** (open the site through this address, not by double-clicking the HTML file, so it can reach the API).

On the first run the server creates the database, loads all functions from `seed/functions.json`, and creates the admin account from `.env`.

## API
| Method | Route | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/login | public | `{code, pass}` → token and role |
| GET | /api/me | logged in | current user |
| GET | /api/functions | logged in | list of functions |
| GET | /api/functions/:name | logged in | full explanation of one function |
| GET / POST | /api/admin/students | admin | list / add students |
| PATCH / DELETE | /api/admin/students/:id | admin | set paid status / delete |
| GET / POST | /api/admin/payments | admin | list / record a payment (marks student paid) |
| DELETE | /api/admin/payments/:id | admin | delete a payment record |
| POST | /api/admin/functions | admin | add a new function |
| PUT | /api/admin/functions/:name | admin | edit a function |
| PUT | /api/admin/account | admin | change admin code and password |

Send the token as `Authorization: Bearer <token>`.

## Security notes
- Passwords are stored as bcrypt hashes, never in plain text. Admin code and password come from `.env` only.
- Tokens expire after 12 hours. Login attempts are limited to 10 failures per 15 minutes per IP.
- Students whose subscription is not paid cannot log in.
- Run only over HTTPS in production, and keep `.env` and `data.db` private.
- Back up `data.db` regularly (copy the file while the server is stopped, or schedule a copy).

## Deploy
Any Node host works (Render, Railway, a VPS). Set the same environment variables in the host dashboard, use a persistent disk for `data.db`, and set `DB_FILE` to its path.

## How the pages connect
- The login gate sends the code and password to `/api/auth/login`.
- Students load the function library from `/api/functions/all` after login.
- The admin settings page uses the admin routes for students, payments, functions, and account.
- Favorites stay on each visitor's device.

