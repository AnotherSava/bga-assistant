---
name: project-innovation-cities-images
description: Upstream cities card images sorted by cardnum ASC — Print_CitiesCards_front-N maps to card with cardnum (335+N); same shape as echoes downloader with simpler sort key
metadata: 
  node_type: memory
  type: project
---

Upstream cities card images (`Print_CitiesCards_front-NNN.png` at micahstairs/bga-innovation main-dev) are sorted by **cardnum ASC** — simpler than echoes/artifacts which use `(age, color, name)`.

**Mapping:** upstream file `N` ↔ card with cardnum `(335 + N)`. Cities span cardnums 336-440 (+ relic 441 Timbuktu, which is part of the with-relics variant). JSON's array index in `assets/bga/innovation/card_info.json` for cities equals the BGA cardnum (which is embedded in each entry's `html` field as `cardnum="N"`).

**To (re)download:** sort cities entries by cardnum and save each upstream `Print_CitiesCards_front-NNN.png` as `card_<cardnum>.png`, then convert to WebP. Same shape as `scripts/download_echoes_assets.py` but with the simpler sort key. Total upstream file count is 112 (105 cities + 7 extras, likely backs/specials); only files 001-105 + the relic position map to in-game cards.

**Historical note:** This mapping was discovered while fixing a long-standing bug where local cities WebPs had been saved under wrong sprite indices — yellow cards rendered green popup images and vice versa. Spot-checking upstream files 001/004/007/010/013 (Yin/Jerusalem/Uruk/Hattusa/Thebes — cardnums 336/339/342/345/348) confirmed the cardnum-ASC ordering. Related: [[project-innovation-artifact-meld-action]].
