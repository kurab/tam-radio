"""Tám Radio share cards and pages: what a link to an episode looks like on SNS and in chat apps (1200x630 card).

Based on myradio's tools/share.py (MIT): the same layout — the station, the date, the episode's title and its topics on
the left; the caster in her camera frame on the right — in Tám Radio's own parts: the non lá logo in its colours, the
day's outfit. Both columns share one height. No LIVE mark (a picture, not a broadcast) and no voice credit (the card has
no voice; the player carries the credit). No news photo is used (a card is copied
and kept by every service it is shared to).

usage: python tools/share_card.py --all [--site site] [--url URL] [--font FONT]
       python tools/share_card.py DATE [--out FILE]          (one card, to look at)
  --all writes SITE/share/<date>-ja.jpg and .html for every episode the site lists and removes the rest.
  The front page keeps its own fixed card (site/og-image.jpg, DEC #87); it is not drawn here.
  Font: Noto Sans JP, variable weight (SIL Open Font License 1.1; tools/fonts/, see tools/fonts/README.md). The OFL
  allows drawing it into images that are distributed.
Needs Pillow; the SVG logo is drawn with rsvg-convert.
"""
from __future__ import annotations

import argparse
import datetime
import html
import io
import json
import re
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
INK, CAM, TEXT, MUTED = (12, 14, 20), (22, 26, 38), (242, 243, 247), (141, 147, 168)
YELLOW, TEAL, RED = (255, 208, 40), (63, 224, 220), (255, 68, 104)
WEEK_JA = "月火水木金土日"


def date_text(d: str) -> str:
    t = datetime.date.fromisoformat(d)
    return f"{t.year}年{t.month}月{t.day}日（{WEEK_JA[t.weekday()]}）"


def wrap(draw, text, f, width, max_lines):
    """Japanese breaks between characters (not before 、。」 etc.); Latin words stay whole."""
    import re
    tokens = re.findall(r"[A-Za-z0-9][\w.\-'’:/+&]*|\s+|.", text)
    lines, cur = [], ""
    for t in tokens:
        if draw.textlength(cur + t, font=f) <= width or not cur.strip() or t in "、。，．・」』）)!?！？ー":
            cur += t
        else:
            lines.append(cur.rstrip()); cur = t.lstrip()
    if cur.strip():
        lines.append(cur.rstrip())
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textlength(lines[-1] + "…", font=f) > width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines


def fit(draw, text, f, width):
    if draw.textlength(text, font=f) <= width:
        return text
    while text and draw.textlength(text + "…", font=f) > width:
        text = text[:-1]
    return text + "…"


def logo_image(svg: Path, height: int) -> Image.Image | None:
    try:
        png = subprocess.run(["rsvg-convert", "-h", str(height * 2), str(svg)], capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def character(site: Path, outfit: str | None) -> Image.Image | None:
    """The day's outfit: its share-card pose (index "og"), else the pack's base (standing, eyes open, mouth closed)."""
    index = json.loads((site / "character" / "character.json").read_text(encoding="utf-8"))
    oid = outfit if outfit in index.get("outfits", {}) else index.get("default")
    if index["outfits"][oid].get("og"):
        return Image.open(site / "character" / index["outfits"][oid]["og"]).convert("RGBA")
    pack_path = site / "character" / index["outfits"][oid]["pack"]
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    return Image.open(pack_path.parent / pack["base"]).convert("RGBA")


def card(site: Path, date: str, font_path: str) -> Image.Image:
    station = json.loads((site / "station.json").read_text(encoding="utf-8"))
    ep = json.loads((site / "episodes" / f"{date}-ja.json").read_text(encoding="utf-8"))
    def face(size, weight):
        f = ImageFont.truetype(font_path, size)
        try:
            f.set_variation_by_axes([weight])
        except (OSError, ValueError):
            pass   # not a variable font: its own weight
        return f
    bold = lambda size: face(size, 700)
    heavy = lambda size: face(size, 800)
    medium = lambda size: face(size, 600)

    im = Image.new("RGB", (W, H), INK)
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0)); g = ImageDraw.Draw(grid)
    for x in range(0, W, 48): g.line([(x, 0), (x, H)], fill=(255, 255, 255, 9))
    for y in range(0, H, 48): g.line([(0, y), (W, y)], fill=(255, 255, 255, 9))
    im.paste(grid, (0, 0), grid)
    d = ImageDraw.Draw(im)
    x0, margin, gap = 64, 64, 56
    logo = logo_image(site / station.get("logo", "logo.svg"), 40)
    char = character(site, ep.get("outfit"))

    def left_block(right):
        """The left column as (kind, x, y, payload) at y from 0, with its ink top and bottom: the station (logo, name,
        bar), tagline, date, the episode's title, the topics."""
        ops, x = [], x0
        if logo:
            ops.append(("img", x, 4, logo)); x += logo.width + 12
        ops.append(("text", x, 0, (station["name"], heavy(38), YELLOW)))
        ops.append(("rect", x0, 58, (x0 + 110, 62)))
        y = 80
        ops.append(("text", x0, y, (station.get("tagline", ""), bold(24), TEAL))); y += 36
        ops.append(("text", x0, y, (date_text(ep["date"]), medium(23), MUTED))); y += 48
        ft = heavy(36)
        for line in wrap(d, ep["title"], ft, right - x0, 3):
            ops.append(("text", x0, y, (line, ft, TEXT))); y += 48
        y += 14
        fn, fl = heavy(21), medium(23)
        for j, n in enumerate(ep["news"]):
            ops.append(("text", x0, y + 2, (f"{j + 1:02d}", fn, YELLOW)))
            ops.append(("text", x0 + 42, y, (fit(d, n["label"], fl, right - x0 - 42), fl, TEXT))); y += 35
        tops, bottoms = [], []
        for kind, x, yy, p in ops:
            if kind == "text":
                b = d.textbbox((x, yy), p[0], font=p[1]); tops.append(b[1]); bottoms.append(b[3])
            elif kind == "img":
                tops.append(yy); bottoms.append(yy + p.height)
        return ops, min(tops), max(bottoms)

    # the two columns share one height: the camera frame (corners included) spans exactly the left column's ink, and the
    # pair is centred on the card; the camera keeps the player's 896:768, so its width follows (a few passes settle it)
    right = W - margin - 456 - 20 - gap
    for _ in range(4):
        ops, top, bottom = left_block(right)
        hl = bottom - top
        chh = hl - 20                      # the corners stand 10 px outside the picture, top and bottom
        cw = round(chh * 896 / 768)
        cx = W - margin - 10 - cw
        right = cx - 10 - gap
    oy = (H - hl) // 2 - top
    for kind, x, y, p in ops:
        if kind == "img": im.paste(p, (x, y + oy), p)
        elif kind == "rect": d.rectangle([x, y + oy, p[0], p[1] + oy], fill=YELLOW)
        else: d.text((x, y + oy), p[0], font=p[1], fill=p[2])

    # the caster in her camera frame; no LIVE mark and no voice credit (a picture, not a live broadcast, and no voice)
    cy = (H - hl) // 2 + 10
    cam = Image.new("RGB", (cw, chh), CAM)
    if char:
        # crop to her, then fill the frame (96 % of its height, or its width for a wide pose), standing on the bottom
        # edge; a pose cut at the waist runs out of the frame's bottom like a camera shot
        c = char.crop(char.getchannel("A").getbbox())
        k = min(chh * 0.96 / c.height, cw / c.width)
        c = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
        cam.paste(c, ((cw - c.width) // 2, chh - c.height), c)
    im.paste(cam, (cx, cy))
    L, t = 30, 4
    box = lambda a, b, c, e: d.rectangle([min(a, c), min(b, e), max(a, c), max(b, e)], fill=YELLOW)
    for ax, ay, sx, sy in [(cx - 10, cy - 10, 1, 1), (cx + cw + 10, cy - 10, -1, 1),
                           (cx - 10, cy + chh + 10, 1, -1), (cx + cw + 10, cy + chh + 10, -1, -1)]:
        box(ax, ay, ax + sx * L, ay + sy * t)
        box(ax, ay, ax + sx * t, ay + sy * L)
    return im


def page(station: dict, ep: dict, stem: str, base: str) -> str:
    """The share page: Open Graph / Twitter tags for the card, title and topics; a person who opens it goes on to that
    episode in the player (meta refresh, no script; the page's own CSP allows nothing to load)."""
    e = lambda t: html.escape(t or "", quote=True)
    desc = " / ".join(f"{j + 1:02d} {n['label']}" for j, n in enumerate(ep["news"]))
    target = f"../#{ep['date']}"
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<title>{e(ep['title'])}｜{e(station['name'])}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="{e(base + '#' + ep['date'])}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{e(station['name'])}">
<meta property="og:title" content="{e(ep['title'])}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{e(base + f'share/{stem}.jpg')}">
<meta property="og:image:width" content="{W}">
<meta property="og:image:height" content="{H}">
<meta property="og:image:alt" content="{e(station['name'] + '　' + date_text(ep['date']) + '　' + ep['title'])}">
<meta property="og:url" content="{e(base + f'share/{stem}.html')}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={e(target)}">
</head>
<body><p><a href="{e(target)}">{e(ep['title'])}｜{e(station['name'])}</a></p></body>
</html>
"""


def current_dates(site: Path, station: dict) -> list[str]:
    """The episodes the site still lists: episodes.json within station.json audio.keep_days (as the player filters them,
    by the station's time zone), newest first."""
    eps = json.loads((site / "episodes.json").read_text(encoding="utf-8"))
    keep = (station.get("audio") or {}).get("keep_days")
    tz = ZoneInfo((station.get("schedule") or {}).get("timezone", "Asia/Ho_Chi_Minh"))
    first = (datetime.datetime.now(tz).date() - datetime.timedelta(days=keep - 1)).isoformat() if keep else ""
    return [e["date"] for e in eps if e["date"] >= first]


def main(argv=None) -> int:
    here = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("date", nargs="?", help="one episode's card only (to look at); without it: --all")
    ap.add_argument("--all", action="store_true", help="cards and pages for every episode the site lists, into SITE/share/; "
                                                        "files of episodes no longer listed are removed")
    ap.add_argument("--site", default=str(here / "site"))
    ap.add_argument("--font", default=str(here / "tools" / "fonts" / "NotoSansJP-wght.ttf"))
    ap.add_argument("--url", default=None, help="where the site is published (default: station.json url); cards need a full URL")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    site = Path(a.site)
    if a.date and not a.all:
        out = Path(a.out or f"share-{a.date}-ja.jpg")
        card(site, a.date, a.font).save(out, quality=88, optimize=True, progressive=True)
        print(out)
        return 0
    station = json.loads((site / "station.json").read_text(encoding="utf-8"))
    base = a.url or station.get("url") or ""
    if not base.startswith("https://"):
        raise SystemExit("share: a full https URL is needed (--url or station.json url): SNS do not show a card without it")
    base = base if base.endswith("/") else base + "/"
    out_dir = site / "share"; out_dir.mkdir(exist_ok=True)
    dates = current_dates(site, station); keep = set()
    for date in dates:
        stem = f"{date}-ja"; keep |= {f"{stem}.jpg", f"{stem}.html"}
        ep = json.loads((site / "episodes" / f"{stem}.json").read_text(encoding="utf-8"))
        card(site, date, a.font).save(out_dir / f"{stem}.jpg", quality=88, optimize=True, progressive=True)
        (out_dir / f"{stem}.html").write_text(page(station, ep, stem, base), encoding="utf-8")
    for f in out_dir.iterdir():
        if f.name not in keep:
            f.unlink()   # an episode that has left the site: its card and page go too (DEC #40, 14 days)
    print(f"share: {len(dates)} episode(s) -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
