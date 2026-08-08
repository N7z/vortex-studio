#!/usr/bin/env bash
# Turns an ambientCG "<Name>_1K-JPG.zip" into the three maps the viewport wants,
# under public/materials/. Run it again whenever a set is added or replaced.
#
#   scripts/build-materials.sh ~/downloads/*_1K-JPG.zip
#
# Two things happen that are not just a format change:
#
#   * the base colour is flattened to greyscale. A part's colour is picked in the
#     editor and multiplies the albedo, so a green grass texture would fight the
#     picker and there would be no such thing as red grass. Greyscale keeps the
#     variation and lets the colour through.
#   * its brightness is normalised to the same mean for every material. Grass and
#     wood scans are much darker than plaster, and without this the same picked
#     colour would come out muddy on one material and bright on another.
#
# Needs ImageMagick 7 (`magick`).
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/public/materials"
# Where a mid-grey albedo lands, so every material tints the same way. Measured off
# the two sets that were already neutral (Metal055A and PaintedPlaster017, both 0.75).
TARGET_MEAN=0.78
QUALITY=88

# ambientCG names carry a number; the editor's materials do not.
name_for() {
    case "${1,,}" in
        grass*) echo grass ;;
        wood*) echo wood ;;
        metal*) echo metal ;;
        ice*) echo ice ;;
        paintedplaster*|paint*|plaster*) echo paint ;;
        plastic*) echo plastic ;;
        *) echo "" ;;
    esac
}

mkdir -p "$OUT"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for zip in "$@"; do
    base=$(basename "$zip" .zip)
    set=${base%_1K-JPG}
    name=$(name_for "$set")
    if [ -z "$name" ]; then
        echo "skip $set: no editor material goes by that name" >&2
        continue
    fi

    dir="$tmp/$set"
    mkdir -p "$dir"
    unzip -q -o "$zip" -d "$dir" '*.jpg'

    colour="$dir/${set}_1K-JPG_Color.jpg"
    rough="$dir/${set}_1K-JPG_Roughness.jpg"
    # OpenGL convention: +Y up, which is what three.js reads.
    normal="$dir/${set}_1K-JPG_NormalGL.jpg"
    metalness="$dir/${set}_1K-JPG_Metalness.jpg"
    ao="$dir/${set}_1K-JPG_AmbientOcclusion.jpg"

    [ -f "$colour" ] || { echo "skip $set: no Color map" >&2; continue; }

    was_sat=$(magick "$colour" -colorspace HSL -channel G -separate +channel -format "%[fx:mean]" info:)
    grey="$dir/grey.png"
    magick "$colour" -colorspace Gray "$grey"
    mean=$(magick "$grey" -format "%[fx:mean]" info:)
    # -gamma g raises to 1/g, so this lands the mean on TARGET_MEAN whatever it was.
    gamma=$(awk -v m="$mean" -v t="$TARGET_MEAN" 'BEGIN { print log(m) / log(t) }')
    magick "$grey" -gamma "$gamma" -quality $QUALITY "$OUT/${name}_albedo.webp"

    if [ -f "$normal" ]; then
        magick "$normal" -quality 95 "$OUT/${name}_normal.webp"
    else
        echo "  $name: no normal map in the set" >&2
    fi

    # ORM, the packing the desktop Studio ships: occlusion, roughness, metalness in
    # R, G and B. A set without one gets the neutral value for that channel.
    [ -f "$ao" ] && aoc="$ao" || aoc="xc:white"
    [ -f "$rough" ] && rc="$rough" || rc="xc:gray50"
    [ -f "$metalness" ] && mc="$metalness" || mc="xc:black"
    size=$(magick "$colour" -format "%wx%h" info:)
    magick \
        \( "$aoc" -colorspace Gray -resize "$size!" \) \
        \( "$rc" -colorspace Gray -resize "$size!" \) \
        \( "$mc" -colorspace Gray -resize "$size!" \) \
        -channel RGB -combine -quality $QUALITY "$OUT/${name}_orm.webp"

    now=$(magick "$OUT/${name}_albedo.webp" -format "%[fx:mean]" info:)
    printf '%-8s from %-20s saturation %.3f -> 0, brightness %.3f -> %.3f\n' \
        "$name" "$set" "$was_sat" "$mean" "$now"
done
