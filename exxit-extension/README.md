# Exxit (Chrome Extension)

Exxit is a source-loaded Chrome extension that deletes your own Reddit posts and comments from old Reddit profile pages.

## Install from source (Developer mode)

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select this folder:

```text
/Users/yanone/Code/exreddit/exxit-extension
```

6. Confirm the extension appears as **Exxit**.

## Run Exxit

1. Log in to Reddit in the same Chrome profile.
2. Open one of these pages:
   - `https://old.reddit.com/user/<your_user>/`
   - `https://old.reddit.com/user/<your_user>/comments/`
   - `https://old.reddit.com/user/<your_user>/submitted/`
3. Click the **Exxit** extension icon.
4. Click **Start**.
5. To halt, click **Stop** (this also reloads the current page).

## Behavior notes

- Exxit uses Reddit API requests from the page session.
- Deletes can succeed even when old.reddit does not immediately redraw the item.
- The page auto-refreshes every 20 successful deletions.
- Error logs stay hidden unless a real failure is detected.

## Troubleshooting

- If popup status shows connection issues, reload Exxit in `chrome://extensions`, refresh the Reddit tab, and retry.
