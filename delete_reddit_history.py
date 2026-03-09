#!/usr/bin/env python3
"""Delete a Reddit user's own posts and comments.

Usage:
  python delete_reddit_history.py --dry-run
  python delete_reddit_history.py --execute
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from typing import Callable, Optional

import praw
from praw.exceptions import RedditAPIException
from praw.models import Comment, Submission


@dataclass
class Config:
    client_id: str
    client_secret: str
    username: str
    password: str
    user_agent: str


@dataclass
class RunStats:
    processed: int = 0
    successes: int = 0
    failures: int = 0
    retries: int = 0

    def add(self, other: "RunStats") -> None:
        self.processed += other.processed
        self.successes += other.successes
        self.failures += other.failures
        self.retries += other.retries


def load_config_from_env() -> Config:
    required_vars = {
        "REDDIT_CLIENT_ID": os.getenv("REDDIT_CLIENT_ID"),
        "REDDIT_CLIENT_SECRET": os.getenv("REDDIT_CLIENT_SECRET"),
        "REDDIT_USERNAME": os.getenv("REDDIT_USERNAME"),
        "REDDIT_PASSWORD": os.getenv("REDDIT_PASSWORD"),
        "REDDIT_USER_AGENT": os.getenv("REDDIT_USER_AGENT"),
    }

    missing = [name for name, value in required_vars.items() if not value]
    if missing:
        missing_text = ", ".join(missing)
        raise ValueError(
            f"Missing required environment variables: {missing_text}. "
            "Set them first, then rerun."
        )

    return Config(
        client_id=required_vars["REDDIT_CLIENT_ID"] or "",
        client_secret=required_vars["REDDIT_CLIENT_SECRET"] or "",
        username=required_vars["REDDIT_USERNAME"] or "",
        password=required_vars["REDDIT_PASSWORD"] or "",
        user_agent=required_vars["REDDIT_USER_AGENT"] or "",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete your Reddit submissions and comments."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually delete content. Without this flag, the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be deleted. This is the default behavior.",
    )
    parser.add_argument(
        "--only-posts",
        action="store_true",
        help="Process posts only.",
    )
    parser.add_argument(
        "--only-comments",
        action="store_true",
        help="Process comments only.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of posts/comments to process per type.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=1.2,
        help="Delay between actions to reduce API pressure.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Number of items to fetch/process per pass.",
    )
    parser.add_argument(
        "--until-empty",
        action="store_true",
        help=(
            "Keep running passes until no more items remain. "
            "If --limit is set, stops when limit is reached."
        ),
    )
    parser.add_argument(
        "--max-passes",
        type=int,
        default=50,
        help="Safety cap for number of passes when using --until-empty.",
    )
    parser.add_argument(
        "--retry-attempts",
        type=int,
        default=3,
        help="Retry attempts per failed delete action.",
    )
    parser.add_argument(
        "--retry-base-seconds",
        type=float,
        default=2.0,
        help="Base backoff delay for retries; doubles each retry.",
    )
    return parser.parse_args()


def should_process_posts(args: argparse.Namespace) -> bool:
    if args.only_comments:
        return False
    return True


def should_process_comments(args: argparse.Namespace) -> bool:
    if args.only_posts:
        return False
    return True


def action_word(dry_run: bool) -> str:
    return "[DRY-RUN] would delete" if dry_run else "deleting"


def delete_submission(item: Submission, dry_run: bool) -> None:
    if dry_run:
        return
    item.delete()


def delete_comment(item: Comment, dry_run: bool) -> None:
    if dry_run:
        return
    item.delete()


def run_with_retries(
    operation: Callable[[], None],
    kind: str,
    item_id: str,
    retry_attempts: int,
    retry_base_seconds: float,
) -> tuple[bool, int, str | None]:
    retries_used = 0
    attempts = max(1, retry_attempts)
    for attempt in range(1, attempts + 1):
        try:
            operation()
            return True, retries_used, None
        except (RedditAPIException, Exception) as exc:  # noqa: BLE001
            if attempt >= attempts:
                return False, retries_used, str(exc)
            retries_used += 1
            backoff = max(0.0, retry_base_seconds) * (2 ** (attempt - 1))
            print(
                f"[RETRY] {kind} {item_id} attempt {attempt}/{attempts - 1} "
                f"failed, retrying in {backoff:.1f}s: {exc}"
            )
            time.sleep(backoff)
    return False, retries_used, "Unknown failure"


def process_submissions_batch(
    items: list[Submission],
    dry_run: bool,
    sleep_seconds: float,
    retry_attempts: int,
    retry_base_seconds: float,
) -> RunStats:
    stats = RunStats()
    for post in items:
        stats.processed += 1
        try:
            print(f"{action_word(dry_run)} post {post.id}: {post.title}")
            if dry_run:
                stats.successes += 1
            else:
                ok, retries_used, error_text = run_with_retries(
                    lambda: delete_submission(post, False),
                    kind="post",
                    item_id=post.id,
                    retry_attempts=retry_attempts,
                    retry_base_seconds=retry_base_seconds,
                )
                stats.retries += retries_used
                if ok:
                    stats.successes += 1
                else:
                    stats.failures += 1
                    print(f"[ERROR] post {post.id} failed: {error_text}")
        except Exception as exc:  # noqa: BLE001
            stats.failures += 1
            print(f"[ERROR] post {post.id} failed: {exc}")
        time.sleep(max(0.0, sleep_seconds))
    return stats


def process_comments_batch(
    items: list[Comment],
    dry_run: bool,
    sleep_seconds: float,
    retry_attempts: int,
    retry_base_seconds: float,
) -> RunStats:
    stats = RunStats()
    for comment in items:
        stats.processed += 1
        try:
            preview = comment.body.replace("\n", " ")
            preview = preview[:80] + ("..." if len(preview) > 80 else "")
            print(f"{action_word(dry_run)} comment {comment.id}: {preview}")
            if dry_run:
                stats.successes += 1
            else:
                ok, retries_used, error_text = run_with_retries(
                    lambda: delete_comment(comment, False),
                    kind="comment",
                    item_id=comment.id,
                    retry_attempts=retry_attempts,
                    retry_base_seconds=retry_base_seconds,
                )
                stats.retries += retries_used
                if ok:
                    stats.successes += 1
                else:
                    stats.failures += 1
                    print(f"[ERROR] comment {comment.id} failed: {error_text}")
        except Exception as exc:  # noqa: BLE001
            stats.failures += 1
            print(f"[ERROR] comment {comment.id} failed: {exc}")
        time.sleep(max(0.0, sleep_seconds))
    return stats


def process_submissions(
    reddit: praw.Reddit,
    username: str,
    dry_run: bool,
    limit: Optional[int],
    sleep_seconds: float,
    batch_size: int,
    until_empty: bool,
    max_passes: int,
    retry_attempts: int,
    retry_base_seconds: float,
) -> RunStats:
    total = RunStats()
    remaining_budget = limit
    pass_count = 0

    while True:
        if remaining_budget is not None and remaining_budget <= 0:
            break
        if until_empty and pass_count >= max(1, max_passes):
            print(f"[INFO] Reached max post passes ({max_passes}), stopping.")
            break

        pass_count += 1
        fetch_limit = max(1, batch_size)
        if remaining_budget is not None:
            fetch_limit = min(fetch_limit, remaining_budget)

        items = list(reddit.redditor(username).submissions.new(limit=fetch_limit))
        if not items:
            print("[INFO] No more posts found.")
            break

        print(f"[PASS {pass_count}] Processing {len(items)} posts")
        batch_stats = process_submissions_batch(
            items=items,
            dry_run=dry_run,
            sleep_seconds=sleep_seconds,
            retry_attempts=retry_attempts,
            retry_base_seconds=retry_base_seconds,
        )
        total.add(batch_stats)

        if remaining_budget is not None:
            remaining_budget -= batch_stats.processed

        if not until_empty:
            break
        if batch_stats.successes == 0 and batch_stats.failures > 0:
            print("[INFO] No successful post actions in this pass, stopping early.")
            break

    return total


def process_comments(
    reddit: praw.Reddit,
    username: str,
    dry_run: bool,
    limit: Optional[int],
    sleep_seconds: float,
    batch_size: int,
    until_empty: bool,
    max_passes: int,
    retry_attempts: int,
    retry_base_seconds: float,
) -> RunStats:
    total = RunStats()
    remaining_budget = limit
    pass_count = 0

    while True:
        if remaining_budget is not None and remaining_budget <= 0:
            break
        if until_empty and pass_count >= max(1, max_passes):
            print(f"[INFO] Reached max comment passes ({max_passes}), stopping.")
            break

        pass_count += 1
        fetch_limit = max(1, batch_size)
        if remaining_budget is not None:
            fetch_limit = min(fetch_limit, remaining_budget)

        items = list(reddit.redditor(username).comments.new(limit=fetch_limit))
        if not items:
            print("[INFO] No more comments found.")
            break

        print(f"[PASS {pass_count}] Processing {len(items)} comments")
        batch_stats = process_comments_batch(
            items=items,
            dry_run=dry_run,
            sleep_seconds=sleep_seconds,
            retry_attempts=retry_attempts,
            retry_base_seconds=retry_base_seconds,
        )
        total.add(batch_stats)

        if remaining_budget is not None:
            remaining_budget -= batch_stats.processed

        if not until_empty:
            break
        if batch_stats.successes == 0 and batch_stats.failures > 0:
            print("[INFO] No successful comment actions in this pass, stopping early.")
            break

    return total


def main() -> int:
    args = parse_args()

    if args.only_posts and args.only_comments:
        print("Choose either --only-posts or --only-comments, not both.")
        return 2

    if args.batch_size < 1:
        print("--batch-size must be >= 1")
        return 2
    if args.max_passes < 1:
        print("--max-passes must be >= 1")
        return 2
    if args.retry_attempts < 1:
        print("--retry-attempts must be >= 1")
        return 2

    dry_run = not args.execute or args.dry_run
    if dry_run:
        print("Running in DRY-RUN mode. No deletions will be made.")

    until_empty = bool(args.until_empty and not dry_run)
    if until_empty:
        print(
            f"Run-until-empty mode enabled (max passes per type: {args.max_passes})."
        )

    try:
        config = load_config_from_env()
    except ValueError as exc:
        print(f"Configuration error: {exc}")
        return 2

    reddit = praw.Reddit(
        client_id=config.client_id,
        client_secret=config.client_secret,
        username=config.username,
        password=config.password,
        user_agent=config.user_agent,
    )

    try:
        me = reddit.user.me()
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to authenticate with Reddit API: {exc}")
        return 1

    if not me:
        print("Authentication succeeded but no account info was returned.")
        return 1

    print(f"Authenticated as: {me.name}")

    grand_total = RunStats()

    if should_process_posts(args):
        post_stats = process_submissions(
            reddit,
            me.name,
            dry_run=dry_run,
            limit=args.limit,
            sleep_seconds=args.sleep_seconds,
            batch_size=args.batch_size,
            until_empty=until_empty,
            max_passes=args.max_passes,
            retry_attempts=args.retry_attempts,
            retry_base_seconds=args.retry_base_seconds,
        )
        grand_total.add(post_stats)

    if should_process_comments(args):
        comment_stats = process_comments(
            reddit,
            me.name,
            dry_run=dry_run,
            limit=args.limit,
            sleep_seconds=args.sleep_seconds,
            batch_size=args.batch_size,
            until_empty=until_empty,
            max_passes=args.max_passes,
            retry_attempts=args.retry_attempts,
            retry_base_seconds=args.retry_base_seconds,
        )
        grand_total.add(comment_stats)

    print("\nSummary")
    print(f"Processed: {grand_total.processed}")
    print(f"Processed successfully: {grand_total.successes}")
    print(f"Failed: {grand_total.failures}")
    print(f"Retries used: {grand_total.retries}")
    if dry_run:
        print("Dry-run only. Re-run with --execute to actually delete.")

    return 0 if grand_total.failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
