#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uRadius;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	ivec2 size = textureSize(uTex, 0);
	float sigma = max(uRadius, 0.5);
	float step = max(sigma / 4.0, 1.0);
	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float fi = float(i);
		float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
		ivec2 q = px + ivec2(uDir * fi * step);
		q = clamp(q, ivec2(0), size - 1);
		sum += texelFetch(uTex, q, 0).rgb * w;
		wsum += w;
	}
	fragColor = vec4(wsum > 1e-6 ? sum / wsum : vec3(0.0), 1.0);
}
