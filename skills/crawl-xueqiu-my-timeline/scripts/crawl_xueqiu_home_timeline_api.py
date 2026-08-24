#!/usr/bin/env -S uv run
"""
爬取雪球首页关注时间线脚本（API 方式）
通过 agent-browser 在浏览器内执行 API 请求，自动处理 md5__1038 令牌和反爬机制
支持 --hours 参数指定爬取最近 N 小时（默认 24 小时）
"""

import argparse
import json
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path


def run_agent_browser(args: list[str]) -> str:
    """执行 agent-browser 命令并返回输出"""
    cmd = ["agent-browser", "--cdp", "9222", *args]
    result = subprocess.run(  # noqa: S603
        cmd, capture_output=True, text=True, timeout=60
    )
    output = result.stdout
    lines = []
    for line in output.split("\n"):
        line = line.strip()
        if line and not line.startswith("✓") and not line.startswith("Done"):
            lines.append(line)
    return "\n".join(lines)


def open_xueqiu() -> None:
    """打开雪球首页并登录"""
    print("正在打开雪球首页...")
    run_agent_browser(["open", "https://xueqiu.com"])
    time.sleep(5)


def get_home_timeline(page: int = 1, count: int = 20, max_id: int | None = None) -> dict:
    """在浏览器内通过 fetch 执行首页时间线 API 请求"""
    url = f"https://xueqiu.com/v4/statuses/home_timeline.json?page={page}&count={count}"
    if max_id is not None:
        url += f"&max_id={max_id}"

    return browser_fetch_json(url)


def get_hot_posts(max_id: int | None = None, size: int = 15) -> dict:
    """在浏览器内通过 fetch 执行热帖列表 API 请求"""
    since_id = -1 if max_id is None else max_id
    url = (
        f"https://xueqiu.com/statuses/hot/listV2.json"
        f"?since_id={since_id}&max_id={max_id if max_id is not None else -1}&size={size}"
    )
    return browser_fetch_json(url)


def browser_fetch_json(url: str) -> dict:
    """在浏览器内通过 fetch 执行 GET 请求并返回 JSON（统一反爬处理）"""
    js_code = f"""
    (async () => {{
        const r = await fetch('{url}', {{
            method: 'GET',
            headers: {{
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            }},
            credentials: 'include'
        }});
        return await r.json();
    }})()
    """
    result = run_agent_browser(["eval", js_code])

    try:
        data = json.loads(result)
        if isinstance(data, dict):
            return data
        return {}
    except json.JSONDecodeError as e:
        print(f"解析 API 响应失败：{e}, 原始输出：{result[:200]}")
        return {}


def parse_date_string(date_str: str | None, default: datetime) -> datetime:
    """解析 YYYY-MM-DD 格式日期字符串"""
    if not date_str:
        return default
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(f"日期格式错误，请使用 YYYY-MM-DD 格式：{date_str}") from e


def parse_timestamp(timestamp_ms: int) -> str:
    """将毫秒时间戳转换为绝对时间格式"""
    try:
        dt = datetime.fromtimestamp(timestamp_ms / 1000)
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, OSError):
        return "未知时间"


def clean_html(text: str) -> str:
    """清理 HTML 标签"""
    import re

    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&amp;", "&")
    text = text.replace("&#39;", "'")
    text = text.replace("&quot;", '"')
    return text.strip()


def extract_quote_info(status: dict) -> tuple[str, str]:
    """提取转发/回复帖中的引用信息"""
    retweeted = status.get("retweeted_status", {})
    if not retweeted:
        return "", ""

    quote_user = retweeted.get("user", {}).get("screen_name", "")
    quote_text = clean_html(retweeted.get("description", ""))

    return quote_user, quote_text


def is_official_account(author: str, user_id: str | int) -> bool:
    """判断是否为官方账号（上市公司、指数、ETF、系统账号）"""
    import re

    if user_id in ["-1", "0", -1, 0, ""]:
        return True

    if "ETF" in author or "指数" in author:
        return True

    return bool(re.search(r".+\([\d\w\-]+\)$", author))


def parse_status(status: dict) -> dict | None:
    """解析单条帖子数据，如果是官方账号返回 None"""
    post_id = status.get("id", "")
    user_id = status.get("user_id", "")
    created_at = status.get("created_at", 0)
    description = status.get("description", "")
    retweet_count = status.get("retweet_count", 0)
    reply_count = status.get("reply_count", 0)
    like_count = status.get("like_count", 0)
    user_info = status.get("user", {})

    author = user_info.get("screen_name", "")

    if is_official_account(author, user_id):
        return None

    content = clean_html(description)

    quote_user, quote_content = extract_quote_info(status)

    comment_chain = content.split("//")
    author_content = comment_chain[0].strip()[:500]
    commented_posts = [c.strip() for c in comment_chain[1:] if c.strip()]

    url = f"https://xueqiu.com/{user_id}/{post_id}" if post_id else ""

    return {
        "post_id": post_id,
        "user_id": user_id,
        "author": author,
        "post_time": parse_timestamp(created_at) if created_at else "未知时间",
        "author_content": author_content,
        "commented_posts": commented_posts,
        "quote_user": quote_user,
        "quote_content": quote_content[:300] if quote_content else "",
        "reposts": retweet_count,
        "comments": reply_count,
        "likes": like_count,
        "url": url,
    }


def fetch_timeline_in_range(start_date: datetime, end_date: datetime) -> list:
    """爬取指定日期范围内的首页时间线，自动处理分页"""
    all_statuses = []
    max_id = None
    page = 1
    start_ms = start_date.timestamp() * 1000
    end_ms = end_date.timestamp() * 1000

    while True:
        print(f"正在爬取第 {page} 页...")
        api_data = get_home_timeline(page=page, count=20, max_id=max_id)
        statuses = api_data.get("home_timeline", [])

        if not statuses:
            print("没有更多数据")
            break

        in_range = [s for s in statuses if start_ms <= s.get("created_at", 0) <= end_ms]
        all_statuses.extend(in_range)

        oldest_timestamp = min(s.get("created_at", 0) for s in statuses)
        if oldest_timestamp < start_ms:
            print("已爬取到开始日期之前的数据，停止")
            break

        max_id = api_data.get("next_max_id")
        page += 1
        time.sleep(2)

    return all_statuses


def fetch_hot_posts_in_range(start_date: datetime, end_date: datetime) -> list:
    """爬取指定日期范围内的热帖，自动处理分页"""
    all_statuses = []
    max_id = None
    page = 1
    start_ms = start_date.timestamp() * 1000
    end_ms = end_date.timestamp() * 1000

    while True:
        print(f"正在爬取热帖第 {page} 页...")
        api_data = get_hot_posts(max_id=max_id, size=20)
        items = api_data.get("items", [])

        if not items:
            print("热帖没有更多数据")
            break

        # 热帖 item 结构：{original_status: {…}}，嵌套的 original_status 才是完整帖子对象
        statuses = [
            item.get("original_status") or item.get("status")
            for item in items
            if item.get("original_status") or item.get("status")
        ]

        in_range = [s for s in statuses if start_ms <= s.get("created_at", 0) <= end_ms]
        all_statuses.extend(in_range)

        oldest_timestamp = min(s.get("created_at", 0) for s in statuses)
        if oldest_timestamp < start_ms:
            print("已爬取到开始日期之前的热帖，停止")
            break

        next_max_id = api_data.get("next_max_id")
        if next_max_id is None or next_max_id == max_id:
            print("热帖分页无新数据，停止")
            break

        max_id = next_max_id
        page += 1
        time.sleep(2)

    return all_statuses


def group_by_author(posts: list[dict]) -> dict[str, list[dict]]:
    """按发言人分组帖子"""
    from collections import defaultdict

    grouped = defaultdict(list)
    for post in posts:
        grouped[post["author"]].append(post)

    for author in grouped:
        grouped[author].sort(key=lambda p: p["post_time"], reverse=True)

    return dict(grouped)


def save_to_markdown(
    posts: list[dict],
    start_date: datetime,
    end_date: datetime,
    output_file: str,
    sources: list[str] | None = None,
) -> None:
    """保存为 Markdown 文件（按发言人分组）"""
    from collections import Counter

    content = []
    sources = sources or ["关注时间线"]

    source_label = "+".join(sources)
    content.append(
        f"# 雪球分析数据源 {source_label} ({start_date.strftime('%Y-%m-%d')} 至 {end_date.strftime('%Y-%m-%d')})\n"
    )
    content.append(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    author_counts = Counter(post["author"] for post in posts)
    content.append(f"共 {len(posts)} 条动态，{len(author_counts)} 位发言人\n")

    content.append("## 发言统计\n")
    content.append("| 发言人 | 帖子数 |")
    content.append("|--------|--------|")
    for author, count in sorted(author_counts.items(), key=lambda x: x[1], reverse=True):
        content.append(f"| @{author} | {count} |")
    content.append("")

    content.append("## 时间线\n")

    grouped = group_by_author(posts)
    sorted_authors = sorted(grouped.keys(), key=lambda a: len(grouped[a]), reverse=True)

    for author in sorted_authors:
        author_posts = grouped[author]
        content.append(f"### @{author} ({len(author_posts)} 条)\n")

        for post in author_posts:
            content.append(f"#### {post['post_time']}\n")

            content.append(f"{post['author_content']}\n")

            for commented in post["commented_posts"]:
                content.append(f"//{commented}\n")

            if post["quote_content"]:
                content.append(f"> @{post['quote_user']}: {post['quote_content']}\n")

            content.append(f"[查看原文]({post['url']})\n")
            content.append("---\n")

    Path(output_file).write_text("\n".join(content), encoding="utf-8")
    print(f"已保存到：{output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="爬取雪球关注时间线 + 热帖（API 方式），默认双源综合分析"
    )
    parser.add_argument("--hours", type=int, default=24, help="爬取最近 N 小时，默认 24 小时")
    parser.add_argument("--days", type=int, help="爬取最近 N 天")
    parser.add_argument("--start-date", help="开始日期 (YYYY-MM-DD)")
    parser.add_argument("--end-date", help="结束日期 (YYYY-MM-DD)，默认今天")
    parser.add_argument("-o", "--output", help="输出文件名（默认自动生成）")
    parser.add_argument(
        "--hot", action="store_true", help="仅爬取热帖（不爬关注时间线）"
    )
    parser.add_argument(
        "--follow-only",
        action="store_true",
        help="仅爬取关注时间线（默认是关注+热帖双源）",
    )
    args = parser.parse_args()

    if args.hours and args.days:
        print("错误：--hours 和 --days 参数互斥，不能同时使用")
        return
    if args.hours and args.start_date:
        print("错误：--hours 和 --start-date 参数互斥，不能同时使用")
        return
    if args.days and args.start_date:
        print("错误：--days 和 --start-date 参数互斥，不能同时使用")
        return

    end_date = parse_date_string(args.end_date, datetime.now())

    if args.hours:
        start_date = datetime.now() - timedelta(hours=args.hours)
    elif args.days:
        start_date = datetime.now() - timedelta(days=args.days)
    elif args.start_date:
        start_date = parse_date_string(args.start_date, datetime.now() - timedelta(hours=24))
    else:
        start_date = datetime.now() - timedelta(hours=24)

    output_file = args.output

    if args.follow_only and args.hot:
        print("错误：--follow-only 和 --hot 参数互斥，不能同时使用")
        return

    print("步骤 1: 打开雪球首页并登录...")
    open_xueqiu()
    time.sleep(3)

    print(f"步骤 2: 获取数据源（时间范围：{start_date.strftime('%Y-%m-%d')} 至 {end_date.strftime('%Y-%m-%d')}）...")
    all_statuses: list = []
    sources: list[str] = []

    if not args.hot:
        print("—— 爬取关注时间线...")
        follow_statuses = fetch_timeline_in_range(start_date, end_date)
        all_statuses.extend(follow_statuses)
        sources.append("关注时间线")
        print(f"关注时间线获取到 {len(follow_statuses)} 条动态")

    if not args.follow_only:
        print("—— 爬取热帖...")
        hot_statuses = fetch_hot_posts_in_range(start_date, end_date)
        all_statuses.extend(hot_statuses)
        sources.append("热帖")
        print(f"热帖获取到 {len(hot_statuses)} 条动态")

    if not all_statuses:
        print("未找到任何帖子数据（关注时间线可能为空，可尝试 --hot）")
        return

    print(f"共获取到 {len(all_statuses)} 条动态")

    print("步骤 3: 解析帖子数据...")
    posts = [p for p in (parse_status(s) for s in all_statuses) if p is not None]

    # 双源合并去重：同一帖子 id 只保留一次
    seen = set()
    deduped = []
    for post in posts:
        if post["post_id"] in seen:
            continue
        seen.add(post["post_id"])
        deduped.append(post)
    posts = deduped
    print(f"去重后 {len(posts)} 条动态")

    if not output_file:
        start_str = start_date.strftime("%Y%m%d")
        end_str = end_date.strftime("%Y%m%d")
        output_file = f"xueqiu_{start_str}_{end_str}.md"

    print("步骤 4: 保存到 Markdown 文件...")
    save_to_markdown(posts, start_date, end_date, output_file, sources=sources)

    print(f"\n=== 统计：共 {len(posts)} 条动态")
    from collections import Counter

    author_counts = Counter(post["author"] for post in posts)
    print(f"=== 发言人：{len(author_counts)} 位")
    print("\n=== 前 3 位发言人 ===")
    for author, count in sorted(author_counts.items(), key=lambda x: x[1], reverse=True)[:3]:
        print(f"@{author}: {count} 条")


if __name__ == "__main__":
    main()
