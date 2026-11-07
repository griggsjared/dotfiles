void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = texture(iChannel0, uv);

    if (iCursorVisible == 0 || iCurrentCursor.z <= 0.0 || iCurrentCursor.w <= 0.0 || iTime - iTimeCursorChange < 10.0) {
        return;
    }

    float cycle = floor(iTime / 10.0);
    float start = fract(sin(cycle * 127.1 + 17.0) * 43758.5453) * 9.2;
    float duration = 0.08 + fract(sin(cycle * 311.7 + 23.0) * 43758.5453) * 0.72;
    float chance = fract(sin(cycle * 269.5 + 31.0) * 43758.5453);
    float phase = mod(iTime, 10.0) - start;
    if (chance < 0.4 || phase < 0.0 || phase >= duration) {
        return;
    }

    float speed = 0.025 + fract(sin(cycle * 183.3 + 47.0) * 43758.5453) * 0.045;
    float frame = floor(phase / speed);
    float flicker = fract(sin(frame * 93.7 + cycle * 57.1) * 43758.5453);
    if (flicker < 0.18) {
        return;
    }

    vec2 topLeft = iCurrentCursor.xy;
    vec2 bottomRight = topLeft + vec2(iCurrentCursor.z, -iCurrentCursor.w);
    if (fragCoord.y > topLeft.y || fragCoord.y < bottomRight.y) {
        return;
    }

    float bandHeight = max(1.0, iCurrentCursor.w / (5.0 + chance * 7.0));
    float band = floor((topLeft.y - fragCoord.y) / bandHeight);
    float pattern = fract(sin(band * 127.1 + frame * 311.7 + cycle * 74.7) * 43758.5453);
    float strength = min(10.0, max(4.0, iCurrentCursor.z * 0.4)) * (0.5 + flicker * 0.5);
    float offset = floor((pattern * 2.0 - 1.0) * strength);
    float sourceX = fragCoord.x - offset;
    bool insideCursor = fragCoord.x >= topLeft.x && fragCoord.x <= bottomRight.x;
    bool sourceInsideCursor = sourceX >= topLeft.x && sourceX <= bottomRight.x;

    if (insideCursor || sourceInsideCursor) {
        fragColor = texture(iChannel0, vec2(sourceX, fragCoord.y) / iResolution.xy);
    } else {
        float distanceX = max(topLeft.x - fragCoord.x, fragCoord.x - bottomRight.x);
        if (distanceX <= 12.0) {
            vec2 sparkCell = floor(vec2(fragCoord.x / 3.0, fragCoord.y / 2.0));
            float spark = fract(sin(dot(sparkCell, vec2(127.1, 311.7)) + frame * 74.7 + cycle * 53.3) * 43758.5453);
            if (spark > 0.88) {
                vec2 cursorSample = vec2(topLeft.x + iCurrentCursor.z * 0.5, fragCoord.y);
                fragColor = texture(iChannel0, cursorSample / iResolution.xy);
            }
        }
    }
}
