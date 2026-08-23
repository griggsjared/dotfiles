#!/bin/sh
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name')
model="${model% (*}"
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
tasks=$(echo "$input" | jq -r 'if .agent then 1 else 0 end')
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

out=$(printf "\033[32m%s\033[0m" "$model")

if [ -n "$effort" ]; then
    out="$out $(printf "\033[33m%s\033[0m" "$effort")"
fi

abbrev() {
    n=$1
    if [ "$n" -ge 1000000 ]; then
        awk -v n="$n" 'BEGIN { v=n/1000000; printf "%.0fm", v }'
    elif [ "$n" -ge 1000 ]; then
        awk -v n="$n" 'BEGIN { v=n/1000; printf (v>=10 ? "%.0fk" : "%.1fk"), v }'
    else
        printf "%s" "$n"
    fi
}

if [ -n "$total_in" ] && [ -n "$ctx_size" ]; then
    context_color="\033[34m"
    if [ "$total_in" -ge 200000 ]; then
        context_color="\033[5;31m"
    fi
    out="$out $(printf "${context_color}%s/%s\033[0m" "$(abbrev "$total_in")" "$(abbrev "$ctx_size")")"
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
    five_str="$(printf '%.0f' "$five_pct")%"
    if [ -n "$five_reset" ]; then
        five_str="$five_str($(fmt_remaining "$five_reset"))"
    fi
    out="$out $(printf "\033[38;2;114;114;113m%s\033[0m" "$five_str")"
fi
if [ -n "$week_pct" ]; then
    week_str="$(printf '%.0f' "$week_pct")%"
    if [ -n "$week_reset" ]; then
        week_str="$week_str($(fmt_remaining "$week_reset"))"
    fi
    out="$out $(printf "\033[38;2;114;114;113m%s\033[0m" "$week_str")"
fi

printf "%s" "$out"
