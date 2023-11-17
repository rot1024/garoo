# garoo

Tools to automatically save social networking posts by simply posting the URL of the social networking site to Discord

1. Post URL to Discord
2. Automatically fetches posts from SNS
3. Automatically saves posts and their media to databases and files

## Usage

1. Create apps and integrations to Discord, Dropbox, and Notion. Also set up Notion databases as following.
2. Copy `.env.sample` file to `.env` and fill environment variables. Then start app with `docker compose up -d --build` or `go run .`.
3. Get and access to a log in URL to Dropbox by posting `garoo login dropbox` to Discord. Get code and then post `garoo login dropbox <code>` to Discord.

## Supported services

- Receiver
  - Discord
- Provider
  - Twitter
- Store
  - Dropbox (via Dropbox API)
  - Notion
  - SQLite3

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
| Provider | select |
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

Used for posts without any media (images and videos)

| Name | Type |
| --- | --- |
| Name | Title |
| ID | Text |
| Author Name | Text |
| Author ID | Text |
| Description | Text |
| Category | Select |
| Tags | Multiselect |
| Provider | select |
| URL | URL |
| Date | Date |

## License

[MIT License](LICENSE)
