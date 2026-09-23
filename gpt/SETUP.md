# Darl'Art PBN Artwork GPT: setup

A Custom GPT that takes a photo and a number of colors (12, 24, 36 or 48) and answers with exactly two things:
1. ONE image made by ChatGPT's image model: the photo redrawn as a posterized realistic painting (the look of a finished paint-by-numbers canvas) using only N colors from the Darl'Art palette (`palette 2.json` without 3801 and 3811);
2. ONE JSON code block with those N colors (`id`, `hex`, `use`), largest area first.

Nothing else: no text, no files, no second image.

## Configure tab

**Name**
```
Darl'Art PBN Artwork Studio
```

**Description**
```
Send a photo and a number of colors (12, 24, 36 or 48): get one paint-by-numbers artwork in Darl'Art colors, and its color list.
```

**Instructions**: the whole content of `instructions.txt` (3,894 characters). It contains no palette on purpose: ChatGPT's image model sees the conversation, so a palette in context gets drawn into the picture. The GPT writes a full text prompt and generates the image first, and opens the palette file only afterwards, for the JSON.

**Conversation starters**
```
24 colors
12 colors
48 colors
```

**Knowledge**: `darlart_palette.json`, the 407 colors as a bare list of `id` and `hex`, with no title (its old title "Darl'Art palette V2" was being painted into the image). Delete the old copy in the editor and upload this one. Remove `pbn_palette_tool.py`.

**Capabilities**
- Web Search: **off**
- Image Generation: **on**
- Code Interpreter & Data Analysis: **off** (no code, no downloadable files)

**Actions**: none.

Then click **Update**.

## Known limit

The image model paints with the listed HEX codes, but it can't guarantee every pixel is exactly one of them: edges are smoothed and flat areas can drift slightly. The JSON is the exact list of palette colors the image is built on.

## Files in this folder

| File | Use |
|---|---|
| `instructions.txt` | Paste into Instructions |
| `darlart_palette.json` | Knowledge file |
| `pbn_palette_tool.py` | Not used by the GPT. Optional offline check of an image's colors (`pbn.validate(image, N)`) |
