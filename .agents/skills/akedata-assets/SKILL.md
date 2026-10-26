---
name: akedata-assets
description: "Find and add Arknights: Endfield operator portraits or other game art from AKEData when this repository needs image assets. Do not invoke for the text-only poster."
---

# AKEData Assets

Use this when an image is actually needed by the poster. AKEData's operator pages are at [akedata.wiki](https://www.akedata.wiki/); its image elements can expose `/public/images/...` paths, while the site's image resolver may route them to `https://data.akedata.wiki`.

1. Confirm the full operator name from the user's input. Short rotation labels such as `赛` and `祀` are ambiguous; do not guess an identity or substitute fan art.
2. Open the relevant operator entry, inspect the displayed portrait, and use the resolved image URL from the image element. Prefer a portrait or icon suited to the target crop. Check that the downloaded file is an actual image at useful resolution.
3. Save only the assets used by the feature under `assets/operators/` with stable, descriptive filenames. Record each source page, image URL, attribution/license information available on the page, and retrieval date in `assets/sources.csv`.
4. Keep the original file untouched. Derive crops separately if needed. Do not commit a bulk mirror of the wiki or hotlink runtime artwork.

Example retrieval after verifying an image URL:

```sh
curl -fL --retry 2 -o assets/operators/<operator>-portrait.png '<verified-image-url>'
file assets/operators/<operator>-portrait.png
```

If AKEData changes its image routing, inspect the current operator page again instead of inferring a new URL from an old path.
