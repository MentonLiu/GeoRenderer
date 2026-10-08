#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform float uThreshold;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec3 c = texelFetch(uHDR, px, 0).rgb;
	fragColor = vec4(max(c - vec3(uThreshold), 0.0), 1.0);
}
