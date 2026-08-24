#!/usr/bin/env python3
"""
crawl_xueqiu_home_timeline_api.py 的核心逻辑自检。

不依赖网络 / 登录态 / Chrome，纯单元级验证：
- parse_timestamp / clean_html
- is_official_account 过滤（含字符串/整数 user_id 边界）
- parse_status 评论链（// 与 >）解析
- group_by_author + save_to_markdown 端到端输出

用法：python3 scripts/selfcheck.py
"""
import importlib.util
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CRAWLER_PATH = os.path.join(HERE, "crawl_xueqiu_home_timeline_api.py")

spec = importlib.util.spec_from_file_location("crawler", CRAWLER_PATH)
crawler = importlib.util.module_from_spec(spec)
sys.modules["crawler"] = crawler
spec.loader.exec_module(crawler)


def test_timestamp():
    t = crawler.parse_timestamp(1700000000000)
    assert t.startswith("2023-11-1"), t


def test_official_filter():
    for bad in ["-1", "0", -1, 0, ""]:
        assert crawler.is_official_account("某人", bad) is True, f"user_id={bad!r} 应过滤"
    assert crawler.is_official_account("贵州茅台(600519)", "123") is True
    assert crawler.is_official_account("某ETF", "123") is True
    assert crawler.is_official_account("某指数", "123") is True
    assert crawler.is_official_account("张三", "123") is False


def test_clean_html():
    assert crawler.clean_html("<p>你好 &amp; 世界</p>") == "你好 & 世界"


def test_parse_status():
    status = {
        "id": 100, "user_id": 200, "created_at": 1700000000000,
        "description": "这是本人观点 //回复@A：别人的话 > 引用内容",
        "retweet_count": 1, "reply_count": 2, "like_count": 3,
        "user": {"screen_name": "张三"},
        "retweeted_status": {"user": {"screen_name": "李四"}, "description": "<p>被转发内容</p>"},
    }
    parsed = crawler.parse_status(status)
    assert parsed["author"] == "张三"
    assert "这是本人观点" in parsed["author_content"]
    assert any("回复@A" in c for c in parsed["commented_posts"])
    assert parsed["quote_user"] == "李四" and "被转发内容" in parsed["quote_content"]
    assert parsed["url"] == "https://xueqiu.com/200/100"

    official = {"id": 1, "user_id": 300, "created_at": 0, "description": "x",
                "user": {"screen_name": "贵州茅台(600519)"}}
    assert crawler.parse_status(official) is None


def test_hot_post_item_parse():
    """热帖 item（含 original_status 嵌套）应能直接复用 parse_status 解析"""
    hot_item = {
        "id": 954926,
        "category": 0,
        "original_status": {
            "id": 406226910,
            "user_id": 2815370195,
            "created_at": 1787477227000,
            "description": "热帖内容",
            "retweet_count": 1, "reply_count": 2, "like_count": 3,
            "user": {"screen_name": "热帖作者"},
        },
    }
    os_ = hot_item.get("original_status") or hot_item.get("status")
    assert os_ is not None
    parsed = crawler.parse_status(os_)
    assert parsed["author"] == "热帖作者"
    assert str(parsed["post_id"]) == "406226910"  # 真实 API 中 id 为整数
    assert "热帖内容" in parsed["author_content"]


def test_save_markdown():
    posts = [
        {"author": "乙", "post_time": "2024-01-01 10:00", "author_content": "乙的发言",
         "commented_posts": [], "quote_user": "", "quote_content": "", "url": "u2"},
        {"author": "甲", "post_time": "2024-01-01 09:00", "author_content": "甲的发言",
         "commented_posts": ["别人的"], "quote_user": "丙", "quote_content": "引用", "url": "u1"},
        {"author": "甲", "post_time": "2024-01-01 08:00", "author_content": "甲的另一条",
         "commented_posts": [], "quote_user": "", "quote_content": "", "url": "u1b"},
    ]
    out = os.path.join(os.path.dirname(HERE), "selfcheck_out.md")
    crawler.save_to_markdown(posts, datetime(2024, 1, 1), datetime(2024, 1, 2), out)
    try:
        content = open(out, encoding="utf-8").read()
        assert "### @甲 (2 条)" in content and "### @乙 (1 条)" in content
        assert content.index("甲 (2 条)") < content.index("乙 (1 条)")
        assert "//别人的" in content and "> @丙: 引用" in content
    finally:
        os.remove(out)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("全部自检通过 ✓")
