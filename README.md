# Exxit

Exxit is a source-loaded Chrome extension for deleting your own Reddit posts/comments from old.reddit profile pages.

## Install Exxit from source (Developer mode)

1. Open Chrome.
2. Go to `chrome:packed\*\*.
3. Select this folder: `exxit-extension`
4. Verify the extension appears as **Exxit**.

## Run Exxit

1. In the same Chrome profile, sign in to Reddit.
2. Open this pages: `https://old.reddit.com/user/<your_user>/`
3. Click the Exxit extension icon.
4. Click **Start** to begin deletion.
5. Click **Stop** to halt. Exxit reloads the current tab on stop.

## Runtime behavior

- Uses authenticated API requests from your active old.reddit session.
- UI may not immediately redraw each deleted item on the same page load.
- Auto-refreshes the page every 25 successful deletions.
- Status shows Running, Deleted, Skipped, and Failed.
- Error log panel appears only when failures/errors are detected.

## Updating after code changes

1. Go to `chrome://extensions`.
2. Find **Exxit**.
3. Click the reload icon on the extension card.
4. Refresh your Reddit tab.
