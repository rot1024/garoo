# garoo

Tools to automatically save social networking posts by simply posting the URL of the social networking site to Discord.

1. Post a URL to Discord
2. Automatically fetches the post from the SNS
3. Automatically saves the post and its media to databases and files

Runs on [Cloudflare Workers](https://workers.cloudflare.com/). The code lives in [`workers/`](workers/).

## Architecture

- **Receiver**: Discord
  - A cron trigger polls the channel every minute (a KV single-flight lock prevents overlapping runs)
  - `POST /webhook` accepts `{ "content": "<url> <category> <tags...>" }` for manual/other integrations
- **Provider**: Twitter / X (via [twitterapi.io](https://twitterapi.io/) — fetches text, author, photos, and the highest-bitrate mp4 for videos)
- **Stores** (a post is saved to every configured store):
  - **D1** — post metadata (`pictures` table)
  - **Dropbox** — media files (per-author / per-category folders)
  - **R2** — media files (`<base>/<provider>/<category>/<screenname>/<file>`)
  - **Notion** — Post DB / Author DB (and a secondary DB for text posts)

Media-less posts are not stored unless they use the special text category `_`.

## Endpoints

`GET /` (the health check) is always available. The other endpoints are
unauthenticated admin/maintenance actions and are **only served when `DEBUG` is
`"true"`** (otherwise they return 404 — see [Debug mode](#debug-mode)). The
production flow runs via the cron trigger, not these endpoints.

- `GET /` — health check / endpoint list
- `POST /webhook` — process a message (`{ "content": "<url> <category> <tags...>" }`) and save its posts
- `GET /rescan` — backfill: re-process posts that previously failed (bot `❌` replies). Dry-run unless `?dry=0`; resumable via the returned `nextBefore`
- `GET /import-dropbox` — backfill: import existing Dropbox media into R2. Dry-run unless `?dry=0`; resumable via the returned `nextCursor`
- `GET /reconcile?target=r2|dropbox|notion` — sync a store to the D1 categories (D1 is the source of truth). Moves/relabels any item whose category drifted from D1. Idempotent and re-runnable for any future drift; dry-run unless `?dry=0`; resumable via the returned `nextCursor`

### Debug mode

`DEBUG` (a `wrangler.toml` var or secret) gates the action endpoints above. Set
it to `"true"` to run maintenance (`/rescan`, `/import-dropbox`, `/reconcile`,
`/webhook`), then back to `"false"` to lock down. With `DEBUG` off, only `GET /`
responds.

### Categories

D1 is the source of truth for a post's category. If categories drift across
stores (a renamed/normalized category, a missed move, files left in the wrong
folder), normalize D1 first (e.g. `UPDATE pictures SET category=...`) and then
run `GET /reconcile?target=...&dry=0` for each store to bring Dropbox, R2, and
Notion back in line.

## Commands (post in Discord)

- `garoo login dropbox` → returns the Dropbox authorize URL
- `garoo login dropbox <code>` → exchanges the code and stores the refresh token in KV
- `garoo help`

## Deployment

```sh
cd workers
npm install
npm run typecheck

# Create resources
npx wrangler d1 create garoo          # set the database_id in wrangler.toml
npx wrangler r2 bucket create garoo

# Configure secrets
npx wrangler secret put TWITTERAPI_IO_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_CHANNEL_ID
npx wrangler secret put DISCORD_USER_ID            # optional: @-mention on errors
npx wrangler secret put DROPBOX_CLIENT_ID
npx wrangler secret put DROPBOX_CLIENT_SECRET
npx wrangler secret put DROPBOX_BASE_DIR           # e.g. /garo
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put NOTION_POST_DB
npx wrangler secret put NOTION_SECONDARY_POST_DB
npx wrangler secret put NOTION_AUTHOR_DB

npx wrangler deploy
```

The Dropbox token (refresh token) is stored in KV under `dropbox_token`; seed it with `garoo login dropbox`. The Dropbox app needs the `files.content.write` and `files.content.read` scopes.

## Notion database properties

### Post DB

| Name | Type |
| --- | --- |
| Name | Title |
| ID | Text |
| Author Name | Text |
| Author ID | Text |
| Author | Reference to Author DB |
| Description | Text |
| Category | Select |
| Tags | Multiselect |
| Provider | Select |
| URL | URL |
| Date | Date |
| Media | Files |
| Media Raw | Files |
| Index | Number |
| Count | Number |

### Author DB

| Name | Type |
| --- | --- |
| Name | Title |
| ID | Text |
| User Name | Text |
| Screenname | Text |
| Provider | Select |
| Avatar | Files |

### Secondary post DB

Used for text posts (category `_`).

| Name | Type |
| --- | --- |
| Name | Title |
| ID | Text |
| Author Name | Text |
| Author ID | Text |
| Description | Text |
| Category | Select |
| Tags | Multiselect |
| Provider | Select |
| URL | URL |
| Date | Date |

## License

[MIT License](LICENSE)
