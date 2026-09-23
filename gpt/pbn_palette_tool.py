"""
Darl'Art PBN palette tool: turns an artwork into a validated paint-by-numbers master.

It remaps every pixel to exactly N distinct authorized palette colors (darlart_palette.json: the Darl'Art V2
palette without 3801 and 3811), removes the regions too small to paint, then re-reads the saved PNG to validate it.

In ChatGPT (Code Interpreter), with this file and darlart_palette.json in the GPT's knowledge:

    import sys; sys.path.append("/mnt/data")
    import pbn_palette_tool as pbn
    result = pbn.run("/mnt/data/artwork.png", 24)
    print(result["report"])

Only numpy, Pillow and scipy are needed.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

EXCLUDED_IDS = {"3801", "3811"}
SUPPORTED_COUNTS = (12, 24, 36, 48)
# Smallest region the PBN tool keeps, in pixels at 1024 px on the long side (src/core/settings.ts)
MIN_REGION_AT_1024 = {"easy": 160, "medium": 110, "hard": 30}


# ---------------------------------------------------------------- palette

def find_palette_file():
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "."
    for folder in (here, "/mnt/data", "."):
        path = os.path.join(folder, "darlart_palette.json")
        if os.path.exists(path):
            return path
    raise FileNotFoundError("darlart_palette.json not found next to the tool or in /mnt/data")


def load_palette(path=None):
    """Authorized colors: list of {id, hex, rgb}. Never includes 3801 / 3811."""
    with open(path or find_palette_file(), encoding="utf-8") as f:
        data = json.load(f)
    colors = []
    for c in data["colors"]:
        if c["id"] in EXCLUDED_IDS:
            continue
        h = c["hex"].lstrip("#").upper()
        colors.append({"id": c["id"], "hex": "#" + h, "rgb": (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))})
    if len({c["hex"] for c in colors}) != len(colors):
        raise ValueError("palette has duplicate HEX values")
    return colors


# ---------------------------------------------------------------- color math

def rgb_to_lab(rgb):
    """sRGB (uint8, any shape ending in 3) to CIE Lab (D65)."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


# Extra cost for losing chroma (a colored area turning grey): the palette has no pastel blues, so without it a pale
# sky or skin can land on a grey that is about as close as the nearest blue or skin tone
CHROMA_LOSS_WEIGHT = 0.6


def color_distance2(lab_a, lab_b):
    """Squared Delta E 76, plus the chroma-loss cost."""
    d = ((lab_a - lab_b) ** 2).sum(-1)
    loss = np.maximum(0.0, np.hypot(lab_a[..., 1], lab_a[..., 2]) - np.hypot(lab_b[..., 1], lab_b[..., 2]))
    return d + CHROMA_LOSS_WEIGHT * loss ** 2


def nearest(lab_pixels, lab_colors):
    """Index of the nearest color for each pixel (color_distance2), and that distance."""
    chunk = max(1024, 2000000 // len(lab_colors))  # keeps each distance block around 50 MB
    idx = np.empty(len(lab_pixels), dtype=np.int32)
    dist = np.empty(len(lab_pixels))
    for start in range(0, len(lab_pixels), chunk):
        d = color_distance2(lab_pixels[start:start + chunk, None, :], lab_colors[None, :, :])
        idx[start:start + chunk] = d.argmin(1)
        dist[start:start + chunk] = np.sqrt(d.min(1))
    return idx, dist


# ---------------------------------------------------------------- color selection

def _kmeans(samples, k, rng, iterations=25):
    # k-means++ seeding
    centers = [samples[rng.integers(len(samples))]]
    d2 = ((samples - centers[0]) ** 2).sum(1)
    for _ in range(1, k):
        if d2.sum() == 0:
            centers.append(samples[rng.integers(len(samples))])
        else:
            centers.append(samples[rng.choice(len(samples), p=d2 / d2.sum())])
        d2 = np.minimum(d2, ((samples - centers[-1]) ** 2).sum(1))
    centers = np.array(centers)
    for _ in range(iterations):
        labels, _ = nearest(samples, centers)
        for j in range(k):
            members = samples[labels == j]
            if len(members):
                centers[j] = members.mean(0)
    labels, _ = nearest(samples, centers)
    return centers, np.bincount(labels, minlength=k)


def min_separation(n):
    """Smallest Delta E kept between two chosen colors, so neighbors stay distinguishable when painting"""
    return {12: 10.0, 24: 7.0, 36: 6.0, 48: 5.0}.get(n, 5.0)


def _pick(target_lab, pal_lab, chosen, separation):
    """Nearest palette color to target that is unused and at least `separation` away from the chosen ones"""
    order = np.argsort(color_distance2(target_lab[None, :], pal_lab))
    chosen_lab = pal_lab[list(chosen)] if chosen else None
    for sep in (separation, separation * 0.6, separation * 0.3, 0.0):
        for i in order:
            i = int(i)
            if i in chosen:
                continue
            if chosen_lab is None or sep == 0 or np.sqrt(((chosen_lab - pal_lab[i]) ** 2).sum(1)).min() >= sep:
                return i
    raise ValueError("palette exhausted")


def _snap(centers, weights, pal_lab, separation):
    """Each center to its nearest usable palette color; the largest clusters choose first."""
    chosen = [None] * len(centers)
    used = []
    for j in np.argsort(-weights):
        chosen[j] = _pick(centers[j], pal_lab, used, separation)
        used.append(chosen[j])
    return chosen


def _balanced_sample(flat, size, rng, balance):
    """
    Pixels for the k-means. Plain sampling gives the colors to the largest areas (sky, foliage, a white shirt)
    and leaves 2 or 3 for faces. Half the sample is drawn with a weight of 1 / sqrt(frequency of the pixel's
    color), so small but distinct areas (skin, hair, eyes, lips, clothes) get their own colors too.
    """
    size = min(size, len(flat))
    if balance <= 0:
        return flat[rng.choice(len(flat), size, replace=False)]
    bins = np.floor(flat / 6.0).astype(np.int64)
    key = (bins[:, 0] * 64 + bins[:, 1] + 32) * 64 + bins[:, 2] + 32
    _, inverse, counts = np.unique(key, return_inverse=True, return_counts=True)
    weight = counts[inverse].astype(np.float64) ** -0.5
    n_balanced = int(size * balance)
    uniform = rng.choice(len(flat), size - n_balanced, replace=False)
    balanced = rng.choice(len(flat), n_balanced, replace=False, p=weight / weight.sum())
    return flat[np.concatenate([uniform, balanced])]


def select_colors(lab_image, n, pal_lab, seed=7707, sample_size=80000, balance=0.5):
    """N distinct palette indices that best represent the image (k-means in Lab, snapped to the palette)."""
    rng = np.random.default_rng(seed)
    flat = lab_image.reshape(-1, 3)
    samples = _balanced_sample(flat, sample_size, rng, balance)
    centers, weights = _kmeans(samples, n, rng)
    separation = min_separation(n)
    selected = _snap(centers, weights, pal_lab, separation)
    # refine: re-center on the pixels each palette color actually receives, then snap again
    for _ in range(3):
        labels, _ = nearest(samples, pal_lab[selected])
        weights = np.bincount(labels, minlength=n)
        centers = np.array([samples[labels == j].mean(0) if weights[j] else pal_lab[selected[j]] for j in range(n)])
        new = _snap(centers, weights, pal_lab, separation)
        if new == selected:
            break
        selected = new
    return selected


# ---------------------------------------------------------------- clean-up

def resolve_antialiasing(labels, pal_lab, passes=2):
    """
    Pixels whose color lies between the two regions on either side of them (the blend left by anti-aliasing or
    resizing, 1 or 2 px wide) join the closer of the two. A thin line of its own color, such as an eyelid, a lip
    line or a dark outline, is kept: its sides are the same region, or it isn't between them.
    """
    h, w = labels.shape
    for _ in range(passes):
        out = labels.copy()
        for gap in (1, 2):
            for axis in (0, 1):
                if labels.shape[axis] <= 2 * gap:
                    continue
                c = labels[gap:-gap, :] if axis == 0 else labels[:, gap:-gap]
                a = labels[:-2 * gap, :] if axis == 0 else labels[:, :-2 * gap]
                b = labels[2 * gap:, :] if axis == 0 else labels[:, 2 * gap:]
                la, lb, lc = pal_lab[a], pal_lab[b], pal_lab[c]
                dab = np.sqrt(((la - lb) ** 2).sum(-1))
                dac = np.sqrt(((la - lc) ** 2).sum(-1))
                dcb = np.sqrt(((lc - lb) ** 2).sum(-1))
                between = (a != b) & (c != a) & (c != b) & (dac + dcb <= 1.15 * dab)
                target = np.where(dac <= dcb, a, b)
                view = out[gap:-gap, :] if axis == 0 else out[:, gap:-gap]
                view[between] = target[between]
        labels = out
    return labels


def majority_filter(labels, n, size=3):
    """Each pixel takes the most common color around it: removes anti-aliasing and speckles."""
    best = np.full(labels.shape, -1.0)
    out = labels.copy()
    for c in range(n):
        score = ndimage.uniform_filter((labels == c).astype(np.float32), size=size, mode="nearest")
        score += (labels == c) * 1e-3  # ties keep the current color
        better = score > best
        out[better] = c
        best[better] = score[better]
    return out


def components(labels, n):
    """Connected same-color regions (4-connected): region map, region sizes, region colors."""
    regions = np.zeros(labels.shape, dtype=np.int32)
    offset = 0
    for c in range(n):
        lab, count = ndimage.label(labels == c)
        inside = lab > 0
        regions[inside] = lab[inside] + offset
        offset += count
    sizes = np.bincount(regions.ravel(), minlength=offset + 1)
    colors = np.zeros(offset + 1, dtype=np.int64)
    colors[regions.ravel()] = labels.ravel()
    return regions, sizes, colors


def merge_small_regions(labels, n, min_area, max_passes=25):
    """Regions under min_area pixels take the color they share the longest border with (large neighbors first)."""
    for _ in range(max_passes):
        regions, sizes, colors = components(labels, n)
        small = sizes < min_area
        small[0] = False
        if not small.any():
            break
        src_all, col_all, w_all = [], [], []
        for a, b in ((regions[:, :-1], regions[:, 1:]), (regions[:-1, :], regions[1:, :])):
            for src, dst in ((a, b), (b, a)):
                sel = (src != dst) & small[src]
                s_ids, d_ids = src[sel], dst[sel]
                src_all.append(s_ids)
                col_all.append(colors[d_ids])
                w_all.append(np.where(small[d_ids], 1.0, 1000.0))
        src_ids = np.concatenate(src_all)
        if src_ids.size == 0:
            break
        key = src_ids.astype(np.int64) * n + np.concatenate(col_all)
        uniq, inverse = np.unique(key, return_inverse=True)
        weight = np.bincount(inverse, weights=np.concatenate(w_all))
        region_of, color_of = uniq // n, uniq % n
        order = np.lexsort((-weight, region_of))
        first = order[np.r_[True, region_of[order][1:] != region_of[order][:-1]]]
        new_colors = colors.copy()
        new_colors[region_of[first]] = color_of[first]
        labels = new_colors[regions].astype(labels.dtype)
    return labels


def fill_missing(labels, selected, missing, flat_lab, pal_lab, min_area, separation):
    """
    A chosen color vanished in the clean-up: its slot goes to the paintable region worst matched by its
    current color (never the last region of a color), painted with the nearest free palette color.
    """
    n = len(selected)
    regions, sizes, colors = components(labels, n)
    count = np.maximum(sizes, 1)
    mean = np.stack([np.bincount(regions.ravel(), weights=flat_lab[:, k], minlength=len(sizes)) for k in range(3)], 1) / count[:, None]
    per_color = np.bincount(colors[1:], minlength=n)
    error = np.sqrt(((mean - pal_lab[np.array(selected)][colors]) ** 2).sum(1)) * np.sqrt(count)
    error[0] = -1
    error[sizes < min_area] = -1
    for j in missing:
        candidates = np.where((error >= 0) & (per_color[colors] >= 2))[0]
        if candidates.size == 0:
            break
        r = int(candidates[error[candidates].argmax()])
        others = [selected[k] for k in range(n) if k != j]
        selected[j] = _pick(mean[r], pal_lab, others, separation)
        labels[regions == r] = j
        per_color[colors[r]] -= 1
        error[r] = -1
    return labels, selected


# ---------------------------------------------------------------- validation

def validate(path, n, palette=None):
    """Reads the saved file's pixels: PASS only if it has exactly n distinct colors, all authorized."""
    palette = palette or load_palette()
    by_hex = {c["hex"]: c["id"] for c in palette}
    img = Image.open(path)
    if img.mode == "RGBA" and np.asarray(img)[..., 3].min() < 255:
        return {"status": "FAIL", "reason": "transparent pixels", "distinct": None, "unauthorized": None, "colors": []}
    arr = np.asarray(img.convert("RGB")).reshape(-1, 3)
    uniq, counts = np.unique(arr, axis=0, return_counts=True)
    colors, unauthorized = [], []
    for rgb, count in zip(uniq, counts):
        hx = "#%02X%02X%02X" % tuple(int(v) for v in rgb)
        entry = {"id": by_hex.get(hx), "hex": hx, "pixels": int(count), "coverage": 100.0 * count / len(arr)}
        (colors if entry["id"] else unauthorized).append(entry)
    colors.sort(key=lambda c: -c["pixels"])
    status = "PASS" if len(uniq) == n and not unauthorized else "FAIL"
    return {"status": status, "distinct": int(len(uniq)), "unauthorized": len(unauthorized),
            "unauthorized_samples": [c["hex"] for c in unauthorized[:10]], "colors": colors}


def region_stats(labels):
    """Number of paintable regions and the smallest one, as the PBN tool will see them."""
    total, smallest = 0, None
    for c in np.unique(labels):
        regions, count = ndimage.label(labels == c)
        if count:
            sizes = np.bincount(regions.ravel())[1:]
            total += count
            smallest = int(sizes.min()) if smallest is None else min(smallest, int(sizes.min()))
    return total, smallest


# ---------------------------------------------------------------- main entry

def run(path, n, out_path=None, detail="hard", min_area=None, max_side=1024, seed=7707):
    """
    Remaps the image at `path` to exactly n authorized colors and validates the saved PNG.
    detail: "easy" | "medium" | "hard", the smallest region kept (same thresholds as the PBN tool).
    max_side: the image is first scaled down to this (1024 = what the PBN tool works at, so it won't resample
    the master and blend new colors into it). The scaling happens before the remap, never after.
    Returns a dict with status, the output path, the colors (ID, HEX, coverage) and a text report.
    """
    if n not in SUPPORTED_COUNTS:
        raise ValueError("n must be one of %s" % (SUPPORTED_COUNTS,))
    palette = load_palette()
    pal_rgb = np.array([c["rgb"] for c in palette], dtype=np.uint8)
    pal_lab = rgb_to_lab(pal_rgb)

    img = Image.open(path)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(background, img)
    img = img.convert("RGB")
    if max_side and max(img.size) > max_side:
        scale = max_side / float(max(img.size))
        # box averaging: no ringing halos around edges, unlike Lanczos
        img = img.resize((max(1, round(img.size[0] * scale)), max(1, round(img.size[1] * scale))), Image.BOX)
    rgb = np.asarray(img)
    h, w = rgb.shape[:2]
    lab = rgb_to_lab(rgb)
    flat_lab = lab.reshape(-1, 3)
    if min_area is None:
        min_area = max(8, int(round(MIN_REGION_AT_1024[detail] * (max(h, w) / 1024.0) ** 2)))

    selected = select_colors(lab, n, pal_lab, seed=seed)
    idx, _ = nearest(flat_lab, pal_lab[selected])
    labels = resolve_antialiasing(idx.reshape(h, w), pal_lab[selected])
    labels = merge_small_regions(labels, n, min_area)
    missing = [j for j in range(n) if j not in set(np.unique(labels).tolist())]
    if missing:
        labels, selected = fill_missing(labels, selected, missing, flat_lab, pal_lab, min_area, min_separation(n))

    out_path = out_path or os.path.splitext(path)[0] + "_pbn_%d.png" % n
    Image.fromarray(pal_rgb[selected][labels].astype(np.uint8), "RGB").save(out_path, optimize=True)

    check = validate(out_path, n, palette)
    chosen_lab = pal_lab[selected]
    pair = ((chosen_lab[:, None, :] - chosen_lab[None, :, :]) ** 2).sum(-1) ** 0.5
    np.fill_diagonal(pair, np.inf)
    regions, smallest = region_stats(labels)
    result = dict(check, path=out_path, size=(w, h), min_area=min_area, regions=regions, smallest_region=smallest,
                  min_delta_e=float(pair.min()))
    result["report"] = format_report(result, n)
    return result


def format_report(result, n):
    lines = [
        "VERSION: %d" % n,
        "STATUS: %s" % result["status"],
        "ACTUAL DISTINCT RGB COLORS: %s" % result["distinct"],
        "UNAUTHORIZED COLORS: %s" % result["unauthorized"],
        "FILE: %s (%d x %d, lossless PNG)" % (os.path.basename(result["path"]), result["size"][0], result["size"][1]),
        "PAINTABLE REGIONS: %d (smallest %s px, minimum kept %d px)" % (result["regions"], result["smallest_region"], result["min_area"]),
        "CLOSEST COLOR PAIR: Delta E %.1f" % result["min_delta_e"],
        "",
        "Palette ID - #HEX - coverage",
    ]
    lines += ["%s - %s - %.2f%%" % (c["id"], c["hex"], c["coverage"]) for c in result["colors"]]
    if result.get("unauthorized_samples"):
        lines.append("Unauthorized samples: " + ", ".join(result["unauthorized_samples"]))
    return "\n".join(lines)


def swatch_sheet(result, out_path=None, columns=6):
    """A PNG legend of the colors used (swatch, ID, HEX, coverage), for the customer or for checking."""
    from PIL import ImageDraw
    colors = result["colors"]
    cell_w, cell_h = 180, 120
    rows = (len(colors) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), (250, 250, 250))
    draw = ImageDraw.Draw(sheet)
    for i, c in enumerate(colors):
        x, y = (i % columns) * cell_w, (i // columns) * cell_h
        rgb = tuple(int(c["hex"][k:k + 2], 16) for k in (1, 3, 5))
        draw.rectangle([x + 10, y + 10, x + cell_w - 10, y + 70], fill=rgb, outline=(120, 120, 120))
        draw.text((x + 12, y + 76), "%s  %s" % (c["id"], c["hex"]), fill=(20, 20, 20))
        draw.text((x + 12, y + 94), "%.2f%%" % c["coverage"], fill=(90, 90, 90))
    out_path = out_path or os.path.splitext(result["path"])[0] + "_legend.png"
    sheet.save(out_path)
    return out_path


def suggest(path, n, max_side=512):
    """The n authorized colors that best fit a reference image (ID, HEX), to describe the target palette
    in the generation prompt. The final colors are chosen again on the generated artwork by run()."""
    palette = load_palette()
    pal_lab = rgb_to_lab(np.array([c["rgb"] for c in palette], dtype=np.uint8))
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    selected = select_colors(rgb_to_lab(np.asarray(img)), n, pal_lab)
    return [{"id": palette[i]["id"], "hex": palette[i]["hex"]} for i in selected]
