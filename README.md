# exreddit cleanup script

This project contains a script to delete your own Reddit posts and comments via the Reddit API.

## 1) Create a Reddit API app

Before app creation, Reddit may require explicit Data API signup/approval for your account.

1. Open this signup form: https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164
2. Select non-commercial Data API access.
3. Describe your use case as personal account cleanup (delete your own posts/comments).
4. Wait for approval/confirmation, then continue.

If app creation is still blocked, submit a support ticket at the same link and include:

- Reddit username
- the exact error text shown
- that the use case is one-time personal data cleanup for your own account

After approval, continue with app creation below.

1. Log in to Reddit and open: https://www.reddit.com/prefs/apps
2. Click "create another app..."
3. Choose **script** as app type.
4. Set redirect URI to `http://localhost:8080` (required, not used in this script).
5. Save and copy:
   - client ID (the short string under the app name)
   - client secret

## 2) Set up Python env (macOS)

```bash
cd /Users/yanone/Code/exreddit
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3) Export credentials

```bash
export REDDIT_CLIENT_ID="your_client_id"
export REDDIT_CLIENT_SECRET="your_client_secret"
export REDDIT_USERNAME="your_reddit_username"
export REDDIT_PASSWORD="your_reddit_password"
export REDDIT_USER_AGENT="exreddit-cleanup-script by u/your_reddit_username"
```

## 4) Run a dry-run first

```bash
python delete_reddit_history.py --dry-run
```

## 5) Perform deletion

```bash
python delete_reddit_history.py --execute
```

Recommended robust run (loops in passes until empty):

```bash
python delete_reddit_history.py --execute --until-empty --batch-size 100 --max-passes 100
```

## Optional flags

- `--limit 100`: process only up to 100 posts and 100 comments.
- `--only-posts`: process posts only.
- `--only-comments`: process comments only.
- `--sleep-seconds 1.2`: pause between requests.
- `--batch-size 100`: items fetched per pass.
- `--until-empty`: keep running passes until no items remain.
- `--max-passes 100`: safety cap for pass count.
- `--retry-attempts 3`: retry count for failed delete actions.
- `--retry-base-seconds 2.0`: base delay for retry backoff.

## Important

- Deletions are permanent.
- If a request fails (rate limit/network), rerun the script.
- Keep credentials private.
