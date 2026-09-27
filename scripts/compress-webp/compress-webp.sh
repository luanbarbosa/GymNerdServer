#!/usr/bin/env bash
# Compress catalog webp images larger than MAX_KB.
# Animated files: frames re-encoded lossy via img2webp, keeping frame durations and loop count.
# Static files: re-encoded lossy via cwebp.
# Quality steps down until the file fits; if lowest quality still too big, width is reduced.
# If the first quality at a width is over 2x the limit, that width is skipped (lower quality won't halve it).
# Original is only replaced when the result is smaller.
#
# Usage: compress-webp.sh [images_dir] [max_kb]
# Requires: brew install imagemagick webp
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="${1:-$SCRIPT_DIR/../../catalog/images}"
MAX_KB="${2:-500}"
MAX_BYTES=$((MAX_KB * 1024))
QUALITIES=(80 70 60 50 40)
WIDTHS=(1024 768 512)

for bin in magick webpmux webpinfo img2webp cwebp; do
  command -v "$bin" >/dev/null || { echo "Missing $bin (brew install imagemagick webp)" >&2; exit 1; }
done

file_size() { stat -f%z "$1"; }

read_anim_info() { # in -> sets LOOP, DURATIONS
  local info
  info=$(webpmux -info "$1")
  LOOP=$(awk -F'Loop Count : ' '/Loop Count/{print $2}' <<<"$info")
  DURATIONS=($(awk '/^[[:space:]]*[0-9]+:/{print $7}' <<<"$info"))
}

extract_frames() { # in width tmpdir
  rm -f "$3"/frame-*.png
  magick "$1" -coalesce -resize "${2}x>" "$3/frame-%04d.png"
}

encode_animated() { # out quality tmpdir (frames from extract_frames, info from read_anim_info)
  local args i=0
  args=(-loop "${LOOP:-0}" -lossy -q "$2" -m 4) # -m 6 is ~3x slower for little gain on many frames
  for frame in "$3"/frame-*.png; do
    args+=(-d "${DURATIONS[$i]:-100}" "$frame")
    i=$((i + 1))
  done
  img2webp "${args[@]}" -o "$1" >/dev/null 2>&1
}

encode_static() { # in out quality width
  cwebp -quiet -q "$3" -m 6 -alpha_q 90 -resize "$4" 0 "$1" -o "$2"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

compressed=0; skipped=0; saved=0

files=()
while IFS= read -r -d '' f; do
  [ "$(file_size "$f")" -gt "$MAX_BYTES" ] && files+=("$f")
done < <(find "$IMAGES_DIR" -type f -name '*.webp' -print0)
total=${#files[@]}
echo "Found $total files over ${MAX_KB}KB"

n=0
for f in "${files[@]+"${files[@]}"}"; do
  n=$((n + 1))
  name=$(basename "$f")
  size=$(file_size "$f")

  animated=0
  # Capture first: piping into grep -q + pipefail makes webpinfo SIGPIPE on large files
  info=$(webpinfo -summary "$f" 2>/dev/null || true)
  [[ "$info" == *"Animation: 1"* ]] && animated=1
  orig_w=$(magick identify -format "%w" "${f}[0]")

  kind=static
  if [ "$animated" -eq 1 ]; then
    read_anim_info "$f"
    kind="animated, ${#DURATIONS[@]} frames"
  fi
  printf '[%d/%d] %s: %dKB, %dpx, %s\n' "$n" "$total" "$name" $((size / 1024)) "$orig_w" "$kind"

  best="" best_size=$size
  for w in "${WIDTHS[@]}"; do
    [ "$w" -gt "$orig_w" ] && w=$orig_w
    if [ "$animated" -eq 1 ]; then
      printf '    extracting frames at w=%d...\n' "$w"
      extract_frames "$f" "$w" "$TMP"
    fi
    for q in "${QUALITIES[@]}"; do
      out="$TMP/out.webp"
      printf '    q=%d w=%d... ' "$q" "$w"
      start=$SECONDS
      if [ "$animated" -eq 1 ]; then
        encode_animated "$out" "$q" "$TMP"
      else
        encode_static "$f" "$out" "$q" "$w"
      fi
      out_size=$(file_size "$out")
      printf '%dKB (%ds)\n' $((out_size / 1024)) $((SECONDS - start))
      if [ "$out_size" -lt "$best_size" ]; then
        mv "$out" "$TMP/best.webp"; best="$TMP/best.webp"; best_size=$out_size
        best_desc="q=$q w=$w"
      fi
      [ "$best_size" -le "$MAX_BYTES" ] && break 2
      if [ "$q" -eq "${QUALITIES[0]}" ] && [ "$out_size" -gt $((MAX_BYTES * 2)) ] && [ "$w" -gt "${WIDTHS[${#WIDTHS[@]}-1]}" ]; then
        printf '    over 2x limit, trying smaller width\n'
        break
      fi
    done
  done

  if [ -n "$best" ]; then
    mv "$best" "$f"
    compressed=$((compressed + 1)); saved=$((saved + size - best_size))
    flag=""; [ "$best_size" -gt "$MAX_BYTES" ] && flag=" (still over ${MAX_KB}KB)"
    printf '  -> %dKB -> %dKB [%s]%s\n' $((size / 1024)) $((best_size / 1024)) "$best_desc" "$flag"
  else
    skipped=$((skipped + 1))
    printf '  -> no smaller encoding found, kept\n'
  fi
done

echo "Over ${MAX_KB}KB: $total, compressed: $compressed, kept: $skipped, saved: $((saved / 1024 / 1024))MB"
