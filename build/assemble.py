#!/usr/bin/env python3
"""Assemble the Pages site of Tám Radio: the static site + the published episodes still on air.

usage: python3 build/assemble.py PUBLISHED_DIR OUT_DIR
  PUBLISHED_DIR holds episodes/<date>-ja.json and audio/<date>-ja.mp3 (downloaded from the Blob container `site`,
  where the approval flow puts each day's final version after the merge — one file per date, so a later correction
  replaces it and nothing else can shadow it).
  OUT_DIR gets a copy of site/ plus episodes/, audio/ and episodes.json for the dates from today (Vietnam time) back
  station.json audio.keep_days days; dates after today are not published yet. Standard library only.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def on_air(dates: list[str], today: str, keep_days: int) -> list[str]:
    first = (datetime.fromisoformat(today) - timedelta(days=keep_days - 1)).date().isoformat()
    return sorted((d for d in dates if first <= d <= today), reverse=True)


def main(pub: str, out: str) -> int:
    pub_dir, out_dir = Path(pub), Path(out)
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.copytree(ROOT / "site", out_dir)
    station = json.loads((out_dir / "station.json").read_text(encoding="utf-8"))
    tz = ZoneInfo(station["schedule"]["timezone"])
    today = datetime.now(tz).date().isoformat()
    have = {f.name[:10] for f in (pub_dir / "episodes").glob("*-ja.json")
            if (pub_dir / "audio" / f"{f.name[:-5]}.mp3").exists()}
    dates = on_air(sorted(have), today, station["audio"]["keep_days"])
    (out_dir / "episodes").mkdir(exist_ok=True)
    (out_dir / "audio").mkdir(exist_ok=True)
    index = []
    for d in dates:
        ep = json.loads((pub_dir / "episodes" / f"{d}-ja.json").read_text(encoding="utf-8"))
        shutil.copyfile(pub_dir / "episodes" / f"{d}-ja.json", out_dir / "episodes" / f"{d}-ja.json")
        shutil.copyfile(pub_dir / "audio" / f"{d}-ja.mp3", out_dir / "audio" / f"{d}-ja.mp3")
        index.append({"date": d, "ja": {"title": ep.get("title", ""), "seconds": ep["seconds"]}})
    (out_dir / "episodes.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    skipped = sorted(have - set(dates))
    print(f"on air ({today}): {', '.join(dates) or 'none'}" + (f"; not on air: {', '.join(skipped)}" if skipped else ""))
    return 0 if dates else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
