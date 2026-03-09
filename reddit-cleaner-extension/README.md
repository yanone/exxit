# Reddit Bulk Cleaner Extension

This Chrome-compatible extension automates deleting your own posts/comments one by one from old Reddit profile pages.

## Scope and assumptions

- Works against old Reddit profile pages (`old.reddit.com/user/<name>/...`).
- Targets your own items only (author must match profile user).
- Clicks delete controls sequentially with delay.
- Supports dry-run mode.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder: `reddit-cleaner-extension`.

## Use

1. Open one of these pages first:
   - `https://old.reddit.com/user/<your_user>/`
   - `https://old.reddit.com/user/<your_user>/comments/`
   - `https://old.reddit.com/user/<your_user>/submitted/`
2. Open extension popup.
3. Click Start.
4. Watch diagnostics in the large output panel.
5. Use Stop only if you need to halt mid-run.

## Notes

- Reddit UI changes can break selectors.
- Keep the tab active while running.
- Use at your own risk; review Reddit terms/policies.

## Troubleshooting

- If you see `Could not establish connection. Receiving end does not exist`, reload the extension on `chrome://extensions`, then refresh the active Reddit tab and reopen the popup.
