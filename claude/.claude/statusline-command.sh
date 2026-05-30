#!/bin/sh
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
mode=$(echo "$input" | jq -r '.output_style.name // empty')
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
tasks=$(echo "$input" | jq -r 'if .agent then 1 else 0 end')
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

out=$(printf "\033[32m%s\033[0m" "$model")

abbrev() {
    n=$1
    if [ "$n" -ge 1000 ]; then
        awk -v n="$n" 'BEGIN { v=n/1000; printf (v>=10 ? "%.0fk" : "%.1fk"), v }'
    else
        printf "%s" "$n"
    fi
}

if [ -n "$used" ] && [ -n "$total_in" ] && [ -n "$ctx_size" ]; then
    out="$out $(printf "\033[34m%s/%s (%.0f%%)\033[0m" "$(abbrev "$total_in")" "$(abbrev "$ctx_size")" "$used")"
fi

if [ -n "$mode" ] && [ "$mode" != "null" ] && [ "$mode" != "default" ]; then
    out="$out $(printf "\033[35mmode: %s\033[0m" "$mode")"
fi

if [ "$tasks" -gt 0 ]; then
    out="$out $(printf "\033[31mtasks: %s\033[0m" "$tasks")"
fi

fmt_remaining() {
    secs=$(( $1 - $(date +%s) ))
    if [ "$secs" -le 0 ]; then
        printf "now"
    elif [ "$secs" -lt 60 ]; then
        printf "0h1m"
    elif [ "$secs" -ge 86400 ]; then
        printf "%dd%dh%dm" "$((secs / 86400))" "$(((secs % 86400) / 3600))" "$(((secs % 3600) / 60))"
    else
        printf "%dh%dm" "$((secs / 3600))" "$(((secs % 3600) / 60))"
    fi
}

# Rate limits (only shown when present — Claude.ai subscribers after first API response)
if [ -n "$five_pct" ]; then
    five_str="5h:$(printf '%.0f' "$five_pct")%"
    if [ -n "$five_reset" ]; then
        five_str="$five_str ($(fmt_remaining "$five_reset"))"
    fi
    out="$out $(printf "\033[36m%s\033[0m" "$five_str")"
fi
if [ -n "$week_pct" ]; then
    week_str="7d:$(printf '%.0f' "$week_pct")%"
    if [ -n "$week_reset" ]; then
        week_str="$week_str ($(fmt_remaining "$week_reset"))"
    fi
    out="$out $(printf "\033[91m%s\033[0m" "$week_str")"
fi

printf "%s" "$out"
